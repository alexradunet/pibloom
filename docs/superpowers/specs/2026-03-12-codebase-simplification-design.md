# Codebase Simplification Design

Date: 2026-03-12

## Goal

Remove dead code, unnecessary abstractions, stale documentation, unused dependencies, and a hardcoded credential from the pi-bloom repository. No new features — only deletion and simplification.

## Scope

Five tiers of changes, ordered by risk (lowest first).

---

## Tier 1: Remove Dead Code

### 1.1 Delete empty `types.ts` stubs

Delete these files (each contains only `export {}`):
- `extensions/bloom-objects/types.ts`
- `extensions/bloom-repo/types.ts`
- `extensions/bloom-services/types.ts`
- `extensions/bloom-setup/types.ts`

### 1.2 Remove `commandCheckArgs`

In `lib/services-validation.ts`: delete the `commandCheckArgs` function (ignores its input, always returns `["--version"]`). Inline `["--version"]` in `commandExists` where it's called. Remove its tests.

### 1.3 Remove no-op `buildExtensionFactories`

In `daemon/index.ts`: delete `buildExtensionFactories()` and pass `[]` as `extensionFactories` to `SessionPool`.

### 1.4 Remove unused re-exports from extension index files

- `extensions/bloom-persona/index.ts`: remove `export { normalizeCommand }` re-export. Update test imports to use `./actions.js` directly.
- `extensions/bloom-objects/index.ts`: remove `export { parseRef }` re-export. Update test imports.
- `extensions/bloom-repo/index.ts`: remove `export { parseGithubSlugFromUrl, slugifyBranchPart }` re-exports (completely unused — nothing imports them from here).

### 1.5 Remove unused `RoomRegistry` methods

In `daemon/room-registry.ts`: remove `leastRecentlyUsed()`, `archive()`, and `getAll()`. Remove their tests.

### 1.6 Un-export internal functions in `lib/netbird.ts`

Remove `export` from: `listGroups`, `findAllGroupId`, `listZones`, `createZone`, `listRecords`, `createRecord`. These are internal implementation details only called within the file.

### 1.7 Un-export `RoutingResult` in `lib/service-routing.ts`

Remove `export` from the `RoutingResult` type — never imported externally.

### 1.8 Remove unused parameters

- `lib/service-routing.ts`: remove the `_port` parameter from `ensureServiceRouting`. Update all callers.
- `extensions/bloom-dev/actions-build.ts`: remove `_bloomRuntime` from `handleDevSwitch` and `handleDevRollback`. Update callers.
- `extensions/bloom-dev/actions-lifecycle.ts`: remove `_bloomRuntime` from `handleDevCodeServer`. Update callers.

### 1.9 Remove exported `sleep` in `bloom-services/actions-test.ts`

Remove the `export` keyword. The function is only used within the same file.

---

## Tier 2: Simplify Dependencies

### 2.1 Remove `qrcode` and `@types/qrcode`

`npm uninstall qrcode @types/qrcode` — zero imports anywhere.

### 2.2 Replace `execa` with `node:child_process`

In `lib/exec.ts`: replace the single `execa()` call with `node:child_process.execFile` + `node:util.promisify`. The project is Linux-only (Fedora bootc), so cross-platform shell resolution is unnecessary. Then `npm uninstall execa`. This removes ~12 transitive dependencies.

### 2.3 Replace `@11ty/gray-matter` with inline code

In `lib/frontmatter.ts`: the file already pre-validates `---` delimiters before calling `matter()`. Replace with a ~15-line function that splits on `---` and calls `jsYaml.load()`. Then `npm uninstall @11ty/gray-matter`.

### 2.4 Bump `matrix-bot-sdk` to 0.8.0

Update `package.json` from `0.7.1` to `^0.8.0`. APIs used (`MatrixClient`, `SimpleFsStorageProvider`, `AutojoinRoomsMixin`) are stable.

---

## Tier 3: Fix Stale Documentation

All references to `bloom.network` must be updated to reflect that services use host networking. The `bloom.network` Podman network concept was never actually used by any container and has been deleted from the OS image.

### 3.1 Remove `bloom.network` references (15+ files)

Replace `bloom.network` with `host` networking in:
- `CLAUDE.md` — update services convention line
- `ARCHITECTURE.md` — lines 122, 131, 165
- `services/README.md` — lines 24, 34, 67
- `extensions/bloom-services/index.ts` — line 40 (change default from `"bloom.network"` to `"host"`)
- `skills/service-management/SKILL.md` — line 80
- `skills/self-evolution/SKILL.md` — line 138
- `skills/recovery/SKILL.md` — line 86
- `docs/service-architecture.md` — line 210
- `docs/conventions/containers.md` — line 19
- `.claude/agents/bloom-live-tester.md` — line 48
- `.claude/agents/bloom-architect.md` — line 49

Historical plan docs (`docs/plans/`) can be left as-is (they're point-in-time snapshots).

### 3.2 Remove ghost `nginx.ts` from AGENTS.md

Delete the `nginx.ts` row and update `service-routing.ts` description to say "DNS record creation" (not "DNS + nginx").

### 3.3 Remove nginx vhost references from `docs/service-architecture.md`

Remove the nginx vhost section describing removed functionality.

### 3.4 Fix signal health port in AGENTS.md

Change `29320` to `29328` to match `services/catalog.yaml` (source of truth).

### 3.5 Remove `services/examples/` reference from `services/README.md`

The directory doesn't exist.

### 3.6 Remove Sway/Wayland mention from `docs/quick_deploy.md`

No longer relevant.

---

## Tier 4: Security — `bib-config.toml`

### 4.1 Replace with example file

- Rename `os/bib-config.toml` to `os/bib-config.example.toml`
- Replace the hardcoded password with a placeholder: `password = "CHANGE_ME"`
- Add `os/bib-config.toml` to `.gitignore`
- Update `justfile` or any build scripts that reference `bib-config.toml` to copy from `.example` if the real file doesn't exist
- Note: removing the password from git history requires `git filter-repo` + force-push, which is a separate decision

---

## Tier 5: Minor Cleanup

### 5.1 Fix scaffold network default mismatch

In `extensions/bloom-services/index.ts`: change the schema default from `"bloom.network"` to `"host"` (already covered by 3.1). In `actions-scaffold.ts`: the code already defaults to `"host"` — no change needed.

### 5.2 Deduplicate `checkUpdateAvailable`

Extract the shared path constant and JSON-read logic from `bloom-persona/actions.ts` and `bloom-os/actions.ts` into a shared helper in `lib/`.

### 5.3 Pick one js-yaml alias in `lib/frontmatter.ts`

Will be resolved by 2.3 (gray-matter replacement rewrite).

---

## What We're NOT Doing

- No git history rewriting for the password (separate concern, requires force-push coordination)
- No changes to plan docs in `docs/plans/` (point-in-time snapshots)
- No replacement of `hosted-git-info` (small, well-maintained, handles edge cases)
- No structural refactoring — this is purely removal and simplification

## Testing

- Run `npm run build` after each tier to catch type errors
- Run `npm run test` after each tier to verify no regressions
- Run `npm run check` to verify formatting compliance
