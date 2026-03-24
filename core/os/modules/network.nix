# core/os/modules/network.nix
{ pkgs, lib, config, ... }:

let
  primaryUser = config.nixpi.primaryUser;
  primaryHome = "/home/${primaryUser}";
  stateDir = config.nixpi.stateDir;
  systemReadyFile = "${primaryHome}/.nixpi/wizard-state/system-ready";
  cfg = config.nixpi.services;
  securityCfg = config.nixpi.security;
  sshAllowUsers =
    if securityCfg.ssh.allowUsers != [ ] then
      securityCfg.ssh.allowUsers
    else
      lib.optional (primaryUser != "") primaryUser;
  bindsLocally =
    cfg.bindAddress == "127.0.0.1"
    || cfg.bindAddress == "::1"
    || cfg.bindAddress == "localhost";
  exposedPorts =
    lib.optionals cfg.home.enable [ 80 ]
    ++
    lib.optionals cfg.home.enable [ cfg.home.port ]
    ++ lib.optionals cfg.elementWeb.enable [ cfg.elementWeb.port ]
    ++ [ config.nixpi.matrix.port ]
    ++ lib.optionals config.nixpi.netbird.ssh.enable [ 22022 ];
  preferWifi = pkgs.writeShellScriptBin "nixpi-prefer-wifi" ''
    set -euo pipefail

    if ! command -v nmcli >/dev/null 2>&1; then
      exit 0
    fi

    while IFS=: read -r uuid type; do
      [ -n "$uuid" ] || continue
      case "$type" in
        802-11-wireless)
          priority=100
          ;;
        802-3-ethernet)
          priority=-100
          ;;
        *)
          continue
          ;;
      esac

      current_priority="$(nmcli -g connection.autoconnect-priority connection show uuid "$uuid" 2>/dev/null || true)"
      current_autoconnect="$(nmcli -g connection.autoconnect connection show uuid "$uuid" 2>/dev/null || true)"
      if [ "$current_priority" = "$priority" ] && [ "$current_autoconnect" = "yes" ]; then
        continue
      fi

      nmcli connection modify uuid "$uuid" \
        connection.autoconnect yes \
        connection.autoconnect-priority "$priority" >/dev/null 2>&1 || true
    done < <(nmcli -t -f UUID,TYPE connection show 2>/dev/null || true)
  '';
  netbirdDnsProxy = pkgs.writeShellScriptBin "nixpi-netbird-dns-proxy" ''
    set -euo pipefail

    ${pkgs.socat}/bin/socat \
      UDP4-LISTEN:53,bind=127.0.0.1,fork,reuseaddr \
      UDP4:127.0.0.1:${toString config.nixpi.netbird.dns.localForwarderPort} &
    udp_pid=$!

    ${pkgs.socat}/bin/socat \
      TCP4-LISTEN:53,bind=127.0.0.1,fork,reuseaddr \
      TCP4:127.0.0.1:${toString config.nixpi.netbird.dns.localForwarderPort} &
    tcp_pid=$!

    trap 'kill "$udp_pid" "$tcp_pid" >/dev/null 2>&1 || true' EXIT INT TERM
    wait "$udp_pid" "$tcp_pid"
  '';
in

