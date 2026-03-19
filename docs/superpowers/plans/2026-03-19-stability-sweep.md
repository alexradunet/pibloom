# Stability Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sweep the Bloom OS codebase subsystem-by-subsystem to remove Bash/Nix workarounds, eliminate TypeScript defensive code, and raise test coverage to enforced thresholds — without adding features or restructuring the daemon.

**Architecture:** Subsystem order (fewest deps → most): Tooling → Scripts → Nix → core/lib → core/daemon → Extensions (7, in spec order) → Tests/CI. Each subsystem passes the full stability gate before moving to the next. Gate: `npm run build && npm run check && npm run test:ci`.

**Tech Stack:** TypeScript 5.7, Vitest 4.x, Biome v2 (target; currently package.json pins v1.9.4 but biome.json already references v2 schema), TypeBox 0.34, Node 22, NixOS/Nix, Bash

**Spec:** `docs/superpowers/specs/2026-03-19-stability-sweep-design.md`

**Test helpers (know these before editing any test file):**
- `createMockExtensionAPI()` → `tests/helpers/mock-extension-api.ts` — mock Pi extension API
- `createTempGarden()` → `tests/helpers/temp-garden.ts` — creates a temp dir, **automatically sets `process.env.BLOOM_DIR`**, field is `gardenDir`. Call `cleanup()` in afterEach.
- `createMockExtensionContext()` → `tests/helpers/mock-extension-context.ts` — mock extension context. By default `ui.confirm` resolves to `true`. No options needed to get default confirm-true behavior.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | Bump `@biomejs/biome` to v2 stable |
| `biome.json` | Modify | Enable `noFloatingPromises` in correct v2 group |
| `vitest.config.ts` | Modify | Add `clearMocks`, `restoreMocks`; raise thresholds |
| `core/scripts/bloom-wizard.sh` | Audit/modify | Remove dead guards/duplicates if found |
| `core/scripts/bloom-firstboot.sh` | Audit/modify | Verify fallback comment accuracy |
| `core/scripts/bloom-lib.sh` | Audit | Verify no unreachable functions |
| `core/scripts/run-qemu.sh` | Audit | Confirm clean |
| `core/os/modules/bloom-update.nix` | Modify | Remove Cachix TODO placeholder (lines 7-10) |
| `flake.nix` | Audit | Verify outputs list is clean |
| `core/lib/*.ts` | Audit/modify | Remove `as unknown as`, unsafe casts at fs boundaries |
| `core/daemon/*.ts` | Audit/modify | Remove silent error swallowing only |
| `core/pi-extensions/bloom-setup/` | Modify | Extract param schemas; add tests |
| `core/pi-extensions/bloom-localai/` | Audit | Confirm coverage at threshold |
| `core/pi-extensions/bloom-os/` | Modify | Extract param schemas; add action tests |
| `core/pi-extensions/bloom-garden/` | Modify | Extract param schemas; add command tests |
| `core/pi-extensions/bloom-episodes/` | Modify | Extract param schemas; add action tests |
| `core/pi-extensions/bloom-objects/` | Modify | Extract param schemas; add action tests |
| `core/pi-extensions/bloom-persona/` | Audit/modify | Check for defensive casts |
| `tests/extensions/bloom-setup.test.ts` | Modify | Add action-level tests |
| `tests/extensions/bloom-localai.test.ts` | Audit | Confirm at threshold |
| `tests/extensions/bloom-os.test.ts` | Modify | Add action tests (mock `run`) |
| `tests/extensions/bloom-os-update.test.ts` | Audit/modify | Review and add missing action tests |
| `tests/extensions/bloom-os-proposal.test.ts` | Audit/modify | Review and add missing action tests |
| `tests/extensions/bloom-garden.test.ts` | Modify | Add command handler tests |
| `tests/extensions/bloom-episodes.test.ts` | Modify | Add action tests |
| `tests/extensions/bloom-objects.test.ts` | Modify | Add action tests |
| `tests/e2e/operator-journey.test.ts` | Create | Real operator e2e test |
| `.github/workflows/nixos-tests.yml` | Modify | Make bloom-boot + bloom-daemon non-skippable |

---

## Task 1: Align Biome to v2 and enable `noFloatingPromises`

**Files:**
- Modify: `package.json:34`
- Modify: `biome.json`

`biome.json` already references schema `2.4.7` but `package.json` still pins `@biomejs/biome: ^1.9.4`. The first step is to align them.

### Step 1.1 — Find the current Biome v2 stable version

- [ ] Run:
  ```bash
  npm info @biomejs/biome version
  ```
  Note the version printed (e.g. `2.4.7`).

### Step 1.2 — Update `package.json`

- [ ] In `package.json` line 34, change:
  ```json
  "@biomejs/biome": "^1.9.4"
  ```
  to:
  ```json
  "@biomejs/biome": "^2.0.0"
  ```

- [ ] Run:
  ```bash
  npm install
  ```
  Expected: installs Biome 2.x. Verify with `npx biome --version` — should print `2.x.x`.

### Step 1.3 — Auto-fix any format drift from v2 defaults

- [ ] Run:
  ```bash
  npm run check:fix
  ```
  Review the diff. Revert any changes that alter runtime behaviour (only formatting changes are safe to keep).

### Step 1.4 — Find the correct group for `noFloatingPromises` in the installed v2

- [ ] Run:
  ```bash
  npx biome explain noFloatingPromises 2>/dev/null || echo "not found"
  ```
  If the output includes a group path (e.g. `correctness/noFloatingPromises`), use that group. If `not found`, check the Biome v2 changelog or run `npx biome lint --help` to find it. **Do not proceed to Step 1.5 until the group is confirmed.**

