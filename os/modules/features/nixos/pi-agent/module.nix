{
  config,
  lib,
  pkgs,
  ...
}: let
  cfg = config.ownloom.pi;
  userName = config.ownloom.human.name;
  userHome = config.ownloom.human.homeDirectory;
  userGroup = config.users.users.${userName}.group or "users";

  extensionSources = {
    ownloom = "${config.ownloom.root}/os/pkgs/pi-adapter/extension";
  };

  npmPackages = lib.filter (package: lib.hasPrefix "npm:" package) cfg.packages;
  globalPackages = lib.filter (package: !(lib.hasPrefix "npm:" package)) cfg.packages;

  desiredGlobalSettings =
    {
      packages = globalPackages;
      extensions = map (name: extensionSources.${name}) cfg.extensions;
      inherit (cfg) skills;
      inherit (cfg) prompts;
      inherit (cfg) themes;
    }
    // lib.optionalAttrs (cfg.enableSkillCommands != null) {
      inherit (cfg) enableSkillCommands;
    };

  desiredProjectSettings = {
    # npm Pi packages are project-scoped so installs go under
    # $OWNLOOM_ROOT/.pi/npm instead of npm's global prefix in the Nix store.
    packages = npmPackages;
  };

  desiredGlobalSettingsFile = pkgs.writeText "ownloom-pi-global-settings.json" (builtins.toJSON desiredGlobalSettings);
  desiredProjectSettingsFile = pkgs.writeText "ownloom-pi-project-settings.json" (builtins.toJSON desiredProjectSettings);
  extensionSourceChecks =
    lib.concatMapStringsSep "\n" (name: ''
      if [ ! -d ${lib.escapeShellArg extensionSources.${name}} ]; then
        echo "ownloom-pi-settings: missing PI extension source ${name}: ${extensionSources.${name}}" >&2
        echo "ownloom-pi-settings: sync the ownloom checkout before activating this host, or remove the extension from ownloom.pi.extensions." >&2
        exit 1
      fi
    '')
    cfg.extensions;
in {
  imports = [../paths/module.nix];

  options.ownloom.pi = {
    enable = lib.mkEnableOption "declarative PI resource activation for the primary user" // {default = true;};

    extensions = lib.mkOption {
      type = lib.types.listOf (lib.types.enum (builtins.attrNames extensionSources));
      default = [];
      example = ["ownloom"];
      description = ''
        Declaratively enabled PI extensions. Names map to local extension source
        directories under the ownloom checkout and are merged into
        ~/.pi/agent/settings.json during activation.
      '';
    };

    packages = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [];
      description = "Declarative PI package sources written to ~/.pi/agent/settings.json.";
    };

    skills = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [];
      description = "Declarative PI skill paths written to ~/.pi/agent/settings.json.";
    };

    prompts = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [];
      description = "Declarative PI prompt template paths written to ~/.pi/agent/settings.json.";
    };

    themes = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [];
      description = "Declarative PI theme paths written to ~/.pi/agent/settings.json.";
    };

    enableSkillCommands = lib.mkOption {
      type = lib.types.nullOr lib.types.bool;
      default = null;
      description = ''
        Optional declarative override for PI skill command registration.
        Null preserves the existing runtime/user value.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    # Expose the Synthetic API key from the NixOS sops secret to interactive Pi sessions.
    # No TypeScript extension needed for a simple file-read.
    programs.bash.interactiveShellInit = ''
      if [ -r /run/secrets/synthetic_api_key ] && [ -z "''${SYNTHETIC_API_KEY:-}" ]; then
        export SYNTHETIC_API_KEY="$(< /run/secrets/synthetic_api_key)"
      fi
    '';

    system.activationScripts.ownloom-pi-settings = lib.stringAfter ["users"] ''
      install -d -m 0755 -o ${userName} -g ${userGroup} ${lib.escapeShellArg "${userHome}/.pi/agent"}
      install -d -m 0755 -o ${userName} -g ${userGroup} ${lib.escapeShellArg "${config.ownloom.root}/.pi"}

      ${extensionSourceChecks}

      settings=${lib.escapeShellArg "${userHome}/.pi/agent/settings.json"}
      desired=${lib.escapeShellArg desiredGlobalSettingsFile}

      # Merge desired keys into existing settings.json, creating it if absent.
      # jq null-input reads desired, then slurps existing (if present) and merges.
      if [ -f "$settings" ]; then
        ${pkgs.jq}/bin/jq -s '.[0] * .[1]' "$settings" "$desired" > "$settings.tmp"
      else
        ${pkgs.jq}/bin/jq '.' "$desired" > "$settings.tmp"
      fi
      mv "$settings.tmp" "$settings"

      project_settings=${lib.escapeShellArg "${config.ownloom.root}/.pi/settings.json"}
      project_desired=${lib.escapeShellArg desiredProjectSettingsFile}
      if [ -f "$project_settings" ]; then
        ${pkgs.jq}/bin/jq -s '.[0] * .[1]' "$project_settings" "$project_desired" > "$project_settings.tmp"
      else
        ${pkgs.jq}/bin/jq '.' "$project_desired" > "$project_settings.tmp"
      fi
      mv "$project_settings.tmp" "$project_settings"

      chown ${userName}:${userGroup} ${lib.escapeShellArg "${userHome}/.pi/agent/settings.json"} "$project_settings"
      chmod 0644 ${lib.escapeShellArg "${userHome}/.pi/agent/settings.json"} "$project_settings"
    '';
  };
}
