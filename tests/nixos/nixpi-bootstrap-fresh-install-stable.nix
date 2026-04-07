{
  pkgs,
  bootstrapPackage,
  mkTestFilesystems,
  ...
}:

let
  rawSource = builtins.path {
    path = ../..;
    name = "source";
  };

  bootstrapSource = pkgs.runCommandLocal "nixpi-bootstrap-test-repo-stable.git" { nativeBuildInputs = [ pkgs.git ]; } ''
    cp -R ${rawSource}/. source
    chmod -R u+w source
    rm -rf source/.git

    git -C source init --initial-branch=main
    git -C source config user.name "NixPI Test"
    git -C source config user.email "nixpi-tests@example.com"
    git -C source add .
    git -C source add -f package-lock.json
    git -C source add -f core/os/pkgs/pi/package-lock.json
    git -C source commit -m "bootstrap fixture"

    git clone --bare source "$out"
  '';

  nixosRebuildShim = pkgs.writeShellScript "nixos-rebuild" ''
    set -euo pipefail

    printf '%s\n' "$@" > /tmp/nixos-rebuild.args
    if [ "$#" -ne 4 ] || [ "$1" != "switch" ] || [ "$2" != "--flake" ] || [ "$3" != "/etc/nixos#nixos" ] || [ "$4" != "--impure" ]; then
      echo "unexpected nixos-rebuild invocation: $*" >&2
      exit 1
    fi

    printf 'invoked\n' > /tmp/nixos-rebuild.invoked
  '';
in
{
  name = "nixpi-bootstrap-fresh-install-stable";

  nodes.nixos =
    _:
    {
      imports = [
        mkTestFilesystems
      ];

      networking.hostName = "bootstrap-fresh-stable";
      environment.etc."nixos/configuration.nix".text = ''
        { ... }:
        {
          networking.hostName = "bootstrap-fresh-stable";
          system.stateVersion = "25.05";
          boot.loader.systemd-boot.enable = true;
          boot.loader.efi.canTouchEfiVariables = true;
        }
      '';
      environment.etc."nixos/hardware-configuration.nix".text = ''
        { ... }:
        {
          fileSystems."/" = {
            device = "/dev/vda";
            fsType = "ext4";
          };

          fileSystems."/boot" = {
            device = "/dev/vda1";
            fsType = "vfat";
          };
        }
      '';

      users.users.pi = {
        isNormalUser = true;
        group = "pi";
        extraGroups = [
          "wheel"
          "networkmanager"
        ];
        home = "/home/pi";
        shell = pkgs.bash;
      };
      users.groups.pi = { };
    }
    ;

  testScript = ''
    machine = machines[0]
    bootstrap = "${bootstrapPackage}/bin/nixpi-bootstrap-vps"
    repo_url = "${bootstrapSource}"
    rebuild_shim = "${nixosRebuildShim}"

    machine.start()
    machine.wait_for_unit("multi-user.target", timeout=300)
    machine.succeed("test -e " + rebuild_shim)
    machine.succeed("test ! -e /srv/nixpi")
    machine.succeed("test -f /etc/nixos/configuration.nix")
    machine.succeed("test -f /etc/nixos/hardware-configuration.nix")
    machine.copy_from_host(rebuild_shim, "/tmp/tools/nixos-rebuild")
    machine.succeed("chmod +x /tmp/tools/nixos-rebuild")

    machine.succeed(
        "env "
        + "PATH=/tmp/tools:/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin:$PATH "
        + "NIXPI_REPO_URL=" + repo_url + " "
        + "NIXPI_REPO_BRANCH=main "
        + "NIXPI_PRIMARY_USER=pi "
        + "NIXPI_HOSTNAME=bootstrap-fresh-stable "
        + bootstrap
        + " | tee /tmp/bootstrap.out"
    )

    machine.succeed("test -f /tmp/nixos-rebuild.invoked")
    machine.succeed("test \"$(paste -sd ' ' /tmp/nixos-rebuild.args)\" = 'switch --flake /etc/nixos#nixos --impure'")
    machine.succeed("test -d /srv/nixpi/.git")
    machine.succeed("test -f /srv/nixpi/flake.nix")
    machine.succeed("test -f /etc/nixos/flake.nix")
    machine.succeed("grep -q 'github:NixOS/nixpkgs/nixos-25.11' /etc/nixos/flake.nix")
    machine.succeed("grep -q 'nixosConfigurations.nixos' /etc/nixos/flake.nix")
    machine.succeed("grep -q './hardware-configuration.nix' /etc/nixos/flake.nix")
    machine.succeed("grep -q 'nixpi.primaryUser = \"pi\";' /etc/nixos/flake.nix")
    machine.succeed("grep -q \"Bootstrap complete. Use 'nixpi-rebuild'\" /tmp/bootstrap.out")

    print("nixpi-bootstrap-fresh-install-stable test passed!")
  '';
}
