# core/os/modules/update.nix
{ pkgs, lib, config, ... }:

{
  nix.settings.experimental-features = [ "nix-command" "flakes" ];

  systemd.services.garden-update = {
    description = "Garden OS NixOS update";
    after    = [ "network-online.target" ];
    wants    = [ "network-online.target" ];

    serviceConfig = {
      Type            = "oneshot";
      # nixos-rebuild lives at /run/current-system/sw/bin/nixos-rebuild (not in nixpkgs).
      # serviceConfig.path only accepts derivations, so set PATH via Environment instead.
      Environment = [
        "PATH=/run/current-system/sw/bin:${lib.makeBinPath (with pkgs; [ nix git jq ])}"
        "GARDEN_USERNAME=${config.garden.username}"
      ];
      ExecStart       = pkgs.writeShellScript "garden-update" (builtins.readFile ../../../core/scripts/system-update.sh);
      RemainAfterExit = false;
    };
  };

  systemd.timers.garden-update = {
    description = "Garden OS update check timer";
    wantedBy    = [ "timers.target" ];

    timerConfig = {
      OnBootSec        = "5min";
      OnUnitActiveSec  = "6h";
      Persistent       = true;
    };
  };
}
