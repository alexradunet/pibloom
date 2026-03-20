# core/os/modules/network.nix
{ pkgs, lib, config, ... }:

let
  resolved = import ../lib/resolve-primary-user.nix { inherit lib config; };
  primaryUser = resolved.resolvedPrimaryUser;
  primaryHome = resolved.resolvedPrimaryHome;
  serviceUser = config.nixpi.serviceUser;
  stateDir = config.nixpi.stateDir;
  cfg = config.nixpi.services;
  securityCfg = config.nixpi.security;
  exposedPorts =
    lib.optionals cfg.home.enable [ cfg.home.port ]
    ++ lib.optionals cfg.chat.enable [ cfg.chat.port ]
    ++ lib.optionals cfg.files.enable [ cfg.files.port ]
    ++ lib.optionals cfg.code.enable [ cfg.code.port ]
    ++ [ config.nixpi.matrix.port ];
in

{
  imports = [ ./options.nix ];

  config = {
    assertions = [
      {
        assertion = securityCfg.trustedInterface != "";
        message = "nixpi.security.trustedInterface must not be empty.";
      }
      {
        assertion = cfg.bindAddress != "";
        message = "nixpi.services.bindAddress must not be empty.";
      }
      {
        assertion = lib.length (lib.unique exposedPorts) == lib.length exposedPorts;
        message = "nixPI service ports must be unique across built-in services and Matrix.";
      }
    ];

    hardware.enableAllFirmware = true;
    services.netbird.enable = true;

    services.openssh = {
      enable = true;
      settings = {
        PasswordAuthentication = true;
        PubkeyAuthentication = "yes";
        PermitRootLogin = "no";
      };
    };

    networking.firewall.enable = true;
    networking.firewall.allowedTCPPorts = [ 22 ];
    networking.firewall.interfaces = lib.mkIf securityCfg.enforceServiceFirewall {
      "${securityCfg.trustedInterface}".allowedTCPPorts = exposedPorts;
    };
    networking.networkmanager.enable = true;

    environment.etc."nixpi/fluffychat-web".source = pkgs.fluffychat-web;

    environment.systemPackages = with pkgs; [
      git git-lfs gh
      ripgrep fd bat htop jq curl wget unzip openssl
      just shellcheck biome typescript
      qemu OVMF
      chromium
      netbird
      dufs nginx code-server
    ];

    system.services = lib.mkMerge [
      (lib.mkIf cfg.home.enable {
        nixpi-home = {
          imports = [ (lib.modules.importApply ../services/nixpi-home.nix { inherit pkgs; }) ];
          nixpi-home = {
            port = cfg.home.port;
            inherit stateDir serviceUser;
            chatPort = cfg.chat.port;
            filesPort = cfg.files.port;
            codePort = cfg.code.port;
          };
        };
      })
      (lib.mkIf cfg.chat.enable {
        nixpi-chat = {
          imports = [ (lib.modules.importApply ../services/nixpi-chat.nix { inherit pkgs; }) ];
          nixpi-chat = {
            port = cfg.chat.port;
            matrixPort = config.nixpi.matrix.port;
            inherit stateDir serviceUser;
          };
        };
      })
      (lib.mkIf cfg.files.enable {
        nixpi-files = {
          imports = [ (lib.modules.importApply ../services/nixpi-files.nix { inherit pkgs; }) ];
          nixpi-files = {
            port = cfg.files.port;
            bindAddress = cfg.bindAddress;
            sharedDir = "${primaryHome}/Public/nixPI";
            inherit serviceUser;
          };
        };
      })
      (lib.mkIf cfg.code.enable {
        nixpi-code = {
          imports = [ (lib.modules.importApply ../services/nixpi-code.nix { inherit pkgs; }) ];
          nixpi-code = {
            port = cfg.code.port;
            bindAddress = cfg.bindAddress;
            workspaceDir = "${primaryHome}/nixPI";
            inherit stateDir serviceUser;
          };
        };
      })
    ];

    system.activationScripts.nixpi-builtins = lib.stringAfter [ "users" ] ''
      install -d -m 2775 -o ${primaryUser} -g ${serviceUser} ${primaryHome}/Public
      install -d -m 2775 -o ${primaryUser} -g ${serviceUser} ${primaryHome}/Public/nixPI
      install -d -m 2775 -o ${primaryUser} -g ${serviceUser} ${primaryHome}/nixPI
      install -d -m 0770 -o ${serviceUser} -g ${serviceUser} ${stateDir}/services/home
      install -d -m 0770 -o ${serviceUser} -g ${serviceUser} ${stateDir}/services/home/tmp
      install -d -m 0770 -o ${serviceUser} -g ${serviceUser} ${stateDir}/services/chat
      install -d -m 0770 -o ${serviceUser} -g ${serviceUser} ${stateDir}/services/chat/tmp
      install -d -m 0770 -o ${serviceUser} -g ${serviceUser} ${stateDir}/services/code
    '';

    warnings = lib.optional config.nixpi.security.enforceServiceFirewall ''
      nixPI opens Home, Chat, Files, Code, and Matrix only on
      `${config.nixpi.security.trustedInterface}`. Without that interface, only local
      access remains available.
    '';
  };
}
