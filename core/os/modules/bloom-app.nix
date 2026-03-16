# core/os/modules/bloom-app.nix
{ pkgs, lib, bloomApp, piAgent, ... }:

{
  environment.systemPackages = [ bloomApp piAgent ];

  systemd.tmpfiles.rules = [
    "L+ /usr/local/share/bloom - - - - ${bloomApp}/share/bloom"
    "d /etc/bloom/appservices 0755 root root -"
  ];

  systemd.user.services.pi-daemon = {
    description = "Bloom Pi Daemon (Matrix room agent)";
    wantedBy = [ "default.target" ];

    unitConfig.ConditionPathExists = "%h/.bloom/.setup-complete";

    serviceConfig = {
      Type       = "simple";
      ExecStart  = "${pkgs.nodejs}/bin/node /usr/local/share/bloom/dist/core/daemon/index.js";
      Environment = [
        "HOME=%h"
        "BLOOM_DIR=%h/Bloom"
        "PATH=${lib.makeBinPath [ piAgent pkgs.nodejs ]}:/run/current-system/sw/bin"
      ];
      Restart    = "on-failure";
      RestartSec = 15;
    };
  };
}
