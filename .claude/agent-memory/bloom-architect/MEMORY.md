# Bloom Architect Memory

## Architecture Decisions (Settled)

### Extension directory structure (2026-03-08)
- Every extension is a directory: `extensions/bloom-{name}/index.ts + actions.ts + types.ts`
- Always a directory, even for thin extensions -- consistency for AI-driven development
- `index.ts` is registration only, `actions.ts` handles orchestration, lib/ has pure logic
- All 12 extensions are directories (10 original + bloom-dev + bloom-setup added post-migration)
- Tests live in `tests/` at project root (NOT colocated in extension dirs)

### lib/ actual files (2026-03-09, verified)
- `shared.ts` -- generic utilities (createLogger, nowIso, truncate, errorResult, guardBloom, requireConfirmation)
- `exec.ts` -- command execution (run)
- `repo.ts` -- git remote helpers (getRemoteUrl, inferRepoUrl)
- `audit.ts` -- audit utilities (dayStamp, sanitize, summarizeInput, SENSITIVE_KEY)
- `filesystem.ts` -- path helpers (safePath, getBloomDir)
- `frontmatter.ts` -- YAML frontmatter (parseFrontmatter, stringifyFrontmatter, yaml)
- `services.ts` -- catalog parsing, manifest, install, validation, container detection
- `lemonade.ts` -- lemonade-server model catalog and pull helpers (UNDOCUMENTED in ARCHITECTURE.md)
- `setup.ts` -- setup wizard state machine: STEP_ORDER, advanceStep, etc. (UNDOCUMENTED in ARCHITECTURE.md)

### Service template (2026-03-08)
- `services/_template/` EXISTS with: Containerfile, package.json, src/, tests/, quadlet/, tsconfig, vitest.config
- No shared service library -- independence is the point

## Architecture State (last verified: 2026-03-09)
- 12 extensions (all directory-based)
- ~41 tools registered (AGENTS.md says 27 -- stale)
- code-server service in catalog.yaml but undocumented
- Missing extension test files: bloom-garden, bloom-services, bloom-topics, bloom-audit

## Codebase Audit (2026-03-09)
See `audit-2026-03-09.md` for full findings.
Key: CI references deleted whatsapp service, Matrix image mismatch across files,
AGENTS.md/README.md/ARCHITECTURE.md all missing bloom-dev and bloom-setup,
duplicated slugify logic, bloom-audit index.ts has business logic in execute block.

## Pi SDK Notes
- `StringEnum`, `Type`, `truncateHead` are VALUE exports requiring runtime import as peerDependencies -- correct
- CLAUDE.md's "never import at runtime" is misleading -- peerDependency runtime imports are fine
