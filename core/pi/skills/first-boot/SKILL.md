---
name: first-boot
description: Pi-guided first boot and onboarding for a terminal-first NixPI machine
---

# First-Boot: Terminal-First Onboarding

## Prerequisite

This skill applies while `~/.nixpi/wizard-state/system-ready` does **not** exist.

The browser surface is ttyd, not a separate chat app. The same setup should also work from SSH or a local terminal.

## How This Works

1. If Pi is already responding, do **not** open with generic `/login` or `/model` instructions
2. Only ask for `/login` or `/model` when runtime feedback explicitly says authentication/model state is missing
3. Keep the user in setup mode until onboarding is complete
4. Guide the user through:
   - git identity setup for `/srv/nixpi`
   - default git identity fallback when unset:
     - `git -C /srv/nixpi config user.name "$(id -un)"`
     - `git -C /srv/nixpi config user.email "$(id -un)@$(hostname -s).local"`
   - WireGuard configuration
     - treat WireGuard as `systemd-networkd`-backed
     - prefer checks like `systemctl status systemd-networkd.service`, `systemctl status wireguard-wg0.service`, `networkctl status wg0`, and `wg show wg0`
   - OS security configuration
   - a short NixPI intro/tutorial
5. Only when the full flow is complete should Pi write `~/.nixpi/wizard-state/system-ready`

## Conversation Style

- **Pi leads the setup** — this is a Pi-native onboarding flow
- **One step at a time** — never dump the whole checklist at once
- **Terminal first** — all instructions should make sense in ttyd, SSH, or a local shell
- **Verification over assumption** — check commands and system state before advancing
- **Setup takes priority** until the completion marker exists
