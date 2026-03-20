# Service Architecture

> Built-in service surface and web interfaces

## 🌱 Audience

Maintainers and operators deciding how nixPI exposes user-facing services.

## 🌱 Current Model

nixPI no longer ships a separate packaged-service layer. The user-facing service surface is built directly into the base NixOS system.

## 🧩 Built-In Services

The current built-in service set is:

| Service | Port | Purpose |
|---------|------|---------|
| Home | `:8080` | Service directory and status page |
| Web Chat | `:8081` | FluffyChat web Matrix client |
| Matrix | `:6167` | Continuwuity Matrix homeserver |

These are declared as user systemd services in the OS modules and are expected to exist on every nixPI node.

## 📚 Operational Notes

- Home is a minimal status page for the service surface
- FluffyChat is preconfigured for the local nixPI Matrix server
- Use `systemd_control` to inspect and restart these units

## 🔗 Related

- [Daemon Architecture](./daemon-architecture)
- [First Boot Setup](../operations/first-boot-setup)
