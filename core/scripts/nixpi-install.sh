#!/usr/bin/env bash
set -euo pipefail

# nixPI Install Script
# Attaches nixPI to an existing NixOS installation.
# 
# Usage:
#   curl -fsSL ... | bash                    # Install from GitHub (non-interactive)
#   bash <(curl -fsSL ...)                   # Interactive with prompt
#   NIXPI_PRIMARY_USER=alex bash ...         # Specify user explicitly
#   bash ... github:owner/repo#branch        # Use custom flake

flake="${1:-github:alexradunet/nixpi#desktop-attach}"
primary_user="${NIXPI_PRIMARY_USER:-${SUDO_USER:-${USER:-}}}"

if [[ -z "${primary_user}" ]]; then
	echo "Error: Unable to determine the primary user." >&2
	echo "Set NIXPI_PRIMARY_USER and retry." >&2
	exit 1
fi

# Verify the user exists on the system
if ! id "${primary_user}" &>/dev/null; then
	echo "Error: User '${primary_user}' does not exist on this system." >&2
	echo "Create the user first, or set NIXPI_PRIMARY_USER to an existing user." >&2
	exit 1
fi

export NIXPI_PRIMARY_USER="${primary_user}"

echo "Installing nixPI for user: ${primary_user}"
echo "Using flake: ${flake}"
echo ""
echo "This will:"
echo "  - Import your existing NixOS configuration"
echo "  - Layer nixPI services on top (Matrix, built-in services, daemon)"
echo "  - Add '${primary_user}' to the 'agent' group"
echo ""

# Only prompt if stdin is a terminal (not when piped)
if [[ -t 0 ]]; then
	read -p "Continue? [Y/n] " -n 1 -r
	echo
	if [[ ! $REPLY =~ ^[Yy]$ ]] && [[ -n $REPLY ]]; then
		echo "Aborted."
		exit 1
	fi
else
	echo "Running non-interactively (piped). Use -y flag or set NIXPI_AUTO_CONFIRM=1 to skip this warning."
	sleep 2
fi

exec sudo --preserve-env=NIXPI_PRIMARY_USER \
	nixos-rebuild switch --impure --flake "${flake}"
