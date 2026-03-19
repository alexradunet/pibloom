# tests/nixos/garden-home.nix
# Test that Garden Home and the built-in user services are provisioned after firstboot

{ pkgs, lib, bloomModulesNoShell, piAgent, appPackage, mkTestFilesystems, ... }:

pkgs.testers.runNixOSTest {
  name = "garden-home";

  nodes.garden = { ... }: let
    username = "garden";
    homeDir = "/home/${username}";
  in {
    imports = bloomModulesNoShell ++ [
      ../../core/os/modules/firstboot.nix
      mkTestFilesystems
    ];
    _module.args = { inherit piAgent appPackage; };
    garden.username = username;

    virtualisation.diskSize = 20480;
    virtualisation.memorySize = 4096;

    boot.loader.systemd-boot.enable = true;
    boot.loader.efi.canTouchEfiVariables = true;
    networking.hostName = "garden-home-test";
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
      "d ${homeDir}/.garden 0755 ${username} ${username} -"
      "f ${homeDir}/.garden/prefill.env 0644 ${username} ${username} -"
    ];

    system.activationScripts.garden-prefill = lib.stringAfter [ "users" ] ''
      mkdir -p ${homeDir}/.garden
      cat > ${homeDir}/.garden/prefill.env << 'EOF'
    PREFILL_USERNAME=testuser
    PREFILL_MATRIX_PASSWORD=testpassword123
    EOF
      chown -R ${username}:${username} ${homeDir}/.garden
      chmod 755 ${homeDir}/.garden
      chmod 644 ${homeDir}/.garden/prefill.env
    '';
  };

  testScript = ''
    garden = machines[0]
    home = "/home/garden"

    garden.start()
    garden.wait_for_unit("multi-user.target", timeout=300)
    garden.wait_for_unit("garden-firstboot.service", timeout=120)
    garden.wait_until_succeeds("test -f " + home + "/.garden/.setup-complete", timeout=120)

    garden.wait_until_succeeds("test -f " + home + "/.config/garden/home/index.html", timeout=120)
    garden.wait_until_succeeds("test -f " + home + "/.config/garden/fluffychat/config.json", timeout=120)
    garden.succeed("grep -q 'Garden Home' " + home + "/.config/garden/home/index.html")
    garden.succeed("grep -q 'Garden Web Chat' " + home + "/.config/garden/home/index.html")
    garden.succeed("grep -q 'Garden Files' " + home + "/.config/garden/home/index.html")
    garden.succeed("grep -q 'Garden Code' " + home + "/.config/garden/home/index.html")

    garden.wait_until_succeeds("curl -sf http://127.0.0.1:8080 | grep -q 'Garden Home'", timeout=60)
    garden.wait_until_succeeds("curl -sf http://127.0.0.1:8080 | grep -q '8081'", timeout=60)
    garden.wait_until_succeeds("curl -sf http://127.0.0.1:8080 | grep -q '5000'", timeout=60)
    garden.wait_until_succeeds("curl -sf http://127.0.0.1:8080 | grep -q '8443'", timeout=60)
    garden.wait_until_succeeds("curl -sf http://127.0.0.1:8081/config.json | grep -q 'defaultHomeserver'", timeout=60)
    garden.wait_until_succeeds("curl -sf http://127.0.0.1:5000/ >/dev/null", timeout=60)
    garden.wait_until_succeeds("curl -sf http://127.0.0.1:8443/ | grep -q 'code-server'", timeout=60)
    garden.succeed("test -d " + home + "/.config/code-server")

    print("Garden Home and built-in service tests passed!")
  '';
}
