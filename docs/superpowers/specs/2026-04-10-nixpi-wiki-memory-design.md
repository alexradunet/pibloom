# NixPI Wiki Memory — Design Spec

**Date:** 2026-04-10
**Status:** Proposed
**Goal:** Replace the current Objects/Episodes/evolution memory system with a single page-first LLM wiki under `~/nixpi/Wiki/`. Make the codebase leaner, simpler, and aligned with KISS principles. Remove speculative code (interactions.ts). Net reduction of ~1,900 LOC.

---

## Motivation

NixPI's current memory system has three separate subsystems:

- **Episodes/** — append-only episodic capture (4 tools)
- **Objects/** — durable structured records with frontmatter scoring (8 tools)
- **Evolution** — tracked object/process beside memory

That's 12 tools, ~1,400 LOC of action code, 332 LOC of scoring/ranking machinery, and a promotion workflow (capture episode → maybe promote to object → maybe link objects) that adds conceptual overhead without proportional value.

The LLM wiki pattern (Karpathy's idea, implemented by pi-llm-wiki) replaces all three with:

- **Raw source packets** — immutable captured inputs
- **Source pages** — what each source says
- **Canonical wiki pages** — what NixPI currently believes
- **Generated metadata** — registry, backlinks, index, log

One system. One mental model. Fewer tools. Strict provenance. Compounding knowledge.

Additionally, `core/lib/interactions.ts` (355 LOC) is speculative interaction machinery that was never used in practice. It gets removed.

---

## Architecture

### Vault structure

```
~/nixpi/Wiki/
├─ raw/                          # immutable source packets
│  └─ SRC-2026-04-10-001/
│     ├─ manifest.json
│     ├─ original/
│     └─ extracted.md
├─ pages/                        # editable wiki pages
│  ├─ sources/                   # one page per source packet
│  └─ *.md                       # all canonical pages (flat, type in frontmatter)
├─ meta/                         # generated, machine-owned
│  ├─ registry.json
│  ├─ backlinks.json
│  ├─ index.md
│  ├─ events.jsonl
│  ├─ log.md
│  └─ lint-report.md
└─ WIKI_SCHEMA.md                # operating manual for Pi
```

### Ownership model

| Path | Owner | Rule |
|---|---|---|
| `raw/**` | extension tools | immutable after capture |
| `pages/**` | model + user | editable knowledge |
| `meta/**` | extension | generated, never hand-edited |
| `WIKI_SCHEMA.md` | human | operating manual |

### Page types

All canonical pages live flat in `pages/` with a `type` frontmatter field. Source pages are the one exception — they live in `pages/sources/` for clean separation.

Supported types: `source`, `concept`, `entity`, `synthesis`, `analysis`, `evolution`, `procedure`, `decision`.

The type determines required sections and lint rules, not directory placement.

### Key differences from pi-llm-wiki

| pi-llm-wiki | NixPI wiki | Why |
|---|---|---|
| `wiki/concepts/`, `wiki/entities/`, etc. | `pages/` flat + frontmatter `type` | Simpler. No forced categorization. |
| `.wiki/config.json` + templates/ | Convention-only. No config file. | KISS. Paths are fixed. |
| `gray-matter` dependency | Reuse existing `core/lib/frontmatter.ts` | No new dependencies. |
| Separate installable package | Built-in NixPI extension | Replaces objects + episodes natively. |
| Manual `wiki_log_event` tool | Auto-logging from tools | Less LLM burden. |
| `wiki_bootstrap` tool | Folded into `session_start` | NixPI already bootstraps on startup. |

---

## Tool surface

Six tools replace the current twelve.

### New tools

| Tool | Replaces | What it does |
|---|---|---|
| `wiki_status` | `nixpi_status` (partial) | Page counts, source states, recent events, lint summary |
| `wiki_capture` | `episode_create` | Capture URL/file/text → immutable packet + source page. Auto-logs. |
| `wiki_search` | `memory_query`, `memory_search`, `memory_list` | Search registry by title/alias/tags/type/text. Token scoring. No embeddings. |
| `wiki_ensure_page` | `memory_create`, `memory_upsert` | Resolve existing or create new canonical page. Deduplicates by title/alias. |
| `wiki_lint` | (new) | Broken links, orphans, missing frontmatter, duplicates, uncited pages, stale sources |
| `wiki_rebuild` | (new) | Force-rebuild registry, backlinks, index, log |

### Removed tools

All twelve `memory_*` and `episode_*` tools are removed:

- `memory_create`, `memory_update`, `memory_upsert`, `memory_read`, `memory_query`, `memory_search`, `memory_link`, `memory_list`
- `episode_create`, `episode_list`, `episode_promote`, `episode_consolidate`

Pi uses its built-in `read`/`edit`/`write` tools for page authoring. The wiki extension handles scaffolding, search, and metadata.

### Hooks

| Hook | Behavior |
|---|---|
| `session_start` | Ensure `~/nixpi/Wiki/` structure exists. Seed `WIKI_SCHEMA.md` if missing. |
| `tool_call` (write/edit) | Block edits to `raw/**` and `meta/**`. Track dirty state for pages in `pages/**`. |
| `agent_end` | If any pages were dirtied, rebuild registry/backlinks/index/log. |
| `before_agent_start` | Inject wiki digest into system prompt (replaces `buildMemoryDigest`). |

### Design decisions

1. **No `wiki_bootstrap` tool.** Wiki scaffold is created on `session_start` via the `nixpi` extension, same as today's `ensureNixPi()`. Not a separate tool.

2. **No `wiki_log_event` tool.** Every mutating tool auto-appends to `meta/events.jsonl`. The LLM doesn't need to remember to log.

3. **Auto-rebuild on page edits.** Hook `tool_call` for write/edit to `pages/**`, rebuild meta on `agent_end`. Invisible to the LLM.

4. **Page type in frontmatter, not directory.** `pages/sources/` is the one exception. Everything else is flat with a `type` field. This avoids premature categorization and simplifies the file layout.

---

## Source packet format

Each captured source is stored as an immutable packet:

```
raw/SRC-YYYY-MM-DD-NNN/
├─ manifest.json       # metadata: id, title, kind, origin, hash, status
├─ original/           # preserved original artifact
└─ extracted.md        # normalized markdown for reading
```

Source IDs are sequential per day: `SRC-2026-04-10-001`, `SRC-2026-04-10-002`, etc.

### Manifest fields

- `sourceId`, `title`, `kind` (article, note, pdf, webpage, etc.)
- `origin` (type + value)
- `capturedAt`, `integratedAt`
- `hash` (sha256 of original)
- `status` (captured | integrated | superseded)

### Source page

Every source packet gets a corresponding page at `pages/sources/SRC-*.md` with:

- Frontmatter: `type: source`, `source_id`, `status`, `captured_at`, `origin_type`, `origin_value`
- Body sections: Summary, Key claims, Entities/concepts mentioned, Reliability/caveats, Integration targets, Open questions

---

## Canonical page format

All canonical pages share a common frontmatter structure:

```yaml
---
type: concept          # concept, entity, synthesis, analysis, evolution, procedure, decision
title: Example Topic
aliases: []
tags: []
status: draft          # draft, active, contested, superseded, archived
updated: 2026-04-10
source_ids: []
summary: One-line summary
---
```

Body sections vary by type but follow a common pattern:

- `## Current understanding` (or `## Question` for analysis, `## Problem` for evolution)
- `## Evidence` — with `[[sources/SRC-*]]` citations
- `## Tensions / caveats`
- `## Open questions`
- `## Related pages` — wikilinks to other canonical pages

### Linking and citation style

Internal navigation uses folder-qualified wikilinks:

```md
[[sources/SRC-2026-04-10-001|SRC-2026-04-10-001]]
[[my-concept-page]]
```

Factual claims in canonical pages cite source page IDs. Uncited factual assertions are flagged by lint.

---

## Search and retrieval

### Registry-based search

`wiki_search` operates on `meta/registry.json`, not raw files. The registry contains per-page:

- `id`, `type`, `path`, `title`, `aliases`, `summary`, `status`
- `tags`, `sourceIds`, `linksOut`, `headings`, `wordCount`

### Scoring

Token-based scoring adapted from pi-llm-wiki:

- Exact title match: +120
- Exact alias match: +110
- Summary contains query: +50
- Source ID match: +45
- Path contains query: +40
- Heading match: +35
- Per-token partial matches across all fields: +3 to +18

No vector DB. No embeddings. No external search service. The registry + token scoring is sufficient at NixPI's expected scale (hundreds of pages, not thousands).

---

## Lint

### Mechanical lint (deterministic)

- Broken wikilinks (target doesn't exist)
- Orphan pages (no inbound or outbound links, excluding source pages)
- Missing required frontmatter fields
- Duplicate titles or aliases across canonical pages
- Coverage gaps (source pages not cited by any canonical page, canonical pages with no source_ids)
- Staleness (source pages still in `captured` status)

### Output

Lint writes to `meta/lint-report.md` and returns structured counts. The LLM can run `wiki_lint` and then reason about semantic issues on top.

---

## Codebase changes

### Removed

| Path | LOC | Reason |
|---|---|---|
| `core/pi/extensions/objects/` (all files) | ~850 | Replaced by wiki extension |
| `core/pi/extensions/episodes/` (all files) | ~545 | Replaced by wiki extension |
| `core/pi/skills/object-store/SKILL.md` | 95 | Replaced by wiki-maintainer skill |
| `core/lib/interactions.ts` | 355 | Speculative, never used in practice |
| `tests/extensions/objects.test.ts` | 424 | Tests for removed code |
| `tests/extensions/episodes.test.ts` | 402 | Tests for removed code |
| `tests/integration/object-lifecycle.test.ts` | 161 | Tests for removed code |
| `tests/integration/nixpi-seeding.test.ts` | ~220 | Tests blueprint seeding into Objects/ |

**Approximate removal: ~3,050 LOC**

### Added

| Path | Est. LOC | What |
|---|---|---|
| `core/pi/extensions/wiki/index.ts` | ~150 | Tool registration, hooks |
| `core/pi/extensions/wiki/actions-capture.ts` | ~200 | `wiki_capture` implementation |
| `core/pi/extensions/wiki/actions-search.ts` | ~100 | `wiki_search` implementation |
| `core/pi/extensions/wiki/actions-pages.ts` | ~120 | `wiki_ensure_page` implementation |
| `core/pi/extensions/wiki/actions-lint.ts` | ~180 | `wiki_lint` implementation |
| `core/pi/extensions/wiki/actions-meta.ts` | ~150 | Registry/backlinks/index/log rebuild, events, status |
| `core/pi/extensions/wiki/types.ts` | ~80 | Type definitions |
| `core/pi/extensions/wiki/paths.ts` | ~60 | Path conventions and guards |
| `core/pi/skills/wiki-maintainer/SKILL.md` | ~120 | Teaches Pi wiki maintenance |
| `tests/extensions/wiki.test.ts` | ~400 | Unit tests |
| `tests/integration/wiki-lifecycle.test.ts` | ~200 | Integration tests |

**Approximate addition: ~1,760 LOC**

**Net change: approximately -1,290 LOC**

### Modified

| Path | Change |
|---|---|
| `core/pi/extensions/persona/actions.ts` | Replace `buildMemoryDigest` with wiki digest |
| `core/pi/extensions/persona/index.ts` | Import wiki digest instead of objects digest |
| `core/pi/extensions/nixpi/actions.ts` | Bootstrap `~/nixpi/Wiki/` instead of Objects/ + Episodes/ |
| `core/pi/extensions/nixpi/actions-blueprints.ts` | Seed WIKI_SCHEMA.md instead of object-store blueprints |
| `core/pi/skills/self-evolution/SKILL.md` | Reference wiki pages instead of evolution objects |
| `core/pi/skills/first-boot/SKILL.md` | Update memory references |
| `core/pi/skills/recovery/SKILL.md` | Update memory references |
| `core/pi/persona/SKILL.md` | Update memory model references |
| `core/pi/persona/FACULTY.md` | Update memory model references |
| `package.json` | Update extension entries |
| `docs/reference/memory-model.md` | Rewrite for wiki architecture |
| `docs/architecture/index.md` | Update subsystem table |
| `AGENTS.md` | Update extension documentation |
| `tests/e2e/extension-registration.test.ts` | Update registered extension list |
| `tests/integration/standards-guard.test.ts` | Update file existence assertions |

### Reused from existing codebase

- `core/lib/frontmatter.ts` — `parseFrontmatter`/`stringifyFrontmatter` (no `gray-matter`)
- `core/lib/filesystem.ts` — `safePathWithin`, `getNixPiDir`, `ensureDir`, `atomicWriteFile`
- `core/lib/exec.ts` — `run()` for markitdown/URL fetch
- `core/lib/utils.ts` — `ActionResult`, `ok`, `err`, `toToolResult`, `truncate`, `nowIso`

### Adapted from pi-llm-wiki

- Capture pipeline (simplified, using NixPI's `run()` and `atomicWriteFile`)
- Registry/backlinks builder (using NixPI's `parseFrontmatter`)
- Token-based search scoring (~60 LOC)
- Lint categories (adapted for flat `pages/` structure)
- Source ID generation (`makeSourceId`, `slugifyTitle`, `dedupeSlug`)
- Wiki-maintainer skill (adapted for NixPI vocabulary)

---

## Testing

### Unit tests

- Source ID generation (sequential per day)
- Slug generation and dedup
- Registry build from parsed pages
- Backlinks computation
- Token-based search scoring
- All six lint categories
- Page ensure: resolve, create, conflict
- Guard: block raw/ and meta/ writes, allow pages/ writes
- Event append and log rebuild

### Integration tests

- Bootstrap creates Wiki/ structure
- Capture text → packet + source page + event
- Capture file → extracted.md correct
- Ensure page: create if missing, resolve if exists, conflict on ambiguous
- Search returns expected results
- Lint catches known issues in fixture wiki
- Status reports correct counts

### Not tested

- LLM prose quality
- URL fetching (mock the fetch)
- Markitdown conversion (mock the exec)

---

## Constraints

1. **No new dependencies.** Reuse `js-yaml`, `neverthrow`, `@sinclair/typebox`.
2. **ActionResult pattern.** All wiki actions return `Result<{ text, details? }, string>`.
3. **Convention over configuration.** Paths are fixed. No config file. No template files.
4. **No backwards compatibility.** Objects/ and Episodes/ are not migrated.
5. **No vector search.** Registry + token scoring only.
6. **No automatic capture.** Source capture is always explicit.
7. **Immutable raw packets.** Only `manifest.json.status` and `manifest.json.integratedAt` change after capture.

---

## Risks

### Page sprawl
If page creation is too eager, the wiki becomes cluttered.
Mitigation: `wiki_ensure_page` always searches first. Lint flags orphans. Skill teaches "prefer updating existing pages."

### Citation fatigue
If provenance rules are too strict, the LLM writes awkward pages.
Mitigation: Citations enforced for factual claims only. Templates include Evidence sections. Lint is helpful, not blocking.

### Over-engineering
The wiki system could become too tool-heavy.
Mitigation: 6 tools, no config file, no template files, no embeddings, no DB. Markdown + generated JSON only.
