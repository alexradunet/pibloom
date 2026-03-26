{ config, pkgs, lib, ... }:

let
  primaryUser = config.nixpi.primaryUser;
  primaryHome = "/home/${primaryUser}";
  stateDir = config.nixpi.stateDir;
  systemReadyFile = "${primaryHome}/.nixpi/wizard-state/system-ready";
  bootstrapPrimaryPasswordFile = "${stateDir}/bootstrap/primary-user-password";

  bootstrapReadPrimaryPassword = pkgs.writeShellScriptBin "nixpi-bootstrap-read-primary-password" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi
    exec /run/current-system/sw/bin/sh -c 'tr -d "\n" < ${bootstrapPrimaryPasswordFile}' "$@"
  '';

  bootstrapRemovePrimaryPassword = pkgs.writeShellScriptBin "nixpi-bootstrap-remove-primary-password" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi
    exec /run/current-system/sw/bin/rm -f ${bootstrapPrimaryPasswordFile} "$@"
  '';

  bootstrapNetbird = pkgs.writeShellScriptBin "nixpi-bootstrap-netbird-up" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi
    exec /run/current-system/sw/bin/netbird up "$@"
  '';

  bootstrapNetbirdSystemctl = pkgs.writeShellScriptBin "nixpi-bootstrap-netbird-systemctl" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi
    exec /run/current-system/sw/bin/systemctl "$@"
  '';

  bootstrapServiceSystemctl = pkgs.writeShellScriptBin "nixpi-bootstrap-service-systemctl" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi
    exec /run/current-system/sw/bin/systemctl "$@"
  '';

  finalizeServiceSystemctl = pkgs.writeShellScriptBin "nixpi-finalize-service-systemctl" ''
    set -euo pipefail
    exec /run/current-system/sw/bin/systemctl "$@"
  '';

  bootstrapSshdSystemctl = pkgs.writeShellScriptBin "nixpi-bootstrap-sshd-systemctl" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi
    exec /run/current-system/sw/bin/systemctl "$@"
  '';

  bootstrapPasswd = pkgs.writeShellScriptBin "nixpi-bootstrap-passwd" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi
    exec /run/current-system/sw/bin/passwd ${primaryUser} "$@"
  '';

  bootstrapChpasswd = pkgs.writeShellScriptBin "nixpi-bootstrap-chpasswd" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi
    exec /run/current-system/sw/bin/chpasswd "$@"
  '';

  bootstrapBroker = pkgs.writeShellScriptBin "nixpi-bootstrap-brokerctl" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi
    exec /run/current-system/sw/bin/nixpi-brokerctl "$@"
  '';

  bootstrapWriteHostNix = pkgs.writeShellScriptBin "nixpi-bootstrap-write-host-nix" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi

    hostname="''${1:-}"
    primary_user="''${2:-}"
    tz="''${3:-}"
    kb="''${4:-}"
    if [ -z "$hostname" ] || [ -z "$primary_user" ] || [ -z "$tz" ] || [ -z "$kb" ]; then
      echo "usage: nixpi-bootstrap-write-host-nix <hostname> <primary_user> <timezone> <keyboard>" >&2
      exit 1
    fi
    if ! printf '%s' "$tz" | grep -qE '^[A-Za-z0-9_+/.-]{1,64}$'; then
      echo "invalid timezone: $tz" >&2
      exit 1
    fi
    if ! printf '%s' "$kb" | grep -qE '^[a-zA-Z0-9_-]{1,32}$'; then
      echo "invalid keyboard layout: $kb" >&2
      exit 1
    fi

    install -d -m 0755 /etc/nixos
    cat > /etc/nixos/nixpi-host.nix <<EOF
{ ... }:
{
  networking.hostName = "$hostname";
  nixpi.primaryUser = "$primary_user";
  nixpi.timezone = "$tz";
  nixpi.keyboard = "$kb";
}
EOF
  '';

in
{
  imports = [ ../options.nix ];

  environment.systemPackages = [
    bootstrapReadPrimaryPassword
    bootstrapRemovePrimaryPassword
    bootstrapNetbird
    bootstrapNetbirdSystemctl
    bootstrapServiceSystemctl
    finalizeServiceSystemctl
    bootstrapSshdSystemctl
    bootstrapPasswd
    bootstrapChpasswd
    bootstrapBroker
    bootstrapWriteHostNix
  ];

  security.sudo.extraRules = lib.optional config.nixpi.bootstrap.passwordlessSudo.enable {
    users = [ primaryUser ];
    commands = [
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-read-primary-password"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-remove-primary-password"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-netbird-up --setup-key *"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-netbird-systemctl * netbird.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-service-systemctl start display-manager.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-finalize-service-systemctl start display-manager.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-sshd-systemctl stop sshd.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-passwd"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-chpasswd"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-brokerctl systemd *"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-brokerctl status"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-write-host-nix *"; options = [ "NOPASSWD" ]; }
    ];
  };
}
