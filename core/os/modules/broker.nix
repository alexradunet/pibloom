{
  config,
  lib,
  pkgs,
  ...
}:

let
  inherit (config.nixpi) primaryUser stateDir;
  primaryHome = "/home/${primaryUser}";
  socketDir = "/run/nixpi-broker";
  socketPath = "${socketDir}/broker.sock";
  brokerStateDir = "${stateDir}/broker";
  elevationPath = "${brokerStateDir}/elevation.json";

  brokerConfig = pkgs.writeText "nixpi-broker-config.json" (
    builtins.toJSON {
      inherit
        socketPath
        elevationPath
        brokerStateDir
        primaryUser
        ;
      defaultAutonomy = config.nixpi.agent.autonomy;
      elevationDuration = config.nixpi.agent.elevation.duration;
      osUpdateEnable = config.nixpi.agent.osUpdate.enable;
      inherit (config.nixpi.agent) allowedUnits;
      defaultFlake = "/etc/nixos#nixos";
    }
  );

  brokerProgram = pkgs.callPackage ../pkgs/broker { };

  brokerCtl = pkgs.writeShellScriptBin "nixpi-brokerctl" ''
    export NIXPI_BROKER_CONFIG=${brokerConfig}
    exec ${brokerProgram}/bin/nixpi-broker "$@"
  '';
in
{
  imports = [ ./options.nix ];

  config = lib.mkIf config.nixpi.agent.broker.enable {
    assertions = [
      {
        assertion = config.nixpi.agent.autonomy != "";
        message = "nixpi.agent.autonomy must not be empty.";
      }
      {
        assertion = config.nixpi.agent.elevation.duration != "";
        message = "nixpi.agent.elevation.duration must not be empty.";
      }
    ];

    environment.systemPackages = [ brokerCtl ];

    systemd.tmpfiles.settings.nixpi-broker = {
      "${brokerStateDir}".d = {
        mode = "0770";
        user = "root";
        group = primaryUser;
      };
    };

    system.services.nixpi-broker = {
      process.argv = [
        "${brokerCtl}/bin/nixpi-brokerctl"
        "server"
      ];
      systemd.service = {
        description = "NixPI privileged operations broker";
        after = [ "network.target" ];
        wantedBy = [ "multi-user.target" ];
        serviceConfig = {
          User = "root";
          Group = "root";
          RuntimeDirectory = "nixpi-broker";
          RuntimeDirectoryMode = "0770";
          UMask = "0007";
          Environment = [ "NIXPI_BROKER_CONFIG=${brokerConfig}" ];
        };
      };
    };

    security.sudo.extraRules = lib.optional (primaryUser != "") {
      users = [ primaryUser ];
      commands = [
        {
          command = "${brokerCtl}/bin/nixpi-brokerctl grant-admin *";
          options = [ "NOPASSWD" ];
        }
        {
          command = "${brokerCtl}/bin/nixpi-brokerctl revoke-admin";
          options = [ "NOPASSWD" ];
        }
        {
          command = "${brokerCtl}/bin/nixpi-brokerctl status";
          options = [ "NOPASSWD" ];
        }
      ];
    };
  };
}
