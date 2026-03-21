{ pkgs, nixPiModules, piAgent, appPackage, ... }:

pkgs.testers.runNixOSTest {
  name = "nixpi-desktop";

  nodes.nixpi = { ... }: {
    imports = [
      ../../core/os/modules/firstboot.nix
      ../../core/os/modules/desktop-openbox.nix
      {
        fileSystems."/" = { device = "/dev/vda"; fsType = "ext4"; };
        fileSystems."/boot" = { device = "/dev/vda1"; fsType = "vfat"; };
      }
    ] ++ nixPiModules;
    _module.args = { inherit piAgent appPackage; };

    services.xserver.xkb = { layout = "us"; variant = ""; };
    console.keyMap = "us";

    nixpi.primaryUser = "pi";
    nixpi.install.mode = "managed-user";
    nixpi.createPrimaryUser = true;
    networking.hostName = "nixpi-desktop-test";

    virtualisation.diskSize = 20480;
    virtualisation.memorySize = 4096;
    virtualisation.graphics = true;
  };

  testScript = ''
    nixpi = machines[0]

    nixpi.start()
    nixpi.wait_for_unit("display-manager.service", timeout=300)
    nixpi.wait_until_succeeds("systemctl is-active display-manager.service", timeout=120)
    nixpi.wait_until_succeeds("loginctl list-sessions --no-legend | grep -q ' pi '", timeout=120)
    nixpi.wait_until_succeeds("journalctl -u display-manager --no-pager | grep -q 'session opened for user pi'", timeout=120)
    nixpi.wait_until_succeeds("test -f /home/pi/.Xauthority", timeout=120)

    nixpi.succeed("command -v rofi")
    nixpi.succeed("command -v pcmanfm")
    nixpi.succeed("command -v xdotool")
    nixpi.succeed("command -v wmctrl")
    nixpi.succeed("command -v scrot")
    nixpi.succeed("command -v tesseract")
  '';
}
