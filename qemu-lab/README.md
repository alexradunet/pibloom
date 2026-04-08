# QEMU Lab

This directory is the canonical local runtime area for the manual NixPI QEMU workflows.

Only this README is committed. All other files in `qemu-lab/` are local runtime artifacts and stay gitignored.

## Canonical local paths

- installer ISO: `qemu-lab/nixos-stable-installer.iso`
- installer scratch disk: `qemu-lab/disks/installer-scratch.qcow2`
- reusable preinstalled stable disk: `qemu-lab/disks/preinstalled-stable.qcow2`
- serial logs: `qemu-lab/logs/`
- local firmware vars: `qemu-lab/OVMF_VARS-*.fd`

## Expected workflow

1. Run `nix run .#qemu-installer`.
   - If `qemu-lab/nixos-stable-installer.iso` is missing, it is downloaded automatically from:
     `https://channels.nixos.org/nixos-25.11/latest-nixos-graphical-x86_64-linux.iso`
3. If you want the reusable base image path, run `nix run .#qemu-prepare-preinstalled-stable`.
4. Reuse the installed disk with `nix run .#qemu-preinstalled-stable`.

## Cleanup

- Reset local VM artifacts (keep installer ISO cached):
  - `nix run .#qemu-clean`
- Full cleanup including installer ISO:
  - `nix run .#qemu-clean -- --all`

## Notes

- The helper scripts still support `NIXPI_QEMU_DIR` as an explicit override.
- This repo does not auto-migrate older local state from `.omx/qemu-lab` or `iso/`.
