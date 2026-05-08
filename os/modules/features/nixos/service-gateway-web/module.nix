{
  config,
  lib,
  pkgs,
  utils,
  ...
}: let
  cfg = config.services.ownloom-gateway-web;
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
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.host == "127.0.0.1" || cfg.host == "::1";
        message = "services.ownloom-gateway-web.host must stay loopback-only.";
      }
      {
        assertion = lib.hasPrefix "http://127.0.0.1:" cfg.gatewayUrl || lib.hasPrefix "http://[::1]:" cfg.gatewayUrl;
        message = "services.ownloom-gateway-web.gatewayUrl must stay loopback-only.";
      }
    ];

    systemd.services.ownloom-gateway-web = {
      description = "ownloom gateway web client";
      after = ["network.target" "ownloom-gateway.service"];
      wants = ["ownloom-gateway.service"];
      wantedBy = ["multi-user.target"];
      environment = {
        OWNLOOM_GATEWAY_WEB_HOST = cfg.host;
        OWNLOOM_GATEWAY_WEB_PORT = toString cfg.port;
        OWNLOOM_GATEWAY_URL = cfg.gatewayUrl;
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
