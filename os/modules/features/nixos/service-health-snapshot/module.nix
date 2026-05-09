{
  config,
  lib,
  pkgs,
  ...
}: let
  cfg = config.services.ownloom-health-snapshot;
  humanName = config.ownloom.human.name;
  humanHome = config.ownloom.human.homeDirectory;
  stateDir = "/var/lib/${cfg.stateDirectory}";
  outPath = "${stateDir}/${cfg.outFile}";
  extraCmds =
    lib.concatMapStrings (cmd: ''
      echo
      ${cmd}
    '')
    cfg.extraStatusCommands;
in {
  imports = [
    ../paths/module.nix
  ];

  options.services.ownloom-health-snapshot = {
    enable = lib.mkEnableOption "ownloom host health snapshot timer";

    serviceName = lib.mkOption {
      type = lib.types.str;
      default = "ownloom-health-snapshot";
      description = "systemd service and timer unit name.";
    };

    schedule = lib.mkOption {
      type = lib.types.str;
      default = "*-*-* 04:15:00";
      description = "systemd OnCalendar expression for the snapshot timer.";
    };

    stateDirectory = lib.mkOption {
      type = lib.types.str;
      default = "ownloom-health";
      description = "systemd StateDirectory name (relative to /var/lib/).";
    };

    outFile = lib.mkOption {
      type = lib.types.str;
      default = "status.txt";
      description = "Output filename written inside the state directory.";
    };

    extraStatusCommands = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [];
      description = ''
        Additional shell commands appended to the base snapshot script.
        Each string is emitted on its own line, preceded by an echo blank line.
      '';
    };

    extraPackages = lib.mkOption {
      type = lib.types.listOf lib.types.package;
      default = [];
      description = "Extra packages added to the service PATH.";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.${cfg.serviceName} = {
      description = "Write a read-only ownloom host health snapshot";
      serviceConfig = {
        Type = "oneshot";
        User = humanName;
        Group = "users";
        WorkingDirectory = config.ownloom.root;
        StateDirectory = cfg.stateDirectory;
      };
      path =
        [
          pkgs.coreutils
          pkgs.git
          pkgs.ownloom-wiki
        ]
        ++ cfg.extraPackages;
      script = ''
        set -euo pipefail
        export HOME=${humanHome}
        export OWNLOOM_WIKI_ROOT=${config.ownloom.wiki.root}
        export OWNLOOM_WIKI_ROOT_PERSONAL=${config.ownloom.wiki.roots.personal}
        export OWNLOOM_WIKI_ROOT_TECHNICAL=${config.ownloom.wiki.roots.technical}
        export OWNLOOM_WIKI_HOST=${config.networking.hostName}
        export NO_COLOR=1
        out=${outPath}
        tmp="$out.tmp"
        {
          echo "# ownloom host health snapshot"
          echo "timestamp=$(date -Is)"
          echo "host=${config.networking.hostName}"
          echo
          echo "## git status --short"
          git status --short || true
          echo
          echo "## wiki status"
          ownloom-wiki call wiki_status '{"domain":"technical"}' || true
          ${extraCmds}
        } > "$tmp"
        mv "$tmp" "$out"
      '';
    };

    systemd.timers.${cfg.serviceName} = {
      wantedBy = ["timers.target"];
      timerConfig = {
        OnCalendar = cfg.schedule;
        Persistent = true;
      };
    };
  };
}
