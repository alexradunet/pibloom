---
name: signal
version: 0.1.0
description: Signal messaging bridge via signal-cli (containerized)
image: localhost/bloom-signal:latest
---

# Signal Bridge

Bridges Signal messages to Pi via the bloom-channels Unix socket protocol. Uses signal-cli for the Signal protocol.

## Setup

### 1) Build the container image

```bash
cd services/signal
npm install && npm run build
podman build -t bloom-signal:latest .
```

### 2) Configure your Signal account

```bash
mkdir -p ~/.config/bloom
echo "SIGNAL_ACCOUNT=+1234567890" > ~/.config/bloom/signal.env
```

### 3) Install and start

```bash
service_install(name="signal")
systemctl --user start bloom-signal.service
```

### 4) Link to your Signal account

Watch logs for the device linking URI:

```bash
journalctl --user -u bloom-signal -f
```

When you see a `tsdevice://` URI, open Signal on your phone:
Settings > Linked Devices > Link New Device > scan the QR code (or paste the URI).

### 5) Verify

```bash
service_test(name="signal")
```

## Sending Messages

Use the `/signal` command in Pi to send a message:

```
/signal +1234567890 Hello from Bloom!
```

## Service Control

```bash
systemctl --user start bloom-signal.service
systemctl --user status bloom-signal
systemctl --user stop bloom-signal.service
journalctl --user -u bloom-signal -f
```

## Notes

- Signal requires a phone number for registration
- Device linking persists in the `bloom-signal-data` volume
- Media files (images, voice notes) are saved to `/var/lib/bloom/media/`
- Memory usage: ~512MB (Java runtime + Node.js bridge)
- The bridge reconnects automatically if bloom-channels restarts
