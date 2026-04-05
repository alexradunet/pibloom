#!/usr/bin/env bash
set -euo pipefail

DESKTOP_SYSTEM="@desktopSystem@"
DESKTOP_HOST_MODULE="@desktopHostModule@"
PREFILL_FILE=""
LAYOUT_STANDARD="@layoutStandard@"
LAYOUT_SWAP="@layoutSwap@"

ROOT_MOUNT="/mnt"
HOSTNAME_VALUE=""
PRIMARY_USER_VALUE=""
PRIMARY_PASSWORD_VALUE=""
TARGET_DISK=""
FORCE_YES=0
SYSTEM_CLOSURE=""
LAYOUT_MODE=""
SWAP_SIZE=""
INSTALLER_LOG="/tmp/nixpi-installer.log"
LOG_REDIRECTED=0

usage() {
  cat <<'EOF'
Usage: nixpi-installer [--prefill /path/to/prefill.env] [--disk /dev/sdX] [--hostname NAME] [--primary-user USER] [--password VALUE] [--layout no-swap|swap] [--swap-size 8GiB] [--yes] [--system PATH]

Performs a destructive UEFI install with:
- EFI system partition: 1 GiB
- ext4 root partition: remainder (or remainder minus swap)

The installer creates a minimal bootable NixPI base. The first-boot setup
wizard handles WiFi, internet validation, and promotion into the full
appliance profile using the canonical repo checkout at /srv/nixpi.
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

prompt_inputs() {
  if [[ -z "$HOSTNAME_VALUE" ]]; then
    require_tty
    while true; do
      read -rp "Hostname [nixpi]: " HOSTNAME_VALUE
      HOSTNAME_VALUE="${HOSTNAME_VALUE:-nixpi}"
      if [[ -n "$HOSTNAME_VALUE" ]]; then
        break
      fi
      printf '%s\n' "Hostname cannot be empty." >&2
    done
  fi

  if [[ -z "$PRIMARY_USER_VALUE" ]]; then
    require_tty
    while true; do
      read -rp "Primary user [nixpi]: " PRIMARY_USER_VALUE
      PRIMARY_USER_VALUE="${PRIMARY_USER_VALUE:-nixpi}"
      if [[ -n "$PRIMARY_USER_VALUE" ]]; then
        break
      fi
      printf '%s\n' "Primary user cannot be empty." >&2
    done
  fi
}

prompt_password() {
  if [[ -n "$PRIMARY_PASSWORD_VALUE" ]]; then
    return
  fi

  if [[ "$FORCE_YES" -eq 1 ]]; then
    echo "--yes requires --password for the primary user." >&2
    exit 1
  fi

  require_tty

  local password confirm_password
  while true; do
    read -rsp "Primary user password: " password
    echo ""
    if [[ -z "$password" ]]; then
      echo "Password cannot be empty." >&2
      continue
    fi
    read -rsp "Confirm primary user password: " confirm_password
    echo ""
    if [[ "$password" != "$confirm_password" ]]; then
      echo "Passwords do not match." >&2
      continue
    fi
    PRIMARY_PASSWORD_VALUE="$password"
    return
  done
}

load_prefill() {
  local prefill_path="$1"
  [[ -n "$prefill_path" ]] || return 0
  if [[ ! -f "$prefill_path" ]]; then
    echo "Prefill file not found: $prefill_path" >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  . "$prefill_path"
  HOSTNAME_VALUE="${HOSTNAME_VALUE:-${PREFILL_HOSTNAME:-}}"
  PRIMARY_USER_VALUE="${PRIMARY_USER_VALUE:-${PREFILL_USERNAME:-}}"
  PRIMARY_PASSWORD_VALUE="${PRIMARY_PASSWORD_VALUE:-${PREFILL_PASSWORD:-${PREFILL_PRIMARY_PASSWORD:-}}}"
}

validate_swap_size() {
  local size="$1"
  [[ "$size" =~ ^[1-9][0-9]*(MiB|GiB|MB|GB)$ ]]
}

# Convert user-friendly sizes (8GiB, 4096MiB) to disko-compatible format (8G, 4096M).
# Disko's size field requires [0-9]+[KMGTP]? — the "iB" suffix is not accepted.
disko_swap_size() {
  local size="$1"
  size="${size/GiB/G}"
  size="${size/MiB/M}"
  size="${size/GB/G}"
  size="${size/MB/M}"
  echo "$size"
}

choose_layout() {
  if [[ -n "$LAYOUT_MODE" ]]; then
    return
  fi

  if [[ "$FORCE_YES" -eq 1 ]]; then
    LAYOUT_MODE="no-swap"
    return
  fi

  require_tty

  echo "Choose the disk layout:"
  echo "  1) EFI + ext4 root"
  echo "  2) EFI + ext4 root + 8GiB swap"
  echo "  3) EFI + ext4 root + custom swap"

  local choice=""
  while true; do
    read -rp "Select option [1/2/3]: " choice
    case "$choice" in
      1) LAYOUT_MODE="no-swap"; break ;;
      2) LAYOUT_MODE="swap"; SWAP_SIZE="8GiB"; break ;;
      3)
        LAYOUT_MODE="swap"
        while true; do
          read -rp "Swap size [8GiB]: " SWAP_SIZE
          SWAP_SIZE="${SWAP_SIZE:-8GiB}"
          if validate_swap_size "$SWAP_SIZE"; then
            break
          fi
          printf '%s\n' "Swap size must look like 8GiB, 4096MiB, 8GB, or 4096MB." >&2
        done
        break
        ;;
      *) echo "Invalid option." >&2 ;;
    esac
  done
}

