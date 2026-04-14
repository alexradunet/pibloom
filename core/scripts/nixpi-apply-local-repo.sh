#!/usr/bin/env bash
set -euo pipefail

script_name="$(basename "$0")"
current_uid="${NIXPI_UID_OVERRIDE:-$(id -u)}"
repo_dir="${1:-${NIXPI_LOCAL_REPO_DIR:-/var/lib/nixpi/pi-nixpi}}"
system_flake_dir="${NIXPI_SYSTEM_FLAKE_DIR:-/etc/nixos}"
sudo_bin="${NIXPI_SUDO_BIN:-/run/wrappers/bin/sudo}"
rebuild_bin="${NIXPI_REBUILD_BIN:-$(command -v nixpi-rebuild || true)}"

usage() {
	echo "usage: ${script_name} [repo-dir]" >&2
}

if [[ $# -gt 1 ]]; then
	usage
	exit 1
fi

if [[ ! -d "${repo_dir}/.git" ]]; then
	echo "Local NixPI repo is not initialized: ${repo_dir}." >&2
	echo "Clone or repair the local repo first, then retry ${script_name}." >&2
	exit 1
fi

if [[ ! -f "${system_flake_dir}/flake.nix" ]]; then
	echo "System flake not found at ${system_flake_dir}." >&2
	echo "The installed host flake at ${system_flake_dir} is the running system's source of truth." >&2
	echo "Repair or reinstall that installed host flake before applying local repo overrides." >&2
	exit 1
fi

if [[ -z "${rebuild_bin}" ]]; then
	echo "nixpi-rebuild is not available in PATH." >&2
	exit 1
fi

if [[ "${current_uid}" != "0" ]]; then
	exec "${sudo_bin}" -n "$0" "${repo_dir}"
fi

exec "${rebuild_bin}" --override-input nixpi "path:${repo_dir}"
