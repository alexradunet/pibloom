# core/os/hosts/vps.nix
# Canonical NixPI headless VPS profile used for the default installed system shape.
{ lib, config, ... }:

{
  imports = [
    ../modules
  ];

  system.stateVersion = "25.05";

  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;
  # Use tty0 so the active local VT keeps visible boot/login output on
  # monitor-attached x86_64 hosts, while tty1 still provides the recovery getty.
  boot.kernelParams = [ "console=tty0" "console=ttyS0,115200" ];
  systemd.services."getty@tty1".enable = lib.mkDefault true;
  systemd.services."serial-getty@ttyS0".enable = lib.mkDefault true;

  nixpi.primaryUser = lib.mkDefault "human";
  nixpi.bootstrap.keepSshAfterSetup = lib.mkDefault true;
  nixpi.security.ssh.passwordAuthentication = lib.mkDefault false;

  networking.hostName = lib.mkDefault "nixpi";
  networking.networkmanager.enable = true;
  time.timeZone = config.nixpi.timezone;
  i18n.defaultLocale = "en_US.UTF-8";
  console.keyMap = config.nixpi.keyboard;

  # Include redistributable GPU firmware (Intel, AMD) for reliable KMS
  # initialization on monitor-attached hardware such as mini PCs.
  hardware.enableRedistributableFirmware = lib.mkDefault true;

  fileSystems."/" = lib.mkDefault {
    device = "/dev/disk/by-label/nixos";
    fsType = "ext4";
  };

  fileSystems."/boot" = lib.mkDefault {
    device = "/dev/disk/by-label/boot";
    fsType = "vfat";
  };
}
