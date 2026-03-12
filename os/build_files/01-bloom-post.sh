#!/bin/bash
set -xeuo pipefail

cd /usr/local/share/bloom

# Build TypeScript and prune dev deps
npm run build
npm prune --omit=dev

# Wire globally-installed Pi SDK packages into Bloom's node_modules
# NOTE: linking the namespace dir itself can create a nested
# node_modules/@mariozechner/@mariozechner layout if the target exists.
# Link concrete packages instead.
rm -rf /usr/local/share/bloom/node_modules/@mariozechner
mkdir -p /usr/local/share/bloom/node_modules/@mariozechner
ln -s /usr/local/lib/node_modules/@mariozechner/pi-coding-agent /usr/local/share/bloom/node_modules/@mariozechner/pi-coding-agent
ln -s /usr/local/lib/node_modules/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-ai /usr/local/share/bloom/node_modules/@mariozechner/pi-ai

# Configure Pi settings defaults (immutable layer)
mkdir -p /usr/local/share/bloom/.pi/agent
echo '{"packages": ["/usr/local/share/bloom"]}' > /usr/local/share/bloom/.pi/agent/settings.json

# Persona directory
mkdir -p /usr/local/share/bloom/persona

# Continuwuity binary
chmod +x /usr/local/bin/continuwuity

# Appservices directory
mkdir -p /etc/bloom/appservices
