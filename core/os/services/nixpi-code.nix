{ pkgs }:

{ config, lib, ... }:

let
  inherit (lib) mkOption types;
in
{
  _class = "service";

  options.nixpi-code = {
    port = mkOption {
      type = types.port;
    };

    bindAddress = mkOption {
      type = types.str;
    };

    workspaceDir = mkOption {
      type = types.str;
    };

    stateDir = mkOption {
      type = types.str;
    };

    serviceUser = mkOption {
      type = types.str;
    };
  };

  config = {
    process.argv = [
      "${pkgs.code-server}/bin/code-server"
      "--bind-addr"
      "${config.nixpi-code.bindAddress}:${toString config.nixpi-code.port}"
      "--auth"
      "none"
      "--disable-telemetry"
      "--user-data-dir"
      "${config.nixpi-code.stateDir}/services/code/user-data"
      "--extensions-dir"
      "${config.nixpi-code.stateDir}/services/code/extensions"
      config.nixpi-code.workspaceDir
    ];

    systemd.service = {
      description = "nixPI code-server";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        User = config.nixpi-code.serviceUser;
        Group = config.nixpi-code.serviceUser;
        UMask = "0007";
        WorkingDirectory = config.nixpi-code.workspaceDir;
        Restart = "on-failure";
        RestartSec = "10";
      };
    };
  };
}
