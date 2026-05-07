---
name: nixpi-config
description: "Inspect, validate, or apply the NixPI host configuration through standard Nix tooling. Use when the user asks about repo state, wants to validate the flake, or requests a rebuild. Keywords: flake, nixos, rebuild, apply, validate, config, switch, diff."
allowed-tools: shell
---

# NixPI Config Management

This skill replaces the removed `nixpi-config` CLI. Manage the NixPI host configuration lifecycle with standard tools.

## Prerequisites

Always know the host and flake dir first:
```bash
# Host name from environment or /etc/hostname
HOST="${NIXPI_WIKI_HOST:-$(cat /etc/hostname)}"
FLAKE_DIR="${NIXPI_FLAKE_DIR:-${NIXPI_ROOT:-${HOME}/NixPI}}"
```

## Commands

### status — show repo state
```bash
cd "$FLAKE_DIR"
git status --short
git log --oneline -5
```

### diff — show pending changes
```bash
cd "$FLAKE_DIR"
git diff --stat
git diff --cached --stat
```

### validate — run flake checks
```bash
cd "$FLAKE_DIR"
nix flake check --no-build --accept-flake-config 2>&1 || true
```

Also run syntax checks:
```bash
nixfmt --check **/*.nix            # or alejandra
statix check                       # lint-style
```

### apply — build and activate
```bash
cd "$FLAKE_DIR"
sudo nixos-rebuild switch --flake ".#$HOST" --accept-flake-config 2>&1
```

## Workflow for apply

1. **status** — check repo state. If dirty, commit or explain why not.
2. **validate** — run `nix flake check`. Fix errors before proceeding.
3. **Confirm with the user** — show what will change. Offer a rollback path.
4. **apply** — run `nixos-rebuild switch`. Capture stdout/stderr.
5. After a successful apply, optionally reboot if it includes kernel/daemon changes:
   ```bash
   nixpi-health | head -20
   # Ask user before rebooting
   ```

## Publishing changes

`nixpi-config` shipped a separate publication command. This is gone. Use standard Git:
```bash
git add -A
git commit -m "<message>"
git push
```

## Safety rules

- Never `nixos-rebuild switch` without running `nix flake check` first.
- Always show the user the diff before applying.
- If the flake is dirty (uncommitted changes), warn the user.
- Do not reboot after apply unless the user explicitly requests it or the change requires it.
