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
LAB_DIR="${NIXPI_QEMU_DIR:-${REPO_DIR}/qemu-lab}"
DISK_DIR="${LAB_DIR}/disks"
LOG_DIR="${LAB_DIR}/logs"
SHARE_DIR="${REPO_DIR}"
INSTALLER_ISO_PATH="${LAB_DIR}/nixos-stable-installer.iso"
INSTALLER_ISO_URL="${NIXPI_QEMU_INSTALLER_ISO_URL:-https://channels.nixos.org/nixos-25.11/latest-nixos-graphical-x86_64-linux.iso}"
AUTO_DOWNLOAD_INSTALLER_ISO="${NIXPI_QEMU_AUTO_DOWNLOAD_ISO:-1}"
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

curl_bin() {
  command -v curl || true
}

wget_bin() {
  command -v wget || true
}

virtiofsd_bin() {
  command -v virtiofsd || true
}

resolve_ovmf_dir() {
  local candidate
  for candidate in \
    "${NIXPI_QEMU_OVMF_DIR:-}" \
    /run/libvirt/nix-ovmf \
    /usr/share/OVMF \
    /usr/share/edk2/ovmf \
    /run/current-system/sw/share/OVMF \
    /run/current-system/sw/share/edk2-ovmf
  do
    [ -n "${candidate}" ] || continue
    if [ -f "${candidate}/OVMF_CODE.fd" ] && [ -f "${candidate}/OVMF_VARS.fd" ]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  echo "missing OVMF firmware. Set OVMF_CODE_PATH/OVMF_VARS_PATH or NIXPI_QEMU_OVMF_DIR." >&2
  return 1
}

default_ovmf_code_path() {
  local ovmf_dir
  ovmf_dir="$(resolve_ovmf_dir)" || return 1
  printf '%s\n' "${ovmf_dir}/OVMF_CODE.fd"
}

default_ovmf_vars_template_path() {
  local ovmf_dir
  ovmf_dir="$(resolve_ovmf_dir)" || return 1
  printf '%s\n' "${ovmf_dir}/OVMF_VARS.fd"
}

ensure_ovmf_vars_file() {
  local target_path="$1"
  local template_path="$2"

  if [ -f "${target_path}" ]; then
    return 0
  fi

  if [ ! -f "${template_path}" ]; then
    echo "missing OVMF vars template: ${template_path}" >&2
    return 1
  fi

  cp "${template_path}" "${target_path}"
}

create_qcow2() {
  local disk_path="$1"
  if [ ! -f "${disk_path}" ]; then
    "$(qemu_img_bin)" create -f qcow2 "${disk_path}" "${DISK_SIZE}"
  fi
}

download_installer_iso() {
  local iso_path="$1"
  local downloader part_path
  part_path="${iso_path}.part"

  if [ "${AUTO_DOWNLOAD_INSTALLER_ISO}" = "0" ] || [ "${AUTO_DOWNLOAD_INSTALLER_ISO}" = "false" ]; then
    return 1
  fi

  downloader="$(curl_bin)"
  if [ -n "${downloader}" ]; then
    echo "installer ISO missing; downloading via curl:"
    echo "  ${INSTALLER_ISO_URL}"
    "${downloader}" -fL --retry 3 --output "${part_path}" "${INSTALLER_ISO_URL}"
    mv "${part_path}" "${iso_path}"
    return 0
  fi

  downloader="$(wget_bin)"
  if [ -n "${downloader}" ]; then
    echo "installer ISO missing; downloading via wget:"
    echo "  ${INSTALLER_ISO_URL}"
    "${downloader}" --tries=3 --output-document="${part_path}" "${INSTALLER_ISO_URL}"
    mv "${part_path}" "${iso_path}"
    return 0
  fi

  return 1
}

ensure_installer_iso() {
  local iso_path="$1"

  if [ -f "${iso_path}" ]; then
    return 0
  fi

  if download_installer_iso "${iso_path}"; then
    return 0
  fi

  echo "missing installer ISO: ${iso_path}" >&2
  echo "Auto-download URL: ${INSTALLER_ISO_URL}" >&2
  echo "Enable curl/wget or place the ISO manually at the path above." >&2
  return 1
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
