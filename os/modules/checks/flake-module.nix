{
  inputs,
  lib,
  ...
}: {
  perSystem = {
    pkgs,
    system,
    ...
  }: {
    checks = {
      formatting =
        pkgs.runCommand "formatting-check" {
          nativeBuildInputs = [pkgs.alejandra];
        } ''
          cd ${../../..}

          find . -type f -name '*.nix' -print0 \
            | xargs -0 alejandra --check

          touch $out
        '';

      deadnix =
        pkgs.runCommand "deadnix-check" {
          nativeBuildInputs = [pkgs.deadnix];
        } ''
          cd ${../../..}
          deadnix --fail .
          touch $out
        '';

      statix =
        pkgs.runCommand "statix-check" {
          nativeBuildInputs = [pkgs.statix];
        } ''
          cd ${../../..}
          statix check .
          touch $out
        '';

      # Ensure NixOS builds stay pure: no --impure flags in source, no impure
      # builtins, no channel-style nixpkgs imports.  pathExists in imports lists
      # is caught by the host-eval checks failing at nix flake check time.
      nixpi-purity-check =
        pkgs.runCommand "nixpi-purity-check" {
          nativeBuildInputs = [pkgs.ripgrep];
        } ''
          set -euo pipefail
          cd ${../../..}

          # Ban --impure in all source files (not .example docs, not tests, not markdown)
          ! rg -l \
              --glob '!**/*.example' \
              --glob '!**/tests/**' \
              --glob '!**/*.test.ts' \
              --glob '!**/*.md' \
              -e '--impure' \
              os/ hosts/ 2>/dev/null

          # Ban impure builtins in Nix source
          ! rg -l --glob '*.nix' \
              -e 'builtins\.(currentSystem|currentTime|getEnv)' \
              os/ hosts/ 2>/dev/null

          # Ban channel-style imports in Nix source
          ! rg -l --glob '*.nix' \
              -e 'import <' \
              os/ hosts/ 2>/dev/null

          touch $out
        '';

      nixpi-wiki-stale-identities =
        pkgs.runCommand "nixpi-wiki-stale-identities" {
          nativeBuildInputs = [pkgs.ripgrep];
        } ''
          set -euo pipefail
          cd ${../../..}

          # Keep the packaged wiki core free of stale private/fleet identities
          # without forbidding intentional NixPI branding or test fixtures.
          ! rg -ni --glob '!**/tests/**' --glob '!**/*.md' \
            '/home/alex|vps-nixos|evo-nixos|nixpi-mini-pc|syncthing|personal-second-brain|pi_llm|nixpi-tool|assistant-profile' \
            os/pkgs/nixpi-wiki

          touch $out
        '';

      nixpi-wiki-adapter-api-boundary =
        pkgs.runCommand "nixpi-wiki-adapter-api-boundary" {
          nativeBuildInputs = [pkgs.ripgrep];
        } ''
          set -euo pipefail
          cd ${../../..}

          ! rg -n --glob '!**/tests/**' --glob '!node_modules' --glob '!dist*' 'nixpi-wiki/src/(wiki|tools)' \
            os/pkgs/nixpi-pi-adapter \
            os/pkgs/nixpi-gateway \
            os/modules

          touch $out
        '';

      nixpi-wiki-npm-pack-smoke = pkgs.callPackage ./nixpi-wiki-npm-pack-smoke.nix {};

      # Build package derivations in flake checks so their package-local test suites run.
      nixpi-wiki-package = pkgs.nixpi-wiki;
      nixpi-gateway-package = pkgs.nixpi-gateway;
      nixpi-planner-package = pkgs.nixpi-planner;

      nixpi-pi-extension-startup-smoke =
        pkgs.runCommand "nixpi-pi-extension-startup-smoke" {
          nativeBuildInputs = [pkgs.pi];
        } ''
          set -euo pipefail

          export HOME="$TMPDIR/home"
          export PI_CODING_AGENT_DIR="$TMPDIR/agent"
          export PI_OFFLINE=1
          export NIXPI_WIKI_ROOT="$TMPDIR/wiki"
          export NIXPI_WIKI_WORKSPACE=smoke
          export NIXPI_WIKI_DEFAULT_DOMAIN=technical
          export NODE_PATH=${pkgs.pi}/lib/node_modules/@mariozechner/pi-coding-agent/node_modules:${pkgs.pi}/lib/node_modules
          mkdir -p "$HOME" "$PI_CODING_AGENT_DIR" "$NIXPI_WIKI_ROOT"

          set +e
          repo=${../../..}
          pi \
            --extension "$repo/os/pkgs/nixpi-pi-adapter/extensions/nixpi/nixpi" \
            --provider nonexistent \
            --model fake \
            --print \
            --no-tools \
            --no-session \
            'extension load smoke' >stdout.log 2>stderr.log
          status=$?
          set -e

          if grep -q 'Failed to load extension' stderr.log stdout.log; then
            cat stderr.log
            cat stdout.log
            exit 1
          fi
          grep -q 'Unknown provider' stderr.log
          test "$status" -ne 0

          touch $out
        '';

      nixpi-wiki-cli-smoke =
        pkgs.runCommand "nixpi-wiki-cli-smoke" {
          nativeBuildInputs = [pkgs.nixpi-wiki pkgs.jq];
        } ''
          set -euo pipefail
          export NIXPI_WIKI_ROOT="$TMPDIR/wiki"
          export NIXPI_WIKI_HOST="smoke-host"
          mkdir -p "$NIXPI_WIKI_ROOT/pages/resources/technical"
          cat > "$NIXPI_WIKI_ROOT/pages/resources/technical/smoke.md" <<'EOF'
          ---
          type: concept
          title: Smoke Page
          domain: technical
          areas: [tests]
          hosts: []
          status: active
          updated: 2026-04-27
          source_ids: []
          summary: Smoke page.
          ---
          # Smoke Page
          EOF
          nixpi-wiki list --json | jq -e 'all(.[]; .name | startswith("wiki_"))'
          nixpi-wiki list | grep wiki_status
          nixpi-wiki describe wiki_status | grep "Wiki Status"
          nixpi-wiki call wiki_status '{"domain":"technical"}' | grep "Pages: 1 total"
          nixpi-wiki context --format json | jq -e '.host == "smoke-host"'
          nixpi-wiki doctor --json > doctor.json || true
          jq -e '.checks[] | select(.name == "wiki-status") | .ok == true' doctor.json
          touch $out
        '';

      nixpi-gateway-module-eval = let
        eval = inputs.nixpkgs.lib.nixosSystem {
          inherit system;
          modules = [
            {
              nixpkgs.overlays = [
                (final: _prev: {
                  pi = final.writeShellScriptBin "pi" "exit 0";
                  nixpi-gateway = final.writeShellScriptBin "nixpi-gateway" "exit 0";
                  nixpi-planner = final.writeShellScriptBin "nixpi-planner" "exit 0";
                  nixpi-context = final.writeShellScriptBin "nixpi-context" "exit 0";
                  nixpi-health = final.writeShellScriptBin "nixpi-health" "exit 0";
                  nixpi-status = final.writeShellScriptBin "nixpi-status" "exit 0";
                  nixpi-wiki = final.writeShellScriptBin "nixpi-wiki" "exit 0";
                })
              ];
            }
            ../features/nixos/service-nixpi-gateway/module.nix
            {
              networking.hostName = "nixpi-gateway-module-test";
              system.stateVersion = "26.05";

              users.groups.gateway = {};
              users.users.gateway = {
                isSystemUser = true;
                group = "gateway";
              };

              services.nixpi-gateway = {
                enable = true;
                user = "gateway";
                group = "gateway";
                stateDir = "/var/lib/nixpi-gateway";
                settings = {
                  pi.cwd = "/srv/nixpi";
                  wiki.dir = "/srv/wiki";
                  transports = {
                    websocket = {
                      enable = true;
                      host = "127.0.0.1";
                      port = 8081;
                    };
                    whatsapp = {
                      enable = true;
                      ownerNumbers = ["+15550003333"];
                      allowedModels = [
                        "hf:moonshotai/Kimi-K2.6"
                        "hf:deepseek-ai/DeepSeek-V3.2"
                      ];
                      model = "synthetic/hf:deepseek-ai/DeepSeek-V3.2";
                    };
                  };
                };
              };
            }
          ];
        };
        service = eval.config.systemd.services.nixpi-gateway;
        execStart = service.serviceConfig.ExecStart;
        inherit (service) environment;
        inherit (service) serviceConfig;
      in
        assert lib.asserts.assertMsg (lib.hasInfix "/bin/nixpi-gateway" execStart) "nixpi-gateway ExecStart must invoke the configured package";
        assert lib.asserts.assertMsg (lib.hasInfix "nixpi-gateway.yml" execStart) "nixpi-gateway ExecStart must include generated YAML config";
        assert lib.asserts.assertMsg (environment.NIXPI_WIKI_ROOT == "/srv/wiki") "nixpi-gateway must expose the single wiki root";
        assert lib.asserts.assertMsg (!(builtins.hasAttr "NIXPI_WIKI_ROOTS" environment)) "nixpi-gateway must not expose split wiki roots";
        assert lib.asserts.assertMsg (!(builtins.hasAttr "NIXPI_WIKI_ROOT_TECHNICAL" environment)) "nixpi-gateway must not expose a split technical wiki root";
        assert lib.asserts.assertMsg (!(builtins.hasAttr "NIXPI_WIKI_ROOT_PERSONAL" environment)) "nixpi-gateway must not expose a split personal wiki root";
        assert lib.asserts.assertMsg (!(builtins.hasAttr "NIXPI_WIKI_ALLOWED_DOMAINS" environment)) "nixpi-gateway must not restrict domains inside the single wiki";
        assert lib.asserts.assertMsg (environment.PI_SYNTHETIC_API_KEY_FILE == "%d/synthetic_api_key") "nixpi-gateway must read the Synthetic key through a systemd credential";
        assert lib.asserts.assertMsg (environment.PI_CODING_AGENT_DIR == "/home/human/.pi/agent") "nixpi-gateway must use the normal Pi SDK agent directory";
        # ReadWritePaths intentionally absent: ProtectSystem is not set so the
        # gateway process (running as the primary user) can run privileged
        # operations via sudo (nixos-rebuild, systemctl, etc.).
        assert lib.asserts.assertMsg (!serviceConfig.NoNewPrivileges) "nixpi-gateway must not set NoNewPrivileges so that sudo works for privileged operations";
        assert lib.asserts.assertMsg (lib.elem "synthetic_api_key:/run/secrets/synthetic_api_key" serviceConfig.LoadCredential) "nixpi-gateway must load the Synthetic key credential";
        assert lib.asserts.assertMsg (lib.elem "nixpi-gateway/sessions" serviceConfig.StateDirectory) "nixpi-gateway must create session state with StateDirectory";
        assert lib.asserts.assertMsg (lib.elem "nixpi-gateway/whatsapp/auth" serviceConfig.StateDirectory) "nixpi-gateway must create whatsapp auth state with StateDirectory";
          pkgs.runCommand "nixpi-gateway-module-eval" {} ''
            touch $out
          '';

      nixpi-openssh-native-abuse-eval = let
        eval = inputs.nixpkgs.lib.nixosSystem {
          inherit system;
          modules = [
            ../features/nixos/service-openssh/module.nix
            {
              networking.hostName = "nixpi-openssh-native-abuse-test";
              system.stateVersion = "26.05";
            }
          ];
        };
        sshSettings = eval.config.services.openssh.settings;
      in
        assert lib.asserts.assertMsg (!sshSettings.PasswordAuthentication) "OpenSSH password authentication must stay disabled";
        assert lib.asserts.assertMsg (!sshSettings.KbdInteractiveAuthentication) "OpenSSH keyboard-interactive authentication must stay disabled";
        assert lib.asserts.assertMsg (sshSettings.PerSourceMaxStartups == 3) "OpenSSH must limit unauthenticated startups per source";
        assert lib.asserts.assertMsg (sshSettings.PerSourcePenalties != null) "OpenSSH per-source penalties must be configured";
        assert lib.asserts.assertMsg eval.config.networking.nftables.enable "nftables must be enabled by default";
        assert lib.asserts.assertMsg (!(builtins.hasAttr "reaction" eval.config.systemd.services)) "reaction.service must not be present";
          pkgs.runCommand "nixpi-openssh-native-abuse-eval" {} ''
            touch $out
          '';

      nixpi-vps-security-eval = let
        vps = inputs.self.nixosConfigurations.nixpi-vps;
        ssh = vps.config.services.openssh;
        gateway = vps.config.services.nixpi-gateway;
        wikiHealth = vps.config.systemd.services.nixpi-wiki-health-snapshot;
        wikiHealthScript = wikiHealth.script or "";
      in
        assert lib.asserts.assertMsg (ssh.enable && ssh.openFirewall) "nixpi-vps must expose OpenSSH intentionally";
        assert lib.asserts.assertMsg (ssh.ports == [22 2222]) "nixpi-vps must keep both recovery SSH ports";
        assert lib.asserts.assertMsg (ssh.settings.PermitRootLogin == "no") "nixpi-vps must not permit root SSH login";
        assert lib.asserts.assertMsg (!ssh.settings.PasswordAuthentication) "nixpi-vps must not permit SSH password auth";
        assert lib.asserts.assertMsg vps.config.services.fail2ban.enable "nixpi-vps must keep fail2ban enabled";
        assert lib.asserts.assertMsg (vps.config.services.fail2ban.jails.sshd.settings.port == "ssh,2222") "fail2ban sshd jail must cover both SSH ports";
        assert lib.asserts.assertMsg gateway.enable "nixpi-vps must keep the transport gateway enabled";
        assert lib.asserts.assertMsg gateway.settings.audioTranscription.enabled "nixpi-vps gateway must keep audio transcription enabled";
        assert lib.asserts.assertMsg (!(gateway.settings.transports.whatsapp.enable or false) || gateway.settings.transports.whatsapp.directMessagesOnly) "nixpi-vps WhatsApp transport must stay direct-message-only when enabled";
        assert lib.asserts.assertMsg (!(gateway.settings.transports.whatsapp.enable or false) || gateway.settings.transports.whatsapp.ownerNumbers != []) "nixpi-vps WhatsApp owner allowlist must not be empty when enabled";
        assert lib.asserts.assertMsg (builtins.hasAttr "nixpi-wiki-health-snapshot" vps.config.systemd.timers) "nixpi-vps must declare the read-only wiki health snapshot timer";
        assert lib.asserts.assertMsg (wikiHealth.serviceConfig.User == vps.config.nixpi.human.name) "wiki health snapshot must run as the primary user";
        assert lib.asserts.assertMsg (wikiHealth.serviceConfig.WorkingDirectory == vps.config.nixpi.root) "wiki health snapshot must run from the NixPI repo root";
        assert lib.asserts.assertMsg (wikiHealth.serviceConfig.StateDirectory == "nixpi-wiki-health") "wiki health snapshot must write state outside the Git repo";
        assert lib.asserts.assertMsg (lib.hasInfix "export HOME=" wikiHealthScript) "wiki health snapshot must set HOME";
        assert lib.asserts.assertMsg (lib.hasInfix "nixpi-wiki call wiki_status" wikiHealthScript) "wiki health snapshot must use nixpi-wiki";
        assert lib.asserts.assertMsg (lib.hasInfix "/var/lib/nixpi-wiki-health/technical.status" wikiHealthScript) "wiki health snapshot must write outside the repository";
        assert lib.asserts.assertMsg (vps.config.systemd.timers.nixpi-wiki-health-snapshot.timerConfig.OnCalendar == "*-*-* 04:15:00") "wiki health snapshot must run daily";
        assert lib.asserts.assertMsg (builtins.hasAttr "synthetic_api_key" vps.config.sops.secrets) "nixpi-vps must declare the Synthetic API key secret when secrets.yaml exists";
          pkgs.runCommand "nixpi-vps-security-eval" {} ''
            touch $out
          '';

      # ---------------------------------------------------------------------------
      # NixOS integration tests (pkgs.testers.runNixOSTest)
      # Each file in nixos-tests/ is a function { pkgs, lib, ... } -> runNixOSTest.
      # ---------------------------------------------------------------------------

      nixos-planner-radicale = import ./nixos-tests/planner-radicale.nix {inherit lib pkgs;};

      nixos-ollama-smoke = import ./nixos-tests/ollama-smoke.nix {inherit lib pkgs;};

      nixos-planner-pi-e2e = import ./nixos-tests/planner-pi-e2e.nix {inherit lib pkgs;};

      nixos-gateway-loopback = import ./nixos-tests/gateway-loopback.nix {inherit lib pkgs;};

      nixos-nixpi-services-boot-smoke = import ./nixos-tests/nixpi-services-boot-smoke.nix {inherit lib pkgs;};

      nixpi-host-configurations-eval = let
        vps = inputs.self.nixosConfigurations.nixpi-vps;
        expectedPiExtensions = [
          "nixpi"
        ];
        expectedPiPackages = [
          "git:github.com/aliou/pi-synthetic@v0.15.0"
        ];
        assertFleet = name: host: let
          userHome = host.config.nixpi.human.homeDirectory;
        in
          assert lib.asserts.assertMsg (host.config.environment.sessionVariables.NIXPI_ROOT == "${userHome}/NixPI") "${name} must export NIXPI_ROOT";
          assert lib.asserts.assertMsg (host.config.environment.sessionVariables.NIXPI_WIKI_ROOT == "${userHome}/wiki") "${name} must export the NixPI wiki root as ~/wiki";
          assert lib.asserts.assertMsg (host.config.environment.sessionVariables.NIXPI_WIKI_WORKSPACE == "nixpi") "${name} must export the NixPI NixPI wiki workspace label"; true;
        assertHost = name: host: let
          activationText = host.config.system.activationScripts.nixpi-pi-settings.text or "";
          userHome = host.config.nixpi.human.homeDirectory;
          hasPackage = packageName: lib.any (package: lib.getName package == packageName) host.config.environment.systemPackages;
          gatewayEnabled = host.config.services.nixpi-gateway.enable or false;
          gatewayPiAgentDir = host.config.services.nixpi-gateway.settings.pi.agentDir or "";
          gatewayServiceConfig = host.config.systemd.services.nixpi-gateway.serviceConfig or {};
        in
          assert lib.asserts.assertMsg (host.config.system.build.toplevel.drvPath != "") "${name} toplevel must evaluate";
          assert lib.asserts.assertMsg host.config.services.userborn.enable "${name} must use Userborn";
          assert lib.asserts.assertMsg host.config.boot.initrd.systemd.enable "${name} must use systemd initrd";
          assert lib.asserts.assertMsg host.config.system.etc.overlay.enable "${name} must use the /etc overlay";
          assert lib.asserts.assertMsg host.config.system.nixos-init.enable "${name} must enable nixos-init";
          assert lib.asserts.assertMsg (builtins.hasAttr "safe" host.config.specialisation) "${name} must expose the safe specialisation";
          assert lib.asserts.assertMsg (!host.config.specialisation.safe.configuration.system.nixos-init.enable) "${name} safe specialisation must disable nixos-init";
          assert lib.asserts.assertMsg (host.config.nixpi.pi.extensions == expectedPiExtensions) "${name} must declare the shared PI extension set";
          assert lib.asserts.assertMsg (host.config.nixpi.pi.packages == expectedPiPackages) "${name} must declare the shared PI package set";
          assert lib.asserts.assertMsg (host.config.nixpi.role != "common") "${name} must declare a concrete role";
          assert lib.asserts.assertMsg (host.config.nixpi.role == "server" -> !hasPackage "chromium") "${name} server role must not inherit desktop browser packages";
          assert lib.asserts.assertMsg (host.config.nixpi.role != "server" -> (hasPackage "chromium" || hasPackage "firefox")) "${name} desktop-capable role must keep desktop browser packages";
          assert lib.asserts.assertMsg (!gatewayEnabled || gatewayPiAgentDir == "${userHome}/.pi/agent") "${name} gateway must use the normal Pi SDK agent directory";
          assert lib.asserts.assertMsg (!gatewayEnabled || gatewayServiceConfig.UMask == "0077") "${name} gateway must use private file creation mask";
          assert lib.asserts.assertMsg (!gatewayEnabled || gatewayServiceConfig.StateDirectoryMode == "0700") "${name} gateway state directory must be private";
          assert lib.asserts.assertMsg (activationText != "") "${name} must define the PI activation script";
          assert lib.asserts.assertMsg (lib.hasInfix "${userHome}/.pi/agent/settings.json" activationText) "${name} PI activation must manage settings.json";
          assert lib.asserts.assertMsg (lib.hasInfix "nixpi-pi-settings.json" activationText) "${name} PI activation must consume generated declarative settings";
          assert assertFleet name host; true;
      in
        assert assertHost "nixpi-vps" vps;
          pkgs.runCommand "nixpi-host-configurations-eval" {} ''
            touch $out
          '';
    };
  };
}
