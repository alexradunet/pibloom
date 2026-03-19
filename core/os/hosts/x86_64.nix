# core/os/hosts/x86_64.nix
{ pkgs, lib, ... }:

{
  imports = [
    ../modules/app.nix
    ../modules/firstboot.nix
    ../modules/llm.nix
    ../modules/matrix.nix
    ../modules/network.nix
    ../modules/shell.nix
    ../modules/update.nix
  ];

  system.stateVersion = "25.05";
  nixpkgs.hostPlatform = "x86_64-linux";

  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;
  boot.kernelParams = [ "console=tty0" "console=ttyS0,115200" ];

  # Sway window manager as the default desktop environment
  programs.sway = {
    enable = true;
    wrapperFeatures.gtk = true;
  };

  # Enable XDG desktop portal for screen sharing and file opening
  xdg.portal = {
    enable = true;
    extraPortals = [ pkgs.xdg-desktop-portal-wlr pkgs.xdg-desktop-portal-gtk ];
    config.sway.default = lib.mkForce [ "wlr" "gtk" ];
  };

  # Sway-related packages
  environment.systemPackages = with pkgs; [
    swaylock
    swayidle
    foot
    dmenu
    wmenu
    brightnessctl
    pamixer
    wl-clipboard
    grim
    slurp
    mako
    libnotify
  ];

  # VM dev share: mount host's ~/.garden into /mnt/host-garden via 9p virtfs.
  # Requires QEMU -virtfs flag (see justfile). nofail means this is ignored on real hardware.
  fileSystems."/mnt/host-garden" = {
    device = "host-garden";
    fsType = "9p";
    options = [ "trans=virtio" "ro" "nofail" ];
  };

  nixpkgs.config.allowUnfree = true;

  time.timeZone   = "UTC";
  i18n.defaultLocale = "en_US.UTF-8";
}
