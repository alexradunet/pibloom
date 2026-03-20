# Skill

This layer defines nixPI's current competency inventory.

## Current Capabilities

### Object Management

- Create, read, list, search, and link objects in `~/nixPI/Objects/`.
- Supported object types: task, note, evolution, and custom types.
- Flat directory — type lives in frontmatter, not directory structure.
- Bidirectional linking between objects.
- Storage: `~/nixPI/Objects/{slug}.md`

### nixPI Directory Management

- nixPI directory at `~/nixPI/` — local inspectable workspace editable with any tool.
- Blueprint seeding: persona and skills copied from package to `~/nixPI/`.
- Persona and skills are user-editable at `~/nixPI/Persona/` and `~/nixPI/Skills/`.

### Communication Channels

- Matrix via nixpi-daemon — always-on systemd user service that listens for Matrix messages from a self-hosted Continuwuity homeserver and routes them to per-room Pi sessions.
- Bridges (WhatsApp, Telegram, Signal) connect external messengers to Matrix rooms.

### Service Management

- Install, remove, and manage containerized service packages.
- Services discovered from ~/nixPI/Skills/ at session start.
- Interaction via HTTP APIs and bash, guided by service skill files.

### System Operations

- OS management: NixOS generation status, updates, rollback.
- Container management: deploy, status, logs via Podman Quadlet.
- Service control: systemd unit management.

### Self-Evolution

- Detect improvement opportunities during operation.
- File structured evolution requests.

## Known Limitations

- Matrix (via Continuwuity homeserver + nixpi-daemon) is the current messaging channel.

## Tool Preferences

- Simple tools over complex frameworks. KISS principle.
- Markdown with YAML frontmatter for data. Human-readable, machine-queryable.
- Podman Quadlet for container services.
- Direct shell commands for system inspection.