### Step 1.5 — Enable `noFloatingPromises` in `biome.json`

Add the rule under the group confirmed in Step 1.4. If the group is `correctness`:

```json
"correctness": {
  "noUnusedVariables": "error",
  "noUnusedImports": "error",
  "noFloatingPromises": "error"
}
```

- [ ] Add the rule to `biome.json`

### Step 1.6 — Run check and fix any violations

- [ ] Run:
  ```bash
  npm run check
  ```
  For each `noFloatingPromises` violation: add `void` prefix for intentionally fire-and-forget calls; add `await` where the result is needed.

### Step 1.7 — Full stability gate

- [ ] Run:
  ```bash
  npm run build && npm run check && npm run test:ci
  ```
  Expected: passes.

### Step 1.8 — Commit

- [ ] Run:
  ```bash
  git add package.json package-lock.json biome.json
  git commit -m "chore(tooling): upgrade Biome to v2, enable noFloatingPromises"
  ```

---

## Task 2: Raise Vitest coverage thresholds and add global mock settings

**Files:**
- Modify: `vitest.config.ts`

Current thresholds are conservative floors (daemon: 40%, lib: 60%, extensions: 30%) that don't reflect actual observed coverage (daemon ~83%, lib ~81%). This task enforces realistic thresholds. Extensions tasks (Tasks 7–13) will raise actual coverage to meet the new threshold; the threshold is set now to make failures visible.

### Step 2.1 — Capture current actual coverage baseline

- [ ] Run:
  ```bash
  npm run test:coverage 2>&1 | grep -E "^\|" | grep -E "(daemon|lib|pi-extensions)" | head -30
  ```
  Record the actual % per file group. Note which extensions are already below 60% — if many are, temporarily set the extensions threshold to match the highest value that currently passes. Raise it to 60% after Task 13.

### Step 2.2 — Update `vitest.config.ts`

