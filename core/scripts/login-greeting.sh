#!/usr/bin/env bash
set -euo pipefail

# Garden login script — ensures Pi settings include Garden package.

BLOOM_PKG="/usr/local/share/garden"
PI_SETTINGS="$HOME/.pi/agent/settings.json"

# Ensure Pi settings include the Garden package (idempotent)
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

# Keep the Matrix daemon online for this user session after setup completes.
if [[ -f "$HOME/.garden/.setup-complete" ]] && ! systemctl --user --quiet is-active pi-daemon.service 2>/dev/null; then
    if ! systemctl --user enable --now pi-daemon.service >/dev/null 2>&1; then
        echo "warning: failed to enable pi-daemon.service from garden-greeting" >&2
    fi
fi
