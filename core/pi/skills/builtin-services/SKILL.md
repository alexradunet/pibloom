---
name: builtin-services
description: Reference for NixPI's built-in user-facing services that are always available on every node
---

# Built-In Services

NixPI ships these services as part of the base NixOS system. They are not optional packages and they do not need to be installed from the repo.

## Always Available

- `pi` installed as the primary operator runtime for SSH and local shell sessions

## Operational Notes

- The runtime is prepared by the declarative `nixpi-app-setup.service` unit
- Tailnet-backed access is provided by `tailscaled.service` on enrolled hosts
- `headscale.service` provides the control plane on the designated admin-tailnet host
- Use `systemd_control` for status, restart, and stop/start operations
- It should be treated as a stable base OS capability, not as an optional service package

## Expected Unit Names

- `nixpi-app-setup`
- `tailscaled`
- `headscale`

## Access Paths

Preferred access is over admin-tailnet SSH:

- `ssh <user>@<tailnet-host>`

A local login shell remains valid on the machine itself.
