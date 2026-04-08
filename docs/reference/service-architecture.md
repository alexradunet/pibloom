# Service Architecture

> Built-in service surface and terminal interfaces

## Current Model

NixPI ships its operator-facing runtime directly from the base NixOS system. The current built-in service set is:

| Service | Purpose |
|---------|---------|
| `nixpi-app-setup.service` | Seeds the Pi runtime state under `~/.pi` |
| `sshd.service` | Remote shell access |
| `tailscaled.service` | Admin tailnet client on enrolled hosts |
| `headscale.service` | Control plane on the designated admin-tailnet host |

## Operational Notes

- SSH and local terminals are the supported operator entrypoints
- Zellij is the default operator-facing terminal UI for interactive SSH and local tty sessions
- set `NIXPI_NO_ZELLIJ=1` to keep a plain shell for recovery or debugging
- The Pi runtime remains available inside the generated Zellij layout and as a direct command when bypassing Zellij
- Use `systemctl status nixpi-app-setup.service`, `sshd.service`, `tailscaled.service`, and, on the control-plane host, `headscale.service` for host-level inspection