{
  imports = [ ./options.nix ];

  config = lib.mkMerge [
    {
      assertions = [
        {
          assertion = securityCfg.trustedInterface != "";
          message = "nixpi.security.trustedInterface must not be empty.";
        }
        {
          assertion = cfg.bindAddress != "";
          message = "nixpi.services.bindAddress must not be empty.";
        }
        {
          assertion = lib.length (lib.unique exposedPorts) == lib.length exposedPorts;
          message = "NixPI service ports must be unique across built-in services and Matrix.";
        }
      ];

      hardware.enableAllFirmware = true;
      services.netbird.enable = true;
      services.netbird.clients.default.config.DisableAutoConnect = lib.mkForce true;

      services.openssh = {
        enable = true;
        settings = {
          AllowAgentForwarding = false;
          AllowTcpForwarding = false;
          ClientAliveCountMax = 2;
          ClientAliveInterval = 300;
          LoginGraceTime = 30;
          MaxAuthTries = 3;
          PasswordAuthentication = securityCfg.ssh.passwordAuthentication;
          PubkeyAuthentication = "yes";
          PermitRootLogin = "no";
          X11Forwarding = false;
        };
        extraConfig = lib.optionalString (sshAllowUsers != [ ]) ''
          AllowUsers ${lib.concatStringsSep " " sshAllowUsers}
        '';
      };
      systemd.services.sshd.unitConfig = lib.mkIf (!config.nixpi.bootstrap.keepSshAfterSetup) {
        ConditionPathExists = "!${systemReadyFile}";
      };

      networking.firewall.enable = true;
      networking.firewall.allowedTCPPorts = [ 22 ];
      # trustedInterface defaults to "wt0" (NetBird mesh interface).
      # These firewall rules are inert until NetBird connects and wt0 exists.
      # During first-boot setup, SSH access relies on the physical interface,
      # which is opened separately via nixpi.security.ssh options.
      networking.firewall.interfaces = lib.mkIf securityCfg.enforceServiceFirewall {
        "${securityCfg.trustedInterface}".allowedTCPPorts = exposedPorts;
      };
      networking.networkmanager.enable = true;

      systemd.services.nixpi-prefer-wifi = {
        description = "Prefer WiFi profiles over Ethernet in NetworkManager";
        after = [ "NetworkManager.service" ];
        wants = [ "NetworkManager.service" ];
        wantedBy = [ "multi-user.target" ];
        serviceConfig = {
          Type = "oneshot";
          ExecStart = "${preferWifi}/bin/nixpi-prefer-wifi";
        };
      };

      services.fail2ban = lib.mkIf securityCfg.fail2ban.enable {
        enable = true;
        jails.sshd.settings = {
          enabled = true;
          backend = "systemd";
          bantime = "1h";
          findtime = "10m";
          maxretry = 5;
        };
      };

      services.resolved.enable = lib.mkIf (config.nixpi.netbird.apiTokenFile != null) true;
      services.resolved.settings = lib.mkIf (config.nixpi.netbird.apiTokenFile != null) {
        Resolve = {
          DNS = [ "127.0.0.1" ];
          Domains = [ "~${config.nixpi.netbird.dns.domain}" ];
        };
      };

      systemd.services.nixpi-netbird-dns-proxy = lib.mkIf (config.nixpi.netbird.apiTokenFile != null) {
        description = "Loopback DNS proxy for NetBird local forwarder";
        after = [ "netbird.service" ];
        wants = [ "netbird.service" ];
        wantedBy = [ "multi-user.target" ];
        serviceConfig = {
          ExecStart = "${netbirdDnsProxy}/bin/nixpi-netbird-dns-proxy";
          Restart = "on-failure";
          RestartSec = "5s";
          AmbientCapabilities = [ "CAP_NET_BIND_SERVICE" ];
          CapabilityBoundingSet = [ "CAP_NET_BIND_SERVICE" ];
          NoNewPrivileges = false;
        };
      };

      systemd.tmpfiles.rules = [
        "d ${primaryHome}/nixpi 2775 ${primaryUser} ${primaryUser} -"
      ];

      environment.systemPackages = with pkgs; [
        jq
        netbird
        netbirdDnsProxy
        preferWifi
      ];
      warnings =
        lib.optional (!securityCfg.enforceServiceFirewall && !bindsLocally) ''
          NixPI's built-in service surface is bound to `${cfg.bindAddress}` without
          the trusted-interface firewall restriction. Home, Element Web, and
          Matrix may be reachable on all network interfaces.
        '';
    }
    (lib.mkIf config.nixpi.netbird.ssh.enable {
      services.netbird.clients.default.config.SSHAllowed = true;
    })
  ];
}
