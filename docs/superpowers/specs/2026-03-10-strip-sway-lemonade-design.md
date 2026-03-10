# Strip Sway + Lemonade from Base OS

**Date:** 2026-03-10
**Status:** Approved

## Problem

Sway (Wayland display stack) and Lemonade (local LLM server) add unnecessary complexity to the base OS image. Both cause recurring issues (launch races, context overflow, memory tuning) and aren't needed by default. Users who want a desktop or local LLM should install them on-demand through Pi.

## Design

### Philosophy

The base OS is SSH-first. Pi handles its own onboarding natively. If users want a desktop interface or local LLM, they ask Pi to install one via quadlets.

### What Gets Removed

**Sway / Wayland display stack:**
- Packages: sway, wayvnc, novnc, python3-websockify, wlrctl, grim, slurp, wl-clipboard, foot, at-spi2-core, python3-pyatspi
- Extension: `extensions/bloom-display/` (entire directory)
- Systemd units: bloom-sway.service, bloom-wayvnc.service, bloom-novnc.service, bloom-display.target
- Scripts: detect-display.sh, start-sway.sh, ui-tree.py
- Config: sway-config
- bash_profile: Sway detection and tty1 exec logic

**Lemonade / local LLM:**
- Service package: `services/lemonade/` (entire directory)
- Library: `lib/lemonade.ts`
- Tests: `tests/lib/lemonade.test.ts`
- Containerfile: pre-deploy of lemonade quadlet to `/etc/skel/.config/containers/systemd/`
- nginx: `ai.*` proxy route from bloom-nginx.conf
- bash_profile: LLM health wait loop and model download logic
- bloom-setup: lemonade provider registration, local_ai step, llm_upgrade guidance
- catalog.yaml: lemonade entry removal, element dependency on lemonade removal

### What Stays

- **Chromium** — kept for headless browsing (`chromium --headless`), Pi can browse the web without a display server
- **SSH** (openssh-server) — primary access method, also supports VS Code Remote
- **nginx** — reverse proxy infrastructure; Pi can add routes when users install web-facing services
- **NetBird** — VPN tunnel
- **tmux** — terminal multiplexer
- **dufs** — file sync via WebDAV
- **matrix + element** — communication services
- **code-server** — optional in catalog
- All non-display extensions (bloom-setup, bloom-services, bloom-persona, bloom-channels, bloom-objects, bloom-context)

### First Boot Changes

**Before:** SSH in → wait 120s for lemonade → wait 600s for model download → Pi starts with local LLM → setup wizard with LLM steps

**After:** SSH in → Pi starts immediately → Pi's native onboarding handles provider selection

### bash_profile Simplification

Remove:
- Sway detection on tty1 (`/dev/dri` check, `exec sway`)
- LLM health wait loop (`curl lemonade health`)
- Model download wait loop
- Local LLM provider fallback logic

Keep:
- Pi session lock (atomic mkdir)
- Greeting script
- Pi launch

### nginx Changes

Remove `ai.pibloom.netbird.cloud` upstream and server block. Keep `files.pibloom.netbird.cloud` for dufs.

### Files Affected

**Delete entirely (~14 files):**
- `extensions/bloom-display/` (index.ts, actions.ts, types.ts)
- `tests/extensions/bloom-display.test.ts`
- `services/lemonade/` (SKILL.md, quadlet/bloom-lemonade.container, quadlet/bloom-lemonade-data.volume)
- `lib/lemonade.ts`
- `tests/lib/lemonade.test.ts`
- `os/sysconfig/bloom-sway.service`
- `os/sysconfig/bloom-wayvnc.service`
- `os/sysconfig/bloom-novnc.service`
- `os/sysconfig/bloom-display.target`
- `os/sysconfig/bloom-novnc.xml` (firewalld service definition)
- `os/sysconfig/sway-config`
- `os/scripts/detect-display.sh`
- `os/scripts/start-sway.sh`
- `os/scripts/ui-tree.py`

**Edit (~24 files):**
- `os/Containerfile` — remove Wayland packages, lemonade pre-deploy, display unit installs
- `os/sysconfig/bloom-bash_profile` — remove Sway detection + LLM wait logic
- `os/sysconfig/bloom-bashrc` — remove WAYLAND_DISPLAY export, SWAYSOCK detection, simplify BROWSER var
- `os/sysconfig/bloom-nginx.conf` — remove lemonade upstream/route
- `services/catalog.yaml` — remove lemonade entry, update element dependencies
- `extensions/bloom-setup/index.ts` — remove lemonade provider registration
- `extensions/bloom-setup/step-guidance.ts` — remove local_ai + llm_upgrade guidance
- `skills/first-boot/SKILL.md` — remove LLM wait + local model references
- `skills/service-management/SKILL.md` — remove lemonade service docs
- `skills/os-operations/SKILL.md` — remove display service references
- `skills/recovery/SKILL.md` — remove lemonade debugging references
- `skills/self-evolution/SKILL.md` — remove lemonade port/path references
- `persona/SKILL.md` — remove lemonade capability references
- `docs/service-architecture.md` — update dependency graph
- `tests/lib/services.test.ts` — update catalog expectations
- `tests/extensions/bloom-services.test.ts` — update service metadata expectations
- `AGENTS.md` — remove bloom-display section, bloom-local provider, lemonade service/lib entries
- `README.md` — remove lemonade from services table, Sway from desktop stack description
- `ARCHITECTURE.md` — remove lemonade.ts from lib tree listing
- `services/README.md` — replace lemonade references with another service example
- `docs/pibloom-setup.md` — update lemonade examples
- `docs/conventions/config.md` — update lemonade catalog example
- `docs/conventions/general.md` — replace bloom-lemonade naming example
- `justfile` — update vm target comment
