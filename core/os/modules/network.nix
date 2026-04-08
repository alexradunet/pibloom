# core/os/modules/network.nix
{
  pkgs,
  lib,
  config,
  ...
}:

let
  primaryUser = config.nixpi.primaryUser;
  primaryHome = "/home/${primaryUser}";
  stateDir = config.nixpi.stateDir;
  systemReadyFile = "${primaryHome}/.nixpi/wizard-state/system-ready";
  cfg = config.nixpi.services;
  securityCfg = config.nixpi.security;
  wgCfg = config.nixpi.wireguard;
  sshAllowUsers =
    if securityCfg.ssh.allowUsers != [ ] then
      securityCfg.ssh.allowUsers
    else
      lib.optional (primaryUser != "") primaryUser;
  bindsLocally =
    cfg.bindAddress == "127.0.0.1" || cfg.bindAddress == "::1" || cfg.bindAddress == "localhost";
  exposedPorts =
    lib.optionals cfg.home.enable [ 80 ] ++ lib.optionals cfg.secureWeb.enable [ cfg.secureWeb.port ];
  wireguardPeers = map (
    peer:
    {
      PublicKey = peer.publicKey;
      AllowedIPs = peer.allowedIPs;
    }
    // lib.optionalAttrs (peer.endpoint != null) { Endpoint = peer.endpoint; }
    // lib.optionalAttrs (peer.presharedKeyFile != null) { PresharedKeyFile = peer.presharedKeyFile; }
    // lib.optionalAttrs (peer.persistentKeepalive != null) { PersistentKeepalive = peer.persistentKeepalive; }
  ) wgCfg.peers;
  wireguardSecretFiles =
    lib.unique ([ wgCfg.privateKeyFile ] ++ lib.filter (path: path != null) (map (peer: peer.presharedKeyFile) wgCfg.peers));
  wireguardSecretDirs = lib.unique (map builtins.dirOf wireguardSecretFiles);
  networkctlBin = lib.getExe' pkgs.systemd "networkctl";
  wireguardKeySetup = pkgs.writeShellScript "nixpi-wireguard-key-setup" ''
    set -euo pipefail

    ${lib.concatMapStringsSep "\n" (dir: ''
      ${lib.getExe' pkgs.coreutils "install"} -d -m 0750 -o root -g systemd-network "${dir}"
    '') wireguardSecretDirs}

    if [ ! -f "${wgCfg.privateKeyFile}" ]; then
      if ${if wgCfg.generatePrivateKeyFile then "true" else "false"}; then
        umask 027
        ${lib.getExe' pkgs.wireguard-tools "wg"} genkey > "${wgCfg.privateKeyFile}"
      fi
    fi

    ${lib.concatMapStringsSep "\n" (file: ''
      if [ -e "${file}" ]; then
        ${lib.getExe' pkgs.coreutils "chgrp"} systemd-network "${file}"
        ${lib.getExe' pkgs.coreutils "chmod"} 0640 "${file}"
      fi
    '') wireguardSecretFiles}
  '';
  wireguardCompatService = pkgs.writeShellScript "nixpi-wireguard-up" ''
    set -euo pipefail

    ${networkctlBin} up ${lib.escapeShellArg wgCfg.interface} >/dev/null 2>&1 || true
    ${pkgs.iproute2}/bin/ip link show dev ${lib.escapeShellArg wgCfg.interface} >/dev/null
  '';
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
          message = "NixPI service ports must be unique across built-in services.";
        }
        {
          assertion = lib.all (peer: peer.dynamicEndpointRefreshSeconds == null) wgCfg.peers;
          message = ''
            nixpi.wireguard.peers.*.dynamicEndpointRefreshSeconds is not supported by the
            native systemd.network WireGuard backend. Use static IP endpoints or leave
            peer endpoints unset for roaming clients.
          '';
        }
      ];

      hardware.enableAllFirmware = true;

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
      systemd.sockets.sshd.unitConfig = lib.mkIf (!config.nixpi.bootstrap.keepSshAfterSetup) {
        ConditionPathExists = "!${systemReadyFile}";
      };

      networking.firewall.enable = true;
      networking.firewall.allowedTCPPorts = [ 22 ];
      networking.firewall.allowedUDPPorts = lib.optionals wgCfg.enable [ wgCfg.listenPort ];
      # trustedInterface defaults to "wg0" (the native WireGuard interface).
      # These firewall rules are inert until WireGuard brings the interface up.
      # During first-boot setup, SSH access still relies on the physical interface,
      # which is opened separately via nixpi.security.ssh options.
      networking.firewall.interfaces = lib.mkIf securityCfg.enforceServiceFirewall {
        "${securityCfg.trustedInterface}".allowedTCPPorts = exposedPorts;
      };
      networking.useDHCP = lib.mkDefault false;
      networking.networkmanager.enable = true;
      systemd.network = lib.mkIf wgCfg.enable {
        enable = true;
        wait-online.enable = false;
        netdevs."50-${wgCfg.interface}" = {
          netdevConfig = {
            Kind = "wireguard";
            Name = wgCfg.interface;
          };
          wireguardConfig = {
            ListenPort = wgCfg.listenPort;
            PrivateKeyFile = wgCfg.privateKeyFile;
            RouteTable = "main";
          };
          wireguardPeers = wireguardPeers;
        };
        networks."50-${wgCfg.interface}" = {
          matchConfig.Name = wgCfg.interface;
          address = [ wgCfg.address ];
          linkConfig.RequiredForOnline = "no";
          networkConfig.ConfigureWithoutCarrier = true;
        };
      };

      systemd.services.nixpi-wireguard-key = lib.mkIf wgCfg.enable {
        description = "Prepare NixPI WireGuard key material for systemd-networkd";
        before = [ "systemd-networkd.service" ];
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
        };
        script = builtins.readFile wireguardKeySetup;
      };
      systemd.services.systemd-networkd = lib.mkIf wgCfg.enable {
        wants = [ "nixpi-wireguard-key.service" ];
        after = [ "nixpi-wireguard-key.service" ];
      };

      systemd.services."wireguard-${wgCfg.interface}" = lib.mkIf wgCfg.enable {
        description = "NixPI WireGuard interface ${wgCfg.interface}";
        wants = [ "systemd-networkd.service" ];
        after = [ "systemd-networkd.service" ];
        wantedBy = [ "multi-user.target" ];
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
          ExecStart = wireguardCompatService;
          ExecReload = "${networkctlBin} reconfigure ${wgCfg.interface}";
          ExecStop = "${networkctlBin} down ${wgCfg.interface}";
        };
      };

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

      systemd.tmpfiles.settings.nixpi-workspace = {
        "${config.nixpi.agent.workspaceDir}".d = {
          mode = "2775";
          user = primaryUser;
          group = primaryUser;
        };
      };

      environment.systemPackages = with pkgs; [
        jq
        preferWifi
      ] ++ lib.optionals wgCfg.enable [ wireguard-tools ];
      warnings = lib.optional (!securityCfg.enforceServiceFirewall && !bindsLocally) ''
        NixPI's built-in service surface is bound to `${cfg.bindAddress}` without
        the trusted-interface firewall restriction. Backend service ports may
        be reachable on all network interfaces.
      '';
    }
  ];
}
