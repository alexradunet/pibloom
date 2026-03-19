# core/os/modules/options.nix
# Shared NixOS options consumed by garden-shell, garden-firstboot, etc.
{ lib, ... }:

{
  options.garden.username = lib.mkOption {
    type        = lib.types.str;
    default     = "pi";
    description = ''
      Primary system user for the Garden machine. All Garden modules
      derive the user name, home directory, and service ownership from it.
    '';
  };
}
