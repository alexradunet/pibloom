# tests/nixos/nixpi-home.nix
# Test that nixPI Home and the built-in system services are provisioned after firstboot

{ pkgs, lib, nixpiModulesNoShell, piAgent, appPackage, mkTestFilesystems, ... }:

pkgs.testers.runNixOSTest {
  name = "nixpi-home";

  nodes.nixpi = { ... }: let
    username = "pi";
    homeDir = "/home/${username}";
  in {
    imports = nixpiModulesNoShell ++ [
      ../../core/os/modules/firstboot.nix
      mkTestFilesystems
    ];
    _module.args = { inherit piAgent appPackage; };
    nixpi.primaryUser = username;

    virtualisation.diskSize = 20480;
    virtualisation.memorySize = 4096;

    boot.loader.systemd-boot.enable = true;
    boot.loader.efi.canTouchEfiVariables = true;
    networking.hostName = "nixpi-home-test";
    time.timeZone = "UTC";
    i18n.defaultLocale = "en_US.UTF-8";
    networking.networkmanager.enable = true;
    system.stateVersion = "25.05";

    users.users.${username} = {
      isNormalUser = true;
      group = username;
      extraGroups = [ "wheel" "networkmanager" "agent" ];
      home = homeDir;
      shell = pkgs.bash;
    };
    users.groups.${username} = {};
    systemd.services.localai.wantedBy = lib.mkForce [];
    systemd.services.localai-download.wantedBy = lib.mkForce [];

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

    nixpi.start()
    nixpi.wait_for_unit("multi-user.target", timeout=300)
    nixpi.wait_for_unit("nixpi-firstboot.service", timeout=120)
    nixpi.wait_until_succeeds("test -f " + home + "/.nixpi/.setup-complete", timeout=120)

    nixpi.wait_until_succeeds("test -f /etc/system-services/nixpi-home/webroot/index.html", timeout=120)
    nixpi.wait_until_succeeds("test -f /etc/system-services/nixpi-chat/config.json", timeout=120)
    nixpi.succeed("grep -q 'nixPI Home' /etc/system-services/nixpi-home/webroot/index.html")
    nixpi.succeed("grep -q 'nixPI Chat' /etc/system-services/nixpi-home/webroot/index.html")
    nixpi.succeed("grep -q 'nixPI Files' /etc/system-services/nixpi-home/webroot/index.html")
    nixpi.succeed("grep -q 'nixPI Code' /etc/system-services/nixpi-home/webroot/index.html")

    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1:8080 | grep -q 'nixPI Home'", timeout=60)
    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1:8080 | grep -q '8081'", timeout=60)
    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1:8080 | grep -q '5000'", timeout=60)
    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1:8080 | grep -q '8443'", timeout=60)
    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1:8081/config.json | grep -q 'defaultHomeserver'", timeout=60)
    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1:5000/ >/dev/null", timeout=60)
    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1:8443/ >/dev/null", timeout=60)
    nixpi.succeed("test -d /var/lib/nixpi/services/code")

    print("nixPI Home and built-in service tests passed!")
  '';
}
