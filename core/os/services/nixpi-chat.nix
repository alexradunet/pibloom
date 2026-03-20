{ pkgs }:

{ config, lib, ... }:

let
  inherit (lib) mkOption types;
in
{
  _class = "service";

  options.nixpi-chat = {
    port = mkOption {
      type = types.port;
    };

    matrixPort = mkOption {
      type = types.port;
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
      "${pkgs.nginx}/bin/nginx"
      "-c"
      config.configData."nginx.conf".path
    ];

    configData = {
      "config.json".text = builtins.toJSON {
        applicationName = "nixPI Chat";
        defaultHomeserver = "http://localhost:${toString config.nixpi-chat.matrixPort}";
      };
      "nginx.conf".text = ''
        daemon off;
        pid ${config.nixpi-chat.stateDir}/services/chat/nginx.pid;
        error_log stderr;
        events { worker_connections 64; }
        http {
            include ${pkgs.nginx}/conf/mime.types;
            default_type application/octet-stream;
            access_log off;
            client_body_temp_path ${config.nixpi-chat.stateDir}/services/chat/tmp;
            server {
                listen ${toString config.nixpi-chat.port};
                location /config.json {
                    alias ${config.configData."config.json".path};
                }
                location / {
                    root /etc/nixpi/fluffychat-web;
                    try_files $uri $uri/ /index.html;
                }
            }
        }
      '';
    };

    systemd.service = {
      description = "nixPI web chat client";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        User = config.nixpi-chat.serviceUser;
        Group = config.nixpi-chat.serviceUser;
        UMask = "0007";
        Restart = "on-failure";
        RestartSec = "10";
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = false;
        ReadWritePaths = [ "${config.nixpi-chat.stateDir}/services/chat" ];
      };
    };
  };
}
