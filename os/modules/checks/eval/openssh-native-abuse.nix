{
  inputs,
  lib,
  pkgs,
  system,
}: let
  eval = inputs.nixpkgs.lib.nixosSystem {
    inherit system;
    modules = [
      ../../features/nixos/service-openssh/module.nix
      {
        networking.hostName = "nixpi-openssh-native-abuse-test";
        system.stateVersion = "26.05";
      }
    ];
  };
  sshSettings = eval.config.services.openssh.settings;
in
  assert lib.asserts.assertMsg (!sshSettings.PasswordAuthentication) "OpenSSH password authentication must stay disabled";
  assert lib.asserts.assertMsg (!sshSettings.KbdInteractiveAuthentication) "OpenSSH keyboard-interactive authentication must stay disabled";
  assert lib.asserts.assertMsg (sshSettings.PerSourceMaxStartups == 3) "OpenSSH must limit unauthenticated startups per source";
  assert lib.asserts.assertMsg (sshSettings.PerSourcePenalties != null) "OpenSSH per-source penalties must be configured";
  assert lib.asserts.assertMsg eval.config.networking.nftables.enable "nftables must be enabled by default";
  assert lib.asserts.assertMsg (!(builtins.hasAttr "reaction" eval.config.systemd.services)) "reaction.service must not be present";
    pkgs.runCommand "ownloom-openssh-native-abuse-eval" {} ''
      touch $out
    ''
