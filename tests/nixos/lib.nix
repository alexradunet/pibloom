{ pkgs, lib, self }:

{
  mkBaseNode = extraConfig: {
    virtualisation.diskSize = 20480;
    virtualisation.memorySize = 4096;
    virtualisation.graphics = false;

    boot.loader.systemd-boot.enable = true;
    boot.loader.efi.canTouchEfiVariables = true;
    networking.hostName = lib.mkDefault "nixos";
    time.timeZone = "UTC";
    i18n.defaultLocale = "en_US.UTF-8";
    networking.networkmanager.enable = true;
    system.stateVersion = "25.05";
  } // extraConfig;

  mkManagedUserConfig = {
    username,
    homeDir ? "/home/${username}",
    extraGroups ? [ "wheel" "networkmanager" ],
  }: {
    nixpi.primaryUser = username;

    users.users.${username} = {
      isNormalUser = true;
      group = username;
      inherit extraGroups;
      home = homeDir;
      shell = pkgs.bash;
    };
    users.groups.${username} = {};
  };

  mkTestFilesystems = {
    fileSystems."/" = { device = "/dev/vda"; fsType = "ext4"; };
    fileSystems."/boot" = { device = "/dev/vda1"; fsType = "vfat"; };
  };

  nixPiModules = [
    self.nixosModules.nixpi
  ];

  nixPiModulesNoShell = [
    self.nixosModules.nixpi-no-shell
  ];

}
