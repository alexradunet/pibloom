{
  config,
  lib,
  pkgs,
  utils,
  ...
}: let
  cfg = config.services.ownloom-gateway-web;
  isLoopbackHttpUrl = value:
    (lib.hasPrefix "http://127.0.0.1:" value || lib.hasPrefix "http://[::1]:" value)
    && !(lib.hasInfix "@" value);
in {
  options.services.ownloom-gateway-web = {
    enable = lib.mkEnableOption "loopback-only web client for ownloom-gateway";

    package = lib.mkPackageOption pkgs "ownloom-gateway-web" {};

    host = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Host to bind. Keep loopback-only; use SSH tunneling or a trusted reverse proxy.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8090;
      description = "Port for the local gateway web client.";
    };

    gatewayUrl = lib.mkOption {
      type = lib.types.str;
      default = "http://127.0.0.1:8081";
      description = "Loopback URL of the ownloom-gateway protocol/REST endpoint to proxy.";
    };

    terminalUrl = lib.mkOption {
      type = lib.types.str;
      default = "http://127.0.0.1:8091";
      description = "Loopback URL of the optional Zellij web terminal endpoint to proxy under /terminal/.";
    };

    plannerUrl = lib.mkOption {
      type = lib.types.str;
      default = "http://127.0.0.1:8082";
      description = "Loopback URL of the ownloom planner web/API server to proxy under /api/planner/.";
    };

    terminalTokenFile = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/ownloom-terminal/login-token";
      description = "Local Zellij web login token file exposed through the loopback-only cockpit.";
    };

    terminalTokenGroup = lib.mkOption {
      type = lib.types.str;
      default = "ownloom-terminal";
      description = "Group allowed to read the local Zellij web login token.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.host == "127.0.0.1" || cfg.host == "::1";
        message = "services.ownloom-gateway-web.host must stay loopback-only.";
      }
      {
        assertion = isLoopbackHttpUrl cfg.gatewayUrl;
        message = "services.ownloom-gateway-web.gatewayUrl must stay loopback-only without URL userinfo.";
      }
      {
        assertion = isLoopbackHttpUrl cfg.terminalUrl;
        message = "services.ownloom-gateway-web.terminalUrl must stay loopback-only without URL userinfo.";
      }
      {
        assertion = isLoopbackHttpUrl cfg.plannerUrl;
        message = "services.ownloom-gateway-web.plannerUrl must stay loopback-only without URL userinfo.";
      }
    ];

    users.groups.${cfg.terminalTokenGroup} = {};

    systemd.services.ownloom-gateway-web = {
      description = "ownloom gateway web client";
      after = ["network.target" "ownloom-gateway.service"];
      wants = ["ownloom-gateway.service"];
      wantedBy = ["multi-user.target"];
      environment = {
        OWNLOOM_GATEWAY_WEB_HOST = cfg.host;
        OWNLOOM_GATEWAY_WEB_PORT = toString cfg.port;
        OWNLOOM_GATEWAY_URL = cfg.gatewayUrl;
        OWNLOOM_TERMINAL_URL = cfg.terminalUrl;
        OWNLOOM_PLANNER_URL = cfg.plannerUrl;
        OWNLOOM_TERMINAL_TOKEN_FILE = toString cfg.terminalTokenFile;
      };
      serviceConfig = {
        Type = "simple";
        ExecStart = utils.escapeSystemdExecArgs ["${cfg.package}/bin/ownloom-gateway-web"];
        Restart = "on-failure";
        RestartSec = "5s";
        StandardOutput = "journal";
        StandardError = "journal";
        SyslogIdentifier = "ownloom-gateway-web";

        DynamicUser = true;
        User = "ownloom-gateway-web";
        Group = "ownloom-gateway-web";
        SupplementaryGroups = [cfg.terminalTokenGroup];
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        NoNewPrivileges = true;
        RestrictSUIDSGID = true;
        LockPersonality = true;
        MemoryDenyWriteExecute = false; # node requires JIT
        UMask = "0077";
      };
    };
  };
}
