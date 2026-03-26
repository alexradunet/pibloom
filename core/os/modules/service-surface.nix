{ pkgs, lib, config, ... }:

let
  cfg = config.nixpi.services;
  tlsDir = "/var/lib/nixpi-tls";
  tlsCertPath = "${tlsDir}/nixpi-secure.crt";
  tlsKeyPath = "${tlsDir}/nixpi-secure.key";
  secureWebTlsSetup = pkgs.writeShellScript "nixpi-secure-web-tls-setup" ''
    set -euo pipefail

    tls_dir="${tlsDir}"
    cert_path="${tlsCertPath}"
    key_path="${tlsKeyPath}"
    host_name="${config.networking.hostName}"

    fqdn=""
    mesh_ip=""
    if command -v netbird >/dev/null 2>&1; then
      status_json="$(netbird status --json 2>/dev/null || true)"
      if [ -n "$status_json" ]; then
        fqdn="$(printf '%s' "$status_json" | ${pkgs.jq}/bin/jq -r '.fqdn // empty')"
        mesh_ip="$(printf '%s' "$status_json" | ${pkgs.jq}/bin/jq -r '.netbirdIp // empty | split("/")[0]')"
      fi
    fi

    common_name="$host_name"
    if [ -n "$fqdn" ]; then
      common_name="$fqdn"
    fi

    san_entries="DNS:$host_name,DNS:localhost,IP:127.0.0.1"
    if [ -n "$fqdn" ]; then
      san_entries="$san_entries,DNS:$fqdn"
    fi
    if [ -n "$mesh_ip" ]; then
      san_entries="$san_entries,IP:$mesh_ip"
    fi

    install -d -m 0750 -o nginx -g nginx "$tls_dir"
    tmp_conf="$(mktemp)"
    cat > "$tmp_conf" <<EOF
[req]
distinguished_name = dn
x509_extensions = v3_req
prompt = no

[dn]
CN = $common_name

[v3_req]
subjectAltName = $san_entries
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
EOF

    ${pkgs.openssl}/bin/openssl req \
      -x509 \
      -nodes \
      -newkey rsa:2048 \
      -days 3650 \
      -keyout "$key_path" \
      -out "$cert_path" \
      -config "$tmp_conf"

    rm -f "$tmp_conf"
    chown nginx:nginx "$cert_path" "$key_path"
    chmod 0640 "$cert_path" "$key_path"
  '';
in
{
  imports = [ ./options.nix ];

  config = {
    assertions = [
      {
        assertion = (!cfg.home.enable) || cfg.secureWeb.enable;
        message = "Canonical hosted access requires nixpi.services.secureWeb.enable = true.";
      }
    ];

    systemd.tmpfiles.rules = lib.mkIf cfg.secureWeb.enable [
      "d ${tlsDir} 0750 nginx nginx -"
    ];

    systemd.services.nixpi-secure-web-tls = lib.mkIf cfg.secureWeb.enable {
      description = "Generate self-signed TLS certificate for secure NixPI web entry point";
      after = [ "network-online.target" "netbird.service" ];
      wants = [ "network-online.target" "netbird.service" ];
      wantedBy = [ "multi-user.target" ];
      before = [ "nginx.service" ];
      serviceConfig = {
        Type = "oneshot";
        User = "root";
        Group = "root";
        ExecStart = secureWebTlsSetup;
      };
    };

    services.nginx = lib.mkMerge [
      (lib.mkIf cfg.home.enable {
        enable = true;
        recommendedProxySettings = true;
        virtualHosts.nixpi-home = {
          default = true;
          listen = [
            {
              addr = cfg.bindAddress;
              port = 80;
            }
          ];
          locations."/".proxyPass = "http://127.0.0.1:${toString cfg.home.port}";
          locations."/".extraConfig = lib.optionalString cfg.secureWeb.enable ''
            if ($host !~* ^(localhost|127\.0\.0\.1)$) {
              return 308 https://$host$request_uri;
            }
          '';
        };
      })
      (lib.mkIf cfg.secureWeb.enable {
        enable = true;
        recommendedProxySettings = true;
        virtualHosts.nixpi-secure-web = {
          default = true;
          onlySSL = true;
          listen = [
            {
              addr = cfg.bindAddress;
              port = cfg.secureWeb.port;
              ssl = true;
            }
          ];
          sslCertificate = tlsCertPath;
          sslCertificateKey = tlsKeyPath;
          locations."/".proxyPass = "http://127.0.0.1:${toString cfg.home.port}";
        };
      })
    ];
  };
}
