# core/os/modules/app.nix
{
  pkgs,
  lib,
  config,
  ...
}:

let
  inherit (config.nixpi) primaryUser stateDir;
  primaryHome = "/home/${primaryUser}";
  agentStateDir = "${primaryHome}/.pi";
  piAgent = pkgs.callPackage ../pkgs/pi { };
  appPackage = pkgs.callPackage ../pkgs/app { inherit piAgent; };
  piCommand = pkgs.writeShellScriptBin "pi" ''
    export PI_SKIP_VERSION_CHECK=1
    export PATH="${
      lib.makeBinPath [
        pkgs.fd
        pkgs.ripgrep
      ]
    }:$PATH"
    exec ${appPackage}/share/nixpi/node_modules/.bin/pi "$@"
  '';
  defaultSettings = pkgs.writeText "pi-settings.json" (
    builtins.toJSON { packages = config.nixpi.agent.packagePaths; }
  );
in

{
  imports = [ ./options.nix ];

  environment.systemPackages = [
    appPackage
    piCommand
  ];

  systemd.tmpfiles.settings.nixpi-app = {
    "/usr/local/share/nixpi"."L+" = {
      argument = "${appPackage}/share/nixpi";
    };
    "/etc/nixpi/appservices".d = {
      mode = "0755";
      user = "root";
      group = "root";
    };
    "${stateDir}".d = {
      mode = "0770";
      user = primaryUser;
      group = primaryUser;
    };
    "${stateDir}/services".d = {
      mode = "0770";
      user = primaryUser;
      group = primaryUser;
    };
  };

  system.services.nixpi-chat = {
    process.argv = [
      "${pkgs.nodejs}/bin/node"
      "/usr/local/share/nixpi/dist/core/chat-server/index.js"
    ];
    systemd.service = {
      description = "NixPI Chat Server";
      after = [ "network.target" "nixpi-app-setup.service" ];
      wants = [ "nixpi-app-setup.service" ];
      wantedBy = [ "multi-user.target" ];
      environment = {
        NIXPI_CHAT_PORT = toString config.nixpi.services.home.port;
        NIXPI_SHARE_DIR = "/usr/local/share/nixpi";
        PI_DIR = toString agentStateDir;
        NIXPI_PRIMARY_USER = primaryUser;
      } // lib.optionalAttrs (config.nixpi.agent.workspaceDir != "") {
        NIXPI_DIR = config.nixpi.agent.workspaceDir;
      };
      serviceConfig = {
        Environment = [
          "PATH=${lib.makeBinPath [ appPackage pkgs.nodejs ]}:/run/wrappers/bin:/run/current-system/sw/bin"
        ];
        User = primaryUser;
        Group = primaryUser;
        WorkingDirectory = toString agentStateDir;
        Restart = "on-failure";
        RestartSec = "10";
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = false;
      };
    };
  };

  systemd.services.nixpi-app-setup = {
    description = "NixPI app setup: create agent state dir and seed default settings";
    wantedBy = [ "multi-user.target" ];
    after = [ "systemd-tmpfiles-setup.service" ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      User = "root";
      ExecStart = "${pkgs.writeShellScript "nixpi-app-setup" ''
        primary_group="$(id -gn ${primaryUser})"

        install -d -m 0700 -o ${primaryUser} -g "$primary_group" ${agentStateDir}

        if [ ! -e ${agentStateDir}/settings.json ]; then
          install -m 0600 -o ${primaryUser} -g "$primary_group" ${defaultSettings} ${agentStateDir}/settings.json
        fi

        chown -R ${primaryUser}:"$primary_group" ${agentStateDir}
        chmod 0700 ${agentStateDir}
      ''}";
    };
  };

}
