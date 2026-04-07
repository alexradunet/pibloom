#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

ISO_PATH="${1:-${LAB_DIR}/nixos-stable-installer.iso}"
DISK_PATH="${DISK_DIR}/installer-scratch.qcow2"
OVMF_CODE="${OVMF_CODE_PATH:-/run/libvirt/nix-ovmf/OVMF_CODE.fd}"
OVMF_VARS="${OVMF_VARS_PATH:-${LAB_DIR}/OVMF_VARS-installer.fd}"

require_cmd "$(qemu_bin)"
require_cmd "$(qemu_img_bin)"

if [ ! -f "${ISO_PATH}" ]; then
  echo "missing installer ISO: ${ISO_PATH}" >&2
  echo "Place a stable NixOS installer ISO there before launching." >&2
  exit 1
fi

create_qcow2 "${DISK_PATH}"

if [ ! -f "${OVMF_VARS}" ] && [ -f /run/libvirt/nix-ovmf/OVMF_VARS.fd ]; then
  cp /run/libvirt/nix-ovmf/OVMF_VARS.fd "${OVMF_VARS}"
fi

run_qemu "installer" \
  -enable-kvm \
  -machine q35,accel=kvm \
  -cpu host \
  -smp "${CPUS}" \
  -m "${MEMORY_MB}" \
  -drive if=pflash,format=raw,readonly=on,file="${OVMF_CODE}" \
  -drive if=pflash,format=raw,file="${OVMF_VARS}" \
  -drive file="${DISK_PATH}",if=virtio,format=qcow2 \
  -cdrom "${ISO_PATH}" \
  -boot d \
  -netdev user,id=net0,hostfwd=tcp::${SSH_PORT}-:22,hostfwd=tcp::${HTTP_PORT}-:80,hostfwd=tcp::${HTTPS_PORT}-:443 \
  -device virtio-net-pci,netdev=net0 \
  -virtfs local,path="${SHARE_DIR}",mount_tag=nixpi-repo,security_model=none,id=repo-share \
  -display gtk
