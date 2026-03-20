{ pkgs, lib, nixpiModulesNoShell, piAgent, appPackage, mkTestFilesystems, ... }:

pkgs.testers.runNixOSTest {
  name = "nixpi-modular-services";

  nodes.nixpi = { ... }: let
    username = "pi";
    homeDir = "/home/${username}";
  in {
    imports = nixpiModulesNoShell ++ [ mkTestFilesystems ];
    _module.args = { inherit piAgent appPackage; };
    nixpi.primaryUser = username;

    networking.hostName = "nixpi-modular-test";

    users.users.${username} = {
      isNormalUser = true;
      group = username;
      extraGroups = [ "wheel" "networkmanager" "agent" ];
      home = homeDir;
      shell = pkgs.bash;
    };
    users.groups.${username} = {};

    systemd.services.localai.wantedBy = lib.mkForce [ ];
    systemd.services.localai-download.wantedBy = lib.mkForce [ ];
  };

  testScript = ''
    nixpi = machines[0]

    nixpi.start()
    nixpi.wait_for_unit("multi-user.target", timeout=300)

    nixpi.succeed("test -f /etc/system-services/nixpi-home/nginx.conf")
    nixpi.succeed("test -f /etc/system-services/nixpi-home/webroot/index.html")
    nixpi.succeed("test -f /etc/system-services/nixpi-chat/nginx.conf")
    nixpi.succeed("test -f /etc/system-services/nixpi-chat/config.json")

    nixpi.succeed("grep -q 'nixPI Home' /etc/system-services/nixpi-home/webroot/index.html")
    nixpi.succeed("grep -q 'defaultHomeserver' /etc/system-services/nixpi-chat/config.json")

    nixpi.succeed("systemctl cat nixpi-home.service | grep -q '/etc/system-services/nixpi-home/nginx.conf'")
    nixpi.succeed("systemctl cat nixpi-chat.service | grep -q '/etc/system-services/nixpi-chat/nginx.conf'")

    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1:8080 | grep -q 'nixPI Home'", timeout=60)
    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1:8081/config.json | grep -q 'defaultHomeserver'", timeout=60)
    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1:5000/ >/dev/null", timeout=60)
    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1:8443/ >/dev/null", timeout=60)

    print("nixPI modular service tests passed!")
  '';
}
