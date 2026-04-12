{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.nixpi.signalGateway;
  gatewayPackage = pkgs.callPackage ../pkgs/signal-gateway { };
  gatewayConfig = pkgs.writeText "nixpi-signal-gateway.yml" (
    lib.generators.toYAML { } {
      signal = {
        account = cfg.account;
        httpUrl = "http://127.0.0.1:${toString cfg.port}";
      };
      gateway = {
        dbPath = "${cfg.stateDir}/gateway.db";
        piSessionDir = "${cfg.stateDir}/pi-sessions";
        maxReplyChars = cfg.maxReplyChars;
        maxReplyChunks = cfg.maxReplyChunks;
        directMessagesOnly = cfg.directMessagesOnly;
      };
      pi.cwd = cfg.piCwd;
      auth = {
        allowedNumbers = cfg.allowedNumbers;
        adminNumbers = cfg.adminNumbers;
      };
    }
  );
  bootstrapMode = if config.nixpi.bootstrap.enable then "bootstrap" else "steady";
in
{
  imports = [ ./options.nix ];

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.account != "";
        message = "nixpi.signalGateway.account must not be empty when the Signal gateway is enabled.";
      }
      {
        assertion = cfg.allowedNumbers != [ ];
        message = "nixpi.signalGateway.allowedNumbers must not be empty when the Signal gateway is enabled.";
      }
      {
        assertion = cfg.adminNumbers != [ ];
        message = "nixpi.signalGateway.adminNumbers must not be empty when the Signal gateway is enabled.";
      }
    ];

    environment.systemPackages = [ gatewayPackage pkgs.signal-cli ];

    systemd.tmpfiles.settings.nixpi-signal-gateway = {
      "${cfg.stateDir}".d = {
        mode = "0700";
        user = "root";
        group = "root";
      };
      "${cfg.stateDir}/signal-cli-data".d = {
        mode = "0700";
        user = "root";
        group = "root";
      };
      "${cfg.stateDir}/pi-sessions".d = {
        mode = "0700";
        user = "root";
        group = "root";
      };
      "${cfg.stateDir}/tmp".d = {
        mode = "0700";
        user = "root";
        group = "root";
      };
    };

    systemd.services.nixpi-signal-daemon = {
      description = "NixPI Signal CLI daemon";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" "nixpi-app-setup.service" ];
      wants = [ "network-online.target" "nixpi-app-setup.service" ];
      serviceConfig = {
        Type = "simple";
        User = "root";
        Group = "root";
        WorkingDirectory = cfg.piCwd;
        ExecStart = lib.escapeShellArgs [
          "${pkgs.signal-cli}/bin/signal-cli"
          "--config"
          "${cfg.stateDir}/signal-cli-data"
          "-a"
          cfg.account
          "daemon"
          "--http"
          "127.0.0.1:${toString cfg.port}"
          "--receive-mode"
          "on-start"
          "--ignore-attachments"
        ];
        Restart = "on-failure";
        RestartSec = 3;
      };
    };

    systemd.services.nixpi-signal-gateway = {
      description = "NixPI Signal gateway";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" "nixpi-signal-daemon.service" "nixpi-app-setup.service" ];
      wants = [ "network-online.target" "nixpi-signal-daemon.service" "nixpi-app-setup.service" ];
      serviceConfig = {
        Type = "simple";
        User = "root";
        Group = "root";
        WorkingDirectory = cfg.piCwd;
        ExecStart = lib.escapeShellArgs [ "${gatewayPackage}/bin/nixpi-signal-gateway" gatewayConfig ];
        Restart = "on-failure";
        RestartSec = 3;
        Environment = [
          "HOME=/root"
          "PI_CODING_AGENT_DIR=${config.nixpi.agent.piDir}"
          "NIXPI_PI_DIR=${config.nixpi.agent.piDir}"
          "NIXPI_DIR=${config.nixpi.agent.workspaceDir}"
          "NIXPI_STATE_DIR=${config.nixpi.stateDir}"
          "NIXPI_BOOTSTRAP_MODE=${bootstrapMode}"
        ];
      };
    };
  };
}
