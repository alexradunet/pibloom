# tests/nixos/nixpi-install-flow.nix
# Simulate installing nixPI onto an existing NixOS machine/user.

{ pkgs, lib, self, piAgent, appPackage, ... }:

pkgs.testers.runNixOSTest {
  name = "nixpi-install-flow";

  nodes.machine = { ... }: {
    virtualisation.diskSize = 20480;
    virtualisation.memorySize = 4096;
    boot.loader.systemd-boot.enable = true;
    boot.loader.efi.canTouchEfiVariables = true;
    networking.hostName = "nixos-installer-test";
    networking.networkmanager.enable = true;
    time.timeZone = "UTC";
    i18n.defaultLocale = "en_US.UTF-8";
    system.stateVersion = "25.05";

    nix.settings.experimental-features = [ "nix-command" "flakes" ];
    nix.settings.substituters = lib.mkForce [ ];

    services.openssh.enable = true;
    security.sudo.wheelNeedsPassword = false;

    users.users.alex = {
      isNormalUser = true;
      initialPassword = "cico";
      extraGroups = [ "wheel" "networkmanager" ];
      shell = pkgs.bash;
    };

    environment.systemPackages = with pkgs; [
      git
      curl
      just
    ];

    specialisation.nixpi-install.configuration = {
      _module.args = { inherit piAgent appPackage; };

      imports = [
        self.nixosModules.nixpi
        self.nixosModules.firstboot
      ];

      nixpi.primaryUser = "alex";
      nixpi.install.mode = "existing-user";
      nixpi.createPrimaryUser = false;

      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      networking.networkmanager.enable = true;
      boot.kernelParams = [ "console=tty0" "console=ttyS0,115200" ];

      # This test validates the generic install contract on an existing user.
      # It intentionally skips interactive setup and large-model bootstrap.
      systemd.services.nixpi-firstboot.wantedBy = lib.mkForce [ ];
    };
  };

  testScript = ''
    machine = machines[0]

    machine.start()
    machine.wait_for_unit("multi-user.target", timeout=300)

    machine.succeed("id alex")
    machine.fail("id agent")
    machine.fail("id pi")

    machine.succeed("""
      set -euo pipefail
      SWITCH_TO_CONFIGURATION="$(readlink -f /run/current-system/specialisation/nixpi-install/bin/switch-to-configuration)"
      "$SWITCH_TO_CONFIGURATION" test
    """)

    # Re-applying the specialization must remain idempotent.
    machine.succeed("""
      set -euo pipefail
      /run/current-system/bin/switch-to-configuration test
    """)

    machine.wait_until_succeeds("systemctl is-active nixpi-broker.service", timeout=120)

    machine.succeed("id alex")
    machine.succeed("id agent")
    machine.fail("id pi")

    machine.succeed("test -d /var/lib/nixpi")
    machine.succeed("test -d /var/lib/nixpi/agent")
    machine.succeed("test -L /home/alex/.pi")
    machine.succeed("test \"$(readlink -f /home/alex/.pi)\" = /var/lib/nixpi/agent")
    machine.succeed("groups alex | grep -q '\\bagent\\b'")
    machine.succeed("systemctl cat nixpi-daemon.service >/dev/null")
    machine.succeed("systemctl is-enabled nixpi-daemon.service")
    machine.succeed("systemctl is-enabled nixpi-broker.service")
    machine.succeed("systemctl is-active nixpi-broker.service")
    machine.succeed("sshd -T | grep -q '^passwordauthentication no$'")
    machine.succeed("sshd -T | grep -q '^permitrootlogin no$'")
    machine.succeed("sshd -T | grep -q '^maxauthtries 3$'")
    machine.succeed("sshd -T | grep -q '^allowtcpforwarding no$'")
    machine.succeed("sshd -T | grep -q '^allowagentforwarding no$'")
    machine.succeed("sshd -T | grep -q '^x11forwarding no$'")
    machine.succeed("sshd -T | grep -q '^clientaliveinterval 300$'")
    machine.succeed("sshd -T | grep -q '^clientalivecountmax 2$'")
    machine.succeed("sshd -T | grep -q '^allowusers alex$'")
    machine.succeed("systemctl cat nixpi-firstboot.service >/dev/null")
    machine.succeed("systemctl show -p UnitFileState --value nixpi-firstboot.service | grep -Eq 'enabled|linked'")
    machine.succeed("systemctl is-enabled fail2ban.service")

    print("Existing-user install flow passed.")
  '';
}
