{ pkgs, lib, config, ... }:

let
  nixpiRebuild = pkgs.callPackage ../pkgs/nixpi-rebuild { };
in
{
  imports = [ ./options.nix ];

  environment.systemPackages = with pkgs; [
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
    qemu
    OVMF
    nixpiRebuild
  ] ++ lib.optionals config.nixpi.security.fail2ban.enable [ pkgs.fail2ban ];
}
