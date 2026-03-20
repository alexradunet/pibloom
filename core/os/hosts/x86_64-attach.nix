# core/os/hosts/x86_64-attach.nix
# Attach nixPI to an existing NixOS installation.
# 
# IMPORTANT: This configuration is for REAL HARDWARE only.
# It imports your existing /etc/nixos configuration.
# 
# USAGE:
#   curl -fsSL https://raw.githubusercontent.com/alexradunet/nixPI/main/core/scripts/nixpi-install.sh | bash
# 
# Or manually:
#   NIXPI_PRIMARY_USER=yourusername sudo --preserve-env=NIXPI_PRIMARY_USER nixos-rebuild switch --impure --flake github:alexradunet/nixpi#desktop-attach

{ lib, pkgs, config, ... }:

let
  primaryUser = builtins.getEnv "NIXPI_PRIMARY_USER";
in
{
  # Import the user's existing NixOS configuration
  # These must exist on a real NixOS system
  imports = [
    /etc/nixos/hardware-configuration.nix
    /etc/nixos/configuration.nix
    
    # nixPI modules (excluding shell which manages the primary user)
    ../modules/app.nix
    ../modules/broker.nix
    ../modules/firstboot.nix
    ../modules/llm.nix
    ../modules/matrix.nix
    ../modules/network.nix
    ../modules/update.nix
  ];

  # Assertions to provide helpful error messages
  assertions = [
    {
      assertion = primaryUser != "";
      message = ''
        NIXPI_PRIMARY_USER must be set to your username.
        
        Usage: NIXPI_PRIMARY_USER=yourusername sudo --preserve-env=NIXPI_PRIMARY_USER nixos-rebuild switch --impure --flake github:alexradunet/nixpi#desktop-attach
        
        Or use the install script:
        curl -fsSL https://raw.githubusercontent.com/alexradunet/nixPI/main/core/scripts/nixpi-install.sh | bash
      '';
    }
    {
      assertion = primaryUser != "" && (builtins.hasAttr primaryUser config.users.users);
      message = ''
        User '${primaryUser}' does not exist in the system configuration.
        Make sure NIXPI_PRIMARY_USER is set to an existing user.
      '';
    }
  ];

  # nixPI attaches to existing user, doesn't create one
  nixpi.primaryUser = lib.mkForce primaryUser;
  nixpi.install.mode = lib.mkForce "existing-user";
  nixpi.createPrimaryUser = lib.mkForce false;

  # Ensure the primary user is in the agent group
  users.users.${primaryUser} = lib.mkIf (primaryUser != "") {
    extraGroups = lib.mkAfter [ "agent" ];
  };

  # Allow unfree packages (needed for some nixPI services)
  nixpkgs.config.allowUnfree = lib.mkDefault true;
}
