{ installerHelper, self, lib, ... }:

{
  name = "nixpi-installer-smoke";
  node.pkgsReadOnly = false;

  nodes.installer =
    { modulesPath, pkgs, ... }:
    let
      targetDisk = "/tmp/shared/nixpi-installer-target.qcow2";
    in
    {
      imports = [
        "${modulesPath}/installer/cd-dvd/installation-cd-minimal.nix"
      ];

      system.stateVersion = "25.05";
      networking.hostName = "nixpi-installer-test";
      networking.networkmanager.enable = true;
      services.getty.autologinUser = "nixos";
      users.users.root.initialHashedPassword = lib.mkForce null;

      virtualisation.diskImage = null;
      virtualisation.memorySize = 6144;
      virtualisation.cores = 2;
      virtualisation.graphics = false;
      virtualisation.useEFIBoot = true;
      virtualisation.qemu.drives = [
        {
          name = "target";
          file = targetDisk;
          driveExtraOpts = {
            format = "qcow2";
            cache = "writeback";
            werror = "report";
          };
          deviceExtraOpts = {
            serial = "nixpi-installer-target";
          };
        }
      ];

      environment.systemPackages = [
        installerHelper
        pkgs.dosfstools
        pkgs.e2fsprogs
        pkgs.jq
        pkgs.parted
        pkgs.util-linux
        (pkgs.writeShellScriptBin "disko" ''
          set -euo pipefail

          mode=""
          config=""
          while [[ $# -gt 0 ]]; do
            case "$1" in
              --mode) mode="$2"; shift 2 ;;
              *) config="$1"; shift ;;
            esac
          done

          if [[ "$mode" != "destroy,format,mount" || -z "$config" ]]; then
            echo "usage: disko --mode destroy,format,mount <config>" >&2
            exit 1
          fi

          disk="$(sed -n 's/.*device = "\([^"]*\)";/\1/p' "$config" | head -n1)"
          if [[ -z "$disk" ]]; then
            echo "unable to determine target disk from $config" >&2
            exit 1
          fi

          has_swap=0
          swap_size=""
          if grep -q 'type = "swap";' "$config"; then
            has_swap=1
            swap_size="$(sed -n 's/.*end = "-\([^"]*\)";/\1/p' "$config" | head -n1)"
            if [[ -z "$swap_size" ]]; then
              echo "unable to determine swap size from $config" >&2
              exit 1
            fi
          fi

          umount -R /mnt 2>/dev/null || true
          wipefs -a "$disk"
          parted -s "$disk" mklabel gpt
          parted -s "$disk" mkpart ESP fat32 1MiB 1025MiB
          parted -s "$disk" set 1 esp on

          if [[ "$has_swap" -eq 1 ]]; then
            parted -s "$disk" -- mkpart root ext4 1025MiB "-''${swap_size}"
            parted -s "$disk" -- mkpart swap linux-swap "-''${swap_size}" 100%
          else
            parted -s "$disk" mkpart root ext4 1025MiB 100%
          fi

          udevadm settle

          mapfile -t parts < <(lsblk -rno NAME,TYPE "$disk" | awk '$2 == "part" { print "/dev/" $1 }')
          boot_part="''${parts[0]}"
          root_part="''${parts[1]}"
          swap_part=""
          if [[ ''${#parts[@]} -ge 3 ]]; then
            swap_part="''${parts[2]}"
          fi

          mkfs.vfat -F32 "$boot_part"
          mkfs.ext4 -F -L nixos "$root_part"
          mkdir -p /mnt
          mount "$root_part" /mnt
          mkdir -p /mnt/boot
          mount "$boot_part" /mnt/boot
          if [[ -n "$swap_part" ]]; then
            mkswap "$swap_part"
          fi
        '')
      ];

      system.extraDependencies = [
        self.nixosConfigurations.desktop.config.system.build.toplevel
      ];
    };

  testScript = ''
    import os
    import shlex
    import subprocess

    installer = machines[0]
    target_disk_image = "/tmp/shared/nixpi-installer-target.qcow2"
    target_mount = "/mnt"
    qemu_img = "qemu-img"

    os.makedirs(os.path.dirname(target_disk_image), exist_ok=True)
    if os.path.exists(target_disk_image):
        os.unlink(target_disk_image)
    subprocess.run([qemu_img, "create", "-f", "qcow2", target_disk_image, "20G"], check=True)

    installer.start()
    installer.wait_for_unit("multi-user.target", timeout=300)
    installer.wait_until_succeeds(
        "lsblk -dnbo NAME,SIZE,TYPE,RO | awk '$3 == \"disk\" && $4 == 0 && $2 == 21474836480 { found = 1 } END { exit found ? 0 : 1 }'",
        timeout=120,
    )

    target_disk_device = installer.succeed(
        "lsblk -dnbpo NAME,SIZE,TYPE,RO | awk '$3 == \"disk\" && $4 == 0 && $2 == 21474836480 { print $1; exit }'"
    ).strip()
    assert target_disk_device, "failed to resolve target disk device"

    installer.succeed(
        "bash -lc "
        + shlex.quote(
            "! nixpi-installer --prefill /tmp/does-not-matter --password installerpass123 --disk "
            + target_disk_device
            + " --yes --system "
            + shlex.quote("${self.nixosConfigurations.desktop.config.system.build.toplevel}")
            + " >/tmp/nixpi-installer-invalid-option.log 2>&1"
        )
    )
    installer.succeed("grep -Eq 'Usage: nixpi-installer|Unknown option: --prefill' /tmp/nixpi-installer-invalid-option.log")
    installer.succeed(
        "bash -lc "
        + shlex.quote(
            "! nixpi-installer --layout no-swap --password installerpass123 --disk "
            + target_disk_device
            + " --yes --system "
            + shlex.quote("${self.nixosConfigurations.desktop.config.system.build.toplevel}")
            + " >/tmp/nixpi-installer-invalid-layout.log 2>&1"
        )
    )
    installer.succeed("grep -Eq 'Usage: nixpi-installer|Unknown option: --layout' /tmp/nixpi-installer-invalid-layout.log")
    installer.succeed(
        "bash -lc "
        + shlex.quote(
            "! nixpi-installer --swap-size 16GiB --password installerpass123 --disk "
            + target_disk_device
            + " --yes --system "
            + shlex.quote("${self.nixosConfigurations.desktop.config.system.build.toplevel}")
            + " >/tmp/nixpi-installer-invalid-swap-size.log 2>&1"
        )
    )
    installer.succeed("grep -Eq 'Usage: nixpi-installer|Unknown option: --swap-size' /tmp/nixpi-installer-invalid-swap-size.log")

    def run_install_case(name):
        installer.succeed("rm -f /tmp/nixpi-installer.log")
        password_args = "--password installerpass123"
        installer.succeed(
            "bash -lc "
            + shlex.quote(
                "nixpi-installer --disk "
                + target_disk_device
                + " "
                + password_args
                + " --yes --system "
                + shlex.quote("${self.nixosConfigurations.desktop.config.system.build.toplevel}")
                + " > /tmp/nixpi-installer.log 2>&1 || { cat /tmp/nixpi-installer.log >&2; exit 1; }"
            )
        )
        installer.succeed("grep -q " + shlex.quote("${self.nixosConfigurations.desktop.config.system.build.toplevel}") + " /tmp/nixpi-installer.log")

        installer.succeed("test -f " + target_mount + "/etc/nixos/configuration.nix")
        installer.succeed("test -f " + target_mount + "/etc/nixos/hardware-configuration.nix")
        installer.succeed("test -f " + target_mount + "/etc/nixos/nixpi-install.nix")
        installer.succeed("test -f " + target_mount + "/etc/nixos/nixpi-config/core/os/hosts/x86_64.nix")
        installer.succeed("nix-instantiate --parse " + target_mount + "/etc/nixos/configuration.nix >/tmp/nixpi-installer-configuration.parse")
        installer.succeed("nix-instantiate --parse " + target_mount + "/etc/nixos/nixpi-install.nix >/tmp/nixpi-installer-install.parse")
        installer.succeed(
            "NIXPKGS_ALLOW_UNFREE=1 nix-instantiate '<nixpkgs/nixos>'"
            + " -A config.system.build.toplevel"
            + " -I nixos-config="
            + target_mount
            + "/etc/nixos/configuration.nix"
            + " >/tmp/nixpi-installer-eval.drv"
        )
        installer.succeed("grep -q './hardware-configuration.nix' " + target_mount + "/etc/nixos/configuration.nix")
        installer.succeed("grep -q 'fileSystems\\.\"/\"' " + target_mount + "/etc/nixos/hardware-configuration.nix")
        installer.succeed("grep -q 'nixpi.primaryUser = \"human\";' " + target_mount + "/etc/nixos/nixpi-install.nix")
        installer.succeed("grep -q 'networking.hostName = \"nixpi\";' " + target_mount + "/etc/nixos/nixpi-install.nix")
        installer.succeed("grep -q 'nixpi.security.ssh.passwordAuthentication = true;' " + target_mount + "/etc/nixos/nixpi-install.nix")
        installer.fail("grep -q 'hashedPassword' " + target_mount + "/etc/nixos/nixpi-install.nix")
        installer.fail("grep -q 'nixpi.install.mode = ' " + target_mount + "/etc/nixos/nixpi-install.nix")
        installer.fail("grep -q 'nixpi.createPrimaryUser = ' " + target_mount + "/etc/nixos/nixpi-install.nix")
        installer.fail("grep -q 'bootstrap-upgrade.nix' " + target_mount + "/etc/nixos/nixpi-install.nix")
        installer.succeed("grep -q 'imports = \\[' " + target_mount + "/etc/nixos/configuration.nix")
        installer.succeed("grep -q './nixpi-install.nix' " + target_mount + "/etc/nixos/configuration.nix")
        installer.succeed("grep -q './nixpi-config/core/os/hosts/x86_64.nix' " + target_mount + "/etc/nixos/configuration.nix")
        installer.succeed("grep -q '_module.args = {' " + target_mount + "/etc/nixos/configuration.nix")
        installer.succeed("test -f " + target_mount + "/var/lib/nixpi/bootstrap/primary-user-password")
        installer.succeed("test \"$(stat -c '%U:%G %a' " + target_mount + "/var/lib/nixpi/bootstrap)\" = 'root:root 755'")
        installer.succeed("test \"$(stat -c '%U:%G %a' " + target_mount + "/var/lib/nixpi/bootstrap/primary-user-password)\" = 'root:root 600'")
        installer.succeed("test \"$(cat " + target_mount + "/var/lib/nixpi/bootstrap/primary-user-password)\" = installerpass123")
        installer.fail("test -e " + target_mount + "/etc/nixos/nixpkgs")
        installer.fail("test -e " + target_mount + "/etc/nixos/flake.nix")

        installer.succeed("lsblk -nrpo FSTYPE " + target_disk_device + " | grep -qx swap")

        installer.succeed("nixos-enter --root " + target_mount + " -c 'getent passwd human'")
        installer.succeed("nixos-enter --root " + target_mount + " -c 'grep -q \"^human:[^!*]\" /etc/shadow'")
        installer.succeed("nixos-enter --root " + target_mount + " -c 'command -v nixpi-bootstrap'")
        installer.succeed("nixos-enter --root " + target_mount + " -c 'command -v nixpi-finalize'")
        installer.fail("nixos-enter --root " + target_mount + " -c 'command -v nixpi-bootstrap-ensure-repo-target'")
        installer.fail("nixos-enter --root " + target_mount + " -c 'command -v nixpi-bootstrap-prepare-repo'")
        installer.fail("nixos-enter --root " + target_mount + " -c 'command -v nixpi-bootstrap-nixos-rebuild-switch'")
        installer.succeed("nixos-enter --root " + target_mount + " -c 'systemctl is-enabled nixpi-chat.service'")
        installer.fail("nixos-enter --root " + target_mount + " -c 'test -e /etc/nixos/flake.nix'")
        installer.fail("nixos-enter --root " + target_mount + " -c 'getent passwd agent'")

    run_install_case("default")
  '';
}
