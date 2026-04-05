{ lib, nixPiModulesNoShell, piAgent, appPackage, setupApplyPackage, mkTestFilesystems, ... }:

let
  mkNode =
    { hostName ? "nixpi-firstboot-test"
    }:
    { pkgs, ... }:
    let
      username = "pi";
      homeDir = "/home/${username}";
    in
    {
      imports = nixPiModulesNoShell ++ [
        ../../core/os/modules/firstboot
        mkTestFilesystems
      ];
      _module.args = { inherit piAgent appPackage setupApplyPackage; };
      nixpi.primaryUser = username;

      virtualisation.diskSize = 20480;
      virtualisation.memorySize = 4096;

      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;
      networking.hostName = hostName;
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
      environment.systemPackages = [ pkgs.curl pkgs.jq ];
      systemd.tmpfiles.rules = [ "d ${homeDir}/.nixpi 0755 ${username} ${username} -" ];

      system.activationScripts.nixpi-prefill = lib.stringAfter [ "users" ] (
        ''
          mkdir -p ${homeDir}/.nixpi
          install -d -m 0755 /etc/nixos
          cat > /etc/nixos/nixpi-install.nix <<'EOF'
        { ... }:
        {
          networking.hostName = "${hostName}";
          nixpi.primaryUser = "${username}";
        }
        EOF
          chown -R ${username}:${username} ${homeDir}/.nixpi
          chmod 755 ${homeDir}/.nixpi
        ''
      );
    };
in
{
  name = "nixpi-firstboot";

  nodes = {
    nixpi = mkNode { hostName = "nixpi-firstboot-test"; };
  };

  testScript = ''
    nixpi = machines[0]
    home = "/home/pi"

    nixpi.start()
    nixpi.wait_for_unit("multi-user.target", timeout=300)
    nixpi.wait_for_unit("network-online.target", timeout=60)
    nixpi.wait_for_unit("netbird.service", timeout=60)
    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1:8080/setup | grep -q 'NixPI Setup'", timeout=60)

    apply_output = nixpi.succeed(
        "curl -sS -X POST -H 'Content-Type: application/json' "
        + "--data '{\"netbirdKey\":\"\"}' "
        + "http://127.0.0.1:8080/api/setup/apply | tee /tmp/setup-apply.out"
    )
    print(apply_output)
    assert "SETUP_FAILED" not in apply_output, apply_output

    nixpi.succeed("test -f " + home + "/.nixpi/wizard-state/system-ready")
    nixpi.fail("test -f " + home + "/.nixpi/.setup-complete")
    nixpi.succeed("test -d " + home + "/.nixpi/wizard-state")

    checkpoints = nixpi.succeed("ls " + home + "/.nixpi/wizard-state/ 2>/dev/null || true").strip().split('\n')
    checkpoints = [c for c in checkpoints if c]
    assert len(checkpoints) > 0, f"No checkpoints found in wizard-state. Found: {checkpoints}"

    nixpi.succeed("test -d " + home + "/.pi")
    nixpi.succeed("test -f " + home + "/.pi/settings.json")
    nixpi.succeed("test ! -L " + home + "/.pi")
    nixpi.succeed("test \"$(stat -c %U " + home + "/.pi)\" = pi")
    nixpi.fail("test -e " + home + "/nixpi/.git")
    nixpi.fail("test -e " + home + "/nixpi/flake.nix")
    nixpi.fail("test -e /var/lib/nixpi/pi-nixpi")
    nixpi.fail("test -f /etc/nixos/flake.lock")
    nixpi.fail("test -e /etc/nixos/flake.nix")
    nixpi.fail("test -e /etc/nixpi/canonical-repo.json")
    nixpi.fail("command -v nixpi-bootstrap-ensure-repo-target")
    nixpi.fail("command -v nixpi-bootstrap-prepare-repo")
    nixpi.fail("command -v nixpi-bootstrap-nixos-rebuild-switch")
    nixpi.succeed("systemctl is-enabled nixpi-chat.service")

    nixpi.succeed(
        "su - pi -c '. ~/.bashrc; test \"$PI_CODING_AGENT_DIR\" = /home/pi/.pi; "
        + "pi --help | grep -q \"AI coding assistant\"'"
    )

    print("All nixpi-firstboot tests passed!")
  '';
}
