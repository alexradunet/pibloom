#!/usr/bin/env bash
set -euo pipefail

GUM_BIN="@gumBin@"
HELPER_BIN="@helperBin@"

ROOT_MOUNT="/mnt"
HOSTNAME_VALUE=""
PRIMARY_USER_VALUE=""
TARGET_DISK=""
FORCE_YES=0
SYSTEM_CLOSURE=""
LAYOUT_MODE=""
SWAP_SIZE=""
INSTALLER_LOG="/tmp/nixpi-installer.log"
LOG_REDIRECTED=0

usage() {
  cat <<'EOF'
Usage: nixpi-installer [--disk /dev/sdX] [--hostname NAME] [--primary-user USER] [--layout no-swap|swap] [--swap-size 8GiB] [--yes] [--system PATH]

Performs a destructive UEFI install with:
- EFI system partition: 1 MiB - 512 MiB
- ext4 root partition: 512 MiB - end of disk or swap
EOF
}

network_online() {
  ping -c1 -W5 1.1.1.1 >/dev/null 2>&1
}

require_tty() {
  if [[ ! -t 0 || ! -t 1 ]]; then
    echo "Interactive mode requires a TTY." >&2
    exit 1
  fi
}

gum_input() {
  local placeholder="$1"
  local prompt="$2"
  "$GUM_BIN" input --placeholder "$placeholder" --prompt "$prompt"
}

gum_choose_value() {
  local header="$1"
  shift
  printf '%s\n' "$@" | "$GUM_BIN" choose --header "$header" --height 12
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

  local options=()
  local entry name size model description
  for entry in "${disks[@]}"; do
    IFS=$'\t' read -r name size <<<"$entry"
    model="$(disk_model "$name")"
    description="$size"
    if [[ -n "$model" ]]; then
      description="$description  $model"
    fi
    options+=("$name"$'\t'"$description")
  done

  TARGET_DISK="$(
    printf '%s\n' "${options[@]}" \
      | "$GUM_BIN" choose --header "Choose the target disk" --height 12
  )"
  TARGET_DISK="${TARGET_DISK%%$'\t'*}"
}

prompt_inputs() {
  if [[ -z "$HOSTNAME_VALUE" ]]; then
    require_tty
    while true; do
      HOSTNAME_VALUE="$(gum_input "nixpi" "Hostname: ")"
      if [[ -n "$HOSTNAME_VALUE" ]]; then
        break
      fi
      printf '%s\n' "Hostname cannot be empty." >&2
    done
  fi

  if [[ -z "$PRIMARY_USER_VALUE" ]]; then
    require_tty
    while true; do
      PRIMARY_USER_VALUE="$(gum_input "nixpi" "Primary user: ")"
      if [[ -n "$PRIMARY_USER_VALUE" ]]; then
        break
      fi
      printf '%s\n' "Primary user cannot be empty." >&2
    done
  fi
}

validate_swap_size() {
  local size="$1"
  [[ "$size" =~ ^[1-9][0-9]*(MiB|GiB|MB|GB)$ ]]
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

  local choice
  choice="$(
    gum_choose_value "Choose the disk layout" \
      "EFI + ext4 root"$'\t'"no-swap" \
      "EFI + ext4 root + 8GiB swap"$'\t'"swap:8GiB" \
      "EFI + ext4 root + custom swap"$'\t'"swap:custom"
  )"
  choice="${choice##*$'\t'}"

  case "$choice" in
    no-swap)
      LAYOUT_MODE="no-swap"
      ;;
    swap:8GiB)
      LAYOUT_MODE="swap"
      SWAP_SIZE="8GiB"
      ;;
    swap:custom)
      LAYOUT_MODE="swap"
      while true; do
        SWAP_SIZE="$(gum_input "8GiB" "Swap size: ")"
        if validate_swap_size "$SWAP_SIZE"; then
          break
        fi
        printf '%s\n' "Swap size must look like 8GiB, 4096MiB, 8GB, or 4096MB." >&2
      done
      ;;
    *)
      echo "Unknown layout selection: $choice" >&2
      exit 1
      ;;
  esac
}

connect_wifi_nmcli() {
  local ssid password

  nmcli --colors no device wifi rescan >/dev/null 2>&1 || true
  nmcli --colors no device wifi list || true
  echo ""
  read -rp "WiFi SSID: " ssid
  if [[ -z "$ssid" ]]; then
    echo "SSID cannot be empty." >&2
    return 1
  fi
  read -rsp "WiFi password: " password
  echo ""
  nmcli --wait 30 device wifi connect "$ssid" password "$password"
}

prompt_network_setup() {
  if network_online; then
    log_step "Network is already connected"
    return
  fi

  if [[ "$FORCE_YES" -eq 1 ]]; then
    log_step "No network connection detected; continuing without interactive WiFi setup"
    return
  fi

  require_tty

  while true; do
    echo ""
    echo "No network connection detected."
    echo "Choose an option:"
    echo "  1) Launch WiFi setup (nmtui)"
    echo "  2) Connect to WiFi with nmcli"
    echo "  3) Continue without network"
    echo ""

    case "$("$GUM_BIN" choose --header "Installer network setup" "Launch WiFi setup (nmtui)" "Connect to WiFi with nmcli" "Continue without network")" in
      "Launch WiFi setup (nmtui)")
        if command -v nmtui >/dev/null 2>&1; then
          nmtui
        else
          echo "nmtui is not available on this image." >&2
        fi
        ;;
      "Connect to WiFi with nmcli")
        connect_wifi_nmcli || true
        ;;
      "Continue without network")
        return
        ;;
    esac

    if network_online; then
      log_step "Network connected"
      return
    fi

    echo "Still offline. Check the WiFi credentials or signal and try again."
  done
}

