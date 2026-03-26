# Stale Docs & Configuration

Documentation, config, and markdown files that reference outdated paths, features,
or structures.

---

## STALE-1: README references nonexistent `core/daemon/` directory

**File:** `README.md:106`

```
| `core/daemon/` | Local Pi runtime, session orchestration, and multi-agent support |
```

This directory was renamed to `core/chat-server/`. The docs file
`docs/codebase/daemon.md:7` acknowledges the move, but the README was not updated.

**Fix:** Change to:
```
| `core/chat-server/` | Local web chat server and session management |
```

---

## STALE-2: Recovery SKILL.md references wrong repo path

**File:** `core/pi/skills/recovery/SKILL.md:47`

```
Wrong repo path: confirm the local clone exists at `~/.nixpi/pi-nixpi`
```

The canonical repo path is `/srv/nixpi` per `filesystem.ts:19`.

**Fix:** Update to `/srv/nixpi`.

---

## STALE-3: Self-evolution SKILL.md references wrong repo path

**File:** `core/pi/skills/self-evolution/SKILL.md:54`

```
**Local repo path**: `~/.nixpi/pi-nixpi`
```

Same issue as STALE-2.

**Fix:** Update to `/srv/nixpi`.

---

## STALE-4: Docs tests.md uses wrong import name

**File:** `docs/codebase/tests.md:144-153`

```ts
import { setupTestEnv } from "../helpers/temp-nixpi";
```

The actual export is `createTempNixPi`, not `setupTestEnv`. Also uses `.ts`
extension instead of `.js` (ESM convention used in the project).

**Fix:** Update to:
```ts
import { createTempNixPi } from "../helpers/temp-nixpi.js";
```

---

## STALE-5: Docs tests.md has incorrect NixOS test lane assignments

**File:** `docs/codebase/tests.md`

Several NixOS tests are listed under wrong lanes compared to `flake.nix`:
- `nixpi-install-wizard` listed as `nixos-destructive` → actually in `nixos-full`
- `smoke-chat` listed as separate in smoke lane → not a direct member of `nixos-smoke`
- Destructive lane membership doesn't match `flake.nix` lines 356-362

**Fix:** Regenerate the test lane table from `flake.nix` definitions.

---

## STALE-6: tests/nixos/README.md has incorrect lane assignments

**File:** `tests/nixos/README.md:16`

Lists `nixpi-chat` as being in `nixos-full` lane. Verify against `flake.nix`
and update.

---

## STALE-7: SKILL.md references unimplemented Podman Quadlet integration

**File:** `core/pi/persona/SKILL.md:35-36`

```
Container management: deploy, status, logs via Podman Quadlet.
```

No Podman Quadlet code exists in the codebase. This describes an aspirational
feature.

**Fix:** Remove or mark as "planned" with a note.

---

## STALE-8: SKILL.md references dynamic service discovery

**File:** `core/pi/persona/SKILL.md:28-30`

```
Services discovered from ~/nixpi/Skills/ at session start.
Interaction via HTTP APIs and bash, guided by service skill files.
```

No dynamic service discovery from `Skills/` is implemented.

**Fix:** Remove or mark as "planned".

---

## STALE-9: `.claude/settings.local.json` has stale paths

**File:** `.claude/settings.local.json`

All permitted Bash commands reference `/home/alex/pi-bloom/`, which appears to
be an old project name. The project is now `NixPI` / `pi-platform`.

**Fix:** Update all paths to match the current project layout.

---

## STALE-10: `AGENTS.md` hardcodes developer-specific path

**File:** `AGENTS.md`

```
Canonical repo: /home/alex/nixpi
```

This is the developer's local machine path. While intended for agents on that
machine, it's committed to the repo.

**Fix:** Either reference the constant (`/srv/nixpi`) or add a note that this
applies to the developer's specific machine.

---

## STALE-11: Copyright year in VitePress config

**File:** `docs/.vitepress/config.ts:115`

```ts
copyright: "Copyright 2024-present NixPI contributors"
```

Not technically stale yet, but a manual date that will need updating. Consider
using a dynamic year or removing the start year.
