# tests/nixos/default.nix
# NixOS integration test suite for nixPI
#
# Usage:
#   nix build .#checks.x86_64-linux.nixpi-matrix
#   nix build .#checks.x86_64-linux.nixpi-firstboot
#   nix build .#checks.x86_64-linux.localai
#   nix build .#checks.x86_64-linux.nixpi-network
#   nix build .#checks.x86_64-linux.nixpi-daemon
#   nix build .#checks.x86_64-linux.nixpi-e2e
#   nix build .#checks.x86_64-linux.nixpi-home
#
# Or run all: nix flake check

{ pkgs, lib, piAgent, appPackage, self }:

let
  # Import shared helpers
  testLib = import ./lib.nix { inherit pkgs lib; };
  
  inherit (testLib) nixpiModules nixpiModulesNoShell mkNixpiNode mkTestFilesystems matrixTestClient;
  
  # Test function with common dependencies
  mkTest = testFile: import testFile {
    inherit pkgs lib nixpiModules nixpiModulesNoShell piAgent appPackage mkNixpiNode mkTestFilesystems matrixTestClient self;
  };
in
{
  # Matrix homeserver test
  nixpi-matrix = mkTest ./nixpi-matrix.nix;
  
  # First-boot wizard test
  nixpi-firstboot = mkTest ./nixpi-firstboot.nix;
  
  # LocalAI inference test (with test model)
  localai = mkTest ./localai.nix;
  
  # Network connectivity test
  nixpi-network = mkTest ./nixpi-network.nix;
  
  # Pi daemon test
  nixpi-daemon = mkTest ./nixpi-daemon.nix;
  
  # End-to-end integration test
  nixpi-e2e = mkTest ./nixpi-e2e.nix;

  # nixPI Home landing page and user service test
  nixpi-home = mkTest ./nixpi-home.nix;

  # Firewall and service exposure policy test
  nixpi-security = mkTest ./nixpi-security.nix;

  # Existing-user install flow test
  nixpi-install-flow = mkTest ./nixpi-install-flow.nix;

  # Modular service/configData regression test
  nixpi-modular-services = mkTest ./nixpi-modular-services.nix;

  # Multi-node Matrix daemon transport test
  nixpi-matrix-bridge = mkTest ./nixpi-matrix-bridge.nix;
}
