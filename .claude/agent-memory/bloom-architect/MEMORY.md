# Bloom Architect Memory

## Architecture Decisions (Settled)

### Extension directory structure (2026-03-08)
- Every extension is a directory: `extensions/bloom-{name}/index.ts + actions.ts + types.ts`
- Always a directory, even for thin extensions -- consistency for AI-driven development
- `index.ts` is registration only, `actions.ts` handles orchestration, lib/ has pure logic
- Migration to directories is COMPLETE -- all 10 extensions are directories
- Tests live in `tests/` at project root (NOT colocated in extension dirs despite ARCHITECTURE.md claiming otherwise)

### lib/ actual files (2026-03-08, verified)
- `shared.ts` -- generic utilities (createLogger, nowIso, truncate, errorResult, guardBloom, requireConfirmation)
- `exec.ts` -- command execution (run)
- `repo.ts` -- git remote helpers (getRemoteUrl, inferRepoUrl)
- `audit.ts` -- audit utilities (dayStamp, sanitize, summarizeInput, SENSITIVE_KEY)
- `filesystem.ts` -- path helpers (safePath, getBloomDir)
- `frontmatter.ts` -- YAML frontmatter (parseFrontmatter, stringifyFrontmatter, yaml)
- `services.ts` -- service catalog, manifest, install, validation, container detection
- ARCHITECTURE.md INCORRECTLY lists: containers.ts, networking.ts, persona.ts (DO NOT EXIST)
- ARCHITECTURE.md MISSING: audit.ts, repo.ts

### Service template (2026-03-08)
- `services/_template/` EXISTS with: Containerfile, package.json, src/, tests/, quadlet/, tsconfig, vitest.config
- No shared service library -- independence is the point

## Architecture State (last verified: 2026-03-08)
- 10 extensions (all directory-based)
- 27 tools registered (verified via grep)
- 263 tests across 20 test files (all passing)
- Build clean, no compilation errors

## Convention Violations Found

### Documentation drift (2026-03-08 audit)
- ARCHITECTURE.md lib/ section: 3 phantom files, 2 missing files
- AGENTS.md: old `bloom-foo.ts` dev paths, stale line counts, shared lib table outdated
- README.md: missing bloom-display, old `bloom-foo.ts` dev paths
- CLAUDE.md "Do Not" Pi SDK import rule is misleading (peerDep runtime imports are fine)
- vitest.config.ts thresholds (60%/25%) do not match CLAUDE.md "80% threshold" claim
- Tests NOT colocated in extension dirs (ARCHITECTURE.md says they should be)

## Pi SDK Notes
- `StringEnum`, `Type`, `truncateHead` are VALUE exports requiring runtime import as peerDependencies -- correct
- CLAUDE.md's "never import at runtime" is misleading -- peerDependency runtime imports are fine
