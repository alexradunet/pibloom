---
name: nixpi-svc
description: "Manage NixPI systemd services (status, start, stop, restart). Allowed units are nixpi-* and sshd. Use systemctl directly. Keywords: service, systemd, start, stop, restart, status, nixpi."
allowed-tools: shell
---

# Managing NixPI Services

This skill replaces the removed `nixpi-svc` binary. Use `systemctl` directly. The allowed-unit policy is enforced at the sudoers layer, not in a wrapper binary.

## Allowed units

Only `nixpi-*` units and `sshd` may be managed without root. For any other unit, ask the user for confirmation before elevating.

## Commands

### Status (no privilege needed)
```bash
systemctl status nixpi-gateway.service --no-pager
systemctl status nixpi-planner.service --no-pager
systemctl status nixpi-proactive.service --no-pager
systemctl status sshd.service --no-pager
```

### Start / stop / restart (requires sudo)
```bash
sudo systemctl start  nixpi-gateway.service
sudo systemctl stop   nixpi-gateway.service
sudo systemctl restart nixpi-gateway.service
```

## Workflow

1. Always run `status` first to understand current state.
2. State what you intend to do and why before any `start`/`stop`/`restart`.
3. After a restart, re-run `status` and check logs:
   ```bash
   journalctl -u nixpi-gateway.service -n 50 --no-pager
   ```

## Non-nixpi units

For any unit outside `nixpi-*`/`sshd`, ask the user explicitly before touching it. Prefer `nixpi-context --health` to diagnose before taking action.
