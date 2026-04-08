# Manual QEMU Lab

## Paths

- lab root: `qemu-lab/`
- installer ISO: `qemu-lab/nixos-stable-installer.iso`
- installer scratch disk: `qemu-lab/disks/installer-scratch.qcow2`
- preinstalled stable disk: `qemu-lab/disks/preinstalled-stable.qcow2`
- serial logs: `qemu-lab/logs/`

## Installer flow

1. Run `tools/qemu/run-installer.sh`.
   - If `qemu-lab/nixos-stable-installer.iso` is missing, it is downloaded automatically from:
     `https://channels.nixos.org/nixos-25.11/latest-nixos-graphical-x86_64-linux.iso`
3. In the guest, install NixOS manually onto `qemu-lab/disks/installer-scratch.qcow2`.
4. Reboot, log in, and validate the base install.

## Preinstalled-stable flow

1. Run `tools/qemu/prepare-preinstalled-stable.sh` to create the reusable target disk.
2. Boot the installer flow with `tools/qemu/run-installer.sh` and install stable NixOS onto `qemu-lab/disks/installer-scratch.qcow2`.
3. After shutdown, clone the installed scratch disk into the reusable image:

```bash
qemu-img convert -f qcow2 -O qcow2 \
  qemu-lab/disks/installer-scratch.qcow2 \
  qemu-lab/disks/preinstalled-stable.qcow2
```

4. Boot the reusable image with `tools/qemu/run-preinstalled-stable.sh`.

## Shared repo mount

The repo is exposed to the guest as a 9p share with mount tag `nixpi-repo`.
Mount it manually in the guest when needed.

## Cleanup

- Clean VM artifacts while keeping the cached installer ISO:
  - `tools/qemu/clean-lab.sh`
- Clean everything including the installer ISO:
  - `tools/qemu/clean-lab.sh --all`
