{
  inputs,
  lib,
  pkgs,
  system,
}: let
  eval = inputs.nixpkgs.lib.nixosSystem {
    inherit system;
    modules = [
      {
        nixpkgs.overlays = [
          (final: _prev: {
            pi = final.writeShellScriptBin "pi" "exit 0";
            ownloom-gateway = final.writeShellScriptBin "ownloom-gateway" "exit 0";
            ownloom-planner = final.writeShellScriptBin "ownloom-planner" "exit 0";
            ownloom-context = final.writeShellScriptBin "ownloom-context" "exit 0";
            ownloom-wiki = final.writeShellScriptBin "ownloom-wiki" "exit 0";
          })
        ];
      }
      ../../features/nixos/service-gateway/module.nix
      {
        networking.hostName = "ownloom-gateway-module-test";
        system.stateVersion = "26.05";

        users.groups.gateway = {};
        users.users.gateway = {
          isSystemUser = true;
          group = "gateway";
        };

        services.ownloom-gateway = {
          enable = true;
          user = "gateway";
          group = "gateway";
          stateDir = "/var/lib/ownloom-gateway";
          settings = {
            pi.cwd = "/srv/ownloom";
            wiki.dir = "/srv/wiki";
            transports = {
              client = {
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
  service = eval.config.systemd.services.ownloom-gateway;
  execStart = service.serviceConfig.ExecStart;
  inherit (service) environment serviceConfig;
in
  assert lib.asserts.assertMsg (lib.hasInfix "/bin/ownloom-gateway" execStart) "ownloom-gateway ExecStart must invoke the configured package";
  assert lib.asserts.assertMsg (lib.hasInfix "ownloom-gateway.yml" execStart) "ownloom-gateway ExecStart must include generated YAML config";
  assert lib.asserts.assertMsg (environment.OWNLOOM_WIKI_ROOT == "/srv/wiki") "ownloom-gateway must expose the compatibility/default wiki root";
  assert lib.asserts.assertMsg (environment.OWNLOOM_WIKI_ROOT_PERSONAL == "/home/human/wiki") "ownloom-gateway must expose the personal wiki root";
  assert lib.asserts.assertMsg (environment.OWNLOOM_WIKI_ROOT_TECHNICAL == "/var/lib/ownloom/wiki") "ownloom-gateway must expose the technical wiki root";
  assert lib.asserts.assertMsg (!(builtins.hasAttr "OWNLOOM_WIKI_ALLOWED_DOMAINS" environment)) "ownloom-gateway must not restrict wiki domains";
  assert lib.asserts.assertMsg (environment.PI_SYNTHETIC_API_KEY_FILE == "%d/synthetic_api_key") "ownloom-gateway must read the Synthetic key through a systemd credential";
  assert lib.asserts.assertMsg (environment.PI_CODING_AGENT_DIR == "/home/human/.pi/agent") "ownloom-gateway must use the normal Pi SDK agent directory";
  # ReadWritePaths intentionally absent: ProtectSystem is not set so the
  # gateway process (running as the primary user) can run privileged
  # operations via sudo (nixos-rebuild, systemctl, etc.).
  assert lib.asserts.assertMsg (!serviceConfig.NoNewPrivileges) "ownloom-gateway must not set NoNewPrivileges so that sudo works for privileged operations";
  assert lib.asserts.assertMsg (lib.elem "synthetic_api_key:/run/secrets/synthetic_api_key" serviceConfig.LoadCredential) "ownloom-gateway must load the Synthetic key credential";
  assert lib.asserts.assertMsg (lib.elem "ownloom-gateway/sessions" serviceConfig.StateDirectory) "ownloom-gateway must create session state with StateDirectory";
  assert lib.asserts.assertMsg (lib.elem "ownloom-gateway/whatsapp/auth" serviceConfig.StateDirectory) "ownloom-gateway must create whatsapp auth state with StateDirectory";
    pkgs.runCommand "ownloom-gateway-module-eval" {} ''
      touch $out
    ''
