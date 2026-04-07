#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

resolve_repo_dir() {
  if [ -n "${NIXPI_QEMU_REPO_DIR:-}" ]; then
    printf '%s\n' "${NIXPI_QEMU_REPO_DIR}"
    return 0
  fi

  if git_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
    printf '%s\n' "${git_root}"
    return 0
  fi

  cd "${TOOLS_DIR}/../.." && pwd
}

REPO_DIR="$(resolve_repo_dir)"
LAB_DIR="${NIXPI_QEMU_DIR:-${REPO_DIR}/.omx/qemu-lab}"
DISK_DIR="${LAB_DIR}/disks"
LOG_DIR="${LAB_DIR}/logs"
SHARE_DIR="${REPO_DIR}"
SSH_PORT="${NIXPI_QEMU_SSH_PORT:-2222}"
HTTP_PORT="${NIXPI_QEMU_HTTP_PORT:-8081}"
HTTPS_PORT="${NIXPI_QEMU_HTTPS_PORT:-8444}"
MEMORY_MB="${NIXPI_QEMU_MEMORY_MB:-4096}"
CPUS="${NIXPI_QEMU_CPUS:-4}"
DISK_SIZE="${NIXPI_QEMU_DISK_SIZE:-40G}"

mkdir -p "${DISK_DIR}" "${LOG_DIR}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

qemu_bin() {
  command -v qemu-system-x86_64
}

qemu_img_bin() {
  command -v qemu-img
}

virtiofsd_bin() {
  command -v virtiofsd || true
}

create_qcow2() {
  local disk_path="$1"
  if [ ! -f "${disk_path}" ]; then
    "$(qemu_img_bin)" create -f qcow2 "${disk_path}" "${DISK_SIZE}"
  fi
}

print_access() {
  echo "SSH:   ssh -p ${SSH_PORT} nixos@127.0.0.1"
  echo "HTTP:  http://127.0.0.1:${HTTP_PORT}/"
  echo "HTTPS: https://127.0.0.1:${HTTPS_PORT}/"
}

run_qemu() {
  local name="$1"
  shift
  local serial_log="${LOG_DIR}/${name}-serial.log"
  echo "Launching ${name}"
  echo "Serial log: ${serial_log}"
  print_access
  echo "QEMU command:"
  printf ' %q' "$(qemu_bin)" "$@"
  echo
  exec "$(qemu_bin)" "$@" -serial "file:${serial_log}"
}
