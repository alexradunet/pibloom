# Bloom Architect Memory

## Architecture Decisions (Settled)

### Extension directory structure (2026-03-08)
- Every extension is a directory: `extensions/bloom-{name}/index.ts + actions.ts + types.ts + tests/`
- Always a directory, even for thin extensions — consistency for AI-driven development
- `index.ts` is registration only, `actions.ts` handles orchestration, lib/ has pure logic

### lib/ organized by capability (2026-03-08)
- Files named by what they do: `containers.ts`, `filesystem.ts`, `networking.ts`
- NOT by consumer: no `lib/bloom-os.ts`
- Reason: multiple extensions share underlying systems, capability grouping avoids churn
- `shared.ts` is last resort for truly generic utilities

### Service scaffold, no shared runtime (2026-03-08)
- Template at `services/_template/`, generates independent services
- No shared service library — services are containers, independence is the point
- Template is single source of truth for patterns; backporting is deliberate

### Development model (2026-03-08)
- 70% AI-driven, 30% human-directed
- Conventions optimized for AI: predictable patterns, mechanical rules, zero judgment calls
- Philosophy priority: containers-first → Pi-native → lightest tier → convention-driven → testable

## Architecture State

### Last review: 2026-03-08
- 10 extensions (currently single files, migration to directories planned)
- 25 tools across extensions
- lib/ layer is pure (good), needs reorganization from shared.ts into capability files
- Services: llm, stt, whatsapp, signal, dufs + NetBird (system RPM)
- 255 tests across 20 test files

### Canonical docs
- `ARCHITECTURE.md` — the rulebook (structure, philosophy, enforcement checklist)
- `CLAUDE.md` — build/test/workflow commands
- `AGENTS.md` — tool/hook reference
- `docs/service-architecture.md` — service-specific architecture

## Convention Violations Seen
(None yet — tracking starts with next review)

## Pi SDK Notes
- `StringEnum`, `Type`, `truncateHead` are VALUE exports requiring runtime import as peerDependencies — this is correct
- CLAUDE.md's "never import at runtime" is misleading — peerDependency runtime imports are fine
