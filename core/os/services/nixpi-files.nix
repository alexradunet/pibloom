{ pkgs }:

{ config, lib, ... }:

let
  inherit (lib) mkOption types;
in
{
  _class = "service";

  options.nixpi-files = {
    port = mkOption {
      type = types.port;
    };

    bindAddress = mkOption {
      type = types.str;
    };

    sharedDir = mkOption {
      type = types.str;
    };

    serviceUser = mkOption {
      type = types.str;
    };
  };

  config = {
    process.argv = [
      "${pkgs.dufs}/bin/dufs"
      config.nixpi-files.sharedDir
      "-A"
      "-b"
      config.nixpi-files.bindAddress
      "-p"
      (toString config.nixpi-files.port)
    ];

    systemd.service = {
      description = "nixPI Files WebDAV";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        User = config.nixpi-files.serviceUser;
        Group = config.nixpi-files.serviceUser;
        UMask = "0007";
        Restart = "on-failure";
        RestartSec = "10";
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = false;
        ReadWritePaths = [ config.nixpi-files.sharedDir ];
      };
    };
  };
}
