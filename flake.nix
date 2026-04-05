# flake.nix
{
  description = "NixPI — Pi-native AI companion OS on NixOS";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    disko = {
      url = "github:nix-community/disko";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nixos-hardware.url = "github:NixOS/nixos-hardware";
  };

  outputs = { self, nixpkgs, disko, nixos-hardware, ... }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      lib = nixpkgs.lib;
      nixpiSource = lib.cleanSource ./.;
      bootstrapPackage = pkgs.callPackage ./core/os/pkgs/bootstrap {};
      installerHelper = pkgs.callPackage ./core/os/pkgs/installer {
        inherit nixpiSource piAgent appPackage setupApplyPackage self;
      };
      setupApplyPackage = pkgs.callPackage ./core/os/pkgs/nixpi-setup-apply {};
      # pkgsUnfree is used only for boot nixosTest.  pkgs.testers.nixosTest
      # injects its own pkgs as nixpkgs.pkgs for test nodes, which means modules
      # cannot set nixpkgs.config (NixOS assertion).  Using a pkgs already created
      # with allowUnfree = true sidesteps the issue without touching any module.
      pkgsUnfree = import nixpkgs { inherit system; config.allowUnfree = true; };
      piAgent = pkgs.callPackage ./core/os/pkgs/pi {};
      appPackage = pkgs.callPackage ./core/os/pkgs/app { inherit piAgent; };

      specialArgs = { inherit piAgent appPackage self installerHelper disko setupApplyPackage; };
    in {
      packages.${system} = {
        pi = piAgent;
        app = appPackage;
        nixpi-bootstrap-vps = bootstrapPackage;
        nixpi-installer = installerHelper;
        nixpi-setup-apply = setupApplyPackage;
        installerIso = self.nixosConfigurations.installer-iso.config.system.build.isoImage;
      };

      formatter.${system} = pkgs.nixfmt-rfc-style;

      nixosModules = {
        # Minimal installed NixPI base without the Pi runtime, collab stack,
        # desktop shell, or operator tooling bundle.
        nixpi-base-no-shell = { ... }: {
          imports = [
            ./core/os/modules/options.nix
            ./core/os/modules/network.nix
            ./core/os/modules/update.nix
          ];
        };

        # Minimal installed NixPI base with the operator shell/bootstrap path.
        nixpi-base = { ... }: {
          imports = [
            self.nixosModules.nixpi-base-no-shell
            ./core/os/modules/shell.nix
          ];
        };

        # Portable NixPI module set without the operator shell/user module.
        # Useful for tests that intentionally define their own primary user.
        nixpi-no-shell = { piAgent, appPackage, ... }: {
          imports = [
            self.nixosModules.nixpi-base-no-shell
            ./core/os/modules/runtime.nix
            ./core/os/modules/collab.nix
            ./core/os/modules/tooling.nix
            ./core/os/modules/setup-apply.nix
          ];
        };

        # Single composable module exporting all NixPI feature modules.
        # Consuming flake.nix must provide piAgent and appPackage in specialArgs.
        nixpi = { piAgent, appPackage, ... }: {
          imports = [
            self.nixosModules.nixpi-no-shell
            ./core/os/modules/shell.nix
          ];
          # allowUnfree is intentionally NOT set here.
          # nixpkgs.config cannot be set in a module that is used inside
          # pkgs.testers.nixosTest (the test framework injects an externally
          # created pkgs, making the NixOS module system reject nixpkgs.config
          # overrides).  Consuming configurations set allowUnfree themselves.
        };

        # First-boot service module (included separately, not part of the portable NixPI module).
        firstboot = import ./core/os/modules/firstboot;
      };

      # Canonical NixPI headless VPS profile used for local builds and the default installed system.
      nixosConfigurations.vps = nixpkgs.lib.nixosSystem {
        inherit system specialArgs;
        modules = [
          ./core/os/hosts/vps.nix
          {
            nixpkgs.hostPlatform = system;
            nixpkgs.config.allowUnfree = true;
          }
        ];
      };

      nixosConfigurations.nixpi = self.nixosConfigurations.vps;

      # Compatibility alias for downstream code that still expects the legacy desktop output name.
      nixosConfigurations.desktop = nixpkgs.lib.nixosSystem {
        inherit system specialArgs;
        modules = [
          ./core/os/hosts/x86_64.nix
          {
            nixpkgs.hostPlatform = system;
            nixpkgs.config.allowUnfree = true;
          }
        ];
      };

      # Raspberry Pi 4 target (aarch64-linux).
      # Build on native aarch64 hardware or with binfmt/QEMU:
      #   nix build .#nixosConfigurations.rpi4.config.system.build.toplevel
      nixosConfigurations.rpi4 = nixpkgs.lib.nixosSystem {
        system = "aarch64-linux";
        specialArgs = specialArgs // { inherit nixos-hardware; };
        modules = [
          nixos-hardware.nixosModules.raspberry-pi-4
          ./core/os/hosts/rpi4.nix
          {
            nixpkgs.hostPlatform = "aarch64-linux";
            nixpkgs.config.allowUnfree = true;
          }
        ];
      };

      # Raspberry Pi 5 target (aarch64-linux).
      nixosConfigurations.rpi5 = nixpkgs.lib.nixosSystem {
        system = "aarch64-linux";
        specialArgs = specialArgs // { inherit nixos-hardware; };
        modules = [
          nixos-hardware.nixosModules.raspberry-pi-5
          ./core/os/hosts/rpi5.nix
          {
            nixpkgs.hostPlatform = "aarch64-linux";
            nixpkgs.config.allowUnfree = true;
          }
        ];
      };

      # Minimal installer ISO built on top of the standard NixOS minimal image.
      nixosConfigurations.installer-iso = nixpkgs.lib.nixosSystem {
        inherit system specialArgs;
        modules = [
          ./core/os/hosts/installer-iso.nix
        ];
      };

      # NixOS configuration that mirrors a default NixPI install
      # (nixpi + firstboot + the standard machine defaults).
      # Used by checks.config and checks.boot below.
      nixosConfigurations.installed-test = nixpkgs.lib.nixosSystem {
        inherit system specialArgs;
        modules = [
          ./core/os/hosts/vps.nix
          {
            nixpkgs.hostPlatform = system;
            nixpkgs.config.allowUnfree = true;
            nixpi.primaryUser = "alex";
            networking.hostName = "nixos";
            fileSystems."/" = { device = "/dev/vda"; fsType = "ext4"; };
            fileSystems."/boot" = { device = "/dev/vda1"; fsType = "vfat"; };
          }
        ];
      };

      checks.${system} =
        let
          installerFrontendSource = ./core/os/pkgs/installer/nixpi-installer.sh;
          bootstrapScriptSource = ./core/os/pkgs/bootstrap/nixpi-bootstrap-vps.sh;
          mkInstallerGeneratedConfig = {
            rootDevice,
            bootDevice,
          }: (nixpkgs.lib.nixosSystem {
            inherit system specialArgs;
            modules = [
              ({ config, ... }: {
                imports = [
                  "${nixpiSource}/core/os/modules/firstboot/default.nix"
                  "${nixpiSource}/core/os/modules/network.nix"
                  "${nixpiSource}/core/os/modules/shell.nix"
                  "${nixpiSource}/core/os/modules/update.nix"
                  "${nixpiSource}/core/os/modules/app.nix"
                  "${nixpiSource}/core/os/modules/service-surface.nix"
                  "${nixpiSource}/core/os/modules/setup-apply.nix"
                ];

                networking.hostName = "nixpi";
                time.timeZone = "UTC";
                i18n.defaultLocale = "en_US.UTF-8";
                nixpkgs.config.allowUnfree = true;
                nix.settings.experimental-features = [ "nix-command" "flakes" ];
                nixpi.primaryUser = "human";
                users.groups.human = {};
                users.users.human = {
                  isNormalUser = true;
                  group = "human";
                  extraGroups = [ "networkmanager" ];
                  initialPassword = "installerpass123";
                };
                system.activationScripts.nixpi-bootstrap-primary-password = ''
                  bootstrapPasswordFile="${config.nixpi.stateDir}/bootstrap/primary-user-password"
                  install -d -m 0755 -o root -g root "$(dirname "$bootstrapPasswordFile")"
                  install -m 0600 -o root -g root /dev/null "$bootstrapPasswordFile"
                  printf '%s' "installerpass123" > "$bootstrapPasswordFile"
                '';
                boot.loader.systemd-boot.enable = true;
                boot.loader.efi.canTouchEfiVariables = true;
                fileSystems."/" = {
                  device = rootDevice;
                  fsType = "ext4";
                };
                fileSystems."/boot" = {
                  device = bootDevice;
                  fsType = "vfat";
                };
                system.stateVersion = "25.05";
              })
            ];
          }).config.system.build.toplevel;
          # Import the NixOS integration test suite
          # Using pkgsUnfree so tests can use packages that require allowUnfree
          nixosTests = import ./tests/nixos {
            pkgs = pkgsUnfree;
            inherit lib piAgent appPackage self installerHelper setupApplyPackage;
          };
          bootCheck = pkgsUnfree.testers.runNixOSTest {
            name = "boot";

            nodes.nixpi = { ... }: {
              imports = [
                ./core/os/hosts/vps.nix
              ];
              _module.args = { inherit piAgent appPackage self; };

              nixpi.primaryUser = "alex";

              networking.hostName = "nixos";

              # Give the VM enough disk for the NixPI closure
              virtualisation.diskSize = 20480;  # 20 GB
              virtualisation.memorySize = 4096;
            };

            testScript = ''
              nixpi = machines[0]

              nixpi.start()
              nixpi.wait_for_unit("multi-user.target", timeout=300)

              # Basic sanity: the default operator exists and bootstrap tooling is installed
              nixpi.succeed("id alex")

              nixpi.succeed("command -v nixpi-bootstrap")

              # NetworkManager is running
              nixpi.succeed("systemctl is-active NetworkManager")
            '';
          };
          mkCheckLane = name: entries:
            pkgs.linkFarm name entries;
          diskoLayoutsCheck = pkgs.runCommandLocal "disko-layouts-check" {
            nativeBuildInputs = [ pkgs.nix ];
          } ''
            nix-instantiate --parse \
              ${./core/os/installer/layouts/default.nix} >/dev/null

            grep -F '"@DISK@"' ${./core/os/installer/layouts/default.nix} >/dev/null
            grep -F 'end = "-8G";' ${./core/os/installer/layouts/default.nix} >/dev/null
            grep -F 'size = "8G";' ${./core/os/installer/layouts/default.nix} >/dev/null
            grep -F 'disko.devices' ${./core/os/installer/layouts/default.nix} >/dev/null
            touch "$out"
          '';
        in
        {
          # Fast: build the installed system closure locally — catches locale
          # errors, module conflicts, bad package references, and NixOS
          # evaluation failures without touching QEMU.
          config = self.nixosConfigurations.installed-test.config.system.build.toplevel;

          # Validate installer script syntax and the new installer packaging shape.
          installer-frontend = pkgs.runCommandLocal "installer-frontend-check" { } ''
            bash -n "${installerFrontendSource}"
            ! test -e "${installerHelper}/share/nixpi-installer/nixpi-install-module.nix.in"
            ! grep -F -- '--prefill' ${./core/os/pkgs/installer/nixpi-installer.sh} >/dev/null
            ! grep -F 'PREFILL_' ${./core/os/pkgs/installer/nixpi-installer.sh} >/dev/null
            ! grep -F -- '--layout' ${./core/os/pkgs/installer/nixpi-installer.sh} >/dev/null
            ! grep -F -- '--swap-size' ${./core/os/pkgs/installer/nixpi-installer.sh} >/dev/null
            grep -F 'HOSTNAME_VALUE="nixpi"' "${installerHelper}/share/nixpi-installer/nixpi-installer.sh" >/dev/null
            grep -F 'PRIMARY_USER_VALUE="human"' "${installerHelper}/share/nixpi-installer/nixpi-installer.sh" >/dev/null
            ! grep -F -- '--prefill' "${installerHelper}/share/nixpi-installer/nixpi-installer.sh" >/dev/null
            ! grep -F 'PREFILL_' "${installerHelper}/share/nixpi-installer/nixpi-installer.sh" >/dev/null
            ! grep -F -- '--layout' "${installerHelper}/share/nixpi-installer/nixpi-installer.sh" >/dev/null
            ! grep -F -- '--swap-size' "${installerHelper}/share/nixpi-installer/nixpi-installer.sh" >/dev/null
            grep -F 'CONFIG_SOURCE_DIR="@configSourceDir@"' "${installerFrontendSource}" >/dev/null
            grep -F 'validate_system_closure()' "${installerFrontendSource}" >/dev/null
            grep -F -- '--system only supports the baked desktop closure:' "${installerFrontendSource}" >/dev/null
            ! grep -F '. "$prefill_path"' "${installerFrontendSource}" >/dev/null
            ! grep -F 'Hostname [' "${installerHelper}/share/nixpi-installer/nixpi-installer.sh" >/dev/null
            ! grep -F 'Primary user [' "${installerHelper}/share/nixpi-installer/nixpi-installer.sh" >/dev/null
            ! grep -F -- '--hostname)' "${installerFrontendSource}" >/dev/null
            ! grep -F -- '--primary-user)' "${installerFrontendSource}" >/dev/null
            grep -F 'DESKTOP_SYSTEM="@desktopSystem@"' "${installerFrontendSource}" >/dev/null
            grep -F "${self.nixosConfigurations.desktop.config.system.build.toplevel}" "${installerHelper}/share/nixpi-installer/nixpi-installer.sh" >/dev/null
            test -e "${installerHelper}/share/nixpi-installer/nixpi-config/core/os/hosts/x86_64.nix"
            grep -F './nixpi-config/core/os/hosts/x86_64.nix' "${installerHelper}/share/nixpi-installer/nixpi-installer.sh" >/dev/null
            grep -F '_module.args = {' "${installerHelper}/share/nixpi-installer/nixpi-installer.sh" >/dev/null
            touch "$out"
          '';

          setup-apply-package = pkgs.runCommandLocal "setup-apply-package-check" { } ''
            bash -n "${./core/scripts/nixpi-setup-apply.sh}"
            wrapped="${setupApplyPackage}/bin/nixpi-setup-apply"
            ! grep -E '/jq-[^/]+/bin' "$wrapped"
            ! grep -E '/git-[^/]+/bin' "$wrapped"
            ! grep -F 'SETUP_NAME is required' "${./core/scripts/nixpi-setup-apply.sh}"
            ! grep -F 'SETUP_EMAIL is required' "${./core/scripts/nixpi-setup-apply.sh}"
            ! grep -F 'SETUP_USERNAME is required' "${./core/scripts/nixpi-setup-apply.sh}"
            ! grep -F 'SETUP_PASSWORD is required' "${./core/scripts/nixpi-setup-apply.sh}"
            ! grep -F 'git clone' "${./core/scripts/nixpi-setup-apply.sh}"
            ! grep -F 'nixos-rebuild switch' "${./core/scripts/nixpi-setup-apply.sh}"
            ! grep -F 'jq --arg key' "${./core/scripts/nixpi-setup-apply.sh}"
            touch "$out"
          '';

          bootstrap-script = pkgs.runCommandLocal "bootstrap-script-check" { } ''
            test -x "${bootstrapPackage}/bin/nixpi-bootstrap-vps"
            test -x "${bootstrapScriptSource}"
            grep -F 'REPO_DIR="/srv/nixpi"' "${bootstrapScriptSource}" >/dev/null
            grep -F 'REPO_URL="''${NIXPI_REPO_URL:-https://github.com/alexradunet/nixpi.git}"' "${bootstrapScriptSource}" >/dev/null
            grep -F 'BRANCH="''${NIXPI_REPO_BRANCH:-main}"' "${bootstrapScriptSource}" >/dev/null
            grep -F '/srv/nixpi' "${bootstrapScriptSource}" >/dev/null
            grep -F 'run_as_root install -d -m 0755 /srv' "${bootstrapScriptSource}" >/dev/null
            grep -F 'run_as_root git clone --branch "$BRANCH" "$REPO_URL" "$REPO_DIR"' "${bootstrapScriptSource}" >/dev/null
            grep -F 'run_as_root git -C "$REPO_DIR" fetch origin "$BRANCH"' "${bootstrapScriptSource}" >/dev/null
            grep -F 'run_as_root git -C "$REPO_DIR" checkout "$BRANCH"' "${bootstrapScriptSource}" >/dev/null
            grep -F 'run_as_root git -C "$REPO_DIR" reset --hard "origin/$BRANCH"' "${bootstrapScriptSource}" >/dev/null
            grep -F 'nixos-rebuild switch --flake /srv/nixpi#nixpi' "${bootstrapScriptSource}" >/dev/null
            ! test -e ${./.}/tools/run-installer-iso.sh
            touch "$out"
          '';

          flake-topology = pkgs.runCommandLocal "flake-topology-check" { } ''
            ! grep -F 'desktop-vm' ${./flake.nix}
            ! test -e ${./.}/core/os/hosts/x86_64-vm.nix
            ! test -e ${./.}/tools/run-qemu.sh
            grep -F 'self.nixosConfigurations.desktop.config.system.build.toplevel' ${./core/os/hosts/installer-iso.nix} >/dev/null
            grep -F 'services.fail2ban.enable = lib.mkForce false;' ${./core/os/hosts/installer-iso.nix} >/dev/null
            touch "$out"
          '';

          vps-topology = pkgs.runCommandLocal "vps-topology-check" { } ''
            grep -F 'nixosConfigurations.vps' ${./flake.nix} >/dev/null
            ! grep -F 'Managed NixPI desktop profile' ${./flake.nix} >/dev/null
            grep -F './core/os/hosts/vps.nix' ${./flake.nix} >/dev/null
            grep -F 'headless VPS profile' ${./core/os/hosts/vps.nix} >/dev/null
            sed -n '/nixosConfigurations.installed-test = nixpkgs.lib.nixosSystem {/,/checks\.\${system} =/p' ${./flake.nix} \
              | grep -F './core/os/hosts/vps.nix' >/dev/null
            sed -n '/bootCheck = pkgsUnfree.testers.runNixOSTest {/,/mkCheckLane = name: entries:/p' ${./flake.nix} \
              | grep -F './core/os/hosts/vps.nix' >/dev/null
            smoke_block="$(sed -n '/nixos-smoke = mkCheckLane "nixos-smoke" \[/,/nixos-full = mkCheckLane "nixos-full" \[/p' ${./flake.nix})"
            printf '%s\n' "$smoke_block" | grep -F '{ name = "disko-layouts"; path = diskoLayoutsCheck; }' >/dev/null
            printf '%s\n' "$smoke_block" | grep -F '{ name = "nixpi-vps-bootstrap"; path = nixosTests.nixpi-vps-bootstrap; }' >/dev/null
            printf '%s\n' "$smoke_block" | grep -F '{ name = "nixpi-chat"; path = nixosTests.nixpi-chat; }' >/dev/null
            printf '%s\n' "$smoke_block" | grep -F '{ name = "nixpi-security"; path = nixosTests.nixpi-security; }' >/dev/null
            printf '%s\n' "$smoke_block" | grep -F '{ name = "nixpi-broker"; path = nixosTests.nixpi-broker; }' >/dev/null
            printf '%s\n' "$smoke_block" | grep -F '{ name = "nixpi-installer-smoke"; path = nixosTests.nixpi-installer-smoke; }' >/dev/null
            vps_bootstrap_line="$(printf '%s\n' "$smoke_block" | grep -nF '{ name = "nixpi-vps-bootstrap"; path = nixosTests.nixpi-vps-bootstrap; }' | cut -d: -f1)"
            chat_line="$(printf '%s\n' "$smoke_block" | grep -nF '{ name = "nixpi-chat"; path = nixosTests.nixpi-chat; }' | cut -d: -f1)"
            security_line="$(printf '%s\n' "$smoke_block" | grep -nF '{ name = "nixpi-security"; path = nixosTests.nixpi-security; }' | cut -d: -f1)"
            broker_line="$(printf '%s\n' "$smoke_block" | grep -nF '{ name = "nixpi-broker"; path = nixosTests.nixpi-broker; }' | cut -d: -f1)"
            installer_smoke_line="$(printf '%s\n' "$smoke_block" | grep -nF '{ name = "nixpi-installer-smoke"; path = nixosTests.nixpi-installer-smoke; }' | cut -d: -f1)"
            test "$vps_bootstrap_line" -lt "$chat_line"
            test "$chat_line" -lt "$security_line"
            test "$security_line" -lt "$broker_line"
            test "$broker_line" -lt "$installer_smoke_line"
            touch "$out"
          '';

          disko-layouts = diskoLayoutsCheck;

          installer-generated-config = mkInstallerGeneratedConfig {
            rootDevice = "/dev/vda2";
            bootDevice = "/dev/vda1";
          };

          installer-generated-config-nvme = mkInstallerGeneratedConfig {
            rootDevice = "/dev/nvme0n1p2";
            bootDevice = "/dev/nvme0n1p1";
          };

          installer-generated-config-sata = mkInstallerGeneratedConfig {
            rootDevice = "/dev/sda2";
            bootDevice = "/dev/sda1";
          };

          installer-iso = self.nixosConfigurations.installer-iso.config.system.build.isoImage;

          # Thorough: boot the installed system in a NixOS test VM and verify
          # that critical services come up.
          boot = bootCheck;

          nixos-smoke = mkCheckLane "nixos-smoke" [
            { name = "disko-layouts"; path = diskoLayoutsCheck; }
            { name = "nixpi-vps-bootstrap"; path = nixosTests.nixpi-vps-bootstrap; }
            { name = "nixpi-chat"; path = nixosTests.nixpi-chat; }
            { name = "nixpi-security"; path = nixosTests.nixpi-security; }
            { name = "nixpi-broker"; path = nixosTests.nixpi-broker; }
            { name = "nixpi-installer-smoke"; path = nixosTests.nixpi-installer-smoke; }
          ];

          nixos-full = mkCheckLane "nixos-full" [
            { name = "boot"; path = bootCheck; }
            { name = "nixpi-firstboot"; path = nixosTests.nixpi-firstboot; }
            { name = "nixpi-network"; path = nixosTests.nixpi-network; }
            { name = "nixpi-e2e"; path = nixosTests.nixpi-e2e; }
            { name = "nixpi-security"; path = nixosTests.nixpi-security; }
            { name = "nixpi-modular-services"; path = nixosTests.nixpi-modular-services; }
            { name = "nixpi-bootstrap-mode"; path = nixosTests.nixpi-bootstrap-mode; }
            { name = "nixpi-post-setup-lockdown"; path = nixosTests.nixpi-post-setup-lockdown; }
            { name = "nixpi-broker"; path = nixosTests.nixpi-broker; }
            { name = "nixpi-update"; path = nixosTests.nixpi-update; }
            { name = "nixpi-options-validation"; path = nixosTests.nixpi-options-validation; }
          ];

          nixos-destructive = mkCheckLane "nixos-destructive" [
            { name = "nixpi-installer-smoke"; path = nixosTests.nixpi-installer-smoke; }
            { name = "nixpi-post-setup-lockdown"; path = nixosTests.nixpi-post-setup-lockdown; }
            { name = "nixpi-broker"; path = nixosTests.nixpi-broker; }
          ];
        }
        // nixosTests;  # Merge in the new test suite

      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [
          # JavaScript / TypeScript
          nodejs
          typescript
          biome

          # Linting & utilities
          nixfmt-rfc-style
          statix
          shellcheck
          jq
          curl
          git
          just
        ];

        # Note: vitest is not in nixpkgs-unstable — use 'npm install' then 'npx vitest'

        shellHook = ''
          echo "NixPI dev shell"
          echo "Run 'npm install' to set up JS dependencies (includes vitest)"
        '';
      };
    };
}