Replace the entire file content with:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts"],
		environment: "node",
		clearMocks: true,
		restoreMocks: true,
		coverage: {
			provider: "v8",
			reporter: ["text", "json-summary", "lcov"],
			reportsDirectory: "coverage",
			include: ["core/daemon/**/*.ts", "core/lib/**/*.ts", "core/pi-extensions/**/*.ts"],
			thresholds: {
				"core/daemon/**/*.ts": { lines: 85, functions: 80, branches: 75, statements: 85 },
				"core/lib/**/*.ts": { lines: 85, functions: 85, branches: 70, statements: 85 },
				"core/pi-extensions/**/*.ts": { lines: 60, functions: 60, branches: 50, statements: 60 },
			},
		},
	},
});
```

- [ ] Update `vitest.config.ts`

### Step 2.3 — Run coverage to confirm threshold enforcement

- [ ] Run:
  ```bash
  npm run test:coverage
  ```
  Some thresholds will fail — that is expected. The failures reveal which subsystems still need test work. The build should not be broken; only coverage thresholds fail at this stage.

### Step 2.4 — Commit

- [ ] Run:
  ```bash
  git add vitest.config.ts
  git commit -m "chore(test): raise coverage thresholds, add clearMocks/restoreMocks"
  ```

---

## Task 3: Audit and clean `core/scripts`

**Files:**
- Audit/modify: `core/scripts/bloom-wizard.sh`, `bloom-firstboot.sh`, `bloom-lib.sh`, `run-qemu.sh`, `bloom-update.sh`, `bloom-greeting.sh`

### Step 3.1 — Syntax-check all scripts

- [ ] Run:
  ```bash
  for f in core/scripts/*.sh; do bash -n "$f" && echo "OK: $f" || echo "FAIL: $f"; done
  ```
  Expected: all print `OK`. Fix any syntax errors before continuing.

### Step 3.2 — Audit bloom-wizard.sh

- [ ] Read `core/scripts/bloom-wizard.sh` fully. Check for:
  - Guard variables like `if [[ -z "$SOME_SOURCING_VAR" ]]` preventing double-execution — remove if found (the old `BLOOM_FIRSTBOOT_SOURCING` pattern was removed; it must not have returned)
  - Functions defined but never called from `main()` — remove if found
  - Logic duplicated in `bloom-lib.sh` — remove from wizard, use lib version

### Step 3.3 — Audit bloom-firstboot.sh

- [ ] Read `core/scripts/bloom-firstboot.sh` lines 31-41. The `$(dirname "$0")/bloom-lib.sh` probe is documented as always falling through at runtime (firstboot runs from the Nix source tree). Confirm the comment accurately explains this. If the comment is absent or misleading, fix it. The probe itself stays for pattern consistency.

- [ ] Confirm `write_fluffychat_runtime_config` (called at line 91) is defined in `bloom-lib.sh`. If not defined anywhere, this is a missing function — investigate and fix.

### Step 3.4 — Audit bloom-lib.sh for unreachable functions

- [ ] Run:
  ```bash
  grep -n "^[a-z_]*() {" core/scripts/bloom-lib.sh
  ```
  List all defined functions. Cross-check each one is called from either `bloom-wizard.sh` or `bloom-firstboot.sh`. Remove any that are unreachable dead code.

### Step 3.5 — Audit run-qemu.sh and bloom-update.sh

- [ ] Scan for guard patterns or dead branches. No changes expected. If clean, note "no changes required."

### Step 3.6 — Re-syntax-check all scripts

- [ ] Run:
  ```bash
  for f in core/scripts/*.sh; do bash -n "$f" && echo "OK: $f" || echo "FAIL: $f"; done
  ```
  Expected: all `OK`.

### Step 3.7 — Commit if any changes were made

- [ ] If any files changed:
  ```bash
  git add core/scripts/
  git commit -m "chore(scripts): remove dead code from bash scripts"
  ```

---

## Task 4: Clean `core/os` Nix files

**Files:**
- Modify: `core/os/modules/bloom-update.nix:7-10`
- Audit: `flake.nix`

### Step 4.1 — Remove the Cachix TODO placeholder

Lines 7-10 of `core/os/modules/bloom-update.nix`:
```nix
# Cachix substituter (pre-built closures; avoids on-device compilation during updates)
# TODO: replace <cachix-url> and <cachix-pubkey> with real Cachix cache values
# nix.settings.substituters = [ "https://cache.nixos.org" "<cachix-url>" ];
# nix.settings.trusted-public-keys = [ "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY=" "<cachix-pubkey>" ];
```

Delete all four lines entirely.

- [ ] Delete lines 7-10 from `core/os/modules/bloom-update.nix`

### Step 4.2 — Audit flake.nix for dead outputs

- [ ] Run:
  ```bash
  nix eval .#packages.x86_64-linux --apply builtins.attrNames --no-write-lock-file
  ```
  Expected: `[ "bloom-app" "iso" "qcow2" "raw" ]`. If `iso-gui` or other unexpected outputs appear, remove them from `flake.nix`.

### Step 4.3 — Verify NixOS config evaluates cleanly

- [ ] Run:
  ```bash
  nix eval .#nixosConfigurations.bloom-x86_64.config.system.stateVersion --no-write-lock-file
  just check-config
  ```
  Expected: both pass.

### Step 4.4 — Commit

- [ ] Run:
  ```bash
  git add core/os/modules/bloom-update.nix
  git commit -m "chore(nix): remove Cachix TODO placeholder"
  ```

---

## Task 5: Audit and clean `core/lib`

**Files:**
- Audit/modify: all `.ts` files under `core/lib/`

The lib is at ~81% actual coverage with a 60% floor threshold. Goal: raise floor to 85% enforcement; remove defensive patterns.

### Step 5.1 — Audit each lib file for defensive patterns

Read each file and check for:
- `as unknown as X` casts (TypeScript escape hatch hiding a type mismatch)
- `// @ts-ignore` or `// @ts-expect-error`
- Null checks on values TypeScript strict mode already guarantees non-null
- Helpers that only exist because a caller had the wrong type

Files to audit (note which need changes):
- `core/lib/exec.ts` — the `catch` pattern is **correct design** (never-throws API); the `as { code?: ... }` cast is a legitimate Node.js error shape cast. Do NOT change.
- `core/lib/filesystem.ts` — path utilities
- `core/lib/matrix.ts` — Matrix credentials
- `core/lib/shared.ts` — logger, `errorResult`, `guardBloom`
- `core/lib/extension-tools.ts` — thin wrapper; likely clean
- `core/lib/fs-utils.ts` — filesystem wrappers
- `core/lib/interactions.ts` — dialog helpers
- `core/lib/matrix-format.ts` — formatting utils
- `core/lib/frontmatter.ts` — YAML frontmatter parse
- `core/lib/setup.ts` — setup state file reader (see Step 5.2)
- `core/lib/room-alias.ts`, `core/lib/git.ts`

### Step 5.2 — Fix setup.ts: structured error at filesystem parse boundary

If `core/lib/setup.ts` reads a JSON state file and uses a bare `as SetupState` cast without validation, replace it with TypeBox `Value.Parse` wrapped in a typed catch:

```typescript
import { Value } from "@sinclair/typebox/value"
// (import SetupStateSchema from wherever it is defined or define it inline)

let state: Static<typeof SetupStateSchema>
try {
  state = Value.Parse(SetupStateSchema, JSON.parse(rawContent))
} catch (e) {
  return { error: `setup state corrupt or incompatible: ${e instanceof Error ? e.message : String(e)}` }
}
```

- [ ] Audit `core/lib/setup.ts` and apply if needed

### Step 5.3 — Full stability gate

- [ ] Run:
  ```bash
  npm run build && npm run check && npm run test:ci
  ```
  Expected: passes.

### Step 5.4 — Commit if any changes were made

- [ ] Run:
  ```bash
  git add core/lib/
  git commit -m "refactor(lib): remove defensive casts, structured error at fs boundaries"
  ```

---

## Task 6: Audit `core/daemon` for silent error swallowing

**Files:**
- Audit/modify: all `.ts` files under `core/daemon/`

The daemon is at ~83% actual coverage. Raise threshold enforcement to 85%; remove silent catches.

### Step 6.1 — Audit for silent catch blocks

- [ ] Run:
  ```bash
  grep -n "catch" core/daemon/*.ts
  ```
  For each catch block: does it log and silently return nothing (swallowing the error), or does it propagate? Fix the swallowing ones:

  ```typescript
  // BEFORE (silent swallow):
  try {
    await doSomething()
  } catch (e) {
    logger.error("failed", e)
    // returns undefined — caller gets nothing
  }

  // AFTER:
  try {
    await doSomething()
  } catch (e) {
    logger.error("failed", e)
    throw e  // or return { error: String(e) } if caller expects a result type
  }
  ```

  Do not change catches that correctly handle expected error conditions (e.g. "not found" is a valid state).

### Step 6.2 — Full stability gate

- [ ] Run:
  ```bash
  npm run build && npm run check && npm run test:ci
  ```
  Expected: passes.

### Step 6.3 — Check actual daemon coverage meets threshold

- [ ] Run:
  ```bash
  npm run test:coverage 2>&1 | grep "core/daemon"
  ```
  Confirm statements/lines ≥ 85%.

### Step 6.4 — Commit if any changes were made

- [ ] Run:
  ```bash
  git add core/daemon/
  git commit -m "refactor(daemon): remove silent error swallowing in event handlers"
  ```

---

## Task 7: bloom-setup — add action tests

**Files:**
- Audit/modify: `core/pi-extensions/bloom-setup/index.ts`, `core/pi-extensions/bloom-setup/actions.ts`
- Modify: `tests/extensions/bloom-setup.test.ts`

### Step 7.1 — Audit for Value.Check patterns and unsafe casts

- [ ] Read `core/pi-extensions/bloom-setup/actions.ts` and `index.ts`. Check for:
  - `Value.Check(T, x)` + manual guard → replace with `Value.Parse(T, x)` at tool input boundaries
  - `params as { ... }` unsafe casts → replace with `params as Static<typeof ParamsSchema>` where `ParamsSchema` is extracted as a named const before `defineTool`

- [ ] Make any replacements found. Pattern for extracting named param schemas:

```typescript
import { type Static, Type } from "@sinclair/typebox"

const SetupAdvanceParams = Type.Object({
  step: Type.String({ description: "..." }),
})

// In defineTool:
parameters: SetupAdvanceParams,
async execute(_id, params, ...) {
  const p = params as Static<typeof SetupAdvanceParams>
  return handleSetupAdvance(p.step)
},
```

### Step 7.2 — Read current test file

- [ ] Read `tests/extensions/bloom-setup.test.ts`. Identify which action handlers are already tested.

### Step 7.3 — Add missing action tests

`createTempGarden()` automatically sets `BLOOM_DIR` and provides `gardenDir`. Use it:

```typescript
// Add this to tests/extensions/bloom-setup.test.ts
// (do not duplicate existing imports — add only what is missing)
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createTempGarden, type TempGarden } from "../helpers/temp-garden.js"

describe("setup actions", () => {
  let temp: TempGarden

  beforeEach(() => {
    temp = createTempGarden()
    // BLOOM_DIR is already set by createTempGarden()
  })

  afterEach(() => {
    temp.cleanup()
  })

  it("setup_status returns current state when no steps are done", async () => {
    const { handleSetupStatus } = await import("../../core/pi-extensions/bloom-setup/actions.js")
    const result = await handleSetupStatus()
    expect(result).toHaveProperty("content")
    expect(result.content[0]).toHaveProperty("type", "text")
  })

  it("setup_advance marks a step done", async () => {
    const { handleSetupAdvance } = await import("../../core/pi-extensions/bloom-setup/actions.js")
    // Read the actual handleSetupAdvance signature before calling — it requires
    // both a valid StepName and a result field (e.g. { step: "persona", result: "completed" }).
    // Adjust the call below to match the real signature.
    const result = await handleSetupAdvance({ step: "persona", result: "completed" } as never)
    expect(result.isError).toBeFalsy()
  })

  it("setup_reset clears state", async () => {
    const { handleSetupReset } = await import("../../core/pi-extensions/bloom-setup/actions.js")
    // handleSetupReset takes an optional params object — pass {} even if all fields are optional.
    const result = await handleSetupReset({})
    expect(result).toHaveProperty("content")
  })
})
```

Adjust function names to match the actual exports from `actions.ts` after reading it in Step 7.2.

### Step 7.4 — Run tests

- [ ] Run:
  ```bash
  npx vitest run tests/extensions/bloom-setup.test.ts
  ```
  Expected: all tests pass.

### Step 7.5 — Coverage check

- [ ] Run:
  ```bash
  npm run test:coverage 2>&1 | grep "bloom-setup"
  ```
  Confirm ≥ 60% statements.

### Step 7.6 — Full stability gate

- [ ] Run:
  ```bash
  npm run build && npm run check && npm run test:ci
  ```

### Step 7.7 — Commit

- [ ] Run:
  ```bash
  git add core/pi-extensions/bloom-setup/ tests/extensions/bloom-setup.test.ts
  git commit -m "test(bloom-setup): add action tests; extract typed param schemas"
  ```

---

## Task 8: bloom-localai — confirm coverage

**Files:**
- Audit: `core/pi-extensions/bloom-localai/index.ts`
- Audit: `tests/extensions/bloom-localai.test.ts`

### Step 8.1 — Check current coverage

- [ ] Run:
  ```bash
  npm run test:coverage 2>&1 | grep "bloom-localai"
  ```

### Step 8.2 — If coverage ≥ 60%, audit for unsafe casts only

- [ ] Read `core/pi-extensions/bloom-localai/index.ts`. If there are `params as { ... }` casts, replace with `as Static<typeof ParamsSchema>`. If the file is tiny and has no such patterns, note "no changes required."

### Step 8.3 — If coverage < 60%, add a registration + behaviour test

bloom-localai registers a LocalAI provider. Add a test that calls the registration function and asserts the provider was registered with the expected name/config.

### Step 8.4 — Commit if changes were made

- [ ] Run:
  ```bash
  git add core/pi-extensions/bloom-localai/ tests/extensions/bloom-localai.test.ts
  git commit -m "test(bloom-localai): confirm coverage at threshold"
  ```

---

## Task 9: bloom-os — add action tests and extract typed param schemas

**Files:**
- Modify: `core/pi-extensions/bloom-os/index.ts`
- Modify: `core/pi-extensions/bloom-os/actions.ts`
- Modify: `tests/extensions/bloom-os.test.ts`
- Modify: `tests/extensions/bloom-os-update.test.ts`
- Audit/modify: `tests/extensions/bloom-os-proposal.test.ts`

bloom-os is the lowest-coverage extension (~10%). The `execute` functions use `params as { action: ... }` casts (type-unsafe); `actions.ts` calls system commands that need mocking in tests.

### Step 9.1 — Extract parameter schema constants in `index.ts`

For each tool in `bloom-os/index.ts`, extract the inline `Type.Object({...})` parameter definition to a named const before `defineTool`, then replace the unsafe execute cast:

```typescript
import { type Static, Type } from "@sinclair/typebox"

// Extract before the tool array:
const NixosUpdateParams = Type.Object({
  action: StringEnum(["status", "apply", "rollback"] as const, { description: "..." }),
  source: StringEnum(["remote", "local"] as const, { description: "...", default: "remote" }),
})

// In defineTool:
parameters: NixosUpdateParams,
async execute(_toolCallId, params, signal, _onUpdate, ctx) {
  const p = params as Static<typeof NixosUpdateParams>
  return handleNixosUpdate(p.action, p.source ?? "remote", signal, ctx)
},
```

Do the same for `SystemdControlParams`, `NixConfigProposalParams`, etc.

- [ ] Extract all 6 tool parameter schemas to named consts
- [ ] Replace all `params as { ... }` casts with `params as Static<typeof XxxParams>`

### Step 9.2 — Check for Value.Check patterns in actions.ts

- [ ] Read `core/pi-extensions/bloom-os/actions.ts`. If any `Value.Check(T, x)` + manual guard exists, replace with `Value.Parse(T, x)` (bare throw — tool inputs are a trust boundary where throws are correct).

### Step 9.3 — Add action tests to bloom-os.test.ts

The `run` function from `core/lib/exec.ts` makes real system calls. Mock it.

Add these blocks **after the existing test blocks** in `tests/extensions/bloom-os.test.ts` (do not duplicate the existing imports or `beforeEach`/`afterEach`):

```typescript
import { vi } from "vitest"
import { createMockExtensionContext } from "../helpers/mock-extension-context.js"

vi.mock("../../core/lib/exec.js", () => ({
  run: vi.fn(),
}))

import * as execModule from "../../core/lib/exec.js"
import { handleNixosUpdate, handleSystemdControl, handleUpdateStatus } from "../../core/pi-extensions/bloom-os/actions.js"

const mockRun = vi.mocked(execModule.run)

describe("handleNixosUpdate — status", () => {
  it("returns generation list on exit 0", async () => {
    mockRun.mockResolvedValueOnce({ stdout: "gen1\ngen2", stderr: "", exitCode: 0 })
    const result = await handleNixosUpdate("status", "remote", undefined, {} as never)
    expect(result.content[0].text).toContain("gen1")
  })

  it("returns stderr on non-zero exit", async () => {
    mockRun.mockResolvedValueOnce({ stdout: "", stderr: "permission denied", exitCode: 1 })
    const result = await handleNixosUpdate("status", "remote", undefined, {} as never)
    expect(result.content[0].text).toContain("permission denied")
  })
})

describe("handleNixosUpdate — rollback", () => {
  it("returns success message on exit 0", async () => {
    const ctx = createMockExtensionContext()
    mockRun.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
    const result = await handleNixosUpdate("rollback", "remote", undefined, ctx as never)
    expect(result.content[0].text).toContain("Rolled back")
  })
})

describe("handleNixosUpdate — apply local (missing repo)", () => {
  it("returns error when local repo is absent", async () => {
    const ctx = createMockExtensionContext()
    // Force BLOOM_REPO_DIR to a non-existent path so existsSync returns false
    const prev = process.env.BLOOM_REPO_DIR
    process.env.BLOOM_REPO_DIR = "/tmp/bloom-repo-does-not-exist-12345"
    const result = await handleNixosUpdate("apply", "local", undefined, ctx as never)
    // Restore correctly: assigning undefined to process.env sets it to the string "undefined"
    if (prev === undefined) {
      delete process.env.BLOOM_REPO_DIR
    } else {
      process.env.BLOOM_REPO_DIR = prev
    }
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("Local Bloom repo not found")
  })
})

describe("handleSystemdControl", () => {
  it("rejects non-bloom services", async () => {
    const ctx = createMockExtensionContext()
    const result = await handleSystemdControl("sshd", "status", undefined, ctx as never)
    expect(result.isError).toBe(true)
  })

  it("runs systemctl for bloom-dufs status", async () => {
    mockRun.mockResolvedValueOnce({ stdout: "active", stderr: "", exitCode: 0 })
    const ctx = createMockExtensionContext()
    const result = await handleSystemdControl("bloom-dufs", "status", undefined, ctx as never)
    expect(result.content[0].text).toContain("active")
  })
})

describe("handleUpdateStatus", () => {
  it("returns a defined text result (file absent case)", async () => {
    const result = await handleUpdateStatus()
    expect(result.content[0].text).toBeDefined()
  })
})
```

**Important:** The `vi.mock` call must be at the top-level of the test file (outside any `describe`). If `vi.mock` is already imported in the file, do not add it again.

### Step 9.4 — Read and extend bloom-os-update.test.ts

- [ ] Read `tests/extensions/bloom-os-update.test.ts`. Identify which update-related action paths are already tested. Add tests for any uncovered happy/error paths using the same `vi.mock("../../core/lib/exec.js", ...)` pattern.

### Step 9.5 — Read and extend bloom-os-proposal.test.ts

- [ ] Read `tests/extensions/bloom-os-proposal.test.ts`. Check for coverage of `handleNixConfigProposal`. Add tests for `status`, `validate`, and `update_flake_lock` actions by mocking `run`.

### Step 9.6 — Run tests

- [ ] Run:
  ```bash
  npx vitest run tests/extensions/bloom-os.test.ts tests/extensions/bloom-os-update.test.ts tests/extensions/bloom-os-proposal.test.ts
  ```
  Expected: all pass.

### Step 9.7 — Coverage check

- [ ] Run:
  ```bash
  npm run test:coverage 2>&1 | grep "bloom-os"
  ```
  Confirm ≥ 60% statements.

### Step 9.8 — Full stability gate

- [ ] Run:
  ```bash
  npm run build && npm run check && npm run test:ci
  ```

### Step 9.9 — Commit

- [ ] Run:
  ```bash
  git add core/pi-extensions/bloom-os/ tests/extensions/bloom-os.test.ts tests/extensions/bloom-os-update.test.ts tests/extensions/bloom-os-proposal.test.ts
  git commit -m "test(bloom-os): add action tests; extract typed param schemas"
  ```

---

## Task 10: bloom-garden — add command handler tests

**Files:**
- Audit/modify: `core/pi-extensions/bloom-garden/index.ts`, `core/pi-extensions/bloom-garden/actions.ts`
- Modify: `tests/extensions/bloom-garden.test.ts`

### Step 10.1 — Audit for Value.Check patterns and unsafe casts

- [ ] Read `core/pi-extensions/bloom-garden/index.ts` and `actions.ts`. Replace any `Value.Check(T, x)` + manual guard with `Value.Parse(T, x)` at tool input boundaries. Extract param schemas to named consts and replace `params as { ... }` casts.

### Step 10.2 — Read current test file

- [ ] Read `tests/extensions/bloom-garden.test.ts`. Identify tested vs. untested paths. bloom-garden exposes `garden_status` tool and a `/bloom` command with subcommands (`init`, `status`, `update-blueprints`).

### Step 10.3 — Add tool execute and command handler tests

`createTempGarden()` already sets `BLOOM_DIR`. Add these blocks after existing tests:

```typescript
describe("garden_status tool execute", () => {
  let temp: TempGarden

  beforeEach(() => {
    temp = createTempGarden()
    // BLOOM_DIR is set automatically
  })

  afterEach(() => {
    temp.cleanup()
  })

  it("returns a status result when bloom dir exists", async () => {
    const tool = api._registeredTools.find(t => t.name === "garden_status")!
    expect(tool).toBeDefined()
    const result = await tool.execute("id", {}, undefined, () => {}, {} as never)
    expect(result).toHaveProperty("content")
    expect(result.content[0]).toHaveProperty("type", "text")
  })
})

describe("/bloom status command", () => {
  it("returns a status string", async () => {
    const temp = createTempGarden()
    const cmd = api._registeredCommands.find(c => c.name === "bloom")!
    expect(cmd).toBeDefined()
    // Commands use cmd.handler(...), not cmd.execute(...)
    // Adjust argument shape to match the actual handler signature read in Step 10.2
    const result = await cmd.handler({ args: "status" } as never, {} as never)
    expect(result).toBeDefined()
    temp.cleanup()
  })
})
```

Adjust based on the actual command handler signature read in Step 10.2.

### Step 10.4 — Run tests and check coverage

- [ ] Run:
  ```bash
  npx vitest run tests/extensions/bloom-garden.test.ts
  npm run test:coverage 2>&1 | grep "bloom-garden"
  ```
  Expected: tests pass; ≥ 60% statements.

### Step 10.5 — Full stability gate

- [ ] Run:
  ```bash
  npm run build && npm run check && npm run test:ci
  ```

### Step 10.6 — Commit

- [ ] Run:
  ```bash
  git add core/pi-extensions/bloom-garden/ tests/extensions/bloom-garden.test.ts
  git commit -m "test(bloom-garden): add tool execute and command handler tests"
  ```

---

## Task 11: bloom-episodes — add action tests

**Files:**
- Audit/modify: `core/pi-extensions/bloom-episodes/index.ts`, `core/pi-extensions/bloom-episodes/actions.ts`
- Modify: `tests/extensions/bloom-episodes.test.ts`

### Step 11.1 — Audit for Value.Check patterns and unsafe casts

- [ ] Read `core/pi-extensions/bloom-episodes/index.ts` and `actions.ts`. Apply the same audit: `Value.Check → Value.Parse`, `params as { ... } → params as Static<typeof XxxParams>`.

### Step 11.2 — Read current test file

- [ ] Read `tests/extensions/bloom-episodes.test.ts`. Note which action handlers are already tested.

### Step 11.3 — Add action tests

Episodes write to `BLOOM_DIR`. `createTempGarden()` sets it:

```typescript
describe("episode actions", () => {
  let temp: TempGarden

  beforeEach(() => { temp = createTempGarden() })
  afterEach(() => { temp.cleanup() })

  it("episode_create creates an episode and returns success", async () => {
    const { handleEpisodeCreate } = await import("../../core/pi-extensions/bloom-episodes/actions.js")
    const result = await handleEpisodeCreate({ title: "Test Episode", content: "body text", tags: [] })
    expect(result.isError).toBeFalsy()
    expect(result.content[0].text).toBeDefined()
  })

  it("episode_list returns a list (empty garden)", async () => {
    const { handleEpisodeList } = await import("../../core/pi-extensions/bloom-episodes/actions.js")
    const result = await handleEpisodeList({})
    expect(result).toHaveProperty("content")
  })
})
```

Adjust function names and argument shapes to match actual exports from `actions.ts`.

### Step 11.4 — Run tests and check coverage

- [ ] Run:
  ```bash
  npx vitest run tests/extensions/bloom-episodes.test.ts
  npm run test:coverage 2>&1 | grep "bloom-episodes"
  ```
  Expected: tests pass; ≥ 60% statements.

### Step 11.5 — Full stability gate

- [ ] Run:
  ```bash
  npm run build && npm run check && npm run test:ci
  ```

### Step 11.6 — Commit

- [ ] Run:
  ```bash
  git add core/pi-extensions/bloom-episodes/ tests/extensions/bloom-episodes.test.ts
  git commit -m "test(bloom-episodes): add episode action tests; extract typed param schemas"
  ```

---

## Task 12: bloom-objects — add action tests

**Files:**
- Audit/modify: `core/pi-extensions/bloom-objects/index.ts`, `core/pi-extensions/bloom-objects/actions.ts`
- Modify: `tests/extensions/bloom-objects.test.ts`

### Step 12.1 — Audit for Value.Check patterns and unsafe casts

- [ ] Read source files. Apply the same audit pattern.

### Step 12.2 — Read current test file

- [ ] Read `tests/extensions/bloom-objects.test.ts`. Note which object store operations are already tested.

### Step 12.3 — Add CRUD tests

```typescript
describe("object store CRUD", () => {
  let temp: TempGarden

  beforeEach(() => { temp = createTempGarden() })
  afterEach(() => { temp.cleanup() })

  it("memory_create writes an object and returns success", async () => {
    const { handleMemoryCreate } = await import("../../core/pi-extensions/bloom-objects/actions.js")
    const result = await handleMemoryCreate({ title: "Test Note", content: "some content", type: "note" })
    expect(result.isError).toBeFalsy()
  })

  it("memory_read returns content after create", async () => {
    const { handleMemoryCreate, handleMemoryRead } = await import("../../core/pi-extensions/bloom-objects/actions.js")
    await handleMemoryCreate({ title: "Read Test", content: "hello", type: "note" })
    const result = await handleMemoryRead({ title: "Read Test" })
    expect(result.content[0].text).toContain("hello")
  })

  it("memory_list returns objects", async () => {
    const { handleMemoryList } = await import("../../core/pi-extensions/bloom-objects/actions.js")
    const result = await handleMemoryList({})
    expect(result).toHaveProperty("content")
  })
})
```

Adjust function names and argument shapes to match actual exports.

### Step 12.4 — Run tests and check coverage

- [ ] Run:
  ```bash
  npx vitest run tests/extensions/bloom-objects.test.ts
  npm run test:coverage 2>&1 | grep "bloom-objects"
  ```
  Expected: tests pass; ≥ 60% statements.

### Step 12.5 — Full stability gate

- [ ] Run:
  ```bash
  npm run build && npm run check && npm run test:ci
  ```

### Step 12.6 — Commit

- [ ] Run:
  ```bash
  git add core/pi-extensions/bloom-objects/ tests/extensions/bloom-objects.test.ts
  git commit -m "test(bloom-objects): add memory CRUD action tests; extract typed param schemas"
  ```

---

## Task 13: bloom-persona — audit guardrail hooks

**Files:**
- Audit/modify: `core/pi-extensions/bloom-persona/index.ts`, `core/pi-extensions/bloom-persona/actions.ts`
- Audit: `tests/extensions/bloom-persona.test.ts`

### Step 13.1 — Check current coverage

- [ ] Run:
  ```bash
  npm run test:coverage 2>&1 | grep "bloom-persona"
  ```
  bloom-persona's coverage should be decent (guardrails are tested in `tests/integration/persona-guardrails.test.ts`).

### Step 13.2 — Audit for defensive casts

- [ ] Read `core/pi-extensions/bloom-persona/index.ts` and `actions.ts`. Apply the same audit: replace `params as { ... }` with `as Static<typeof XxxParams>`, replace `Value.Check` guards with `Value.Parse` at event/tool boundaries.

### Step 13.3 — If coverage < 60%, add missing event handler tests

If needed, add tests that trigger the registered event handlers (`session_start`, `before_agent_start`, `tool_call`, `session_before_compact`) using `createMockExtensionAPI()` and call the handlers with stub event objects.

### Step 13.4 — Full stability gate

- [ ] Run:
  ```bash
  npm run build && npm run check && npm run test:ci
  ```

### Step 13.5 — Commit if changes made

- [ ] Run:
  ```bash
  git add core/pi-extensions/bloom-persona/
  git commit -m "refactor(bloom-persona): extract typed param schemas, audit event handlers"
  ```

---

## Task 14: Add real operator e2e test

**Files:**
- Create: `tests/e2e/operator-journey.test.ts`

The existing e2e test validates extension registration shape only. This adds two tests that call real tool `execute` functions.

### Step 14.1 — Write the test file

- [ ] Create `tests/e2e/operator-journey.test.ts`:

```typescript
/**
 * Operator journey test — validates real end-to-end tool call paths.
 * Does not require a running Matrix server.
 * Uses mock extension API + temp garden to exercise the full
 * registration → execute pipeline for two representative tools.
 */
