# core/os/modules/network.nix
{ pkgs, lib, config, ... }:

let
  u = config.garden.username;
  bloomHomeBootstrap = pkgs.writeShellScript "garden-home-bootstrap" ''
    set -eu
    mkdir -p "$HOME/.config/garden/home" "$HOME/.config/garden/home/tmp"
    if [ ! -f "$HOME/.config/garden/home/index.html" ]; then
      cat > "$HOME/.config/garden/home/index.html" <<'HTML'
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Garden Home</title></head>
<body>
  <h1>Garden Home</h1>
  <ul>
    <li><a href="http://localhost:8081">Garden Web Chat</a></li>
    <li><a href="http://localhost:5000">Garden Files</a></li>
    <li><a href="http://localhost:8443">code-server</a></li>
  </ul>
</body>
</html>
HTML
    fi
    cat > "$HOME/.config/garden/home/nginx.conf" <<'NGINX'
daemon off;
pid /run/user/1000/garden-home-nginx.pid;
error_log stderr;
events { worker_connections 64; }
http {
    include ${pkgs.nginx}/conf/mime.types;
    default_type application/octet-stream;
    access_log off;
    client_body_temp_path /home/${u}/.config/garden/home/tmp;
    server {
        listen 8080;
        root /home/${u}/.config/garden/home;
        try_files $uri $uri/ =404;
    }
}
NGINX
  '';
  fluffychatBootstrap = pkgs.writeShellScript "garden-fluffychat-bootstrap" ''
    set -eu
    mkdir -p "$HOME/.config/garden/fluffychat" "$HOME/.config/garden/fluffychat/tmp"
    cat > "$HOME/.config/garden/fluffychat/config.json" <<'CONFIG'
{
  "applicationName": "Garden Web Chat",
  "defaultHomeserver": "http://localhost:6167"
}
CONFIG
    cat > "$HOME/.config/garden/fluffychat/nginx.conf" <<'NGINX'
daemon off;
pid /run/user/1000/garden-fluffychat-nginx.pid;
error_log stderr;
events { worker_connections 64; }
http {
    include ${pkgs.nginx}/conf/mime.types;
    default_type application/octet-stream;
    access_log off;
    client_body_temp_path /home/${u}/.config/garden/fluffychat/tmp;
    server {
        listen 8081;
        location /config.json {
            alias /home/${u}/.config/garden/fluffychat/config.json;
        }
        location / {
            root /etc/garden/fluffychat-web;
            try_files $uri $uri/ /index.html;
        }
    }
}
NGINX
  '';
in

