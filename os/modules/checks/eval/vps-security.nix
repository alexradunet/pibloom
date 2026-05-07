{
  inputs,
  lib,
  pkgs,
}: let
  vps = inputs.self.nixosConfigurations.nixpi-vps;
  ssh = vps.config.services.openssh;
  gateway = vps.config.services.ownloom-gateway;
  wikiHealth = vps.config.systemd.services.ownloom-wiki-health-snapshot;
  wikiHealthScript = wikiHealth.script or "";
in
  assert lib.asserts.assertMsg (ssh.enable && ssh.openFirewall) "nixpi-vps must expose OpenSSH intentionally";
  assert lib.asserts.assertMsg (ssh.ports == [22 2222]) "nixpi-vps must keep both recovery SSH ports";
  assert lib.asserts.assertMsg (ssh.settings.PermitRootLogin == "no") "nixpi-vps must not permit root SSH login";
  assert lib.asserts.assertMsg (!ssh.settings.PasswordAuthentication) "nixpi-vps must not permit SSH password auth";
  assert lib.asserts.assertMsg vps.config.services.fail2ban.enable "nixpi-vps must keep fail2ban enabled";
  assert lib.asserts.assertMsg (vps.config.services.fail2ban.jails.sshd.settings.port == "ssh,2222") "fail2ban sshd jail must cover both SSH ports";
  assert lib.asserts.assertMsg gateway.enable "nixpi-vps must keep the transport gateway enabled";
  assert lib.asserts.assertMsg gateway.settings.audioTranscription.enabled "nixpi-vps gateway must keep audio transcription enabled";
  assert lib.asserts.assertMsg (!(gateway.settings.transports.whatsapp.enable or false) || gateway.settings.transports.whatsapp.directMessagesOnly) "nixpi-vps WhatsApp transport must stay direct-message-only when enabled";
  assert lib.asserts.assertMsg (!(gateway.settings.transports.whatsapp.enable or false) || gateway.settings.transports.whatsapp.ownerNumbers != []) "nixpi-vps WhatsApp owner allowlist must not be empty when enabled";
  assert lib.asserts.assertMsg (builtins.hasAttr "ownloom-wiki-health-snapshot" vps.config.systemd.timers) "nixpi-vps must declare the read-only wiki health snapshot timer";
  assert lib.asserts.assertMsg (wikiHealth.serviceConfig.User == vps.config.ownloom.human.name) "wiki health snapshot must run as the primary user";
  assert lib.asserts.assertMsg (wikiHealth.serviceConfig.WorkingDirectory == vps.config.ownloom.root) "wiki health snapshot must run from the ownloom repo root";
  assert lib.asserts.assertMsg (wikiHealth.serviceConfig.StateDirectory == "ownloom-wiki-health") "wiki health snapshot must write state outside the Git repo";
  assert lib.asserts.assertMsg (lib.hasInfix "export HOME=" wikiHealthScript) "wiki health snapshot must set HOME";
  assert lib.asserts.assertMsg (lib.hasInfix "ownloom-wiki call wiki_status" wikiHealthScript) "wiki health snapshot must use ownloom-wiki";
  assert lib.asserts.assertMsg (lib.hasInfix "/var/lib/ownloom-wiki-health/technical.status" wikiHealthScript) "wiki health snapshot must write outside the repository";
  assert lib.asserts.assertMsg (vps.config.systemd.timers.ownloom-wiki-health-snapshot.timerConfig.OnCalendar == "*-*-* 04:15:00") "wiki health snapshot must run daily";
  assert lib.asserts.assertMsg (builtins.hasAttr "synthetic_api_key" vps.config.sops.secrets) "nixpi-vps must declare the Synthetic API key secret when secrets.yaml exists";
    pkgs.runCommand "ownloom-vps-security-eval" {} ''
      touch $out
    ''