import { beforeEach, afterEach, describe, it, expect } from "vitest"
import { createMockExtensionAPI, type MockExtensionAPI } from "../helpers/mock-extension-api.js"
import { createTempGarden, type TempGarden } from "../helpers/temp-garden.js"

describe("operator journey: setup_status tool call", () => {
  let temp: TempGarden
  let api: MockExtensionAPI

  beforeEach(async () => {
    temp = createTempGarden()
    // BLOOM_DIR is set automatically by createTempGarden()
    api = createMockExtensionAPI()
    const mod = await import("../../core/pi-extensions/bloom-setup/index.js")
    mod.default(api as never)
  })

  afterEach(() => {
    temp.cleanup()
  })

  it("setup_status is registered and returns a valid tool result", async () => {
    const tool = api._registeredTools.find(t => t.name === "setup_status")
    expect(tool, "setup_status must be registered").toBeDefined()

    const result = await tool!.execute("call-1", {}, undefined, () => {}, {} as never)

    // Validate the tool result contract
    expect(result).toHaveProperty("content")
    expect(Array.isArray(result.content)).toBe(true)
    expect(result.content.length).toBeGreaterThan(0)
    expect(result.content[0]).toHaveProperty("type", "text")
    expect(typeof result.content[0].text).toBe("string")
  })
})

