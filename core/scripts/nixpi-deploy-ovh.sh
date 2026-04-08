#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF_USAGE'
Usage: nixpi-deploy-ovh --target-host root@IP --disk /dev/sdX [--flake .#ovh-vps] [--hostname HOSTNAME] [extra nixos-anywhere args...]

Destructive fresh install for an OVH VPS in rescue mode.

Examples:
  nix run .#nixpi-deploy-ovh -- --target-host root@198.51.100.10 --disk /dev/sda
  nix run .#nixpi-deploy-ovh -- --target-host root@198.51.100.10 --disk /dev/nvme0n1 --hostname bloom-eu-1
EOF_USAGE
}

log() {
  printf '[nixpi-deploy-ovh] %s\n' "$*" >&2
}

resolve_repo_url() {
  local ref="$1"
  if [[ "$ref" == path:* || "$ref" == github:* || "$ref" == git+* || "$ref" == https://* || "$ref" == ssh://* ]]; then
    printf '%s\n' "$ref"
    return 0
  fi

  if [[ "$ref" == . || "$ref" == /* ]]; then
    printf 'path:%s\n' "$(realpath "$ref")"
    return 0
  fi

  printf '%s\n' "$ref"
}

TARGET_HOST=""
DISK=""
HOSTNAME="ovh-vps"
FLAKE_REF="${NIXPI_REPO_ROOT:-.}#ovh-vps"
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-host)
      TARGET_HOST="${2:?missing target host}"
      shift 2
      ;;
    --disk)
      DISK="${2:?missing disk path}"
      shift 2
      ;;
    --flake)
      FLAKE_REF="${2:?missing flake ref}"
      shift 2
      ;;
    --hostname)
      HOSTNAME="${2:?missing hostname}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ -z "$TARGET_HOST" || -z "$DISK" ]]; then
  usage >&2
  exit 1
fi

if [[ "$FLAKE_REF" != *#* ]]; then
  log "Flake ref must include a nixosConfigurations attribute, for example .#ovh-vps"
  exit 1
fi

REPO_REF="${FLAKE_REF%%#*}"
BASE_ATTR="${FLAKE_REF#*#}"
REPO_URL="$(resolve_repo_url "$REPO_REF")"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cat > "$TMP_DIR/flake.nix" <<EOF_FLAKE
{
  inputs.nixpi.url = "${REPO_URL}";

  outputs = { nixpi, ... }: {
    nixosConfigurations.deploy = nixpi.nixosConfigurations.${BASE_ATTR}.extendModules {
      modules = [
        ({ lib, ... }: {
          networking.hostName = lib.mkForce "${HOSTNAME}";
          disko.devices.disk.main.device = lib.mkForce "${DISK}";
        })
      ];
    };
  };
}
EOF_FLAKE

log "WARNING: destructive install to ${TARGET_HOST} using disk ${DISK}"
log "Using base configuration ${FLAKE_REF} with temporary hostname ${HOSTNAME}"
exec "${NIXPI_NIXOS_ANYWHERE:-nixos-anywhere}" \
  --flake "$TMP_DIR#deploy" \
  --target-host "$TARGET_HOST" \
  "${EXTRA_ARGS[@]}"