normalize_layout_inputs() {
  if [[ -z "$LAYOUT_MODE" ]]; then
    LAYOUT_MODE="no-swap"
  fi

  case "$LAYOUT_MODE" in
    no-swap)
      SWAP_SIZE=""
      ;;
    swap)
      if [[ -z "$SWAP_SIZE" ]]; then
        SWAP_SIZE="8GiB"
      fi
      if ! validate_swap_size "$SWAP_SIZE"; then
        echo "Invalid --swap-size value: $SWAP_SIZE" >&2
        exit 1
      fi
      ;;
    *)
      echo "Invalid --layout value: $LAYOUT_MODE" >&2
      exit 1
      ;;
  esac
}

confirm_install() {
  if [[ "$FORCE_YES" -eq 1 ]]; then
    return
  fi

  require_tty
  local layout_summary
  if [[ "$LAYOUT_MODE" == "swap" ]]; then
    layout_summary="EFI 512 MiB + ext4 root + swap (${SWAP_SIZE})"
  else
    layout_summary="EFI 512 MiB + ext4 root"
  fi
  printf '%s\n' \
    "Target disk: ${TARGET_DISK}" \
    "Layout: ${layout_summary}" \
    "Hostname: ${HOSTNAME_VALUE}" \
    "Primary user: ${PRIMARY_USER_VALUE}" \
    "" \
    "This will erase the selected disk."
  if [[ "$("$GUM_BIN" choose --header "Proceed with destructive install?" "Proceed" "Cancel")" != "Proceed" ]]; then
    echo "Install cancelled."
    exit 0
  fi
}

partition_prefix() {
  if [[ "$TARGET_DISK" =~ [0-9]$ ]]; then
    printf "%sp" "$TARGET_DISK"
  else
    printf "%s" "$TARGET_DISK"
  fi
}

run_install_steps() {
  local boot_part="$1"
  local root_part="$2"
  local swap_part="$3"

  log_step "Partitioning $TARGET_DISK"
  parted -s "$TARGET_DISK" mklabel gpt
  parted -s "$TARGET_DISK" mkpart ESP fat32 1MiB 512MiB
  parted -s "$TARGET_DISK" set 1 esp on
  if [[ "$LAYOUT_MODE" == "swap" ]]; then
    parted -s -- "$TARGET_DISK" mkpart root ext4 512MiB "-$SWAP_SIZE"
    parted -s -- "$TARGET_DISK" mkpart swap linux-swap "-$SWAP_SIZE" 100%
  else
    parted -s "$TARGET_DISK" mkpart root ext4 512MiB 100%
  fi
  udevadm settle

  log_step "Formatting $boot_part as FAT32"
  mkfs.fat -F 32 -n boot "$boot_part"

  log_step "Formatting $root_part as ext4"
  mkfs.ext4 -F -L nixos "$root_part"

  if [[ "$LAYOUT_MODE" == "swap" ]]; then
    log_step "Creating swap on $swap_part (${SWAP_SIZE})"
    mkswap -L swap "$swap_part"
    swapon "$swap_part"
  fi

  log_step "Mounting target filesystem at $ROOT_MOUNT"
  mount "$root_part" "$ROOT_MOUNT"
  mkdir -p "$ROOT_MOUNT/boot"
  mount -o umask=077 "$boot_part" "$ROOT_MOUNT/boot"

  log_step "Generating base NixOS config"
  nixos-generate-config --root "$ROOT_MOUNT"

  log_step "Writing NixPI install artifacts"
  "$HELPER_BIN" --root "$ROOT_MOUNT" --hostname "$HOSTNAME_VALUE" --primary-user "$PRIMARY_USER_VALUE" | tee /tmp/nixpi-installer-artifacts.json

  if [[ -n "$SYSTEM_CLOSURE" ]]; then
    log_step "Installing prebuilt system closure"
    nixos-install --no-root-passwd --system "$SYSTEM_CLOSURE" --root "$ROOT_MOUNT"
  else
    log_step "Running nixos-install from configuration.nix"
    NIX_CONFIG="experimental-features = nix-command flakes" \
      NIXOS_INSTALL_BOOTLOADER=1 \
      nixos-install --no-root-passwd --root "$ROOT_MOUNT" --no-channel-copy -I "nixos-config=$ROOT_MOUNT/etc/nixos/configuration.nix"
  fi
}

run_install() {
  local prefix boot_part root_part swap_part
  prefix="$(partition_prefix)"
  boot_part="${prefix}1"
  root_part="${prefix}2"
  swap_part="${prefix}3"

  mkdir -p "$ROOT_MOUNT"
  swapoff "$swap_part" 2>/dev/null || true
  umount "$ROOT_MOUNT/boot" 2>/dev/null || true
  umount "$ROOT_MOUNT" 2>/dev/null || true
  enable_logging

  run_install_steps "$boot_part" "$root_part" "$swap_part"
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --disk)
        TARGET_DISK="$2"
        shift 2
        ;;
      --hostname)
        HOSTNAME_VALUE="$2"
        shift 2
        ;;
      --primary-user)
        PRIMARY_USER_VALUE="$2"
        shift 2
        ;;
      --layout)
        LAYOUT_MODE="$2"
        shift 2
        ;;
      --swap-size)
        SWAP_SIZE="$2"
        shift 2
        ;;
      --yes)
        FORCE_YES=1
        shift
        ;;
      --system)
        SYSTEM_CLOSURE="$2"
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        echo "Unknown argument: $1" >&2
        usage >&2
        exit 1
        ;;
    esac
  done

  ensure_root
  choose_disk
  prompt_inputs
  prompt_network_setup
  choose_layout
  normalize_layout_inputs
  confirm_install
  run_install

  echo "NixPI install completed. Reboot when ready."
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
