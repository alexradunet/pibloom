#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

REMOVE_ISO=0
if [ "${1:-}" = "--all" ]; then
  REMOVE_ISO=1
fi

rm -f "${DISK_DIR}/installer-scratch.qcow2"
rm -f "${DISK_DIR}/preinstalled-stable.qcow2"
rm -f "${LAB_DIR}/OVMF_VARS-installer.fd"
rm -f "${LAB_DIR}/OVMF_VARS-preinstalled.fd"
rm -f "${LOG_DIR}"/*.log 2>/dev/null || true

if [ "${REMOVE_ISO}" = "1" ]; then
  rm -f "${INSTALLER_ISO_PATH}"
fi

echo "QEMU lab cleaned at ${LAB_DIR}"
if [ "${REMOVE_ISO}" = "1" ]; then
  echo "Removed disks, logs, OVMF vars, and installer ISO."
else
  echo "Removed disks, logs, and OVMF vars. Kept installer ISO."
fi
