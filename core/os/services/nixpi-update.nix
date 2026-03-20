{ config, lib, ... }:

let
  inherit (lib) mkOption types;
  pathOrStr = types.coercedTo types.path (x: "${x}") types.str;
in
{
  _class = "service";

  options.nixpi-update = {
    command = mkOption {
      type = pathOrStr;
    };

    primaryUser = mkOption {
      type = types.str;
    };

    primaryHome = mkOption {
      type = types.str;
    };

    path = mkOption {
      type = types.str;
    };
  };

  config = {
    process.argv = [ config.nixpi-update.command ];

    systemd.service = {
      description = "nixPI NixOS update";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = false;
        Restart = "no";
        Environment = [
          "PATH=${config.nixpi-update.path}"
          "NIXPI_PRIMARY_USER=${config.nixpi-update.primaryUser}"
          "NIXPI_PRIMARY_HOME=${config.nixpi-update.primaryHome}"
        ];
      };
    };
  };
}
