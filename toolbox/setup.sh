#!/usr/bin/env bash
# Bloom Dev Toolbox — build and create the development environment
# Usage: ./toolbox/setup.sh [--rebuild]
set -euo pipefail

IMAGE="bloom-dev-toolbox"
CONTAINER="bloom-dev"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Colors ────────────────────────────────────────────────────────
red()   { printf "\033[0;31m%s\033[0m\n" "$*"; }
green() { printf "\033[0;32m%s\033[0m\n" "$*"; }
blue()  { printf "\033[0;34m%s\033[0m\n" "$*"; }

# ── Preflight checks ─────────────────────────────────────────────
for cmd in podman toolbox; do
	if ! command -v "$cmd" &>/dev/null; then
		red "Error: $cmd is required but not found."
		echo "Install with: sudo dnf install -y $cmd"
		exit 1
	fi
done

# ── Handle --rebuild flag ────────────────────────────────────────
if [[ "${1:-}" == "--rebuild" ]]; then
	blue "Removing existing container and image..."
	toolbox rm --force "$CONTAINER" 2>/dev/null || true
	podman rmi "$IMAGE" 2>/dev/null || true
fi

# ── Build the image ──────────────────────────────────────────────
if podman image exists "$IMAGE"; then
	green "Image $IMAGE already exists. Use --rebuild to force rebuild."
else
	blue "Building $IMAGE..."
	podman build -t "$IMAGE" -f "$SCRIPT_DIR/Containerfile" "$SCRIPT_DIR"
	green "Image $IMAGE built successfully."
fi

# ── Create the toolbox ───────────────────────────────────────────
if toolbox list --containers 2>/dev/null | grep -q "$CONTAINER"; then
	green "Toolbox $CONTAINER already exists."
else
	blue "Creating toolbox $CONTAINER..."
	toolbox create --image "$IMAGE" "$CONTAINER"
	green "Toolbox $CONTAINER created."
fi

# ── Post-create setup (runs inside the toolbox) ──────────────────
blue "Running post-create setup..."
toolbox run --container "$CONTAINER" bash -c '
	if command -v flatpak-spawn >/dev/null 2>&1; then
		if ! grep -Fq "alias podman=\"flatpak-spawn --host podman\"" ~/.bashrc 2>/dev/null; then
			echo "alias podman=\"flatpak-spawn --host podman\"" >> ~/.bashrc
		fi
	fi

	echo "── Node.js: $(node --version)"
	echo "── npm: $(npm --version)"
	echo "── TypeScript: $(tsc --version)"
	echo "── Biome: $(biome --version)"
	echo "── just: $(just --version)"
	echo "── Claude Code: $(claude --version 2>/dev/null || echo "installed")"
	echo "── Pi: $(pi --version 2>/dev/null || echo "installed")"
	echo "── VS Code: $(code --version 2>/dev/null | head -1)"
	echo "── QEMU: $(qemu-system-x86_64 --version | head -1)"
	echo "── Podman: $(podman --version)"
	echo "── Podman alias: $(grep -F "alias podman=" ~/.bashrc 2>/dev/null | tail -1 || echo "not set")"
'

echo ""
green "Bloom dev toolbox is ready!"
echo ""
echo "  Enter:   toolbox enter $CONTAINER"
echo "  Run:     toolbox run --container $CONTAINER <command>"
echo "  Remove:  toolbox rm --force $CONTAINER"
echo "  Rebuild: $0 --rebuild"
