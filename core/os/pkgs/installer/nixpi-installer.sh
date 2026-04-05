#!/usr/bin/env bash
set -euo pipefail

DESKTOP_SYSTEM="@desktopSystem@"
CONFIG_SOURCE_DIR="@configSourceDir@"
PI_AGENT_PATH="@piAgentPath@"
APP_PACKAGE_PATH="@appPackagePath@"
SETUP_APPLY_PACKAGE_PATH="@setupApplyPackagePath@"
LAYOUT_TEMPLATE="@layoutTemplate@"

ROOT_MOUNT="/mnt"
HOSTNAME_VALUE="nixpi"
PRIMARY_USER_VALUE="human"
PRIMARY_PASSWORD_VALUE=""
TARGET_DISK=""
FORCE_YES=0
SYSTEM_CLOSURE=""
INSTALLER_LOG="/tmp/nixpi-installer.log"
LOG_REDIRECTED=0

usage() {
  cat <<'EOF'
Usage: nixpi-installer [--disk /dev/sdX] [--password VALUE] [--yes] [--system PATH]

Performs a destructive UEFI install with:
- EFI system partition: 1 GiB
- ext4 root partition: remainder minus 8 GiB swap

The installer lays down the fixed NixPI appliance closure for the default
human operator account and applies the chosen password inside the target root.
EOF
}

require_tty() {
  if [[ ! -t 0 || ! -t 1 ]]; then
    echo "Interactive mode requires a TTY." >&2
    exit 1
  fi
}

ensure_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "Run nixpi-installer as root." >&2
    exit 1
  fi
}

log_step() {
  printf '\n==> %s\n' "$*"
}

enable_logging() {
  if [[ "$LOG_REDIRECTED" -eq 1 ]]; then
    return
  fi
  : >"$INSTALLER_LOG"
  exec > >(tee -a "$INSTALLER_LOG") 2>&1
  LOG_REDIRECTED=1
  log_step "Writing installer log to $INSTALLER_LOG"
}

list_writable_disks() {
  lsblk -dnpr -o PATH,SIZE,TYPE,RO | awk '$3 == "disk" && $4 == 0 { print $1 "\t" $2 }'
}

disk_model() {
  local disk="$1"
  lsblk -dnro MODEL "$disk" 2>/dev/null | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
}

