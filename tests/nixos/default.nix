# tests/nixos/default.nix
# NixOS integration test suite for Garden OS
#
# Usage:
#   nix build .#checks.x86_64-linux.garden-matrix
#   nix build .#checks.x86_64-linux.garden-firstboot
#   nix build .#checks.x86_64-linux.localai
#   nix build .#checks.x86_64-linux.garden-network
#   nix build .#checks.x86_64-linux.garden-daemon
#   nix build .#checks.x86_64-linux.garden-e2e
#   nix build .#checks.x86_64-linux.garden-home
#
# Or run all: nix flake check

{ pkgs, lib, piAgent, appPackage }:

let
  # Import shared helpers
  testLib = import ./lib.nix { inherit pkgs lib; };
  
  inherit (testLib) gardenModules gardenModulesNoShell mkGardenNode mkTestFilesystems;
  
  # Test function with common dependencies
  mkTest = testFile: import testFile {
    inherit pkgs lib gardenModules gardenModulesNoShell piAgent appPackage mkGardenNode mkTestFilesystems;
  };
in
{
  # Matrix homeserver test
  garden-matrix = mkTest ./garden-matrix.nix;
  
  # First-boot wizard test
  garden-firstboot = mkTest ./garden-firstboot.nix;
  
  # LocalAI inference test (with test model)
  localai = mkTest ./localai.nix;
  
  # Network connectivity test
  garden-network = mkTest ./garden-network.nix;
  
  # Pi daemon test
  garden-daemon = mkTest ./garden-daemon.nix;
  
  # End-to-end integration test
  garden-e2e = mkTest ./garden-e2e.nix;

  # Garden Home landing page and user service test
  garden-home = mkTest ./garden-home.nix;
}
