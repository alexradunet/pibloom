{ pkgs, lib, nixPiModulesNoShell, piAgent, appPackage, setupPackage, mkTestFilesystems, ... }:

pkgs.testers.runNixOSTest {
  name = "nixpi-firstboot";

  nodes.nixpi = { ... }: let
    username = "pi";
    homeDir = "/home/${username}";
  in {
    imports = nixPiModulesNoShell ++ [ 
      ../../core/os/modules/firstboot.nix
      mkTestFilesystems 
    ];
    _module.args = { inherit piAgent appPackage setupPackage; };
    nixpi.primaryUser = username;

    virtualisation.diskSize = 20480;
    virtualisation.memorySize = 4096;

    boot.loader.systemd-boot.enable = true;
    boot.loader.efi.canTouchEfiVariables = true;
    networking.hostName = "nixpi-firstboot-test";
    time.timeZone = "UTC";
    i18n.defaultLocale = "en_US.UTF-8";
    networking.networkmanager.enable = true;
    system.stateVersion = "25.05";
    users.users.${username} = {
      isNormalUser = true;
      group = username;
      extraGroups = [ "wheel" "networkmanager" ];
      home = homeDir;
      shell = pkgs.bash;
    };
    users.groups.${username} = {};
    systemd.tmpfiles.rules = [
      "d ${homeDir}/.nixpi 0755 ${username} ${username} -"
      "f ${homeDir}/.nixpi/prefill.env 0644 ${username} ${username} -"
    ];

    system.activationScripts.nixpi-prefill = lib.stringAfter [ "users" ] ''
      mkdir -p ${homeDir}/.nixpi
      cat > ${homeDir}/.nixpi/prefill.env << 'EOF'
    PREFILL_USERNAME=testuser
    PREFILL_MATRIX_PASSWORD=testpassword123
    EOF
      chown -R ${username}:${username} ${homeDir}/.nixpi
      chmod 755 ${homeDir}/.nixpi
      chmod 644 ${homeDir}/.nixpi/prefill.env
    '';
  };

  testScript = ''
    nixpi = machines[0]
    home = "/home/pi"
    username = "pi"

    nixpi.start()
    nixpi.wait_for_unit("multi-user.target", timeout=300)
    nixpi.wait_for_unit("network-online.target", timeout=60)
    nixpi.wait_for_unit("netbird.service", timeout=60)

    nixpi.succeed("systemctl stop continuwuity.service")
    nixpi.succeed("su - pi -c 'setup-wizard.sh'")

    nixpi.wait_for_unit("continuwuity.service", timeout=120)
    nixpi.succeed("test -f " + home + "/.nixpi/wizard-state/system-ready")
    nixpi.fail("test -f " + home + "/.nixpi/.setup-complete")
    nixpi.succeed("systemctl is-enabled nixpi-daemon.service | grep -q enabled")
    nixpi.wait_until_succeeds(
        "systemctl is-active nixpi-daemon.service | grep -Eq 'active|activating'",
        timeout=60,
    )
    nixpi.succeed("test -f " + home + "/.nixpi/prefill.env")
    nixpi.succeed("test -f " + home + "/.nixpi/wizard.log")
    log_content = nixpi.succeed("cat " + home + "/.nixpi/wizard.log")
    print("=== Firstboot log content ===")
    print(log_content)
    print("=== End of log ===")
    assert "NixPI Wizard Started" in log_content, "Wizard log missing start marker"
    assert "setup complete" in log_content.lower(), "Firstboot log missing completion marker"

    nixpi.succeed("test -d " + home + "/.nixpi/wizard-state")

    checkpoints = nixpi.succeed("ls " + home + "/.nixpi/wizard-state/ 2>/dev/null || true").strip().split('\n')
    checkpoints = [c for c in checkpoints if c]
    assert len(checkpoints) > 0, f"No checkpoints found in wizard-state. Found: {checkpoints}"

    nixpi.succeed("test -d " + home + "/.pi")
    nixpi.succeed("test -f " + home + "/.pi/settings.json")
    nixpi.succeed("test ! -L " + home + "/.pi")
    nixpi.succeed("test \"$(stat -c %U " + home + "/.pi)\" = pi")

    nixpi.succeed(
        "su - pi -c '. ~/.bashrc; test \"$PI_CODING_AGENT_DIR\" = /home/pi/.pi; "
        + "pi --help | grep -q \"AI coding assistant\"'"
    )

    print("All nixpi-firstboot tests passed!")
  '';
}
