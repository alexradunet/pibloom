{
  config,
  lib,
  ...
}: let
  cfg = config.ownloom;
in {
  imports = [
    (lib.mkRenamedOptionModule ["ownloom" "user"] ["ownloom" "human"])
  ];

  config = {
    environment.sessionVariables = {
      OWNLOOM_ROOT = cfg.root;
      OWNLOOM_WIKI_ROOT = cfg.wiki.root;
      OWNLOOM_WIKI_ROOT_PERSONAL = cfg.wiki.roots.personal;
      OWNLOOM_WIKI_ROOT_TECHNICAL = cfg.wiki.roots.technical;
      OWNLOOM_WIKI_WORKSPACE = cfg.wiki.workspace;
      OWNLOOM_WIKI_DEFAULT_DOMAIN = cfg.wiki.defaultDomain;
      OWNLOOM_WIKI_HOST = config.networking.hostName;
    };

    systemd.tmpfiles.rules = [
      "d ${cfg.wiki.roots.technical} 0750 ${cfg.human.name} users -"
    ];
  };

  options.ownloom.plannerEnvVars = lib.mkOption {
    type = lib.types.attrsOf lib.types.str;
    default = {};
    description = ''Planner environment variables for injection into Pi service environments.  Set by service-planner when the planner is enabled.'';
  };

  options.ownloom = {
    role = lib.mkOption {
      type = lib.types.enum ["common" "server" "workstation" "laptop"];
      default = "common";
      description = ''
        High-level ownloom role for this host. Role modules set this for
        diagnostics, assertions, documentation, and generated context.
      '';
    };

    human = {
      name = lib.mkOption {
        type = lib.types.str;
        default = "human";
        description = ''
          Primary human/operator username for ownloom services and user-scoped paths.
          Hosts may override this to a real local account name such as "alex".
        '';
        example = "alex";
      };

      homeDirectory = lib.mkOption {
        type = lib.types.str;
        default = "/home/${cfg.human.name}";
        defaultText = lib.literalExpression ''"/home/${config.ownloom.human.name}"'';
        description = ''
          Home directory of the primary human/operator ownloom user.
          Defaults to /home/<ownloom.human.name>.
        '';
        example = "/home/alex";
      };
    };

    owner = {
      displayName = lib.mkOption {
        type = lib.types.str;
        default = "Human Operator";
        description = "Human-readable owner/operator name used for account descriptions and identity defaults.";
        example = "Alex";
      };

      email = lib.mkOption {
        type = lib.types.str;
        default = "";
        description = "Optional owner/operator email address for tools that need a contact identity.";
        example = "human@example.com";
      };

      sshKeys = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [];
        description = "SSH public keys for the owner/operator. The primary user uses these by default.";
      };
    };

    root = lib.mkOption {
      type = lib.types.str;
      default = "${cfg.human.homeDirectory}/ownloom";
      description = ''
        Absolute path to the ownloom root directory.
        All other ownloom.* paths derive from this by default.
        Change this to relocate the entire ownloom workspace.
      '';
      example = "/home/your-user/ownloom";
    };

    repos = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = {
        ownloom = cfg.root;
        os = "${cfg.root}/os";
      };
      defaultText = lib.literalExpression ''
        {
          ownloom = config.ownloom.root;
          os = "''${config.ownloom.root}/os";
        }
      '';
      description = ''
        Attribute set of absolute paths to ownloom source trees.
        Defaults derive from the root monorepo checkout.
      '';
    };

    config = lib.mkOption {
      type = lib.types.str;
      default = cfg.root;
      defaultText = lib.literalExpression "config.ownloom.root";
      description = ''
        Absolute path to the fleet configuration flake.
        This is the flake ref base for nixos-rebuild switch.
      '';
    };

    wiki = {
      roots = {
        personal = lib.mkOption {
          type = lib.types.str;
          default = "${cfg.human.homeDirectory}/wiki";
          defaultText = lib.literalExpression ''"''${config.ownloom.human.homeDirectory}/wiki"'';
          description = ''
            Absolute path to Alex's personal/human Markdown wiki root.
          '';
        };

        technical = lib.mkOption {
          type = lib.types.str;
          default = "/var/lib/ownloom/wiki";
          description = ''
            Absolute path to Ownloom's technical/operator Markdown wiki root.
          '';
        };
      };

      root = lib.mkOption {
        type = lib.types.str;
        default =
          if cfg.wiki.defaultDomain == "personal"
          then cfg.wiki.roots.personal
          else cfg.wiki.roots.technical;
        defaultText = lib.literalExpression ''
          if config.ownloom.wiki.defaultDomain == "personal"
          then config.ownloom.wiki.roots.personal
          else config.ownloom.wiki.roots.technical
        '';
        description = ''
          Compatibility/default Markdown wiki root used when a caller does not
          specify a domain. Personal and technical roots are configured under
          ownloom.wiki.roots.*.
        '';
      };

      workspace = lib.mkOption {
        type = lib.types.str;
        default = "ownloom";
        description = ''
          Wiki workspace name passed to Pi sessions and wiki tools.
        '';
      };

      defaultDomain = lib.mkOption {
        type = lib.types.str;
        default = "technical";
        description = ''
          Default wiki domain for tools when no domain is specified.
        '';
      };
    };
  };
}