normalize_layout_inputs() {
  if [[ -z "$LAYOUT_MODE" ]]; then
    LAYOUT_MODE="no-swap"
  fi

  case "$LAYOUT_MODE" in
    no-swap) SWAP_SIZE="" ;;
    swap)
      if [[ -z "$SWAP_SIZE" ]]; then
        SWAP_SIZE="8GiB"
      fi
      if ! validate_swap_size "$SWAP_SIZE"; then
        echo "Invalid --swap-size value: $SWAP_SIZE" >&2
        exit 1
      fi
      SWAP_SIZE="$(disko_swap_size "$SWAP_SIZE")"
      ;;
    *)
      echo "Invalid --layout value: $LAYOUT_MODE" >&2
      exit 1
      ;;
  esac
}

write_install_config() {
  local hashed_password="$1"
  cat >"${ROOT_MOUNT}/etc/nixos/nixpi-install.nix" <<EOF
{ ... }: {
  nixpi.primaryUser = "${PRIMARY_USER_VALUE}";
  networking.hostName = "${HOSTNAME_VALUE}";
  users.users."${PRIMARY_USER_VALUE}".hashedPassword = "${hashed_password}";
  nixpi.security.ssh.passwordAuthentication = true;
}
EOF
}

write_configuration_nix() {
  cat >"${ROOT_MOUNT}/etc/nixos/configuration.nix" <<EOF
{ ... }: {
  imports = [
    ./hardware-configuration.nix
    ./nixpi-install.nix
    ${DESKTOP_HOST_MODULE}
  ];
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
  local layout_summary
  if [[ "$LAYOUT_MODE" == "swap" ]]; then
    layout_summary="EFI 1 GiB + ext4 root + swap (${SWAP_SIZE})"
  else
    layout_summary="EFI 1 GiB + ext4 root"
  fi
  printf '%s\n' \
    "Target disk: ${TARGET_DISK}" \
    "Layout: ${layout_summary}" \
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

  if [[ "$LAYOUT_MODE" == "swap" ]]; then
    sed \
      -e "s|@DISK@|${TARGET_DISK}|g" \
      -e "s|@SWAP_SIZE@|${SWAP_SIZE}|g" \
      "$LAYOUT_SWAP" > "$disko_config"
  else
    sed \
      -e "s|@DISK@|${TARGET_DISK}|g" \
      "$LAYOUT_STANDARD" > "$disko_config"
  fi

  log_step "Running disko on $TARGET_DISK"
  disko --mode destroy,format,mount "$disko_config"

  echo "=== [3/5] Writing boot configuration ==="
  log_step "Generating NixOS hardware config"
  nixos-generate-config --root "$ROOT_MOUNT"

  log_step "Writing NixPI install config"
  local password_hash
  password_hash="$(openssl passwd -6 -stdin <<< "$PRIMARY_PASSWORD_VALUE")"
  write_install_config "$password_hash"
  write_configuration_nix

  echo "=== [4/5] Installing NixOS (this may take 10-20 minutes) ==="
  log_step "Installing system closure"
  install_system
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --prefill) PREFILL_FILE="$2"; shift 2 ;;
      --disk) TARGET_DISK="$2"; shift 2 ;;
      --hostname) HOSTNAME_VALUE="$2"; shift 2 ;;
      --primary-user) PRIMARY_USER_VALUE="$2"; shift 2 ;;
      --password) PRIMARY_PASSWORD_VALUE="$2"; shift 2 ;;
      --layout) LAYOUT_MODE="$2"; shift 2 ;;
      --swap-size) SWAP_SIZE="$2"; shift 2 ;;
      --yes) FORCE_YES=1; shift ;;
      --system) SYSTEM_CLOSURE="$2"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) echo "Unknown argument: $1" >&2; usage >&2; exit 1 ;;
    esac
  done

  ensure_root
  load_prefill "$PREFILL_FILE"
  echo "=== [1/5] Disk selection ==="
  choose_disk
  prompt_inputs
  prompt_password
  choose_layout
  normalize_layout_inputs
  confirm_install
  run_install

  echo "=== [5/5] Finalizing ==="
  echo "NixPI install completed. Reboot when ready."
  echo "After reboot, connect to WiFi in the first-boot setup wizard before promoting to the full appliance."
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
