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
Usage: nixpi-reinstall-ovh --target-host root@IP --disk /dev/sdX --bootstrap-secrets-file PATH [--flake .#ovh-vps] [--hostname HOSTNAME] [extra nixos-anywhere args...]

Destructive fresh reinstall for an OVH VPS in rescue mode using one local bootstrap secrets file.

Required JSON shape:
  {
    "bootstrapUser": "alex",
    "bootstrapPasswordHash": "$6$...",
    "netbirdSetupKey": "..."
  }

Example:
  nix run .#nixpi-reinstall-ovh -- --target-host root@198.51.100.10 --disk /dev/sda --bootstrap-secrets-file ./bootstrap-secrets.json
EOF_USAGE
}

load_bootstrap_secrets() {
	local bootstrap_secrets_file="$1"
	local parsed_assignments=""

	if [[ ! -f "$bootstrap_secrets_file" ]]; then
		log "--bootstrap-secrets-file must point to an existing local file"
		return 1
	fi

	if ! parsed_assignments="$(
		python3 - "$bootstrap_secrets_file" <<'PY'
import json
import shlex
import sys

path = sys.argv[1]
try:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
except json.JSONDecodeError:
    print("bootstrap-secrets-file must contain valid JSON", file=sys.stderr)
    sys.exit(1)
except OSError as exc:
    print(f"failed to read bootstrap-secrets-file: {exc}", file=sys.stderr)
    sys.exit(1)

required_fields = ("bootstrapUser", "bootstrapPasswordHash", "netbirdSetupKey")
missing = [field for field in required_fields if not isinstance(data.get(field), str) or not data[field]]
if missing:
    print(
        "bootstrap-secrets-file must define bootstrapUser, bootstrapPasswordHash, and netbirdSetupKey",
        file=sys.stderr,
    )
    sys.exit(1)

for source_key, target_key in (
    ("bootstrapUser", "bootstrap_user"),
    ("bootstrapPasswordHash", "bootstrap_password_hash"),
    ("netbirdSetupKey", "netbird_setup_key"),
):
    print(f"{target_key}={shlex.quote(data[source_key])}")
PY
	)"; then
		return 1
	fi

	eval "$parsed_assignments"
}

main() {
	local target_host=""
	local disk=""
	local hostname="ovh-vps"
	local flake_ref="${NIXPI_REPO_ROOT:-.}#ovh-vps"
	local bootstrap_secrets_file=""
	local bootstrap_user=""
	local bootstrap_password_hash=""
	local netbird_setup_key=""
	local extra_args=()
	local temp_dir=""
	local netbird_setup_key_file=""

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
			--bootstrap-secrets-file)
				bootstrap_secrets_file="${2:?missing bootstrap secrets file}"
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

	if [[ -z "$target_host" || -z "$disk" || -z "$bootstrap_secrets_file" ]]; then
		usage >&2
		exit 1
	fi

	load_bootstrap_secrets "$bootstrap_secrets_file"

	temp_dir="$(mktemp -d)"
	trap 'rm -rf "$temp_dir"' EXIT
	netbird_setup_key_file="${temp_dir}/netbird-setup-key"
	printf '%s' "$netbird_setup_key" > "$netbird_setup_key_file"

	run_ovh_deploy \
		"$target_host" \
		"$disk" \
		"$hostname" \
		"$flake_ref" \
		"$bootstrap_user" \
		"$bootstrap_password_hash" \
		"$netbird_setup_key_file" \
		"${extra_args[@]}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
	main "$@"
fi
