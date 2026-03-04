# AGENTS.md

## Bloom — Pi-Native OS Platform

Bloom is a Pi package that turns a Fedora bootc machine into a personal AI companion host. Pi IS the product; Bloom teaches Pi about its OS.

## Extensions

| Extension | Purpose | LOC |
|-----------|---------|-----|
| `bloom-persona` | Identity injection, safety guardrails, compaction guidance | ~84 |
| `bloom-os` | bootc, Podman, systemd management tools | ~238 |
| `bloom-memory` | Flat-file object store (YAML frontmatter + Markdown) | ~648 |
| `bloom-garden` | Garden vault initialization, blueprint seeding and updates | ~214 |
| `bloom-channels` | Channel bridge socket server, topic management | ~320 |

## Skills

| Skill | Purpose |
|-------|---------|
| `os-operations` | System health inspection and remediation |
| `bridge-management` | Messaging bridge setup and troubleshooting |
| `object-store` | CRUD operations for the memory store |
| `self-evolution` | Structured system change workflow |

## Persona

OpenPersona 4-layer identity in `persona/`:
- `SOUL.md` — Identity, values, voice, boundaries
- `BODY.md` — Channel adaptation, presence behavior
- `FACULTY.md` — Reasoning patterns, PARA methodology
- `SKILL.md` — Current capabilities, tool preferences

## Install

```bash
pi install /path/to/bloom
```

Or for development:
```bash
pi -e ./extensions/bloom-persona.ts -e ./extensions/bloom-os.ts -e ./extensions/bloom-memory.ts -e ./extensions/bloom-garden.ts -e ./extensions/bloom-channels.ts
```
