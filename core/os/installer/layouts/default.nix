# Disko layout: UEFI GPT, 1 GiB EFI partition, ext4 root, fixed 8 GiB swap.
# @DISK@ is substituted by the installer script at runtime.
{ ... }:
{
  disko.devices = {
    disk.main = {
      device = "@DISK@";
      type = "disk";
      content = {
        type = "gpt";
        partitions = {
          ESP = {
            size = "1G";
            type = "EF00";
            content = {
              type = "filesystem";
              format = "vfat";
              mountpoint = "/boot";
              mountOptions = [ "umask=0077" ];
            };
          };
          root = {
            size = "100%";
            end = "-8G";
            content = {
              type = "filesystem";
              format = "ext4";
              mountpoint = "/";
              extraArgs = [ "-L" "nixos" ];
            };
          };
          swap = {
            size = "8G";
            content = {
              type = "swap";
            };
          };
        };
      };
    };
  };
}
