---
name: nixpi-audit
description: "Compare the NixPI host's current state (wiki, config, services) against a baseline and report drift. Use for periodic reviews, gap analysis, or before significant changes. Keywords: audit, baseline, drift, gap, review, compliance."
allowed-tools: shell
---

# NixPI Audit

This skill replaces the removed `nixpi-audit` CLI. Run a baseline comparison between wiki declarations and implemented state.

## Scope

The audit checks for drift between:

1. **Wiki baseline** — typed objects, daily notes, area pages
2. **NixPI config** — active `hosts/<host>/default.nix`, flake.nix, service modules
3. **Runtime state** — systemd units, podman containers, disk usage

## Procedure

### Step 1: Gather wiki state
```bash
nixpi-wiki search --query "status:reviewing" --type decision | wc -l
nixpi-wiki lint --mode strict 2>&1 | tail -30
nixpi-wiki decay-pass --dry-run 2>&1 | tail -20
```

### Step 2: Gather config state
```bash
FLAKE_DIR="${NIXPI_FLAKE_DIR:-${NIXPI_ROOT:-${HOME}/NixPI}}"
cd "$FLAKE_DIR"
git log --oneline -5
git status --short
nix flake check --no-build --accept-flake-config 2>&1 | tail -10
```

### Step 3: Gather runtime state
```bash
nixpi-health --format markdown 2>&1 | head -40
```

### Step 4: Compare and report
Compare the wiki objects against running services. Look for:

- **Missing implementations** — wiki says a service should exist but `systemctl` doesn't see it
- **Orphan services** — running units with no wiki documentation
- **Stale decisions** — decisions whose `last_confirmed` or `confidence` is old
- **Config drift** — local uncommitted changes vs wiki-recorded plan

## Reporting

Write findings as a summary to the daily note:
```bash
nixpi-wiki daily append --bullets "Audit: <summary>"
```

Optional: create an audit object:
```bash
nixpi-wiki ensure-object --type snapshot --title "Audit <date>" --summary "Baseline comparison result" --domain technical --areas infrastructure
```

## Safety

- `--write-report` and `--capture-source` flags from the old CLI are gone. Write findings to wiki directly.
- Do not auto-remediate. Present findings to the user and ask before acting.
