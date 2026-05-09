---
name: ownloom-svc
description: "Manage ownloom systemd services (status, start, stop, restart). Allowed units are ownloom-* and sshd. Use systemctl directly. Keywords: service, systemd, start, stop, restart, status, ownloom."
allowed-tools: shell
---

# Managing ownloom Services

This skill replaces the removed `ownloom-svc` binary. Use `systemctl` directly. The allowed-unit policy is enforced at the sudoers layer, not in a wrapper binary.

## Allowed units

Only `ownloom-*` units and `sshd` may be managed without root. For any other unit, ask the user for confirmation before elevating.

## Commands

### Status (no privilege needed)
```bash
systemctl status ownloom-gateway.service --no-pager
systemctl status ownloom-gateway-web.service --no-pager
systemctl status radicale.service --no-pager
systemctl list-units 'ownloom-proactive-task-*' --no-pager
systemctl status sshd.service --no-pager
```

### Start / stop / restart (requires sudo)
```bash
sudo systemctl start  ownloom-gateway.service
sudo systemctl stop   ownloom-gateway.service
sudo systemctl restart ownloom-gateway.service
```

## Workflow

1. Always run `status` first to understand current state.
2. State what you intend to do and why before any `start`/`stop`/`restart`.
3. After a restart, re-run `status` and check logs:
   ```bash
   journalctl -u ownloom-gateway.service -n 50 --no-pager
   ```

## Non-ownloom units

For any unit outside `ownloom-*`/`sshd`, ask the user explicitly before touching it. Prefer `ownloom-context --health` to diagnose before taking action.
