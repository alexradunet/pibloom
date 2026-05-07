---
name: nixpi-reboot
description: "Schedule a delayed system reboot on the NixPI host. Use only after explicit user confirmation. Keywords: reboot, restart, shutdown, system."
allowed-tools: shell
---

# Scheduling a NixPI Reboot

This skill replaces the removed `nixpi-reboot` binary. Always get explicit user confirmation before rebooting.

## Steps

1. **Confirm with the user** — state the delay and ask for a yes/no.
2. **Log a wiki note** (optional but recommended for significant reboots):
   ```bash
   nixpi-wiki daily append --bullets "Scheduled reboot in <N> minutes — reason: <reason>"
   ```
3. **Schedule the reboot** (requires sudo):
   ```bash
   sudo shutdown -r +<minutes>
   ```
   - Minimum: 1 minute (gives running services time to flush).
   - Maximum: use judgment; prefer ≤ 60 minutes for operational reboots.
4. **Notify the user** of the scheduled time.

## Cancelling

```bash
sudo shutdown -c
```

## Safety rules

- Never use `shutdown -r now` without an explicit "right now" from the user.
- Never reboot mid-`nixos-rebuild switch` — wait for it to complete.
- If unsure, check the system state with `nixpi-health` first.
