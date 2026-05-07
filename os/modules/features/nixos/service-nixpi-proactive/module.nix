{
  config,
  lib,
  pkgs,
  ...
}: let
  cfg = config.services.nixpi-proactive-timers;
  userName = config.nixpi.human.name;
  userHome = config.nixpi.human.homeDirectory;
  userGroup = config.users.users.${userName}.group or "users";

  mkSvcName = name: "nixpi-proactive-task-${name}";

  mkTaskScript = name: task: let
    baseParts =
      ["${pkgs.pi}/bin/pi" "--print" "--mode" "text" "--no-session"]
      ++ lib.optionals (task.systemPrompt != "") ["--system-prompt" task.systemPrompt]
      ++ lib.optionals (task.thinking != null) ["--thinking" task.thinking]
      ++ lib.optionals (task.enabledTools != "") ["--tools" task.enabledTools]
      ++ task.extraArgs;

    cmdParts = baseParts ++ lib.optionals (task.model != "") ["--model" task.model];
    fallbackParts = baseParts ++ lib.optionals (task.fallbackModel != "") ["--model" task.fallbackModel];

    promptText = lib.concatStringsSep "\n\n" task.userPrompts;

    fullArgs = cmdParts ++ [promptText];
    fallbackArgs = fallbackParts ++ [promptText];

    hasFallback = task.fallbackModel != "";
  in
    pkgs.writeShellScript (mkSvcName name) ''
      set -euo pipefail

      credential_dir="''${CREDENTIALS_DIRECTORY:-}"
      credential_file="$credential_dir/synthetic_api_key"
      if [ -n "$credential_dir" ] && [ -r "$credential_file" ] && [ -z "''${SYNTHETIC_API_KEY:-}" ]; then
        export SYNTHETIC_API_KEY="$(< "$credential_file")"
      fi

      ${lib.optionalString hasFallback ''
        if ! ${lib.escapeShellArgs fullArgs}; then
          echo "nixpi-proactive [${name}]: primary model failed, retrying with fallback" >&2
          exec ${lib.escapeShellArgs fallbackArgs}
        fi
      ''}
      ${lib.optionalString (!hasFallback) ''exec ${lib.escapeShellArgs fullArgs}''}
    '';

  mkTaskService = name: task: {
    description = "NixPI proactive task: ${name}";
    serviceConfig = {
      Type = "oneshot";
      User = userName;
      Group = userGroup;
      WorkingDirectory = config.nixpi.root;
      ExecStart = mkTaskScript name task;
      LoadCredential = ["synthetic_api_key:${cfg.syntheticApiKeyFile}"];
      NoNewPrivileges = true;
      ProtectSystem = "strict";
      ProtectHome = "read-only";
      ReadWritePaths = [
        config.nixpi.root
        config.nixpi.wiki.root
        "${userHome}/.pi"
      ];
      PrivateTmp = true;
    };
    environment =
      {
        HOME = userHome;
        XDG_CONFIG_HOME = "${userHome}/.config";
        XDG_CACHE_HOME = "${userHome}/.cache";
        PI_CODING_AGENT_DIR = "${userHome}/.pi/agent";
        NIXPI_WIKI_ROOT = config.nixpi.wiki.root;
        NIXPI_WIKI_WORKSPACE = config.nixpi.wiki.workspace;
        NIXPI_WIKI_DEFAULT_DOMAIN = config.nixpi.wiki.defaultDomain;
        NIXPI_WIKI_HOST = config.networking.hostName;
        PI_SYNTHETIC_API_KEY_FILE = "%d/synthetic_api_key";
      }
      // config.nixpi.plannerEnvVars;
    path = [
      pkgs.pi
      pkgs.coreutils
      pkgs.git
      pkgs.gnugrep
      pkgs.ripgrep
      pkgs.fd
      pkgs.findutils
      pkgs.nixpi-context
      pkgs.nixpi-health
      pkgs.nixpi-status
      pkgs.nixpi-wiki
      pkgs.nixpi-planner
    ];
  };

  mkTaskTimer = _name: task: {
    wantedBy = ["timers.target"];
    timerConfig = {
      OnCalendar = task.schedule;
      Persistent = task.persistent;
      RandomizedDelaySec = task.randomizedDelaySec;
    };
  };

  taskOpts = {name, ...}: {
    options = {
      enable = lib.mkEnableOption "this proactive task (${name})";

      schedule = lib.mkOption {
        type = lib.types.str;
        default = "daily";
        description = ''
          systemd calendar event specification.
          Examples:
            "*-*-* 08:00:00"       → daily at 08:00
            "Mon *-*-* 09:00:00"   → Monday mornings
            "hourly"               → every hour
        '';
      };

      systemPrompt = lib.mkOption {
        type = lib.types.str;
        default = "";
        description = ''
          System prompt passed to the pi agent for this task.
          If empty, the default coding assistant prompt is used.
        '';
      };

      userPrompts = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [];
        description = ''
          One or more user prompts. They are concatenated with blank lines
          and passed as the final argument to `pi --print`.
        '';
      };

      model = lib.mkOption {
        type = lib.types.str;
        default = "";
        description = ''
          Model override for this task. If empty, uses the user default
          from ~/.pi/agent/settings.json.
        '';
      };

      thinking = lib.mkOption {
        type = lib.types.nullOr (lib.types.enum ["off" "minimal" "low" "medium" "high" "xhigh"]);
        default = null;
        description = ''
          Override Pi thinking level for this task. Null means default.
        '';
      };

      enabledTools = lib.mkOption {
        type = lib.types.str;
        default = "";
        description = ''
          Comma-separated tool allowlist (passed to pi --tools).
          If empty, all available tools are enabled.
        '';
      };

      extraArgs = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [];
        description = ''
          Extra CLI arguments passed through to the `pi` invocation.
          Use sparingly — prefer structured options above.
        '';
      };

      fallbackModel = lib.mkOption {
        type = lib.types.str;
        default = "";
        description = ''
          Pi model selector used as fallback if the primary model fails.
          Format: provider/model-id, e.g. synthetic/hf:moonshotai/Kimi-K2.6.
          Empty string disables fallback.
        '';
      };

      persistent = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          When true, systemd runs the job immediately if the system was
          off when the timer was scheduled to fire.
        '';
      };

      randomizedDelaySec = lib.mkOption {
        type = lib.types.int;
        default = 0;
        description = ''
          Max seconds to randomize the start time, avoiding thundering herd.
        '';
      };
    };
  };
in {
  options.services.nixpi-proactive-timers = {
    enable = lib.mkEnableOption "NixPI proactive timer tasks";

    syntheticApiKeyFile = lib.mkOption {
      type = lib.types.str;
      default = "/run/secrets/synthetic_api_key";
      description = "Runtime file containing the Synthetic API key for proactive Pi invocations.";
    };

    tasks = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule taskOpts);
      default = {};
      description = ''
        Declarative proactive agent tasks. Each entry becomes a systemd
        timer + oneshot service that invokes `pi --print --no-session`
        with a task-specific prompt.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    assertions =
      lib.mapAttrsToList (name: task: {
        assertion = task.userPrompts != [];
        message = "services.nixpi-proactive-timers.tasks.${name}.userPrompts must not be empty.";
      })
      cfg.tasks;

    systemd = {
      services =
        lib.mapAttrs' (name: task: {
          name = mkSvcName name;
          value = mkTaskService name task;
        })
        cfg.tasks;

      timers =
        lib.mapAttrs' (name: task: {
          name = mkSvcName name;
          value = mkTaskTimer name task;
        })
        cfg.tasks;
    };
  };
}