describe("operator journey: memory_create tool call", () => {
  let temp: TempGarden
  let api: MockExtensionAPI

  beforeEach(async () => {
    temp = createTempGarden()
    api = createMockExtensionAPI()
    const mod = await import("../../core/pi-extensions/bloom-objects/index.js")
    mod.default(api as never)
  })

  afterEach(() => {
    temp.cleanup()
  })

  it("memory_create is registered and creates an object successfully", async () => {
    const tool = api._registeredTools.find(t => t.name === "memory_create")
    expect(tool, "memory_create must be registered").toBeDefined()

    const result = await tool!.execute(
      "call-2",
      { title: "journey-test", content: "e2e test content", type: "note" },
      undefined,
      () => {},
      {} as never,
    )

    expect(result).toHaveProperty("content")
    expect(result.isError).toBeFalsy()
  })
})
```

### Step 14.2 — Run the e2e test suite

- [ ] Run:
  ```bash
  npm run test:e2e
  ```
  Expected: all three e2e tests pass (existing registration test + two new journey tests).

### Step 14.3 — Full stability gate

- [ ] Run:
  ```bash
  npm run build && npm run check && npm run test:ci
  ```

### Step 14.4 — Commit

- [ ] Run:
  ```bash
  git add tests/e2e/operator-journey.test.ts
  git commit -m "test(e2e): add real operator journey tests for setup_status and memory_create"
  ```

---

## Task 15: Harden NixOS CI gate

**Files:**
- Modify: `.github/workflows/nixos-tests.yml`

`bloom-boot` and `bloom-daemon` already run in `nixos-vm-tests` but the job silently passes when KVM is absent. This makes the gate meaningless on ubuntu-latest runners.

### Step 15.1 — Read the current workflow

- [ ] Read `.github/workflows/nixos-tests.yml` lines 59-145. The `nixos-vm-tests` job uses `${{ vars.NIXOS_TEST_RUNNER || 'ubuntu-latest' }}`. When on ubuntu-latest (no KVM), `has_kvm` is `false` and all subsequent steps are skipped — the job still passes green.

### Step 15.2 — Replace the silent-skip summary with a hard fail

Find the `Summary (skipped)` step at the end of `nixos-vm-tests` (lines 135-144):

```yaml
- name: Summary (skipped)
  if: steps.kvm-check.outputs.has_kvm == 'false'
  run: |
    echo "## VM Tests Skipped" >> $GITHUB_STEP_SUMMARY
    ...
