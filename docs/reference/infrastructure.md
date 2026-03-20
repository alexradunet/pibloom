# Infrastructure

> External services and infrastructure

## 🌱 Matrix Infrastructure

### Overview

nixPI runs its own Matrix homeserver through the stock `matrix-synapse.service`. Users register with any Matrix client and message Pi directly. No data leaves the device. No federation - fully private.

### Setup

The Matrix server starts automatically on boot. User accounts are created during the first-boot setup:

1. Pi creates a bot account (`@pi:nixpi`) automatically
2. Pi guides the user to register with their preferred Matrix client
3. User creates a DM with `@pi:nixpi`

### Configuration

| Setting | Value |
|---------|-------|
| Server name | `nixpi` |
| Port | `6167` |
| Registration | token-required |
| Federation | disabled |
| Data directory | `/var/lib/continuwuity/` |
| Registration token | `/var/lib/continuwuity/registration_token` |

### Bridges

External messaging platforms (WhatsApp, Telegram, Signal) connect via mautrix bridge containers. Bridge packaging still exists in the repo catalog, but bridge lifecycle helpers are no longer part of the default nixPI runtime and should be treated as maintainer-only setup.

### Troubleshooting

```bash
# Logs
journalctl -u matrix-synapse -n 100

# Status
systemctl status matrix-synapse

# Restart
sudo systemctl restart matrix-synapse

# Reload (after appservice registration)
sudo systemctl reload matrix-synapse
```

---

## 🌐 NetBird Infrastructure

### Overview

EU-hosted mesh networking for secure remote access to your nixPI device. Uses NetBird cloud management (free tier, up to 5 peers).

NetBird provides the security layer for SSH remote access and the built-in nixPI web surface.

NetBird is installed as a native system service (not a container) because WireGuard requires real kernel-level CAP_NET_ADMIN.

### Setup

NetBird authentication is handled during nixPI's first-boot wizard using a setup key. If you need to re-authenticate:

1. Get a new setup key from https://app.netbird.io -> Setup Keys
2. Run: `sudo netbird up --setup-key <KEY>`
3. Verify: `sudo netbird status`

### Adding Peers

Install NetBird on your other devices (laptop, phone) from https://netbird.io/download and sign in with the same account. All devices on the same account can reach each other.

### Operations

```bash
# Status
sudo netbird status

# Logs
sudo journalctl -u netbird -n 100

# Stop
sudo systemctl stop netbird

# Start
sudo systemctl start netbird
```

---

## 🔗 Related

- [Security Model](./security-model)
- [First Boot Setup](../operations/first-boot-setup)
