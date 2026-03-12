#!/usr/bin/env bash
set -euo pipefail

# Bloom login script — ensures Pi settings include Bloom package.

BLOOM_PKG="/usr/local/share/bloom"
PI_SETTINGS="$HOME/.pi/agent/settings.json"

# Ensure Pi settings include the Bloom package (idempotent)
if [[ -d "$BLOOM_PKG" ]]; then
    mkdir -p "$(dirname "$PI_SETTINGS")"
    if [[ -f "$PI_SETTINGS" ]]; then
        if command -v jq >/dev/null 2>&1; then
            if ! jq -e '.packages // [] | index("'"$BLOOM_PKG"'")' "$PI_SETTINGS" >/dev/null 2>&1; then
                jq '.packages = ((.packages // []) + ["'"$BLOOM_PKG"'"] | unique)' "$PI_SETTINGS" > "${PI_SETTINGS}.tmp" && \
                    mv "${PI_SETTINGS}.tmp" "$PI_SETTINGS"
            fi
        fi
    else
        cp "$BLOOM_PKG/.pi/agent/settings.json" "$PI_SETTINGS"
    fi
fi
