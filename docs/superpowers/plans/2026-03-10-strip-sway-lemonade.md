# Strip Sway + Lemonade Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Sway display stack and Lemonade LLM server from the base OS, making Bloom an SSH-first system where Pi handles its own onboarding natively.

**Architecture:** Delete ~14 files (display extension, lemonade service, systemd units, OS scripts). Edit ~26 files (Containerfile, bash profile, nginx, setup extension, setup lib, skills, docs, tests). Keep Chromium for headless browsing, nginx for future service routing, SSH as primary access.

**Tech Stack:** Fedora bootc Containerfile, bash, systemd, nginx, TypeScript (extensions/lib), Vitest (tests), Markdown (skills/docs)

---

## Chunk 1: OS Layer Cleanup

### Task 1: Delete Sway/Display OS Files

**Files:**
- Delete: `os/sysconfig/bloom-sway.service`
- Delete: `os/sysconfig/bloom-wayvnc.service`
- Delete: `os/sysconfig/bloom-novnc.service`
- Delete: `os/sysconfig/bloom-display.target`
- Delete: `os/sysconfig/bloom-novnc.xml`
- Delete: `os/sysconfig/sway-config`
- Delete: `os/scripts/detect-display.sh`
- Delete: `os/scripts/start-sway.sh`
- Delete: `os/scripts/ui-tree.py`

- [ ] **Step 1: Delete all 9 files**

```bash
rm os/sysconfig/bloom-sway.service \
   os/sysconfig/bloom-wayvnc.service \
   os/sysconfig/bloom-novnc.service \
   os/sysconfig/bloom-display.target \
   os/sysconfig/bloom-novnc.xml \
   os/sysconfig/sway-config \
   os/scripts/detect-display.sh \
   os/scripts/start-sway.sh \
   os/scripts/ui-tree.py
```

- [ ] **Step 2: Verify deletions**

```bash
ls os/sysconfig/bloom-sway.service 2>&1  # Should say "No such file"
ls os/scripts/detect-display.sh 2>&1     # Should say "No such file"
```

- [ ] **Step 3: Commit**

```bash
git add -u os/sysconfig/ os/scripts/
git commit -m "remove: Sway display stack OS files (units, configs, scripts)"
```

---

### Task 2: Strip Containerfile

**Files:**
- Modify: `os/Containerfile`

The Containerfile needs these removals:
1. Wayland packages from the dnf install block (line 31-41): `sway wayvnc novnc python3-websockify wlrctl grim slurp wl-clipboard foot at-spi2-core python3-pyatspi`
2. The `chmod +x ui-tree.py` line (line 94): `RUN chmod +x /usr/local/share/bloom/os/scripts/ui-tree.py`
3. The entire display stack COPY block (lines 104-114):
   ```
   # Display stack: Sway Wayland compositor + wayvnc + noVNC for AI computer use + remote desktop
   COPY os/sysconfig/sway-config /etc/bloom/sway-config
   COPY os/scripts/detect-display.sh /usr/local/share/bloom/os/scripts/detect-display.sh
   COPY os/scripts/start-sway.sh /usr/local/share/bloom/os/scripts/start-sway.sh
   RUN chmod +x /usr/local/share/bloom/os/scripts/detect-display.sh /usr/local/share/bloom/os/scripts/start-sway.sh
   COPY os/sysconfig/bloom-sway.service /usr/lib/systemd/system/bloom-sway.service
   COPY os/sysconfig/bloom-wayvnc.service /usr/lib/systemd/system/bloom-wayvnc.service
   COPY os/sysconfig/bloom-novnc.service /usr/lib/systemd/system/bloom-novnc.service
   COPY os/sysconfig/bloom-display.target /usr/lib/systemd/system/bloom-display.target
   COPY os/sysconfig/bloom-novnc.xml /etc/firewalld/services/bloom-novnc.xml
   RUN systemctl enable bloom-display.target
   ```
4. The lemonade pre-deploy block (lines 125-129):
   ```
   # Pre-deploy lemonade (local AI) quadlet so it auto-starts on first login
   # Other services are installed via setup wizard, but lemonade is required for Pi itself
   RUN mkdir -p /etc/skel/.config/containers/systemd
   COPY services/lemonade/quadlet/bloom-lemonade.container /etc/skel/.config/containers/systemd/bloom-lemonade.container
   COPY os/sysconfig/bloom.network /etc/skel/.config/containers/systemd/bloom.network
   ```