```

Replace it with:

```yaml
- name: Fail if KVM unavailable (no self-hosted runner configured)
  if: steps.kvm-check.outputs.has_kvm == 'false'
  run: |
    echo "::error::NixOS VM tests require KVM. Set NIXOS_TEST_RUNNER to a self-hosted runner with KVM, or run locally: nix flake check"
    exit 1
```

- [ ] Make this replacement in `.github/workflows/nixos-tests.yml`

### Step 15.3 — Verify valid YAML

- [ ] Run:
  ```bash
  python3 -c "import yaml; yaml.safe_load(open('.github/workflows/nixos-tests.yml'))" && echo "Valid YAML"
  ```
  Expected: `Valid YAML`

### Step 15.4 — Commit

- [ ] Run:
  ```bash
  git add .github/workflows/nixos-tests.yml
  git commit -m "ci: make NixOS VM tests fail loudly when KVM unavailable"
  ```

---

## Task 16: Final validation

### Step 16.1 — Full test suite with coverage

- [ ] Run:
  ```bash
  npm run test:ci
  ```
  Expected: all tests pass, all coverage thresholds met.

### Step 16.2 — Biome check clean

- [ ] Run:
  ```bash
  npm run check
  ```
  Expected: exits 0.

### Step 16.3 — Build clean

- [ ] Run:
  ```bash
  npm run build
  ```
  Expected: exits 0.

### Step 16.4 — Full NixOS checks gate (spec-required final check)

- [ ] Run:
  ```bash
  nix eval .#checks.x86_64-linux --apply builtins.attrNames --no-write-lock-file
  ```
  Expected: all checks present including `bloom-boot`, `bloom-daemon`, `bloom-config`.

- [ ] Run:
  ```bash
  just check-config
  nix eval .#nixosConfigurations.bloom-x86_64.config.system.stateVersion --no-write-lock-file
  ```
  Expected: both pass, `stateVersion = "25.05"`.

### Step 16.5 — Package outputs clean

- [ ] Run:
  ```bash
  nix eval .#packages.x86_64-linux --apply builtins.attrNames --no-write-lock-file
  ```
  Expected: `[ "bloom-app" "iso" "qcow2" "raw" ]`

### Step 16.6 — Review commit log

- [ ] Run:
  ```bash
  git log --oneline origin/main..HEAD
  ```
  Confirm each commit is scoped correctly and messages are clear.
