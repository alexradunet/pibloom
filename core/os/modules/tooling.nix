{
  pkgs,
  lib,
  config,
  ...
}:

let
  cfg = config.nixpi.tooling;
  nixpiRebuild = pkgs.callPackage ../pkgs/nixpi-rebuild { }; # rebuild the installed /etc/nixos host flake
  nixpiApplyLocalRepo = pkgs.callPackage ../pkgs/nixpi-apply-local-repo { }; # apply local /var/lib/nixpi/pi-nixpi state through the installed host flake
in
{
  options.nixpi.tooling = {
    enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Whether the NixPI operator tooling packages are installed.";
    };
    qemu.enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Install QEMU and OVMF for running local NixOS VM tests.
        Can be disabled on production VPS deployments to reduce closure size.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    environment.systemPackages =
      with pkgs;
      [
        git
        git-lfs
        gh
        nodejs
        ripgrep
        fd
        bat
        htop
        jq
        curl
        wget
        unzip
        openssl
        just
        shellcheck
        biome
        typescript
        nixpiRebuild
        nixpiApplyLocalRepo
      ]
      ++ lib.optionals cfg.qemu.enable [
        qemu
        OVMF
      ]
      ++ lib.optionals config.nixpi.security.fail2ban.enable [ pkgs.fail2ban ];
  };
}