{
  config = {
    # Enable all firmware for maximum hardware compatibility.
    # This ensures WiFi, Bluetooth, and other hardware works out of the box
    # on the widest range of devices (Intel, Broadcom, Realtek, Atheros, etc.)
    hardware.enableAllFirmware = true;
    services.netbird.enable = true;

    services.openssh = {
      enable = true;
      settings = {
        PasswordAuthentication = true;
        PubkeyAuthentication = "yes";
        PermitRootLogin = "no";
      };
    };

    networking.firewall.trustedInterfaces = [ "wt0" ];
    networking.networkmanager.enable = true;

    environment.etc."garden/fluffychat-web".source = pkgs.fluffychat-web;

    environment.systemPackages = with pkgs; [
      git git-lfs gh
      ripgrep fd bat htop jq curl wget unzip openssl
      just shellcheck biome typescript
      qemu OVMF
      chromium
      netbird
      dufs nginx code-server
    ];

    systemd.user.services.garden-home = {
      description = "Garden Home landing page";
      wantedBy = [ "default.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      serviceConfig = {
        ExecStartPre = "${bloomHomeBootstrap}";
        ExecStart = "${pkgs.nginx}/bin/nginx -c %h/.config/garden/home/nginx.conf";
        Restart = "on-failure";
        RestartSec = 10;
      };
    };

    systemd.user.services.garden-fluffychat = {
      description = "Garden FluffyChat web client";
      wantedBy = [ "default.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      serviceConfig = {
        ExecStartPre = "${fluffychatBootstrap}";
        ExecStart = "${pkgs.nginx}/bin/nginx -c %h/.config/garden/fluffychat/nginx.conf";
        Restart = "on-failure";
        RestartSec = 10;
      };
    };

    systemd.user.services.garden-dufs = {
      description = "Garden Files WebDAV";
      wantedBy = [ "default.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      serviceConfig = {
        ExecStartPre = "${pkgs.coreutils}/bin/mkdir -p %h/Public/Garden";
        ExecStart = "${pkgs.dufs}/bin/dufs %h/Public/Garden -A -b 0.0.0.0 -p 5000";
        Restart = "on-failure";
        RestartSec = 10;
      };
    };

    systemd.user.services.garden-code-server = {
      description = "Garden code-server";
      wantedBy = [ "default.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      serviceConfig = {
        ExecStart = "${pkgs.code-server}/bin/code-server --bind-addr 0.0.0.0:8443 --auth none --disable-telemetry";
        Restart = "on-failure";
        RestartSec = 10;
      };
    };

    systemd.tmpfiles.rules = [
      "d /home/${u}/.config/garden 0755 ${u} ${u} -"
      "d /home/${u}/.config/garden/home 0755 ${u} ${u} -"
      "d /home/${u}/.config/garden/fluffychat 0755 ${u} ${u} -"
      "d /home/${u}/.config/code-server 0755 ${u} ${u} -"
      "d /home/${u}/Public/Garden 0755 ${u} ${u} -"
    ];

    system.activationScripts.garden-builtins = lib.stringAfter [ "users" ] ''
      install -d -m 0755 -o ${u} -g ${u} /home/${u}/.config/garden/home
      install -d -m 0755 -o ${u} -g ${u} /home/${u}/.config/garden/home/tmp
      install -d -m 0755 -o ${u} -g ${u} /home/${u}/.config/garden/fluffychat
      install -d -m 0755 -o ${u} -g ${u} /home/${u}/.config/garden/fluffychat/tmp
      install -d -m 0755 -o ${u} -g ${u} /home/${u}/.config/code-server
      install -d -m 0755 -o ${u} -g ${u} /home/${u}/Public/Garden

      cat > /home/${u}/.config/garden/home/index.html <<'HTML'
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Garden Home</title></head>
<body>
  <h1>Garden Home</h1>
  <ul>
    <li><a href="http://localhost:8081">Garden Web Chat</a></li>
    <li><a href="http://localhost:5000">Garden Files</a></li>
    <li><a href="http://localhost:8443">Garden Code</a></li>
  </ul>
</body>
</html>
HTML

      cat > /home/${u}/.config/garden/home/nginx.conf <<'NGINX'
daemon off;
pid /run/user/1000/garden-home-nginx.pid;
error_log stderr;
events { worker_connections 64; }
http {
    include ${pkgs.nginx}/conf/mime.types;
    default_type application/octet-stream;
    access_log off;
    client_body_temp_path /home/${u}/.config/garden/home/tmp;
    server {
        listen 8080;
        root /home/${u}/.config/garden/home;
        try_files $uri $uri/ =404;
    }
}
NGINX

      cat > /home/${u}/.config/garden/fluffychat/config.json <<'CONFIG'
{
  "applicationName": "Garden Web Chat",
  "defaultHomeserver": "http://localhost:6167"
}
CONFIG

      cat > /home/${u}/.config/garden/fluffychat/nginx.conf <<'NGINX'
daemon off;
pid /run/user/1000/garden-fluffychat-nginx.pid;
error_log stderr;
events { worker_connections 64; }
http {
    include ${pkgs.nginx}/conf/mime.types;
    default_type application/octet-stream;
    access_log off;
    client_body_temp_path /home/${u}/.config/garden/fluffychat/tmp;
    server {
        listen 8081;
        location /config.json {
            alias /home/${u}/.config/garden/fluffychat/config.json;
        }
        location / {
            root /etc/garden/fluffychat-web;
            try_files $uri $uri/ /index.html;
        }
    }
}
NGINX

      chown -R ${u}:${u} /home/${u}/.config/garden /home/${u}/.config/code-server /home/${u}/Public/Garden
    '';
  };
}
