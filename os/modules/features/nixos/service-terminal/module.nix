{
  config,
  lib,
  pkgs,
  utils,
  ...
}: let
  cfg = config.services.ownloom-terminal;
  zellijCommand = ''
    cd ${lib.escapeShellArg cfg.workingDirectory} && exec ${lib.getExe pkgs.zellij} attach --create ${lib.escapeShellArg cfg.sessionName}
  '';
in {
  options.services.ownloom-terminal = {
    enable = lib.mkEnableOption "loopback-only ttyd terminal for the Ownloom cockpit";

    package = lib.mkPackageOption pkgs "ttyd" {};

    host = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Host to bind. Keep loopback-only; use the cockpit SSH tunnel.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8091;
      description = "Port for the local ttyd terminal service.";
    };

    basePath = lib.mkOption {
      type = lib.types.str;
      default = "/terminal";
      description = "Reverse-proxy base path used by ttyd.";
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = config.ownloom.human.name;
      defaultText = lib.literalExpression "config.ownloom.human.name";
      description = "User that owns the terminal session.";
    };

    group = lib.mkOption {
      type = lib.types.str;
      default = "users";
      description = "Group for the terminal service.";
    };

    workingDirectory = lib.mkOption {
      type = lib.types.str;
      default = config.ownloom.root;
      defaultText = lib.literalExpression "config.ownloom.root";
      description = "Working directory for new terminal panes.";
    };

    sessionName = lib.mkOption {
      type = lib.types.str;
      default = "main";
      description = "Zellij session name to attach/create.";
    };

    maxClients = lib.mkOption {
      type = lib.types.ints.positive;
      default = 1;
      description = "Maximum simultaneous ttyd browser clients.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.host == "127.0.0.1" || cfg.host == "::1";
        message = "services.ownloom-terminal.host must stay loopback-only.";
      }
      {
        assertion = lib.hasPrefix "/" cfg.basePath;
        message = "services.ownloom-terminal.basePath must start with /.";
      }
    ];

    systemd.services.ownloom-terminal = {
      description = "Ownloom cockpit terminal";
      after = ["network.target"];
      wantedBy = ["multi-user.target"];
      environment = {
        HOME = config.ownloom.human.homeDirectory;
        USER = cfg.user;
        SHELL = lib.getExe pkgs.bashInteractive;
        OWNLOOM_ROOT = config.ownloom.root;
        OWNLOOM_WIKI_ROOT = config.ownloom.wiki.root;
        OWNLOOM_WIKI_WORKSPACE = config.ownloom.wiki.workspace;
        OWNLOOM_WIKI_DEFAULT_DOMAIN = config.ownloom.wiki.defaultDomain;
        OWNLOOM_WIKI_HOST = config.networking.hostName;
      };
      path = with pkgs; [
        bashInteractive
        coreutils
        git
        nix
        pi
        ripgrep
        zellij
      ];
      serviceConfig = {
        Type = "simple";
        ExecStart = utils.escapeSystemdExecArgs [
          (lib.getExe cfg.package)
          "--interface"
          cfg.host
          "--port"
          (toString cfg.port)
          "--base-path"
          cfg.basePath
          "--writable"
          "--max-clients"
          (toString cfg.maxClients)
          "--terminal-type"
          "xterm-256color"
          (lib.getExe pkgs.bashInteractive)
          "-lc"
          zellijCommand
        ];
        Restart = "on-failure";
        RestartSec = "5s";
        WorkingDirectory = cfg.workingDirectory;
        StandardOutput = "journal";
        StandardError = "journal";
        SyslogIdentifier = "ownloom-terminal";

        User = cfg.user;
        Group = cfg.group;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = false;
        NoNewPrivileges = true;
        RestrictSUIDSGID = true;
        LockPersonality = true;
        UMask = "0077";
      };
    };
  };
}
