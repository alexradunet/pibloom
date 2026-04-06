#!/usr/bin/env bash
set -euo pipefail
exec nixos-rebuild switch --flake /etc/nixos --impure "$@"
