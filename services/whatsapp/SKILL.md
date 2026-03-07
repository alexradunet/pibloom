---
name: whatsapp
version: 0.2.0
description: WhatsApp messaging bridge via whatsapp-web.js — visible browser on Sway desktop
image: ghcr.io/pibloom/bloom-whatsapp:0.2.0
---

# WhatsApp Bridge

Connects WhatsApp to Bloom via the channel protocol (Unix socket at `$XDG_RUNTIME_DIR/bloom/channels.sock`). Uses whatsapp-web.js to run WhatsApp Web in a visible Chromium window on the Sway desktop.

The browser window is a normal Sway window — tiled, minimizable, and movable. You can watch Pi interact with WhatsApp in real time.

## Setup

1. Install the service package
2. Start the service: `systemctl --user start bloom-whatsapp`
3. A Chromium window opens on the Sway desktop showing WhatsApp Web
4. Scan the QR code with WhatsApp mobile app
5. Verify: `systemctl --user status bloom-whatsapp`

## Sending Messages

Use the `/wa` command in Pi to send outbound WhatsApp messages.

## Troubleshooting

- **Won't start**: Check logs: `journalctl --user -u bloom-whatsapp -n 100`
- **No browser window**: Verify Wayland socket exists: `ls /run/user/$(id -u)/wayland-1`
- **Connection lost**: Restart: `systemctl --user restart bloom-whatsapp`
- **Auth expired**: Remove auth volume and re-scan QR:
  ```bash
  systemctl --user stop bloom-whatsapp
  podman volume rm bloom-whatsapp-auth
  systemctl --user start bloom-whatsapp
  ```

## Media Support

The bridge downloads audio, image, and video messages to `/var/lib/bloom/media/`.
Media metadata is forwarded to Pi via the channel protocol with file paths.
Pi can use installed services (e.g., Lemonade) to process media files.