- [ ] **Step 1: Remove Wayland packages from dnf install**

Remove these packages from the `dnf install -y \` block:
```
    sway \
    wayvnc \
    novnc \
    python3-websockify \
    wlrctl \
    grim \
    slurp \
    wl-clipboard \
    foot \
    at-spi2-core \
    python3-pyatspi \
```

Keep `chromium \` (stays for headless browsing).

- [ ] **Step 2: Remove ui-tree.py chmod line**

Delete line 94:
```
RUN chmod +x /usr/local/share/bloom/os/scripts/ui-tree.py
```

- [ ] **Step 3: Remove display stack COPY block**

Delete the entire block from `# Display stack:` through `RUN systemctl enable bloom-display.target` (lines 104-114).

- [ ] **Step 4: Remove lemonade pre-deploy block**

Delete the entire block from `# Pre-deploy lemonade` through the `COPY os/sysconfig/bloom.network` line (lines 125-129).

- [ ] **Step 5: Verify Containerfile is valid**

```bash
grep -n "sway\|wayvnc\|novnc\|websockify\|wlrctl\|grim\|slurp\|wl-clipboard\|foot\|at-spi2\|pyatspi\|lemonade\|ui-tree\|display\.target\|detect-display\|start-sway" os/Containerfile
# Should return nothing
```

- [ ] **Step 6: Commit**

```bash
git add os/Containerfile
git commit -m "remove: Sway packages, display units, and lemonade pre-deploy from Containerfile"
```

---

### Task 3: Simplify bash_profile

**Files:**
- Modify: `os/sysconfig/bloom-bash_profile`

The entire file currently has Sway tty1 detection (lines 4-11) and LLM wait logic (lines 21-65). After simplification, the file should be:

```bash
# Source .bashrc for env vars (BLOOM_DIR, PATH, etc.)
[ -f ~/.bashrc ] && . ~/.bashrc

# Start Pi on interactive login (only one instance — atomic mkdir lock)
if [ -t 0 ] && [ -z "$PI_SESSION" ] && mkdir /tmp/.bloom-pi-session 2>/dev/null; then
  trap 'rmdir /tmp/.bloom-pi-session 2>/dev/null' EXIT
  export PI_SESSION=1
  /usr/local/bin/bloom-greeting.sh
  exec pi
fi
```

- [ ] **Step 1: Rewrite bloom-bash_profile**

Replace the entire file with the simplified version above.

- [ ] **Step 2: Commit**

```bash
git add os/sysconfig/bloom-bash_profile
git commit -m "simplify: bash_profile — remove Sway detection and LLM wait logic"
```

---

### Task 4: Clean up bloom-bashrc

**Files:**
- Modify: `os/sysconfig/bloom-bashrc`

Remove the `WAYLAND_DISPLAY` export, the `SWAYSOCK` detection block, and simplify `BROWSER`. After edit:

```bash
export BLOOM_DIR="$HOME/Bloom"
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export BROWSER="chromium"
export PATH="/usr/local/share/bloom/node_modules/.bin:$PATH"
```

- [ ] **Step 1: Rewrite bloom-bashrc**

Replace with the simplified version above.

- [ ] **Step 2: Commit**

```bash
git add os/sysconfig/bloom-bashrc
git commit -m "simplify: bashrc — remove Wayland/Sway env vars"
```

---

### Task 5: Remove lemonade nginx route

**Files:**
- Modify: `os/sysconfig/bloom-nginx.conf`

Delete the entire lemonade server block (lines 43-64):
```nginx
# lemonade-server — unified local AI (LLM, STT, TTS, Image Gen)
server {
    listen 80;
    server_name ai.pibloom.netbird.cloud;
    ...
}
```

- [ ] **Step 1: Remove lemonade server block from nginx config**

Delete lines 43-64 (the `# lemonade-server` comment through the closing `}`).

- [ ] **Step 2: Verify**

