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
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi
    exec ${command} "$@"
  '';
  bootstrapReadMatrixSecret = bootstrapAction "read-matrix-secret" "/run/current-system/sw/bin/cat ${matrixRegistrationSecretFile}";
  bootstrapMatrixJournal = bootstrapAction "matrix-journal" "/run/current-system/sw/bin/journalctl -u matrix-synapse --no-pager";
  bootstrapNetbird = bootstrapAction "netbird-up" "/run/current-system/sw/bin/netbird up";
  bootstrapNetbirdSystemctl = bootstrapAction "netbird-systemctl" "/run/current-system/sw/bin/systemctl";
  bootstrapMatrixSystemctl = bootstrapAction "matrix-systemctl" "/run/current-system/sw/bin/systemctl";
  bootstrapServiceSystemctl = bootstrapAction "service-systemctl" "/run/current-system/sw/bin/systemctl";
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
    bootstrapMatrixSystemctl
    bootstrapServiceSystemctl
    bootstrapSshdSystemctl
    bootstrapPasswd
    bootstrapChpasswd
    bootstrapBroker
  ];

  security.sudo.extraRules = lib.optional config.nixpi.bootstrap.passwordlessSudo.enable {
    users = [ primaryUser ];
    commands = [
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-read-matrix-secret"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-matrix-journal"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-matrix-systemctl start matrix-synapse.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-matrix-systemctl restart matrix-synapse.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-netbird-up --setup-key *"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-netbird-systemctl * netbird.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-matrix-systemctl try-restart matrix-synapse.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-service-systemctl restart nixpi-home.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-service-systemctl restart nixpi-element-web.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-service-systemctl enable --now nixpi-daemon.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-sshd-systemctl stop sshd.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-passwd"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-chpasswd"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-brokerctl systemd *"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-brokerctl status"; options = [ "NOPASSWD" ]; }
    ];
  };
}
