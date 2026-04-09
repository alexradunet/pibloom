{
  lib,
  nixPiModulesNoShell,
  mkTestFilesystems,
  mkManagedUserConfig,
  ...
}:

{
  name = "nixpi-options-validation";

  nodes = {
    defaults =
      { config, options, ... }:
      {
        imports = nixPiModulesNoShell ++ [
          mkTestFilesystems
          (mkManagedUserConfig { username = "pi"; })
        ];

        networking.hostName = "nixpi-defaults-test";

        environment.etc = {
          "nixpi-tests/ssh-password-auth".text =
            if config.services.openssh.settings.PasswordAuthentication then "yes" else "no";
          "nixpi-tests/has-netbird-option".text =
            if lib.hasAttrByPath [ "nixpi" "netbird" ] options then "yes" else "no";
        };
      };

    overrides =
      { config, ... }:
      {
        imports = nixPiModulesNoShell ++ [
          mkTestFilesystems
          (mkManagedUserConfig { username = "pi"; })
        ];

        networking.hostName = "nixpi-overrides-test";

        nixpi = {
          agent.autonomy = "observe";
          security = {
            fail2ban.enable = false;
            ssh.passwordAuthentication = true;
          };
          netbird = {
            enable = true;
            setupKeyFile = "/run/secrets/netbird-setup-key";
            clientName = "nixpi-managed-node";
            managementUrl = "https://api.netbird.io:443";
          };
        };

        environment.etc = {
          "nixpi-tests/ssh-password-auth".text =
            if config.services.openssh.settings.PasswordAuthentication then "yes" else "no";
          "nixpi-tests/netbird-enable".text = if config.nixpi.netbird.enable then "yes" else "no";
          "nixpi-tests/netbird-setup-key-file".text = config.nixpi.netbird.setupKeyFile;
          "nixpi-tests/netbird-client-name".text = config.nixpi.netbird.clientName or "";
          "nixpi-tests/netbird-management-url".text = config.nixpi.netbird.managementUrl or "";
        };
      };
  };

  testScript = ''
    defaults = machines[0]
    overrides = machines[1]

    defaults.start()
    defaults.wait_for_unit("multi-user.target", timeout=300)

    defaults.succeed("id pi")
    defaults.succeed("systemctl cat nixpi-broker.service >/dev/null")
    defaults.succeed("systemctl cat nixpi-update.timer >/dev/null")

    defaults.succeed("nixpi-brokerctl status | jq -r .defaultAutonomy | grep -qx maintain")

    defaults.succeed("systemctl is-active fail2ban")
    defaults.succeed("grep -qx 'no' /etc/nixpi-tests/ssh-password-auth")
    defaults.succeed("grep -qx 'yes' /etc/nixpi-tests/has-netbird-option")

    overrides.start()
    overrides.wait_for_unit("multi-user.target", timeout=300)

    overrides.fail("systemctl is-active fail2ban")
    overrides.succeed("grep -qx 'yes' /etc/nixpi-tests/ssh-password-auth")
    overrides.succeed("nixpi-brokerctl status | jq -r .defaultAutonomy | grep -qx observe")

    overrides.succeed("grep -qx 'yes' /etc/nixpi-tests/netbird-enable")
    overrides.succeed("grep -qx '/run/secrets/netbird-setup-key' /etc/nixpi-tests/netbird-setup-key-file")
    overrides.succeed("grep -qx 'nixpi-managed-node' /etc/nixpi-tests/netbird-client-name")
    overrides.succeed("grep -qx 'https://api.netbird.io:443' /etc/nixpi-tests/netbird-management-url")

    print("All nixpi-options-validation tests passed!")
  '';
}
