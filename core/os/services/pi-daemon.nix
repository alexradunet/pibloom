{ pkgs }:

{ config, lib, ... }:

let
  inherit (lib) mkOption types;
in
{
  _class = "service";

  options.nixpi-pi-daemon = {
    package = mkOption {
      type = types.package;
    };

    primaryHome = mkOption {
      type = types.str;
    };

    primaryUser = mkOption {
      type = types.str;
    };

    serviceHome = mkOption {
      type = types.str;
    };

    stateDir = mkOption {
      type = types.str;
    };

    agentStateDir = mkOption {
      type = types.str;
    };

    serviceUser = mkOption {
      type = types.str;
    };

    path = mkOption {
      type = types.listOf types.package;
      default = [ ];
    };
  };

  config = {
    process.argv = [
      "${pkgs.nodejs}/bin/node"
      "/usr/local/share/nixpi/dist/core/daemon/index.js"
    ];

    systemd.service = {
      description = "nixPI Pi Daemon (Matrix room agent)";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      wantedBy = [ "multi-user.target" ];
      unitConfig.ConditionPathExists = "${config.nixpi-pi-daemon.primaryHome}/.nixpi/.setup-complete";
      serviceConfig = {
        User = config.nixpi-pi-daemon.serviceUser;
        Group = config.nixpi-pi-daemon.serviceUser;
        UMask = "0007";
        WorkingDirectory = "${config.nixpi-pi-daemon.primaryHome}/nixPI";
        Environment = [
          "HOME=${config.nixpi-pi-daemon.serviceHome}"
          "NIXPI_DIR=${config.nixpi-pi-daemon.primaryHome}/nixPI"
          "NIXPI_STATE_DIR=${config.nixpi-pi-daemon.stateDir}"
          "NIXPI_PI_DIR=${config.nixpi-pi-daemon.agentStateDir}"
          "NIXPI_DAEMON_STATE_DIR=${config.nixpi-pi-daemon.stateDir}/pi-daemon"
          "NIXPI_PRIMARY_USER=${config.nixpi-pi-daemon.primaryUser}"
          "NIXPI_PRIMARY_HOME=${config.nixpi-pi-daemon.primaryHome}"
          "PATH=${lib.makeBinPath config.nixpi-pi-daemon.path}:/run/current-system/sw/bin"
        ];
        Restart = "on-failure";
        RestartSec = "15";
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = false;
        ReadWritePaths = [
          config.nixpi-pi-daemon.stateDir
          "${config.nixpi-pi-daemon.primaryHome}/nixPI"
        ];
      };
    };
  };
}
