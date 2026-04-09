#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -n "${NIXPI_REPO_ROOT:-}" && -f "${NIXPI_REPO_ROOT}/core/scripts/nixpi-ovh-common.sh" ]]; then
	source "${NIXPI_REPO_ROOT}/core/scripts/nixpi-ovh-common.sh"
else
	source "${script_dir}/nixpi-ovh-common.sh"
fi

usage() {
  cat <<'EOF_USAGE'
Usage: nixpi-deploy-ovh --target-host root@IP --disk /dev/sdX [--flake .#ovh-vps] [--hostname HOSTNAME] [--bootstrap-user USER --bootstrap-password-hash HASH] [--netbird-setup-key-file PATH] [extra nixos-anywhere args...]

Destructive fresh install for an OVH VPS in rescue mode.

Examples:
  nix run .#nixpi-deploy-ovh -- --target-host root@198.51.100.10 --disk /dev/sda
  nix run .#nixpi-deploy-ovh -- --target-host root@198.51.100.10 --disk /dev/nvme0n1 --hostname bloom-eu-1
  nix run .#nixpi-deploy-ovh -- --target-host root@198.51.100.10 --disk /dev/sda --bootstrap-user human --bootstrap-password-hash '$6$...'
  nix run .#nixpi-deploy-ovh -- --target-host root@198.51.100.10 --disk /dev/sda --netbird-setup-key-file ./netbird-key
EOF_USAGE
}

main() {
  local target_host=""
  local disk=""
  local hostname="ovh-vps"
  local flake_ref="${NIXPI_REPO_ROOT:-.}#ovh-vps"
  local bootstrap_user=""
  local bootstrap_password_hash=""
  local netbird_setup_key_file=""
  local extra_args=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --target-host)
        target_host="${2:?missing target host}"
        shift 2
        ;;
      --disk)
        disk="${2:?missing disk path}"
        shift 2
        ;;
      --flake)
        flake_ref="${2:?missing flake ref}"
        shift 2
        ;;
      --hostname)
        hostname="${2:?missing hostname}"
        shift 2
        ;;
      --bootstrap-user)
        bootstrap_user="${2:?missing bootstrap user}"
        shift 2
        ;;
      --bootstrap-password-hash)
        bootstrap_password_hash="${2:?missing bootstrap password hash}"
        shift 2
        ;;
      --netbird-setup-key-file)
        netbird_setup_key_file="${2:?missing netbird setup key file}"
        shift 2
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        extra_args+=("$1")
        shift
        ;;
    esac
  done

  if [[ -z "$target_host" || -z "$disk" ]]; then
    usage >&2
    exit 1
  fi

  run_ovh_deploy "$target_host" "$disk" "$hostname" "$flake_ref" "$bootstrap_user" "$bootstrap_password_hash" "$netbird_setup_key_file" "${extra_args[@]}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
