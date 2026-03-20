{ pkgs }:

{ config, lib, ... }:

let
  inherit (lib) mkOption types;
  webroot = builtins.dirOf config.configData."webroot/index.html".path;
in
{
  _class = "service";

  options.nixpi-home = {
    port = mkOption {
      type = types.port;
    };

    stateDir = mkOption {
      type = types.str;
    };

    serviceUser = mkOption {
      type = types.str;
    };

    chatPort = mkOption {
      type = types.port;
    };

    filesPort = mkOption {
      type = types.port;
    };

    codePort = mkOption {
      type = types.port;
    };
  };

  config = {
    process.argv = [
      "${pkgs.nginx}/bin/nginx"
      "-c"
      config.configData."nginx.conf".path
    ];

    configData = {
      "webroot/index.html".text = ''
        <!doctype html>
        <html lang="en">
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>nixPI Home</title></head>
        <body>
          <h1>nixPI Home</h1>
          <ul>
            <li><a href="http://localhost:${toString config.nixpi-home.chatPort}">nixPI Chat</a></li>
            <li><a href="http://localhost:${toString config.nixpi-home.filesPort}">nixPI Files</a></li>
            <li><a href="http://localhost:${toString config.nixpi-home.codePort}">nixPI Code</a></li>
          </ul>
        </body>
        </html>
      '';
      "nginx.conf".text = ''
        daemon off;
        pid ${config.nixpi-home.stateDir}/services/home/nginx.pid;
        error_log stderr;
        events { worker_connections 64; }
        http {
            include ${pkgs.nginx}/conf/mime.types;
            default_type application/octet-stream;
            access_log off;
            client_body_temp_path ${config.nixpi-home.stateDir}/services/home/tmp;
            server {
                listen ${toString config.nixpi-home.port};
                root ${webroot};
                try_files $uri $uri/ =404;
            }
        }
      '';
    };

    systemd.service = {
      description = "nixPI Home landing page";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        User = config.nixpi-home.serviceUser;
        Group = config.nixpi-home.serviceUser;
        UMask = "0007";
        Restart = "on-failure";
        RestartSec = "10";
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = false;
        ReadWritePaths = [ "${config.nixpi-home.stateDir}/services/home" ];
      };
    };
  };
}
