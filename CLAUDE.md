# CLAUDE.md

## Project

Bloom — Pi-native OS platform on Fedora bootc. Pi IS the product. Bloom is the OS concept — a Fedora bootc image that makes Pi a first-class citizen with extensions teaching it about its host.
The bloom word comes from the concept that you "plant" your mini-pc and then in time it grows and blooms with you.

## Architecture

Bloom extends Pi through three mechanisms, lightest first: **Skill → Extension → Service**.

- **Pi package**: Extensions + skills bundled as a Pi package (`pi install ./`)
- **Extensions**: `extensions/` — 9 TypeScript Pi extensions (bloom-persona, bloom-audit, bloom-os, bloom-services, bloom-objects, bloom-journal, bloom-garden, bloom-channels, bloom-topics)
- **Shared lib**: `lib/shared.ts` — utilities used across extensions (parseFrontmatter, stringifyFrontmatter, getGardenDir, createLogger, PARA_DIRS, truncate, errorResult, nowIso)
- **Skills**: `skills/` — 6 Pi skill markdown files (first-boot, os-operations, object-store, service-management, self-evolution, recovery)
- **Services**: `services/` — OCI-packaged containers (whisper, whatsapp, tailscale, syncthing). Metadata in `services/catalog.yaml`
- **Persona**: `persona/` — OpenPersona 4-layer identity (SOUL.md, BODY.md, FACULTY.md, SKILL.md) — seeded to Garden on first run
- **Guardrails**: `guardrails.yaml` — bash patterns blocked by bloom-persona (rm -rf, mkfs, dd, fork bombs, eval, pipe-to-shell, force-push, etc.)
- **Garden vault**: `~/Garden/` — PARA-organized user content (Inbox, Projects, Areas, Resources, Archive), synced via Syncthing. Env override: `BLOOM_GARDEN_DIR`
- **Bloom system**: `~/Garden/Bloom/` — shareable persona, skills, evolutions (synced)
- **Pi state**: `~/.pi/` — internal agent state, sessions, settings (NOT synced)
- **OS image**: `os/Containerfile` — Fedora bootc 42

## Key Paths

| Path | Purpose | Synced |
|------|---------|--------|
| `~/Garden/` | User vault (PARA structure) | Yes (Syncthing) |
| `~/Garden/Bloom/Persona/` | Active persona files | Yes |
| `~/Garden/Bloom/Skills/` | Installed skills | Yes |
| `~/Garden/Bloom/Evolutions/` | Proposed persona changes | Yes |
| `~/Garden/Journal/{YYYY}/{MM}/` | Daily journal files | Yes |
| `~/.pi/` | Pi agent state, sessions | No |
| `~/.pi/bloom-context.json` | Compaction context persistence | No |
| `~/.config/containers/systemd/` | Quadlet container units | No |
| `/run/bloom/channels.sock` | Channel bridge Unix socket | No |

## Build and Test

```bash
npm install                    # install dev deps
npm run build                  # tsc --build
npm run check                  # biome lint + format check
npm run check:fix              # biome auto-fix
npm run test                   # vitest run
npm run test:watch             # vitest watch mode
npm run test:coverage          # vitest with v8 coverage (80% threshold)
```

### OS Image Build & VM Testing

Requires: `sudo dnf install just qemu-system-x86 edk2-ovmf`

```bash
just build                     # podman build container image
just qcow2                     # generate qcow2 disk image (BIB)
just iso                       # generate anaconda-iso installer (BIB)
just vm                        # boot qcow2 in QEMU (graphical + SSH :2222)
just vm-serial                 # boot qcow2 serial-only (no GUI)
just vm-ssh                    # ssh -p 2222 bloom@localhost
just vm-kill                   # stop running VM
just clean                     # remove os/output/
just push-ghcr                 # push image to GHCR
just svc-push {name}           # push service package to GHCR
just svc-install {name}        # install service locally (testing)
```

## Conventions

- **TypeScript**: strict, ES2022, NodeNext
- **Formatting**: Biome (tabs, double quotes, 120 line width)
- **Extensions**: `export default function(pi: ExtensionAPI) { ... }` pattern
- **Skills**: SKILL.md with frontmatter (name, description)
- **Containers**: `Containerfile` (not Dockerfile), `podman` (not docker)
- **Services**: Quadlet units named `bloom-{name}`, isolated `bloom.network`, health checks required
- **Objects**: Markdown files with YAML frontmatter, PARA-organized in Garden vault

## Documentation Workflow

When changing code:
1. TDD — Write failing test first
2. Implement — Make it pass
3. JSDoc — Update/add JSDoc on changed exports
4. Docs — If change affects tools, hooks, or architecture, update the relevant doc
5. Links — If adding a new doc, add cross-references from related docs

Canonical locations: tool/hook reference → `AGENTS.md`, architecture → `docs/service-architecture.md`, emoji legend → `docs/LEGEND.md`

## Do Not

- Add eslint, prettier, or formatting tools besides Biome
- Use `Dockerfile` naming — always `Containerfile`
- Use `docker` CLI — always `podman`
- Import from pi SDK at runtime — use `peerDependencies` only
