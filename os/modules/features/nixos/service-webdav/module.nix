{
  config,
  lib,
  pkgs,
  ...
}: let
  cfg = config.services.ownloom-webdav;
  userName = config.ownloom.human.name;
  isLoopback = builtins.elem cfg.address [
    "127.0.0.1"
    "::1"
    "localhost"
  ];
  authFile =
    if cfg.htpasswdFile != null
    then cfg.htpasswdFile
    else "/run/secrets/${cfg.htpasswdSecret}";
  davLocationConfig = authRealm: ''
    # WebDAV verbs — PUT/DELETE/MKCOL/COPY/MOVE are the write methods;
    # PROPFIND/OPTIONS are the discovery methods (dav_ext).
    dav_methods PUT DELETE MKCOL COPY MOVE;
    dav_ext_methods PROPFIND OPTIONS;

    # Allow nginx to create intermediate directories on PUT.
    create_full_put_path on;

    # File/directory permissions created by nginx.
    dav_access user:rw group:r all:r;

    # Basic auth — credentials file is decrypted by sops at runtime.
    auth_basic "${authRealm}";
    auth_basic_user_file ${authFile};

    # Let WebDAV clients discover directory contents.
    autoindex on;

    # Ensure COPY/MOVE destination headers are accepted.
    client_max_body_size 256m;
  '';