```bash
grep -n "lemonade\|ai\.pibloom" os/sysconfig/bloom-nginx.conf
# Should return nothing
```

- [ ] **Step 3: Commit**

```bash
git add os/sysconfig/bloom-nginx.conf
git commit -m "remove: lemonade nginx proxy route"
```

---

### Task 6: Update justfile comment

**Files:**
- Modify: `justfile`

- [ ] **Step 1: Update vm target comment**

Change line 44 from:
```
# Boot qcow2 in QEMU with graphical display (Sway desktop, SSH on :2222)
```
to:
```
# Boot qcow2 in QEMU with graphical display (SSH on :2222)
```

- [ ] **Step 2: Commit**

```bash
git add justfile
git commit -m "docs: remove Sway reference from justfile vm comment"
```

---

## Chunk 2: TypeScript Code Cleanup

### Task 7: Delete bloom-display extension + tests

**Files:**
- Delete: `extensions/bloom-display/index.ts`
- Delete: `extensions/bloom-display/actions.ts`
- Delete: `extensions/bloom-display/types.ts`
- Delete: `tests/extensions/bloom-display.test.ts`

- [ ] **Step 1: Delete the extension directory and its test**

```bash
rm -r extensions/bloom-display/
rm tests/extensions/bloom-display.test.ts
```

- [ ] **Step 2: Verify build still compiles**

```bash
npm run build
```

Expected: Success (no other file imports from bloom-display).

- [ ] **Step 3: Run tests**

```bash
npm run test
```

Expected: All pass (bloom-display tests are gone, no other tests depend on them).

- [ ] **Step 4: Commit**

```bash
git add -u extensions/bloom-display/ tests/extensions/bloom-display.test.ts
git commit -m "remove: bloom-display extension and tests"
```

---

### Task 8: Delete lemonade lib + service + tests

**Files:**
- Delete: `lib/lemonade.ts`
- Delete: `tests/lib/lemonade.test.ts`
- Delete: `services/lemonade/SKILL.md`
- Delete: `services/lemonade/quadlet/bloom-lemonade.container`
- Delete: `services/lemonade/quadlet/bloom-lemonade-data.volume`

- [ ] **Step 1: Delete lemonade files**

```bash
rm lib/lemonade.ts
rm tests/lib/lemonade.test.ts
rm -r services/lemonade/
```

- [ ] **Step 2: Check for remaining imports of lemonade**

```bash
grep -r "lemonade" lib/ extensions/ --include="*.ts" -l
```

Expected: No results (lemonade.ts was only imported by its own test).

- [ ] **Step 3: Commit**

```bash
git add -u lib/lemonade.ts tests/lib/lemonade.test.ts services/lemonade/
git commit -m "remove: lemonade service package, lib, and tests"
```

---

### Task 9: Update service catalog

**Files:**
- Modify: `services/catalog.yaml`

- [ ] **Step 1: Remove lemonade entry and update element depends**

Remove the entire `lemonade:` block (lines 4-10). Change `element`'s `depends: [matrix, lemonade]` to `depends: [matrix]`.

After edit, catalog.yaml should be:
```yaml
version: 1
source_repo: https://github.com/pibloom/pi-bloom
services:
  matrix:
    version: "0.1.0"
    category: communication
    image: forgejo.ellis.link/continuwuation/continuwuity:0.5.0-rc.6
    optional: false
    preflight:
      commands: [podman, systemctl]
  element:
    version: "0.1.0"
    category: communication
    image: localhost/bloom-element:latest
    optional: false
    depends: [matrix]
    preflight:
      commands: [podman, systemctl]
  dufs:
    version: "0.1.0"
    category: sync
    image: docker.io/sigoden/dufs:v0.38.0
    optional: false
    preflight:
      commands: [podman, systemctl]
  code-server:
    version: "0.1.0"
    category: development
    image: localhost/bloom-code-server:latest
    optional: true
    preflight:
      commands: [podman, systemctl]
```

- [ ] **Step 2: Commit**

```bash
git add services/catalog.yaml
git commit -m "remove: lemonade from service catalog, update element depends"
```

---

### Task 10: Update bloom-setup extension

