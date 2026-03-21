{ pkgs, lib, config, ... }:

let
  stateDir = config.nixpi.stateDir;
  marker = "${stateDir}/bootstrap/full-appliance-switched";
  bootstrapUpgrade = pkgs.writeShellScript "nixpi-bootstrap-upgrade" ''
    set -euo pipefail

    if [ -f "${marker}" ]; then
      exit 0
    fi

    mkdir -p "$(dirname "${marker}")"

    if /run/current-system/sw/bin/nixos-rebuild switch --flake /etc/nixos#${config.networking.hostName}; then
      touch "${marker}"
    fi
  '';
in
{
  imports = [ ./options.nix ];

  systemd.tmpfiles.rules = [
    "d ${stateDir}/bootstrap 0755 root root -"
  ];

  systemd.services.nixpi-bootstrap-upgrade = {
    description = "Promote the minimal installed base into the standard NixPI appliance";
    wantedBy = [ "multi-user.target" ];
    wants = [ "network-online.target" ];
    after = [ "network-online.target" ];
    unitConfig.ConditionPathExists = "!${marker}";
    serviceConfig = {
      Type = "oneshot";
      ExecStart = bootstrapUpgrade;
      RemainAfterExit = true;
    };
  };
}
