# Service Architecture

> 📖 [Emoji Legend](LEGEND.md)

Audience: maintainers and operators deciding how Garden exposes user-facing services.

## 🌱 Current Model

Garden no longer ships a separate packaged-service layer. The user-facing service surface is built directly into the base NixOS system.

## 🧩 Built-In Services

The current built-in service set is:

- `Garden Home` on `:8080`
- `Garden Web Chat` on `:8081`
- `Garden Files` on `:5000`
- `code-server` on `:8443`

These are declared as user systemd services in the OS modules and are expected to exist on every Garden node.

## 📚 Operational Notes

- Garden Home is the landing page for the service surface
- FluffyChat is preconfigured for the local Garden Matrix server
- dufs exposes `~/Public/Garden`
- code-server is always available as the browser IDE
- use `systemd_control` to inspect and restart these units

## 🔗 Related

- [../README.md](../README.md)
- [../AGENTS.md](../AGENTS.md)
- [pibloom-setup.md](pibloom-setup.md)
