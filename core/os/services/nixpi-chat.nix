{ pkgs }:

{ config, lib, options, ... }:

let
  inherit (lib) mkOption types;
in
{
  _class = "service";

  options.nixpi-chat = {
    package = mkOption {
      type = types.package;
    };

    primaryUser = mkOption {
      type = types.str;
    };

    port = mkOption {
      type = types.port;
      default = 8080;
    };

    agentStateDir = mkOption {
      type = types.pathWith { absolute = true; };
    };

    nixpiShareDir = mkOption {
      type = types.str;
      default = "/usr/local/share/nixpi";
    };

    idleTimeoutSecs = mkOption {
      type = types.int;
      default = 1800;
    };

    maxSessions = mkOption {
      type = types.int;
      default = 4;
    };
  };

  config = {
    process.argv = [
      "${pkgs.nodejs}/bin/node"
      "${config.nixpi-chat.nixpiShareDir}/dist/core/chat-server/index.js"
    ];
  } // lib.optionalAttrs (options ? systemd) {
    systemd.service = {
      description = "NixPI Chat Server";
      after = [ "network.target" "nixpi-app-setup.service" ];
      wants = [ "nixpi-app-setup.service" ];
      wantedBy = [ "multi-user.target" ];
      environment = {
        NIXPI_CHAT_PORT = toString config.nixpi-chat.port;
        NIXPI_SHARE_DIR = config.nixpi-chat.nixpiShareDir;
        PI_DIR = toString config.nixpi-chat.agentStateDir;
        NIXPI_CHAT_IDLE_TIMEOUT = toString config.nixpi-chat.idleTimeoutSecs;
        NIXPI_CHAT_MAX_SESSIONS = toString config.nixpi-chat.maxSessions;
      };
      serviceConfig = {
        Environment = [
          "PATH=${lib.makeBinPath [ config.nixpi-chat.package pkgs.nodejs ]}:/run/current-system/sw/bin"
        ];
        ExecStart = "${pkgs.nodejs}/bin/node ${config.nixpi-chat.nixpiShareDir}/dist/core/chat-server/index.js";
        User = config.nixpi-chat.primaryUser;
        Group = config.nixpi-chat.primaryUser;
        WorkingDirectory = toString config.nixpi-chat.agentStateDir;
        Restart = "on-failure";
        RestartSec = "10";
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = false;
      };
    };
  };
}