**Files:**
- Modify: `extensions/bloom-setup/index.ts`
- Modify: `extensions/bloom-setup/step-guidance.ts`
- Modify: `lib/setup.ts`

- [ ] **Step 1: Remove lemonade provider registration from index.ts**

Delete lines 20-36: the comment `// Register local AI provider...` (line 20) and the entire `pi.registerProvider("bloom-local", { ... })` block (lines 21-36).

- [ ] **Step 2: Remove local_ai and llm_upgrade from STEP_ORDER in lib/setup.ts**

Remove `"llm_upgrade"` (position 5, between `"connectivity"` and `"webdav"`) and `"local_ai"` (position 8, between `"channels"` and `"git_identity"`) from the array. These are at two non-contiguous positions. Result:
```typescript
export const STEP_ORDER = [
	"welcome",
	"network",
	"netbird",
	"connectivity",
	"webdav",
	"channels",
	"git_identity",
	"contributing",
	"persona",
	"test_message",
	"complete",
] as const;
```

- [ ] **Step 3: Remove local_ai and llm_upgrade entries from STEP_GUIDANCE in step-guidance.ts**

Delete the `local_ai:` entry (line 22) and the `llm_upgrade:` entry (lines 23-24).

- [ ] **Step 4: Verify build compiles**

```bash
npm run build
```

- [ ] **Step 5: Run tests**

```bash
npm run test
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add extensions/bloom-setup/index.ts extensions/bloom-setup/step-guidance.ts lib/setup.ts
git commit -m "remove: lemonade provider and LLM setup steps from bloom-setup"
```

---

### Task 11: Update service tests

**Files:**
- Modify: `tests/lib/services.test.ts`
- Modify: `tests/extensions/bloom-services.test.ts`

- [ ] **Step 1: Update services.test.ts catalog test**

In the test `"loads catalog with depends and models fields"` (line 168), rename the test to `"loads catalog with depends fields"` and update the test data to remove lemonade. Replace the test data:

```typescript
writeFileSync(
	join(catalogDir, "catalog.yaml"),
	[
		"services:",
		"  element:",
		"    version: '0.1.0'",
		"    category: communication",
		"    image: localhost/bloom-element:latest",
		"    depends: [matrix]",
		"  matrix:",
		"    version: '0.1.0'",
		"    category: communication",
		"    image: forgejo.ellis.link/continuwuation/continuwuity:0.5.0-rc.6",
	].join("\n"),
);
const catalog = loadServiceCatalog(tempDir);
expect(catalog.element.depends).toEqual(["matrix"]);
expect(catalog.matrix).toBeDefined();
expect(catalog.matrix.version).toBe("0.1.0");
```

- [ ] **Step 2: Update bloom-services.test.ts**

The test at line 35 uses `"ghcr.io/bloom/lemonade:latest"` as example image text. Change to a generic example:

```typescript
fs.writeFileSync(filePath, "---\nimage: ghcr.io/bloom/matrix:latest\n---\n\n# Matrix\n");
const result = extractSkillMetadata(filePath);
expect(result.image).toBe("ghcr.io/bloom/matrix:latest");
```

- [ ] **Step 3: Run tests**

