#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

DISK_PATH="${DISK_DIR}/preinstalled-stable.qcow2"
OVMF_CODE="${OVMF_CODE_PATH:-$(default_ovmf_code_path)}"
OVMF_VARS="${OVMF_VARS_PATH:-${LAB_DIR}/OVMF_VARS-preinstalled.fd}"
OVMF_VARS_TEMPLATE="${OVMF_VARS_TEMPLATE_PATH:-$(default_ovmf_vars_template_path)}"

require_cmd "$(qemu_bin)"

if [ ! -f "${DISK_PATH}" ]; then
  echo "missing preinstalled stable disk: ${DISK_PATH}" >&2
  echo "Run tools/qemu/prepare-preinstalled-stable.sh first." >&2
  exit 1
fi

ensure_ovmf_vars_file "${OVMF_VARS}" "${OVMF_VARS_TEMPLATE}"

run_qemu "preinstalled-stable" \
  -enable-kvm \
  -machine q35,accel=kvm \
  -cpu host \
  -smp "${CPUS}" \
  -m "${MEMORY_MB}" \
  -drive if=pflash,format=raw,readonly=on,file="${OVMF_CODE}" \
  -drive if=pflash,format=raw,file="${OVMF_VARS}" \
  -drive file="${DISK_PATH}",if=virtio,format=qcow2 \
  -netdev user,id=net0,hostfwd=tcp::${SSH_PORT}-:22,hostfwd=tcp::${HTTP_PORT}-:80,hostfwd=tcp::${HTTPS_PORT}-:443 \
  -device virtio-net-pci,netdev=net0 \
  -virtfs local,path="${SHARE_DIR}",mount_tag=nixpi-repo,security_model=none,id=repo-share \
  -display gtk
