{
  config,
  lib,
  pkgs,
  ...
}: let
  cfg = config.services.ownloom-webdav;
  userName = config.ownloom.human.name;
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
      default = config.ownloom.wiki.root;
      defaultText = lib.literalExpression "config.ownloom.wiki.root";
      description = "Absolute path to the directory served over WebDAV. Defaults to the ownloom wiki root.";
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

    sopsFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = ''
        Path to the host's sops-encrypted secrets file that contains the
        htpasswd secret. Typically set to ./secrets.yaml in the host config.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    # nginx with WebDAV extension module, workers running as the wiki owner
    # so they can read/write ~/wiki without any chmod gymnastics.
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
          extraConfig = ''
            # WebDAV verbs — PUT/DELETE/MKCOL/COPY/MOVE are the write methods;
            # PROPFIND/OPTIONS are the discovery methods (dav_ext).
            dav_methods PUT DELETE MKCOL COPY MOVE;
            dav_ext_methods PROPFIND OPTIONS;

            # Allow nginx to create intermediate directories on PUT.
            create_full_put_path on;

            # File/directory permissions created by nginx.
            dav_access user:rw group:r all:r;

            # Basic auth — credentials file is decrypted by sops at runtime.
            auth_basic "ownloom Wiki";
            auth_basic_user_file /run/secrets/${cfg.htpasswdSecret};

            # Let WebDAV clients discover directory contents.
            autoindex on;

            # Ensure COPY/MOVE destination headers are accepted.
            client_max_body_size 256m;
          '';
        };
      };
    };

    # Decrypt the htpasswd file via sops-nix; owned by root, readable only
    # by root — nginx reads it as root before dropping privileges.
    sops = lib.mkIf (cfg.sopsFile != null) {
      age.sshKeyPaths = lib.mkDefault ["/etc/ssh/ssh_host_ed25519_key"];
      secrets.${cfg.htpasswdSecret} = {
        inherit (cfg) sopsFile;
        owner = userName;
        group = "root";
        mode = "0400";
      };
    };

    # The NixOS nginx module sets ProtectHome=yes by default, which blocks
    # access to /home even for processes running as the home directory owner.
    # Since this nginx instance is loopback-only and runs as the wiki owner,
    # we disable that restriction so workers can read/write ~/wiki.
    systemd.services.nginx.serviceConfig.ProtectHome = lib.mkForce false;

    # Ensure the wiki directory exists with correct ownership before nginx starts.
    systemd.tmpfiles.rules = [
      "d ${cfg.wikiRoot} 0750 ${userName} users -"
    ];
  };
}
