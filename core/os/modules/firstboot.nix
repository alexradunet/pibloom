# core/os/modules/firstboot.nix
{ config, pkgs, lib, ... }:

let
  resolved = import ../lib/resolve-primary-user.nix { inherit lib config; };
  primaryUser = resolved.resolvedPrimaryUser;
  primaryHome = resolved.resolvedPrimaryHome;
  stateDir = config.nixpi.stateDir;
  setupCompleteFile = "${primaryHome}/.nixpi/.setup-complete";
  matrixRegistrationSecretFile =
    if config.nixpi.matrix.registrationSharedSecretFile != null then
      config.nixpi.matrix.registrationSharedSecretFile
    else
      "${stateDir}/secrets/matrix-registration-shared-secret";
  bootstrapAction = action: command: pkgs.writeShellScriptBin "nixpi-bootstrap-${action}" ''
    set -euo pipefail
    if [ -f "${setupCompleteFile}" ]; then
      echo "nixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi
    exec ${command} "$@"
  '';
  bootstrapReadMatrixSecret = bootstrapAction "read-matrix-secret" "/run/current-system/sw/bin/cat ${matrixRegistrationSecretFile}";
  bootstrapMatrixJournal = bootstrapAction "matrix-journal" "/run/current-system/sw/bin/journalctl -u matrix-synapse --no-pager";
  bootstrapNetbird = bootstrapAction "netbird-up" "/run/current-system/sw/bin/netbird up";
  bootstrapNetbirdSystemctl = bootstrapAction "netbird-systemctl" "/run/current-system/sw/bin/systemctl";
  bootstrapSshdSystemctl = bootstrapAction "sshd-systemctl" "/run/current-system/sw/bin/systemctl";
  bootstrapPasswd = bootstrapAction "passwd" "/run/current-system/sw/bin/passwd ${primaryUser}";
  bootstrapChpasswd = bootstrapAction "chpasswd" "/run/current-system/sw/bin/chpasswd";
  bootstrapBroker = bootstrapAction "brokerctl" "/run/current-system/sw/bin/nixpi-brokerctl";
in
{
  imports = [ ./options.nix ];

  environment.systemPackages = [
    bootstrapReadMatrixSecret
    bootstrapMatrixJournal
    bootstrapNetbird
    bootstrapNetbirdSystemctl
    bootstrapSshdSystemctl
    bootstrapPasswd
    bootstrapChpasswd
    bootstrapBroker
  ];

  systemd.services.nixpi-firstboot = {
    description = "nixPI First-Boot Setup";
    wantedBy = [ "multi-user.target" ];
    after = [
      "network-online.target"
      "matrix-synapse.service"
      "netbird.service"
      "nixpi-daemon.service"
      "nixpi-home.service"
      "nixpi-chat.service"
    ];
    wants = [
      "network-online.target"
      "matrix-synapse.service"
      "netbird.service"
      "nixpi-daemon.service"
      "nixpi-home.service"
      "nixpi-chat.service"
    ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      User = primaryUser;
      ExecStart = "${pkgs.bash}/bin/bash ${../../scripts/firstboot.sh}";
      StandardOutput = "journal";
      StandardError = "journal";
      Environment = [
        "HOME=${primaryHome}"
        "NIXPI_DIR=${primaryHome}/nixPI"
        "NIXPI_STATE_DIR=${stateDir}"
        "NIXPI_PI_DIR=${stateDir}/agent"
        "NIXPI_CONFIG_DIR=${stateDir}/services"
        "NIXPI_KEEP_SSH_AFTER_SETUP=${if config.nixpi.bootstrap.keepSshAfterSetup then "1" else "0"}"
      ];
      SuccessExitStatus = "0 1";
    };
    unitConfig.ConditionPathExists = "!${primaryHome}/.nixpi/.setup-complete";
  };

  systemd.services.nixpi-post-setup = {
    description = "nixPI post-setup security transitions";
    unitConfig.ConditionPathExists = setupCompleteFile;
    serviceConfig = {
      Type = "oneshot";
      User = "root";
      Group = "root";
    };
    script = ''
      ${lib.optionalString (!config.nixpi.bootstrap.keepSshAfterSetup) ''
        systemctl stop sshd.service || true
      ''}
      systemctl try-restart matrix-synapse.service || true
    '';
  };

  systemd.paths.nixpi-post-setup = {
    description = "Watch for nixPI setup completion";
    wantedBy = [ "multi-user.target" ];
    pathConfig = {
      PathChanged = "${primaryHome}/.nixpi";
      Unit = "nixpi-post-setup.service";
    };
  };

  security.sudo.extraRules = lib.optional config.nixpi.bootstrap.passwordlessSudo.enable {
    users = [ primaryUser ];
    commands = [
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-read-matrix-secret"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-matrix-journal"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-netbird-up --setup-key *"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-netbird-systemctl * netbird.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-sshd-systemctl stop sshd.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-passwd"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-chpasswd"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-brokerctl systemd *"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-brokerctl status"; options = [ "NOPASSWD" ]; }
    ];
  };
}
