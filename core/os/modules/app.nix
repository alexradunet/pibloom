# core/os/modules/app.nix
{ pkgs, lib, appPackage, piAgent, ... }:

{
  environment.systemPackages = [ appPackage piAgent ];

  systemd.tmpfiles.rules = [
    "L+ /usr/local/share/garden - - - - ${appPackage}/share/garden"
    "d /etc/garden/appservices 0755 root root -"
  ];

  systemd.user.services.pi-daemon = {
    description = "Garden Pi Daemon (Matrix room agent)";
    wantedBy = [ "default.target" ];

    unitConfig.ConditionPathExists = "%h/.garden/.setup-complete";

    serviceConfig = {
      Type       = "simple";
      ExecStart  = "${pkgs.nodejs}/bin/node /usr/local/share/garden/dist/core/daemon/index.js";
      Environment = [
        "HOME=%h"
        "GARDEN_DIR=%h/Garden"
        "PATH=${lib.makeBinPath [ piAgent pkgs.nodejs ]}:/run/current-system/sw/bin"
      ];
      Restart    = "on-failure";
      RestartSec = 15;
    };
  };
}
