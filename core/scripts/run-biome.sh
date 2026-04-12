#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SYSTEM_BIOME="/run/current-system/sw/bin/biome"
LOCAL_BIOME="$ROOT_DIR/node_modules/.bin/biome"

case "$(uname -m)" in
  x86_64|amd64)
    LOCAL_MUSL_BIOME="$ROOT_DIR/node_modules/@biomejs/cli-linux-x64-musl/biome"
    ;;
  aarch64|arm64)
    LOCAL_MUSL_BIOME="$ROOT_DIR/node_modules/@biomejs/cli-linux-arm64-musl/biome"
    ;;
  *)
    LOCAL_MUSL_BIOME=""
    ;;
esac

if [ -n "$LOCAL_MUSL_BIOME" ] && [ -x "$LOCAL_MUSL_BIOME" ]; then
  exec "$LOCAL_MUSL_BIOME" "$@"
fi

if [ -x "$LOCAL_BIOME" ]; then
  exec "$LOCAL_BIOME" "$@"
fi

if [ -x "$SYSTEM_BIOME" ]; then
  exec "$SYSTEM_BIOME" "$@"
fi

if command -v biome >/dev/null 2>&1; then
  exec "$(command -v biome)" "$@"
fi

echo "Biome is not available. Install dependencies with 'npm install' or enter the Nix dev shell." >&2
exit 127