in {
  options.services.ownloom-webdav = {
    enable = lib.mkEnableOption "loopback WebDAV server for the ownloom wiki (access via SSH tunnel)";

    address = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "IP address to listen on. Keep this loopback-only; use an SSH tunnel for remote access.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 4918;
      description = "Port for the WebDAV server. Default 4918 (DAV over loopback, unofficial).";
    };

    wikiRoot = lib.mkOption {
      type = lib.types.str;
      default = config.ownloom.wiki.roots.personal;
      defaultText = lib.literalExpression "config.ownloom.wiki.roots.personal";
      description = "Compatibility WebDAV root served at /. Defaults to the personal wiki root. /personal/ and /technical/ expose the explicit split roots.";
    };

    htpasswdSecret = lib.mkOption {
      type = lib.types.str;
      default = "webdav_htpasswd";
      description = ''
        sops-nix secret name whose decrypted value is an htpasswd file (one
        "user:hash" line per user). Generate a hash with:
          nix shell nixpkgs#apacheHttpd -c htpasswd -nB alex
        then add the full "alex:$2y$..." line to the sops secrets file under
        this key name.
      '';
    };

    htpasswdFile = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = ''
        Optional direct htpasswd file path. Prefer htpasswdSecret + sopsFile on
        real hosts; this is useful for tests and throwaway local deployments.
      '';
    };

    sopsFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = ''
        Path to the host's sops-encrypted secrets file that contains the
        htpasswd secret. Typically set to ./secrets.yaml in the host config.
      '';
    };

    metadataRebuildInterval = lib.mkOption {
      type = lib.types.str;
      default = "15min";
      description = ''
        How often to rebuild generated wiki metadata for edits made through
        WebDAV clients. Set to "0" to disable the timer.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = isLoopback;
        message = "services.ownloom-webdav.address must stay loopback-only; use an SSH tunnel for remote access.";
      }
      {
        assertion = cfg.htpasswdFile != null || cfg.sopsFile != null;
        message = "services.ownloom-webdav requires either htpasswdFile or sopsFile.";
      }
    ];

    # nginx with WebDAV extension module, workers running as the wiki owner
    # so they can read/write the personal and technical wiki roots without chmod gymnastics.
    services.nginx = {
      enable = true;
      user = userName;
      additionalModules = [pkgs.nginxModules.dav];

      virtualHosts."ownloom-webdav" = {
        listen = [
          {
            addr = cfg.address;
            inherit (cfg) port;
            ssl = false;
          }
        ];

        locations."/" = {
          root = cfg.wikiRoot;
          extraConfig = davLocationConfig "ownloom Wiki";
        };

        locations."/personal/" = {
          extraConfig = ''
            alias ${config.ownloom.wiki.roots.personal}/;
            ${davLocationConfig "ownloom Personal Wiki"}
          '';
        };

        locations."/technical/" = {
          extraConfig = ''
            alias ${config.ownloom.wiki.roots.technical}/;
            ${davLocationConfig "ownloom Technical Wiki"}
          '';
        };
      };
    };

    systemd = {
      # The NixOS nginx module sets ProtectHome=yes by default, which blocks
      # access to /home even for processes running as the home directory owner.
      # Since this nginx instance is loopback-only and runs as the wiki owner,
      # we disable that restriction so workers can read/write the wiki roots.
      services.nginx.serviceConfig.ProtectHome = lib.mkForce false;
      services.nginx.serviceConfig.ReadWritePaths = lib.mkForce [
        cfg.wikiRoot
        config.ownloom.wiki.roots.personal
        config.ownloom.wiki.roots.technical
      ];

      # Ensure the wiki directory exists with correct ownership before nginx starts.
      tmpfiles.rules = [
        "d ${cfg.wikiRoot} 0750 ${userName} users -"
        "d ${config.ownloom.wiki.roots.personal} 0750 ${userName} users -"
        "d ${config.ownloom.wiki.roots.technical} 0750 ${userName} users -"
      ];

      services.ownloom-webdav-wiki-rebuild = lib.mkIf (cfg.metadataRebuildInterval != "0") {
        description = "Rebuild Ownloom wiki metadata for WebDAV edits";
        after = ["nginx.service"];
        serviceConfig = {
          Type = "oneshot";
          User = userName;
          Group = "users";
          WorkingDirectory = cfg.wikiRoot;
        };
        environment = {
          OWNLOOM_WIKI_ROOT = cfg.wikiRoot;
          OWNLOOM_WIKI_ROOT_PERSONAL = config.ownloom.wiki.roots.personal;
          OWNLOOM_WIKI_ROOT_TECHNICAL = config.ownloom.wiki.roots.technical;
          OWNLOOM_WIKI_WORKSPACE = config.ownloom.wiki.workspace;
          OWNLOOM_WIKI_DEFAULT_DOMAIN = config.ownloom.wiki.defaultDomain;
          OWNLOOM_WIKI_HOST = config.networking.hostName;
        };
        script = ''
          set -euo pipefail
          rebuild_root() {
            domain="$1"
            root="$2"
            if [ -d "$root" ]; then
              OWNLOOM_WIKI_ROOT="$root" \
              OWNLOOM_WIKI_DEFAULT_DOMAIN="$domain" \
                ${pkgs.ownloom-wiki}/bin/ownloom-wiki mutate wiki_rebuild "{\"domain\":\"$domain\"}" --json >/dev/null
            fi
          }
          rebuild_root personal ${lib.escapeShellArg config.ownloom.wiki.roots.personal}
          rebuild_root technical ${lib.escapeShellArg config.ownloom.wiki.roots.technical}
        '';
      };

      timers.ownloom-webdav-wiki-rebuild = lib.mkIf (cfg.metadataRebuildInterval != "0") {
        wantedBy = ["timers.target"];
        timerConfig = {
          OnBootSec = "5min";
          OnUnitActiveSec = cfg.metadataRebuildInterval;
          AccuracySec = "1min";
          Persistent = true;
        };
      };
    };

    # Decrypt the htpasswd file via sops-nix; owned by root, readable only
    # by root — nginx reads it as root before dropping privileges.
    sops = lib.mkIf (cfg.sopsFile != null && cfg.htpasswdFile == null) {
      age.sshKeyPaths = lib.mkDefault ["/etc/ssh/ssh_host_ed25519_key"];
      secrets.${cfg.htpasswdSecret} = {
        inherit (cfg) sopsFile;
        owner = userName;
        group = "root";
        mode = "0400";
      };
    };
  };
}
