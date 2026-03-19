---
name: matrix
version: 0.1.0
description: Continuwuity Matrix homeserver (native OS service, no federation)
---

# Matrix Homeserver

Native Continuwuity Matrix server baked into the Garden OS image.

## Overview

Garden runs its own Matrix homeserver as a native systemd service (`garden-matrix.service`). Users register with any Matrix client and message Pi directly. No data leaves the device. No federation - fully private.

## Setup

The Matrix server starts automatically on boot. User accounts are created during the first-boot setup:

1. Pi creates a bot account (`@pi:garden`) automatically
2. Pi guides the user to register with their preferred Matrix client
3. User creates a DM with `@pi:garden`

## Configuration

- Server name: `garden`
- Port: `6167`
- Registration: token-required (see `/var/lib/continuwuity/registration_token`)
- Federation: disabled
- Data: `/var/lib/continuwuity/`

## Bridges

External messaging platforms (WhatsApp, Telegram, Signal) connect via mautrix bridge containers. Bridge packaging still exists in the repo catalog, but bridge lifecycle helpers are no longer part of the default Garden runtime and should be treated as maintainer-only setup.

## Troubleshooting

- Logs: `journalctl -u garden-matrix -n 100`
- Status: `systemctl status garden-matrix`
- Restart: `sudo systemctl restart garden-matrix`
- Reload (after appservice registration): `sudo systemctl reload garden-matrix`
