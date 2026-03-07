#!/usr/bin/env bash
set -euo pipefail

# Bloom login script — ensures Pi settings include Bloom package, shows greeting

BLOOM_PKG="/usr/local/share/bloom"
PI_SETTINGS="$HOME/.pi/agent/settings.json"

# Ensure Pi settings include the Bloom package (idempotent, runs every login)
if [ -d "$BLOOM_PKG" ]; then
    mkdir -p "$(dirname "$PI_SETTINGS")"
    if [ -f "$PI_SETTINGS" ]; then
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

# First-boot greeting
FIRST_RUN_MARKER="$HOME/.bloom/.initialized"

if [ ! -f "$FIRST_RUN_MARKER" ]; then
    echo ""
    echo "  🌱 Welcome to Bloom"
    echo ""
    echo "  Your personal AI companion is starting for the first time."
    echo "  Pi will guide you through setup — just chat naturally."
    echo ""
    echo "  What Pi will help you configure:"
    echo "    • LLM API key (Anthropic, OpenAI, etc.)"
    echo "    • GitHub authentication (for self-evolution)"
    echo "    • Optional OCI service modules:"
    echo "      - dufs (home directory WebDAV access)"
    echo "      - WhatsApp bridge"
    echo "      - Lemonade (local LLM + speech-to-text)"
    echo "      - NetBird mesh networking"
    echo "    • Your preferences and name"
    echo ""

    mkdir -p "$(dirname "$FIRST_RUN_MARKER")"
    touch "$FIRST_RUN_MARKER"
else
    echo ""
    echo "  🌸 Bloom"
    echo ""
fi
