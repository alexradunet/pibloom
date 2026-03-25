{ pkgs }:

{ config, lib, options, ... }:

let
  inherit (lib) mkOption types;
  webroot = builtins.dirOf config.configData."webroot/index.html".path;
in
{
  _class = "service";

  options.nixpi-home = {
    port = mkOption {
      type = types.port;
    };

    bindAddress = mkOption {
      type = types.str;
    };

    primaryUser = mkOption {
      type = types.str;
    };

    elementWebPort = mkOption {
      type = types.port;
    };

    matrixPort = mkOption {
      type = types.port;
    };

    matrixClientBaseUrl = mkOption {
      type = types.str;
    };

    trustedInterface = mkOption {
      type = types.str;
    };
  };

  config = {
    process.argv = [
      "${pkgs.static-web-server}/bin/static-web-server"
      "--host"
      config.nixpi-home.bindAddress
      "--port"
      (toString config.nixpi-home.port)
      "--root"
      webroot
      "--health"
    ];

    configData = {
      "webroot/index.html".text = ''
        <!doctype html>
        <html lang="en">
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NixPI Home</title></head>
        <body>
          <h1>NixPI Home</h1>
          <p>Primary interfaces: terminal, Matrix, and Element Web.</p>
          <h2>Canonical access</h2>
          <p>Use the NetBird host over HTTPS during normal operation.</p>
          <ul>
            <li>Home: <a data-page-link href="">canonical host not available on localhost recovery</a></li>
            <li>Element Web: <a data-element-link href="">canonical host not available on localhost recovery</a></li>
            <li>Matrix URL: <a data-matrix-link href="">canonical host not available on localhost recovery</a></li>
          </ul>
          <h2>Recovery</h2>
          <p>Use <a href="http://localhost/">http://localhost/</a> only when NetBird access is unavailable on the box.</p>
          <script>
            (function () {
              const currentHost = window.location.hostname;
              if (!currentHost) return;
              if (/^(localhost|127\.0\.0\.1)$/.test(currentHost)) {
                return;
              }
              const canonicalHost = currentHost;
              const pageUrl = "https://" + canonicalHost + "/";
              const elementUrl = "https://" + canonicalHost + "/element/";
              const matrixUrl = "https://" + canonicalHost;
              for (const node of document.querySelectorAll("[data-page-link]")) {
                node.textContent = pageUrl;
                node.href = pageUrl;
              }
              for (const node of document.querySelectorAll("[data-element-link]")) {
                node.textContent = elementUrl;
                node.href = elementUrl;
              }
              for (const node of document.querySelectorAll("[data-matrix-link]")) {
                node.textContent = matrixUrl;
                node.href = matrixUrl;
              }
            })();
          </script>
        </body>
        </html>
      '';
    };

    # `system.services` portability: guard systemd-specific config so this module
    # can be consumed by non-systemd init systems if NixOS ever supports them.
    # See nixpkgs nixos/README-modular-services.md.
  } // lib.optionalAttrs (options ? systemd) {
    systemd.service = {
      description = "NixPI Home landing page";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        User = config.nixpi-home.primaryUser;
        Group = config.nixpi-home.primaryUser;
        UMask = "0007";
        Restart = "on-failure";
        RestartSec = "10";
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = false;
      };
    };
  };
}