choose_disk() {
  if [[ -n "$TARGET_DISK" ]]; then
    return
  fi

  mapfile -t disks < <(list_writable_disks)
  if [[ ${#disks[@]} -eq 0 ]]; then
    echo "No writable disks found." >&2
    exit 1
  fi

  if [[ ${#disks[@]} -eq 1 ]]; then
    TARGET_DISK="${disks[0]%%$'\t'*}"
    return
  fi

  require_tty

  local entry name size model description
  local index=1
  for entry in "${disks[@]}"; do
    IFS=$'\t' read -r name size <<<"$entry"
    model="$(disk_model "$name")"
    description="$size"
    if [[ -n "$model" ]]; then
      description="$description  $model"
    fi
    printf '  %d) %s  %s\n' "$index" "$name" "$description"
    index=$((index + 1))
  done

  while true; do
    read -rp "Choose the target disk [1-${#disks[@]}]: " disk_choice
    if [[ "$disk_choice" =~ ^[0-9]+$ ]] && (( disk_choice >= 1 && disk_choice <= ${#disks[@]} )); then
      TARGET_DISK="${disks[disk_choice-1]%%$'\t'*}"
      return
    fi
    echo "Invalid selection." >&2
  done
}

prompt_password() {
  if [[ -n "$PRIMARY_PASSWORD_VALUE" ]]; then
    return
  fi

  if [[ "$FORCE_YES" -eq 1 ]]; then
    echo "--yes requires --password." >&2
    exit 1
  fi

  require_tty

  local password confirm_password
  while true; do
    read -rsp "Password: " password
    echo ""
    if [[ -z "$password" ]]; then
      echo "Password cannot be empty." >&2
      continue
    fi
    read -rsp "Confirm password: " confirm_password
    echo ""
    if [[ "$password" != "$confirm_password" ]]; then
      echo "Passwords do not match." >&2
      continue
    fi
    PRIMARY_PASSWORD_VALUE="$password"
    return
  done
}

validate_system_closure() {
  if [[ -z "$SYSTEM_CLOSURE" ]]; then
    return
  fi
  if [[ "$SYSTEM_CLOSURE" != "$DESKTOP_SYSTEM" ]]; then
    echo "--system only supports the baked desktop closure: $DESKTOP_SYSTEM" >&2
    exit 1
  fi
}

write_install_config() {
  cat >"${ROOT_MOUNT}/etc/nixos/nixpi-install.nix" <<EOF
{ ... }: {
  nixpi.primaryUser = "${PRIMARY_USER_VALUE}";
  networking.hostName = "${HOSTNAME_VALUE}";
  nixpi.security.ssh.passwordAuthentication = true;
}
EOF
}

set_primary_password() {
  printf '%s:%s\n' "$PRIMARY_USER_VALUE" "$PRIMARY_PASSWORD_VALUE" \
    | chroot "$ROOT_MOUNT" /nix/var/nix/profiles/system/sw/bin/chpasswd
}

write_bootstrap_primary_password_file() {
  local bootstrap_dir="${ROOT_MOUNT}/var/lib/nixpi/bootstrap"
  local bootstrap_file="${bootstrap_dir}/primary-user-password"

  mkdir -p "$bootstrap_dir"
  printf '%s\n' "$PRIMARY_PASSWORD_VALUE" > "$bootstrap_file"
  chroot "$ROOT_MOUNT" /nix/var/nix/profiles/system/sw/bin/chown \
    "root:root" \
    /var/lib/nixpi/bootstrap \
    /var/lib/nixpi/bootstrap/primary-user-password
  chroot "$ROOT_MOUNT" /nix/var/nix/profiles/system/sw/bin/chmod 0755 /var/lib/nixpi/bootstrap
  chroot "$ROOT_MOUNT" /nix/var/nix/profiles/system/sw/bin/chmod 0600 /var/lib/nixpi/bootstrap/primary-user-password
}

copy_configuration_source() {
  local target_dir="${ROOT_MOUNT}/etc/nixos/nixpi-config"
  rm -rf "$target_dir"
  mkdir -p "$target_dir"
  cp -R "${CONFIG_SOURCE_DIR}/." "$target_dir/"
}

write_configuration_nix() {
  cat >"${ROOT_MOUNT}/etc/nixos/configuration.nix" <<EOF
{ ... }: {
  imports = [
    ./hardware-configuration.nix
    ./nixpi-install.nix
    ./nixpi-config/core/os/hosts/x86_64.nix
  ];
  _module.args = {
    piAgent = ${PI_AGENT_PATH};
    appPackage = ${APP_PACKAGE_PATH};
    setupApplyPackage = ${SETUP_APPLY_PACKAGE_PATH};
  };
  nixpkgs.hostPlatform = "x86_64-linux";
  nixpkgs.config.allowUnfree = true;
}
EOF
}

install_system() {
  nixos-install --no-root-passwd --no-channel-copy --system "${SYSTEM_CLOSURE:-$DESKTOP_SYSTEM}" --root "$ROOT_MOUNT"
}

confirm_install() {
  if [[ "$FORCE_YES" -eq 1 ]]; then
    return
  fi

  require_tty
  printf '%s\n' \
    "Target disk: ${TARGET_DISK}" \
    "Layout: EFI 1 GiB + ext4 root + 8 GiB swap" \
    "Hostname: ${HOSTNAME_VALUE}" \
    "Primary user: ${PRIMARY_USER_VALUE}" \
    "Primary user password: [set]" \
    "" \
    "This will erase the selected disk."
  read -rp "Proceed with destructive install? [y/N]: " proceed
  if [[ ! "$proceed" =~ ^[Yy]$ ]]; then
    echo "Install cancelled."
    exit 0
  fi
}

run_install() {
  enable_logging

  echo "=== [2/5] Partitioning and formatting ==="
  local disko_config
  disko_config="$(mktemp /tmp/nixpi-disko-XXXXXX.nix)"

  sed -e "s|@DISK@|${TARGET_DISK}|g" "$LAYOUT_TEMPLATE" > "$disko_config"

  log_step "Running disko on $TARGET_DISK"
  disko --mode destroy,format,mount "$disko_config"

  echo "=== [3/5] Writing boot configuration ==="
  log_step "Generating NixOS hardware config"
  nixos-generate-config --root "$ROOT_MOUNT"

  log_step "Copying bundled NixPI config sources"
  copy_configuration_source

  log_step "Writing NixPI install config"
  write_install_config
  write_configuration_nix

  echo "=== [4/5] Installing NixOS (this may take 10-20 minutes) ==="
  log_step "Installing system closure"
  install_system
  log_step "Setting primary user password in target root"
  set_primary_password
  log_step "Writing bootstrap password handoff file"
  write_bootstrap_primary_password_file
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --disk) TARGET_DISK="$2"; shift 2 ;;
      --password) PRIMARY_PASSWORD_VALUE="$2"; shift 2 ;;
      --yes) FORCE_YES=1; shift ;;
      --system) SYSTEM_CLOSURE="$2"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
    esac
  done

  ensure_root
  echo "=== [1/5] Disk selection ==="
  choose_disk
  prompt_password
  validate_system_closure
  confirm_install
  run_install

  echo "=== [5/5] Finalizing ==="
  echo "NixPI install completed. Reboot when ready."
  echo "After reboot, connect to WiFi in the first-boot setup wizard before promoting to the full appliance."
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
