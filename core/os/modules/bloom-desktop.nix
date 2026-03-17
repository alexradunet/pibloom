# core/os/modules/bloom-desktop.nix
# LXQt desktop environment configuration for Bloom OS installer
# Lightweight, Qt-based desktop that matches Calamares theming
{ pkgs, lib, ... }:

{
  # Enable X11 and LXQt desktop
  services.xserver.enable = true;
  services.xserver.desktopManager.lxqt.enable = true;
  services.xserver.displayManager.lightdm.enable = true;

  # Auto-login for live ISO user
  services.displayManager.autoLogin.enable = true;
  services.displayManager.autoLogin.user = "nixos";

  # Support all locales (Calamares needs this)
  i18n.supportedLocales = [ "all" ];

  # Additional packages for the installer environment
  environment.systemPackages = with pkgs; [
    # Web browser for documentation
    firefox

    # Disk utilities
    gparted

    # Useful for troubleshooting
    iw
    wirelesstools

    # LXQt includes these by default:
    # - pcmanfm-qt (file manager)
    # - qterminal (terminal)
    # - nm-tray (network manager applet)
    # - qlipper (clipboard)
    # - qps (process manager)
  ];

  # Bloom branding for the desktop
  environment.etc."lxqt/lxqt.conf".text = ''
    [Theme]
    theme=ambiance
    icon_theme=bloom

    [Environment]
    term=qterminal

    [autostart]
    bloom_welcome=true
  '';

  # Wallpaper and branding (optional - can add later)
  # environment.etc."xdg/wallpapers/bloom.png".source = ../../../assets/wallpaper.png;

  networking.hostName = lib.mkDefault "bloom-installer";
}
