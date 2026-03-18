# tests/nixos/default.nix
# NixOS integration test suite for Bloom OS
#
# Usage:
#   nix build .#checks.x86_64-linux.bloom-matrix
#   nix build .#checks.x86_64-linux.bloom-firstboot
#   nix build .#checks.x86_64-linux.bloom-localai
#   nix build .#checks.x86_64-linux.bloom-network
#   nix build .#checks.x86_64-linux.bloom-daemon
#   nix build .#checks.x86_64-linux.bloom-e2e
#
# Or run all: nix flake check

{ pkgs, lib, piAgent, bloomApp }:

let
  # Import shared helpers
  testLib = import ./lib.nix { inherit pkgs lib; };
  
  inherit (testLib) bloomModules bloomModulesNoShell mkBloomNode mkTestFilesystems;
  
  # Test function with common dependencies
  mkTest = testFile: import testFile {
    inherit pkgs lib bloomModules bloomModulesNoShell piAgent bloomApp mkBloomNode mkTestFilesystems;
  };
in
{
  # Matrix homeserver test
  bloom-matrix = mkTest ./bloom-matrix.nix;
  
  # First-boot wizard test
  bloom-firstboot = mkTest ./bloom-firstboot.nix;
  
  # LocalAI inference test (with test model)
  bloom-localai = mkTest ./bloom-localai.nix;
  
  # Network connectivity test
  bloom-network = mkTest ./bloom-network.nix;
  
  # Pi daemon test
  bloom-daemon = mkTest ./bloom-daemon.nix;
  
  # End-to-end integration test
  bloom-e2e = mkTest ./bloom-e2e.nix;
}