```bash
npm run test
```

Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add tests/lib/services.test.ts tests/extensions/bloom-services.test.ts
git commit -m "update: remove lemonade references from service tests"
```

---

## Chunk 3: Skills and Documentation

### Task 12: Update skills

**Files:**
- Modify: `skills/first-boot/SKILL.md`
- Modify: `skills/service-management/SKILL.md`
- Modify: `skills/os-operations/SKILL.md`
- Modify: `skills/recovery/SKILL.md`
- Modify: `skills/self-evolution/SKILL.md`
- Modify: `persona/SKILL.md`

For each file, search for and remove references to:
- `lemonade` / `lemonade-server`
- `sway` / `wayvnc` / `noVNC` / display stack
- `bloom-display` extension
- Port `8000` (when associated with lemonade)
- `Qwen3-4B` / local LLM first-boot behavior
- `bloom-local` provider

- [ ] **Step 1: Edit each skill file**

Read each file, identify lemonade/sway/display references, and remove or update them. Key changes:

- `skills/first-boot/SKILL.md`: Remove LLM wait steps, local model download references, `bloom-local` provider. Keep the setup wizard flow but without LLM-specific steps.
- `skills/service-management/SKILL.md`: Remove ALL lemonade references: service table row, `services/lemonade/quadlet/` reference example (~line 51), lemonade YAML snippet in Versioning section (~lines 123-127), and Known Services table row (~line 142). Update port listings.
- `skills/os-operations/SKILL.md`: Remove display service references from health checks.
- `skills/recovery/SKILL.md`: Remove `bloom-lemonade-data` volume debugging guidance.
- `skills/self-evolution/SKILL.md`: Remove lemonade port 8000 row from Port Allocation table (~line 149) and `services/lemonade/quadlet/` reference (~line 178). If the Port Allocation table becomes empty, remove the entire section or replace with a note that ports are allocated per-service at install time.
- `persona/SKILL.md`: Remove lemonade capability references (transcription, image gen via lemonade).

- [ ] **Step 2: Commit**

```bash
git add skills/ persona/SKILL.md
git commit -m "docs: remove Sway and lemonade references from skills and persona"
```

---

### Task 13: Update project documentation

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `docs/service-architecture.md`
- Modify: `services/README.md`
- Modify: `docs/pibloom-setup.md`
- Modify: `docs/conventions/config.md`
- Modify: `docs/conventions/general.md`

For each file, search for and remove/update references to:
- `bloom-display` extension/section/tools
- `lemonade` / `lemonade-server` / `bloom-lemonade`
- `bloom-local` provider
- Port `8000` (when lemonade-associated)
- Sway / wayvnc / noVNC display stack
- `lemonade.ts` in lib listings

Key changes per file:

- `AGENTS.md`: Remove `bloom-display` section header + tool table row, `bloom-local` provider reference, `bloom-lemonade` service table row, `lemonade.ts` lib table row.
- `README.md`: Remove lemonade from services table, remove Sway/wayvnc/noVNC from desktop stack description.
- `ARCHITECTURE.md`: Remove `lemonade.ts` from lib/ tree listing.
- `docs/service-architecture.md`: Update dependency graph to remove lemonade node.
- `services/README.md`: Replace `services/lemonade/quadlet/` reference example with `services/dufs/quadlet/` or `services/matrix/quadlet/`.
- `docs/pibloom-setup.md`: Update/remove lemonade `manifest_set_service` examples.
- `docs/conventions/config.md`: Update lemonade catalog YAML snippet example (use matrix or dufs instead).
- `docs/conventions/general.md`: Replace `bloom-lemonade.container` naming example with `bloom-matrix.container` or `bloom-dufs.container`.

- [ ] **Step 1: Edit each documentation file**

Read each file, make the targeted changes described above.

- [ ] **Step 2: Verify no stale references remain**

```bash
grep -rl "lemonade\|bloom-display\|bloom-local\|wayvnc\|novnc\|sway-config\|bloom-sway\|bloom-wayvnc\|bloom-novnc" \
  AGENTS.md README.md ARCHITECTURE.md docs/ services/README.md
```

Expected: No results.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md README.md ARCHITECTURE.md docs/ services/README.md
git commit -m "docs: remove all Sway and lemonade references from project docs"
```

---

### Task 14: Final verification

- [ ] **Step 1: Full build**

```bash
npm run build
```

Expected: Success.

- [ ] **Step 2: Full test suite**

```bash
npm run test
```

Expected: All pass.

- [ ] **Step 3: Lint check**

```bash
npm run check
```

Expected: No errors.

- [ ] **Step 4: Grep for any remaining references**

```bash
grep -rl "lemonade\|bloom-display\|bloom-local\|wayvnc\|novnc\|bloom-sway\|bloom-wayvnc\|bloom-novnc\|sway-config\|detect-display\|start-sway\|ui-tree\.py" \
  --include="*.ts" --include="*.md" --include="*.yaml" --include="*.conf" --include="*.service" --include="*.target" --include="*.xml" \
  . justfile | grep -v node_modules | grep -v docs/superpowers/
```

Expected: No results (superpowers specs/plans excluded since they document the change itself).

- [ ] **Step 5: Commit any final fixes if needed**
