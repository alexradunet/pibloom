{
  config,
  lib,
  pkgs,
  ...
}: let
  cfg = config.services.ownloom-terminal;
  terminalBaseUrl =
    if lib.hasSuffix "/" cfg.basePath
    then cfg.basePath
    else "${cfg.basePath}/";
  zellijConfig = pkgs.writeText "ownloom-terminal-zellij.kdl" ''
    default_shell ${builtins.toJSON (lib.getExe pkgs.bashInteractive)}
    default_cwd ${builtins.toJSON cfg.workingDirectory}
    session_name ${builtins.toJSON cfg.sessionName}
    attach_to_session true
    web_server_ip ${builtins.toJSON cfg.host}
    web_server_port ${toString cfg.port}
    web_sharing "on"

    web_client {
        base_url ${builtins.toJSON terminalBaseUrl}
    }
  '';
  zellijEnv = ''
    uid="$(${pkgs.coreutils}/bin/id -u)"
    if [ -d "/run/user/$uid" ]; then
      export XDG_RUNTIME_DIR="/run/user/$uid"
    elif [ -n "''${RUNTIME_DIRECTORY:-}" ]; then
      export XDG_RUNTIME_DIR="$RUNTIME_DIRECTORY"
    fi
    export ZELLIJ_CONFIG_FILE=${lib.escapeShellArg zellijConfig}
  '';
  ensureTokenScript = pkgs.writeShellScript "ownloom-terminal-zellij-ensure-token" ''
    set -euo pipefail
    ${zellijEnv}

    token_file="''${STATE_DIRECTORY:-/var/lib/ownloom-terminal}/login-token"
    token_group=${lib.escapeShellArg cfg.tokenGroup}
    token_dir="$(${pkgs.coreutils}/bin/dirname "$token_file")"
    ${pkgs.coreutils}/bin/install -d -m 750 "$token_dir"
    ${pkgs.coreutils}/bin/chgrp "$token_group" "$token_dir"
    ${pkgs.coreutils}/bin/chmod 750 "$token_dir"

    if ! ${lib.getExe cfg.package} web --list-tokens | ${pkgs.gnugrep}/bin/grep -q .; then
      token="$(${lib.getExe cfg.package} web --create-token | ${pkgs.gnused}/bin/sed -n 's/^[^:][^:]*: //p' | ${pkgs.coreutils}/bin/tail -n 1)"
      if [ -z "$token" ]; then
        echo "failed to create Zellij web login token" >&2
        exit 1
      fi
      {
        echo "# Zellij web login token for the Ownloom cockpit."
        echo "# Generated once by ownloom-terminal; Zellij cannot display it again."
        echo "$token"
      } > "$token_file"
      echo "created Zellij web login token at $token_file"
    elif [ ! -s "$token_file" ]; then
      echo "Zellij web tokens already exist; token values cannot be retrieved."
      echo "To rotate: stop ownloom-terminal, run 'zellij web --revoke-all-tokens' as ${cfg.user}, then restart."
    fi

    if [ -s "$token_file" ]; then
      ${pkgs.coreutils}/bin/chgrp "$token_group" "$token_file"
      ${pkgs.coreutils}/bin/chmod 640 "$token_file"
    fi
  '';
  startScript = pkgs.writeShellScript "ownloom-terminal-zellij" ''
    set -euo pipefail
    ${zellijEnv}

    cd ${lib.escapeShellArg cfg.workingDirectory}
    exec ${lib.getExe cfg.package} web --start --ip ${lib.escapeShellArg cfg.host} --port ${toString cfg.port}
  '';
in {
  options.services.ownloom-terminal = {
    enable = lib.mkEnableOption "loopback-only Zellij web terminal for the Ownloom cockpit";

    package = lib.mkPackageOption pkgs "zellij" {};

    host = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Host to bind. Keep loopback-only; use the cockpit SSH tunnel.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8091;
      description = "Port for the local Zellij web terminal service.";
    };

    basePath = lib.mkOption {
      type = lib.types.str;
      default = "/terminal";
      description = "Reverse-proxy base path used by the cockpit Terminal tab.";
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
      description = "Regular user group kept as a supplementary group for terminal shells.";
    };

    tokenGroup = lib.mkOption {
      type = lib.types.str;
      default = "ownloom-terminal";
      description = "Primary terminal service group allowed to read the generated Zellij web login token.";
    };

    workingDirectory = lib.mkOption {
      type = lib.types.str;
      default = config.ownloom.root;
      defaultText = lib.literalExpression "config.ownloom.root";
      description = "Working directory for new terminal panes.";
    };

    sessionName = lib.mkOption {
      type = lib.types.str;
      default = "ownloom";
      description = "Default Zellij session name linked from the cockpit.";
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

    users.groups.${cfg.tokenGroup} = {};

    systemd.services.ownloom-terminal = {
      description = "Ownloom cockpit Zellij web terminal";
      after = ["network.target"];
      wantedBy = ["multi-user.target"];
      environment = {
        HOME = config.ownloom.human.homeDirectory;
        USER = cfg.user;
        SHELL = lib.getExe pkgs.bashInteractive;
        OWNLOOM_ROOT = config.ownloom.root;
        OWNLOOM_WIKI_ROOT = config.ownloom.wiki.root;
        OWNLOOM_WIKI_ROOT_PERSONAL = config.ownloom.wiki.roots.personal;
        OWNLOOM_WIKI_ROOT_TECHNICAL = config.ownloom.wiki.roots.technical;
        OWNLOOM_WIKI_WORKSPACE = config.ownloom.wiki.workspace;
        OWNLOOM_WIKI_DEFAULT_DOMAIN = config.ownloom.wiki.defaultDomain;
        OWNLOOM_WIKI_HOST = config.networking.hostName;
      };
      path = with pkgs; [
        bashInteractive
        coreutils
        git
        gnugrep
        gnused
        nix
        pi
        ripgrep
        zellij
      ];
      serviceConfig = {
        Type = "simple";
        ExecStartPre = ensureTokenScript;
        ExecStart = startScript;
        Restart = "on-failure";
        RestartSec = "5s";
        RuntimeDirectory = "ownloom-terminal";
        RuntimeDirectoryMode = "0700";
        StateDirectory = "ownloom-terminal";
        StateDirectoryMode = "0750";
        WorkingDirectory = cfg.workingDirectory;
        StandardOutput = "journal";
        StandardError = "journal";
        SyslogIdentifier = "ownloom-terminal";

        User = cfg.user;
        Group = cfg.tokenGroup;
        SupplementaryGroups = lib.unique [cfg.group cfg.tokenGroup];
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
