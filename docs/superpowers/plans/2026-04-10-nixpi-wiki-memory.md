# NixPI Wiki Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Objects/Episodes/interactions with a single page-first LLM wiki extension under `~/nixpi/Wiki/`, reducing tools from 12 to 6 and removing ~1,300 net LOC.

**Architecture:** A new `core/pi/extensions/wiki/` extension provides 6 tools (wiki_status, wiki_capture, wiki_search, wiki_ensure_page, wiki_lint, wiki_rebuild). Raw source packets in `raw/`, editable pages in `pages/`, generated metadata in `meta/`. Hooks auto-rebuild metadata when pages change. No new dependencies — reuse existing `frontmatter.ts`, `filesystem.ts`, `exec.ts`, `utils.ts`.

**Tech Stack:** TypeScript ESM, Vitest, neverthrow ActionResult, @sinclair/typebox, js-yaml (existing)

**Spec:** `docs/superpowers/specs/2026-04-10-nixpi-wiki-memory-design.md`

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `core/pi/extensions/wiki/types.ts` | Type definitions: WikiEvent, RegistryEntry, RegistryData, SourceManifest, LintIssue, etc. |
| `core/pi/extensions/wiki/paths.ts` | Path conventions, wiki root resolution, guard helpers, wikilink normalization |
| `core/pi/extensions/wiki/actions-meta.ts` | Registry/backlinks/index/log rebuild, event append, status, wiki digest |
| `core/pi/extensions/wiki/actions-capture.ts` | Source capture: URL/file/text → immutable packet + source page |
| `core/pi/extensions/wiki/actions-search.ts` | Token-based registry search |
| `core/pi/extensions/wiki/actions-pages.ts` | Ensure canonical page (resolve/create/conflict) |
| `core/pi/extensions/wiki/actions-lint.ts` | Structural lint checks |
| `core/pi/extensions/wiki/index.ts` | Tool registration, hooks (session_start, tool_call, agent_end, before_agent_start) |
| `core/pi/skills/wiki-maintainer/SKILL.md` | Bundled skill teaching Pi wiki maintenance |
| `tests/extensions/wiki.test.ts` | Unit tests for all wiki actions |
| `tests/integration/wiki-lifecycle.test.ts` | End-to-end integration tests |

### Deleted files

| File | Reason |
|---|---|
| `core/pi/extensions/objects/` (all 5 files) | Replaced by wiki |
| `core/pi/extensions/episodes/` (all 2 files) | Replaced by wiki |
| `core/pi/skills/object-store/SKILL.md` | Replaced by wiki-maintainer |
| `tests/extensions/objects.test.ts` | Tests for removed code |
| `tests/extensions/episodes.test.ts` | Tests for removed code |
| `tests/extensions/os-update.test.ts` | Tightly coupled to episode hooks |
| `tests/integration/object-lifecycle.test.ts` | Tests for removed code |
| `tests/integration/nixpi-seeding.test.ts` | Tests blueprint seeding into Objects/ |

### Modified files

| File | Change |
|---|---|
| `core/lib/interactions.ts` | Strip to only `requireConfirmation` (~15 LOC); remove all speculative interaction machinery |
| `core/pi/extensions/persona/index.ts` | Import wiki digest instead of objects digest |
| `core/pi/extensions/nixpi/actions.ts` | Bootstrap `Wiki/` dirs; remove `Objects`, `Episodes`, `Evolutions` from `NIXPI_DIRS` |
| `core/pi/extensions/nixpi/index.ts` | Register wiki extension's `session_start` hook for bootstrap |
| `package.json` | Replace episodes/objects extension entries with wiki |
| `tests/e2e/extension-registration.test.ts` | Update extension list and registered tools |
| `tests/integration/standards-guard.test.ts` | Update file existence assertions |
| `vitest.config.ts` | Remove `nixos_vps_provisioner` test path |
| `AGENTS.md` | Update extension documentation |
| `docs/reference/memory-model.md` | Rewrite for wiki |
| `docs/architecture/index.md` | Update subsystem table |
| Skills/persona `.md` files | Update memory references |

---

## Task 1: Types and path conventions

**Files:**
- Create: `core/pi/extensions/wiki/types.ts`
- Create: `core/pi/extensions/wiki/paths.ts`
- Test: `tests/extensions/wiki.test.ts`

- [ ] **Step 1: Write failing tests for slug and path utilities**

```ts
// tests/extensions/wiki.test.ts
import { describe, expect, it } from "vitest";

describe("wiki paths", () => {
	describe("slugifyTitle", () => {
		it("lowercases and kebab-cases a title", async () => {
			const { slugifyTitle } = await import("../../core/pi/extensions/wiki/paths.js");
			expect(slugifyTitle("My Cool Concept")).toBe("my-cool-concept");
		});

		it("strips non-alphanumeric characters", async () => {
			const { slugifyTitle } = await import("../../core/pi/extensions/wiki/paths.js");
			expect(slugifyTitle("What's the deal?")).toBe("what-s-the-deal");
		});

		it("returns untitled for empty input", async () => {
			const { slugifyTitle } = await import("../../core/pi/extensions/wiki/paths.js");
			expect(slugifyTitle("")).toBe("untitled");
		});
	});

	describe("makeSourceId", () => {
		it("generates SRC-YYYY-MM-DD-001 with no existing IDs", async () => {
			const { makeSourceId } = await import("../../core/pi/extensions/wiki/paths.js");
			const id = makeSourceId([], new Date("2026-04-10T12:00:00Z"));
			expect(id).toBe("SRC-2026-04-10-001");
		});

		it("increments from existing IDs", async () => {
			const { makeSourceId } = await import("../../core/pi/extensions/wiki/paths.js");
			const id = makeSourceId(["SRC-2026-04-10-001", "SRC-2026-04-10-002"], new Date("2026-04-10T12:00:00Z"));
			expect(id).toBe("SRC-2026-04-10-003");
		});
	});

	describe("dedupeSlug", () => {
		it("returns slug unchanged when no conflicts", async () => {
			const { dedupeSlug } = await import("../../core/pi/extensions/wiki/paths.js");
			expect(dedupeSlug("foo", [])).toBe("foo");
		});

		it("appends -2 on first conflict", async () => {
			const { dedupeSlug } = await import("../../core/pi/extensions/wiki/paths.js");
			expect(dedupeSlug("foo", ["foo"])).toBe("foo-2");
		});
	});

	describe("isProtectedPath", () => {
		it("blocks writes to raw/", async () => {
			const { isProtectedPath } = await import("../../core/pi/extensions/wiki/paths.js");
			expect(isProtectedPath("/home/user/nixpi/Wiki", "/home/user/nixpi/Wiki/raw/SRC-001/manifest.json")).toBe(true);
		});

		it("blocks writes to meta/", async () => {
			const { isProtectedPath } = await import("../../core/pi/extensions/wiki/paths.js");
			expect(isProtectedPath("/home/user/nixpi/Wiki", "/home/user/nixpi/Wiki/meta/registry.json")).toBe(true);
		});

		it("allows writes to pages/", async () => {
			const { isProtectedPath } = await import("../../core/pi/extensions/wiki/paths.js");
			expect(isProtectedPath("/home/user/nixpi/Wiki", "/home/user/nixpi/Wiki/pages/my-page.md")).toBe(false);
		});
	});

	describe("normalizeWikiLink", () => {
		it("resolves a source link to pages/sources/*.md", async () => {
			const { normalizeWikiLink } = await import("../../core/pi/extensions/wiki/paths.js");
			expect(normalizeWikiLink("sources/SRC-2026-04-10-001")).toBe("pages/sources/SRC-2026-04-10-001.md");
		});

		it("resolves a bare slug to pages/*.md", async () => {
			const { normalizeWikiLink } = await import("../../core/pi/extensions/wiki/paths.js");
			expect(normalizeWikiLink("my-concept")).toBe("pages/my-concept.md");
		});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/extensions/wiki.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Create types.ts**

```ts
// core/pi/extensions/wiki/types.ts
import type { Result } from "neverthrow";

export type ActionResult = Result<{ text: string; details?: Record<string, unknown> }, string>;

export const PAGE_TYPES = ["source", "concept", "entity", "synthesis", "analysis", "evolution", "procedure", "decision"] as const;
export type WikiPageType = (typeof PAGE_TYPES)[number];

export const CANONICAL_PAGE_TYPES = ["concept", "entity", "synthesis", "analysis", "evolution", "procedure", "decision"] as const;
export type CanonicalPageType = (typeof CANONICAL_PAGE_TYPES)[number];

export interface SourceManifest {
	version: number;
	sourceId: string;
	title: string;
	kind: string;
	origin: { type: "url" | "file" | "text"; value: string };
	capturedAt: string;
	integratedAt?: string;
	hash: string;
	status: "captured" | "integrated" | "superseded";
}

export interface RegistryEntry {
	type: WikiPageType;
	path: string;
	title: string;
	aliases: string[];
	summary: string;
	status: string;
	tags: string[];
	updated: string;
	sourceIds: string[];
	linksOut: string[];
	headings: string[];
	wordCount: number;
}

export interface RegistryData {
	version: number;
	generatedAt: string;
	pages: RegistryEntry[];
}

export interface BacklinksData {
	version: number;
	generatedAt: string;
	byPath: Record<string, { inbound: string[]; outbound: string[] }>;
}

export interface WikiEvent {
	ts: string;
	kind: "capture" | "integrate" | "page-create" | "lint" | "rebuild";
	title: string;
	sourceIds?: string[];
	pagePaths?: string[];
}

export interface LintIssue {
	kind: string;
	severity: "info" | "warning" | "error";
	path: string;
	message: string;
}

export interface LintRun {
	mode: string;
	counts: {
		total: number;
		brokenLinks: number;
		orphans: number;
		frontmatter: number;
		duplicates: number;
		coverage: number;
		staleness: number;
	};
	issues: LintIssue[];
}
```

- [ ] **Step 4: Create paths.ts**

```ts
// core/pi/extensions/wiki/paths.ts
import path from "node:path";
import { getNixPiDir } from "../../../lib/filesystem.js";

export function getWikiRoot(): string {
	return path.join(getNixPiDir(), "Wiki");
}

export function slugifyTitle(title: string): string {
	return (
		title
			.toLowerCase()
			.normalize("NFKD")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.replace(/-{2,}/g, "-") || "untitled"
	);
}

export function todayStamp(date = new Date()): string {
	return date.toISOString().slice(0, 10);
}

export function makeSourceId(existingIds: string[], now = new Date()): string {
	const stamp = todayStamp(now);
	const prefix = `SRC-${stamp}-`;
	const used = existingIds
		.filter((id) => id.startsWith(prefix))
		.map((id) => Number.parseInt(id.slice(prefix.length), 10))
		.filter((v) => Number.isFinite(v));
	const next = (used.length === 0 ? 0 : Math.max(...used)) + 1;
	return `${prefix}${String(next).padStart(3, "0")}`;
}

export function dedupeSlug(baseSlug: string, existingSlugs: string[]): string {
	const seen = new Set(existingSlugs);
	if (!seen.has(baseSlug)) return baseSlug;
	let i = 2;
	while (seen.has(`${baseSlug}-${i}`)) i += 1;
	return `${baseSlug}-${i}`;
}

export function isProtectedPath(wikiRoot: string, absolutePath: string): boolean {
	const rel = path.relative(wikiRoot, absolutePath);
	if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
	return rel.startsWith(`raw${path.sep}`) || rel.startsWith("raw/") || rel.startsWith(`meta${path.sep}`) || rel.startsWith("meta/");
}

export function isWikiPagePath(wikiRoot: string, absolutePath: string): boolean {
	const rel = path.relative(wikiRoot, absolutePath);
	if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
	return rel.startsWith(`pages${path.sep}`) || rel.startsWith("pages/");
}

export function normalizeWikiLink(target: string): string | undefined {
	const clean = target.trim().replace(/\\/g, "/").replace(/\.md$/i, "");
	if (!clean) return undefined;
	if (clean.startsWith("sources/")) return `pages/${clean}.md`;
	if (clean.startsWith("pages/")) return `${clean}.md`;
	return `pages/${clean}.md`;
}

/** Extract [[target]] and [[target|label]] from markdown. */
export function extractWikiLinks(markdown: string): string[] {
	const links: string[] = [];
	const regex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
	for (const match of markdown.matchAll(regex)) {
		links.push(match[1].trim());
	}
	return links;
}

/** Extract ## headings from markdown. */
export function extractHeadings(markdown: string): string[] {
	const headings: string[] = [];
	for (const match of markdown.matchAll(/^#{1,6}\s+(.+)$/gm)) {
		headings.push(match[1].trim());
	}
	return headings;
}

export function countWords(text: string): number {
	return text.trim().match(/\S+/g)?.length ?? 0;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/extensions/wiki.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add core/pi/extensions/wiki/types.ts core/pi/extensions/wiki/paths.ts tests/extensions/wiki.test.ts
git commit -m "Add wiki extension types and path utilities with tests"
```

---

## Task 2: Metadata rebuild engine (registry, backlinks, index, log, events)

**Files:**
- Create: `core/pi/extensions/wiki/actions-meta.ts`
- Test: `tests/extensions/wiki.test.ts` (append)

- [ ] **Step 1: Write failing tests for registry build and event logging**

Append to `tests/extensions/wiki.test.ts`:

```ts
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";

let wikiRoot: string;

beforeEach(() => {
	wikiRoot = mkdtempSync(path.join(os.tmpdir(), "wiki-test-"));
	mkdirSync(path.join(wikiRoot, "pages", "sources"), { recursive: true });
	mkdirSync(path.join(wikiRoot, "meta"), { recursive: true });
	mkdirSync(path.join(wikiRoot, "raw"), { recursive: true });
});

afterEach(() => {
	rmSync(wikiRoot, { recursive: true, force: true });
});

describe("wiki meta", () => {
	describe("buildRegistry", () => {
		it("builds registry from pages with frontmatter", async () => {
			const { scanPages, buildRegistry } = await import("../../core/pi/extensions/wiki/actions-meta.js");
			writeFileSync(
				path.join(wikiRoot, "pages", "test-concept.md"),
				"---\ntype: concept\ntitle: Test Concept\naliases: []\ntags: [ai]\nstatus: active\nupdated: 2026-04-10\nsource_ids: []\nsummary: A test\n---\n# Test Concept\n\n## Current understanding\nSome text.\n",
			);
			const pages = scanPages(wikiRoot);
			const registry = buildRegistry(pages);
			expect(registry.pages).toHaveLength(1);
			expect(registry.pages[0].title).toBe("Test Concept");
			expect(registry.pages[0].type).toBe("concept");
			expect(registry.pages[0].tags).toEqual(["ai"]);
		});
	});

	describe("buildBacklinks", () => {
		it("computes inbound and outbound links", async () => {
			const { scanPages, buildRegistry, buildBacklinks } = await import("../../core/pi/extensions/wiki/actions-meta.js");
			writeFileSync(
				path.join(wikiRoot, "pages", "a.md"),
				"---\ntype: concept\ntitle: A\naliases: []\ntags: []\nstatus: active\nupdated: 2026-04-10\nsource_ids: []\nsummary: A\n---\n# A\n\nSee [[b]].\n",
			);
			writeFileSync(
				path.join(wikiRoot, "pages", "b.md"),
				"---\ntype: concept\ntitle: B\naliases: []\ntags: []\nstatus: active\nupdated: 2026-04-10\nsource_ids: []\nsummary: B\n---\n# B\n\nStandalone.\n",
			);
			const pages = scanPages(wikiRoot);
			const registry = buildRegistry(pages);
			const backlinks = buildBacklinks(registry);
			expect(backlinks.byPath["pages/b.md"]?.inbound).toContain("pages/a.md");
			expect(backlinks.byPath["pages/a.md"]?.outbound).toContain("pages/b.md");
		});
	});

	describe("appendEvent / readEvents", () => {
		it("appends and reads events from events.jsonl", async () => {
			const { appendEvent, readEvents } = await import("../../core/pi/extensions/wiki/actions-meta.js");
			await appendEvent(wikiRoot, { ts: "2026-04-10T00:00:00Z", kind: "capture", title: "Test" });
			const events = await readEvents(wikiRoot);
			expect(events).toHaveLength(1);
			expect(events[0].kind).toBe("capture");
		});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/extensions/wiki.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create actions-meta.ts**

```ts
// core/pi/extensions/wiki/actions-meta.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseFrontmatter, stringifyFrontmatter } from "../../../lib/frontmatter.js";
import { atomicWriteFile } from "../../../lib/filesystem.js";
import { ok, err, nowIso } from "../../../lib/utils.js";
import { extractHeadings, extractWikiLinks, normalizeWikiLink, countWords } from "./paths.js";
import type { ActionResult, BacklinksData, RegistryData, RegistryEntry, WikiEvent, WikiPageType } from "./types.js";

interface ParsedPage {
	relativePath: string;
	frontmatter: Record<string, unknown>;
	body: string;
	headings: string[];
	rawLinks: string[];
	normalizedLinks: string[];
	wordCount: number;
}

function walkMdFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const results: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) results.push(...walkMdFiles(full));
		else if (entry.isFile() && entry.name.endsWith(".md")) results.push(full);
	}
	return results.sort();
}

function parsePage(wikiRoot: string, absolutePath: string): ParsedPage {
	const raw = readFileSync(absolutePath, "utf-8");
	const parsed = parseFrontmatter(raw);
	const rawLinks = extractWikiLinks(raw);
	const normalizedLinks = rawLinks.map(normalizeWikiLink).filter((l): l is string => l !== undefined);
	return {
		relativePath: path.relative(wikiRoot, absolutePath).split("\\").join("/"),
		frontmatter: parsed.attributes as Record<string, unknown>,
		body: parsed.body,
		headings: extractHeadings(raw),
		rawLinks,
		normalizedLinks,
		wordCount: countWords(parsed.body),
	};
}

export function scanPages(wikiRoot: string): ParsedPage[] {
	return walkMdFiles(path.join(wikiRoot, "pages")).map((f) => parsePage(wikiRoot, f));
}

function asString(v: unknown, fallback = ""): string {
	return typeof v === "string" ? v : fallback;
}

function asStringArray(v: unknown): string[] {
	return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function buildRegistry(pages: ParsedPage[]): RegistryData {
	const entries: RegistryEntry[] = pages.map((p) => ({
		type: asString(p.frontmatter.type, "concept") as WikiPageType,
		path: p.relativePath,
		title: asString(p.frontmatter.title, p.relativePath),
		aliases: asStringArray(p.frontmatter.aliases),
		summary: asString(p.frontmatter.summary),
		status: asString(p.frontmatter.status, "draft"),
		tags: asStringArray(p.frontmatter.tags),
		updated: asString(p.frontmatter.updated),
		sourceIds: asStringArray(p.frontmatter.source_ids),
		linksOut: [...new Set(p.normalizedLinks)],
		headings: p.headings,
		wordCount: p.wordCount,
	}));
	return { version: 1, generatedAt: nowIso(), pages: entries.sort((a, b) => a.path.localeCompare(b.path)) };
}

export function buildBacklinks(registry: RegistryData): BacklinksData {
	const known = new Set(registry.pages.map((p) => p.path));
	const byPath: BacklinksData["byPath"] = {};
	for (const p of registry.pages) byPath[p.path] = { inbound: [], outbound: [] };
	for (const p of registry.pages) {
		const outbound = p.linksOut.filter((t) => known.has(t));
		byPath[p.path].outbound = outbound;
		for (const t of outbound) {
			byPath[t] ??= { inbound: [], outbound: [] };
			byPath[t].inbound.push(p.path);
		}
	}
	for (const v of Object.values(byPath)) {
		v.inbound = [...new Set(v.inbound)].sort();
		v.outbound = [...new Set(v.outbound)].sort();
	}
	return { version: 1, generatedAt: nowIso(), byPath };
}

function renderIndex(registry: RegistryData): string {
	const lines = ["# Wiki Index", "", `Generated: ${registry.generatedAt}`, ""];
	const types: WikiPageType[] = ["source", "concept", "entity", "synthesis", "analysis", "evolution", "procedure", "decision"];
	for (const type of types) {
		const entries = registry.pages.filter((p) => p.type === type);
		if (entries.length === 0) continue;
		lines.push(`## ${type.charAt(0).toUpperCase() + type.slice(1)} Pages`, "");
		for (const e of entries) {
			const summary = e.summary ? ` — ${e.summary}` : "";
			lines.push(`- [[${e.path.replace(/^pages\//, "").replace(/\.md$/, "")}|${e.title}]]${summary}`);
		}
		lines.push("");
	}
	return `${lines.join("\n").trimEnd()}\n`;
}

export function rebuildAllMeta(wikiRoot: string): { registry: RegistryData; backlinks: BacklinksData } {
	const metaDir = path.join(wikiRoot, "meta");
	mkdirSync(metaDir, { recursive: true });
	const pages = scanPages(wikiRoot);
	const registry = buildRegistry(pages);
	const backlinks = buildBacklinks(registry);
	atomicWriteFile(path.join(metaDir, "registry.json"), `${JSON.stringify(registry, null, 2)}\n`);
	atomicWriteFile(path.join(metaDir, "backlinks.json"), `${JSON.stringify(backlinks, null, 2)}\n`);
	atomicWriteFile(path.join(metaDir, "index.md"), renderIndex(registry));
	rebuildLog(wikiRoot);
	return { registry, backlinks };
}

export function loadRegistry(wikiRoot: string): RegistryData {
	const fp = path.join(wikiRoot, "meta", "registry.json");
	try {
		return JSON.parse(readFileSync(fp, "utf-8")) as RegistryData;
	} catch {
		return rebuildAllMeta(wikiRoot).registry;
	}
}

// --- Events ---

export async function appendEvent(wikiRoot: string, event: WikiEvent): Promise<void> {
	const fp = path.join(wikiRoot, "meta", "events.jsonl");
	mkdirSync(path.join(wikiRoot, "meta"), { recursive: true });
	const existing = await readEvents(wikiRoot);
	existing.push(event);
	writeFileSync(fp, `${existing.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf-8");
}

export async function readEvents(wikiRoot: string): Promise<WikiEvent[]> {
	const fp = path.join(wikiRoot, "meta", "events.jsonl");
	try {
		return readFileSync(fp, "utf-8")
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean)
			.map((l) => JSON.parse(l) as WikiEvent);
	} catch {
		return [];
	}
}

function rebuildLog(wikiRoot: string): void {
	const fp = path.join(wikiRoot, "meta", "events.jsonl");
	let events: WikiEvent[] = [];
	try {
		events = readFileSync(fp, "utf-8")
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l) as WikiEvent);
	} catch {
		// empty
	}
	const lines = ["# Wiki Log", ""];
	if (events.length === 0) {
		lines.push("_No events yet._");
	} else {
		for (const e of events) {
			lines.push(`## [${e.ts.slice(0, 16).replace("T", " ")} UTC] ${e.kind} | ${e.title}`);
			if (e.sourceIds?.length) lines.push(`- Sources: ${e.sourceIds.join(", ")}`);
			if (e.pagePaths?.length) lines.push(`- Pages: ${e.pagePaths.join(", ")}`);
			lines.push("");
		}
	}
	atomicWriteFile(path.join(wikiRoot, "meta", "log.md"), `${lines.join("\n").trimEnd()}\n`);
}

// --- Status ---

export function handleWikiStatus(wikiRoot: string): ActionResult {
	if (!existsSync(path.join(wikiRoot, "pages"))) {
		return ok({ text: "Wiki not initialized.", details: { initialized: false } });
	}
	const registry = loadRegistry(wikiRoot);
	const totals = {
		all: registry.pages.length,
		source: registry.pages.filter((p) => p.type === "source").length,
		canonical: registry.pages.filter((p) => p.type !== "source").length,
	};
	const captured = registry.pages.filter((p) => p.type === "source" && p.status === "captured").length;
	const integrated = registry.pages.filter((p) => p.type === "source" && p.status === "integrated").length;
	const text = [
		`Pages: ${totals.all} total (${totals.source} source, ${totals.canonical} canonical)`,
		`Sources: ${captured} captured, ${integrated} integrated`,
	].join("\n");
	return ok({ text, details: { totals, captured, integrated } });
}

// --- Wiki digest for persona injection ---

export function buildWikiDigest(wikiRoot: string): string {
	if (!existsSync(path.join(wikiRoot, "meta", "registry.json"))) return "";
	const registry = loadRegistry(wikiRoot);
	const active = registry.pages
		.filter((p) => p.type !== "source" && p.status === "active")
		.sort((a, b) => b.wordCount - a.wordCount)
		.slice(0, 15);
	if (active.length === 0) return "";
	const lines = ["\n\n[WIKI MEMORY DIGEST]"];
	for (const p of active) {
		const summary = p.summary ? ` — ${p.summary}` : "";
		lines.push(`- ${p.title} (${p.type})${summary}`);
	}
	return lines.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/extensions/wiki.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add core/pi/extensions/wiki/actions-meta.ts tests/extensions/wiki.test.ts
git commit -m "Add wiki metadata rebuild engine: registry, backlinks, index, log, events"
```

---

## Task 3: Search

**Files:**
- Create: `core/pi/extensions/wiki/actions-search.ts`
- Test: `tests/extensions/wiki.test.ts` (append)

- [ ] **Step 1: Write failing test for search scoring**

Append to `tests/extensions/wiki.test.ts`:

```ts
describe("wiki search", () => {
	it("finds pages by title match", async () => {
		const { searchRegistry } = await import("../../core/pi/extensions/wiki/actions-search.js");
		const registry: import("../../core/pi/extensions/wiki/types.js").RegistryData = {
			version: 1,
			generatedAt: "2026-04-10",
			pages: [
				{ type: "concept", path: "pages/retrieval.md", title: "Retrieval Augmented Generation", aliases: ["RAG"], summary: "A pattern", status: "active", tags: ["ai"], updated: "2026-04-10", sourceIds: [], linksOut: [], headings: ["Current understanding"], wordCount: 50 },
				{ type: "entity", path: "pages/openai.md", title: "OpenAI", aliases: [], summary: "AI company", status: "active", tags: [], updated: "2026-04-10", sourceIds: [], linksOut: [], headings: [], wordCount: 20 },
			],
		};
		const result = searchRegistry(registry, "RAG", undefined, 10);
		expect(result.matches.length).toBeGreaterThan(0);
		expect(result.matches[0].title).toBe("Retrieval Augmented Generation");
	});

	it("filters by type", async () => {
		const { searchRegistry } = await import("../../core/pi/extensions/wiki/actions-search.js");
		const registry: import("../../core/pi/extensions/wiki/types.js").RegistryData = {
			version: 1,
			generatedAt: "2026-04-10",
			pages: [
				{ type: "concept", path: "pages/a.md", title: "AI Concept", aliases: [], summary: "", status: "active", tags: [], updated: "", sourceIds: [], linksOut: [], headings: [], wordCount: 10 },
				{ type: "entity", path: "pages/b.md", title: "AI Entity", aliases: [], summary: "", status: "active", tags: [], updated: "", sourceIds: [], linksOut: [], headings: [], wordCount: 10 },
			],
		};
		const result = searchRegistry(registry, "AI", "entity", 10);
		expect(result.matches).toHaveLength(1);
		expect(result.matches[0].type).toBe("entity");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/extensions/wiki.test.ts`
Expected: FAIL

- [ ] **Step 3: Create actions-search.ts**

```ts
// core/pi/extensions/wiki/actions-search.ts
import { ok } from "../../../lib/utils.js";
import type { ActionResult, RegistryData, RegistryEntry, WikiPageType } from "./types.js";

export interface SearchMatch {
	type: string;
	path: string;
	title: string;
	summary: string;
	score: number;
}

export interface SearchResult {
	query: string;
	matches: SearchMatch[];
}

function tokenize(input: string): string[] {
	return [...new Set(input.split(/[^a-z0-9]+/).filter(Boolean))];
}

function scoreEntry(entry: RegistryEntry, normalized: string, tokens: string[]): number {
	let score = 0;
	const title = entry.title.toLowerCase();
	const aliases = entry.aliases.map((a) => a.toLowerCase());
	const summary = entry.summary.toLowerCase();
	const headings = entry.headings.map((h) => h.toLowerCase());
	const tags = entry.tags.map((t) => t.toLowerCase());
	const sourceIds = entry.sourceIds.map((s) => s.toLowerCase());
	const p = entry.path.toLowerCase();

	if (title === normalized) score += 120;
	if (aliases.includes(normalized)) score += 110;
	if (summary.includes(normalized)) score += 50;
	if (sourceIds.includes(normalized)) score += 45;
	if (p.includes(normalized)) score += 40;
	if (headings.some((h) => h.includes(normalized))) score += 35;

	for (const t of tokens) {
		if (title.includes(t)) score += 18;
		if (aliases.some((a) => a.includes(t))) score += 14;
		if (summary.includes(t)) score += 8;
		if (headings.some((h) => h.includes(t))) score += 6;
		if (tags.some((tag) => tag.includes(t))) score += 4;
		if (sourceIds.some((s) => s.includes(t))) score += 5;
		if (p.includes(t)) score += 3;
	}
	return score;
}

export function searchRegistry(registry: RegistryData, query: string, type?: WikiPageType | string, limit = 10): SearchResult {
	const normalized = query.trim().toLowerCase();
	const tokens = tokenize(normalized);
	const matches = registry.pages
		.filter((e) => !type || e.type === type)
		.map((e) => ({ entry: e, score: scoreEntry(e, normalized, tokens) }))
		.filter((m) => m.score > 0)
		.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
		.slice(0, limit)
		.map(({ entry, score }) => ({
			type: entry.type,
			path: entry.path,
			title: entry.title,
			summary: entry.summary,
			score,
		}));
	return { query, matches };
}

export function handleWikiSearch(registry: RegistryData, query: string, type?: string, limit?: number): ActionResult {
	const result = searchRegistry(registry, query, type as WikiPageType | undefined, limit);
	if (result.matches.length === 0) {
		return ok({ text: `No wiki matches for: ${query}`, details: { query, matches: [] } });
	}
	const lines = [`Top matches for: ${query}`, ...result.matches.map((m) => `- [${m.score}] ${m.title} (${m.type}) — ${m.path}`)];
	return ok({ text: lines.join("\n"), details: result });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/extensions/wiki.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add core/pi/extensions/wiki/actions-search.ts tests/extensions/wiki.test.ts
git commit -m "Add wiki search with token-based registry scoring"
```

---

## Task 4: Source capture

**Files:**
- Create: `core/pi/extensions/wiki/actions-capture.ts`
- Test: `tests/extensions/wiki.test.ts` (append)

- [ ] **Step 1: Write failing test for text capture**

Append to `tests/extensions/wiki.test.ts`:

```ts
describe("wiki capture", () => {
	it("captures text into a source packet and source page", async () => {
		const { captureText } = await import("../../core/pi/extensions/wiki/actions-capture.js");
		mkdirSync(path.join(wikiRoot, "raw"), { recursive: true });
		mkdirSync(path.join(wikiRoot, "pages", "sources"), { recursive: true });
		mkdirSync(path.join(wikiRoot, "meta"), { recursive: true });

		const result = captureText(wikiRoot, "This is my note about AI alignment.", { title: "AI Alignment Note", tags: ["ai"] });
		expect(result.isOk()).toBe(true);
		if (!result.isOk()) return;

		const details = result.value.details as { sourceId: string; packetDir: string; sourcePagePath: string };
		expect(details.sourceId).toMatch(/^SRC-\d{4}-\d{2}-\d{2}-\d{3}$/);
		expect(existsSync(path.join(wikiRoot, details.packetDir, "manifest.json"))).toBe(true);
		expect(existsSync(path.join(wikiRoot, details.packetDir, "extracted.md"))).toBe(true);
		expect(existsSync(path.join(wikiRoot, details.sourcePagePath))).toBe(true);

		const manifest = JSON.parse(readFileSync(path.join(wikiRoot, details.packetDir, "manifest.json"), "utf-8"));
		expect(manifest.status).toBe("captured");
		expect(manifest.kind).toBe("note");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/extensions/wiki.test.ts`
Expected: FAIL

- [ ] **Step 3: Create actions-capture.ts**

```ts
// core/pi/extensions/wiki/actions-capture.ts
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stringifyFrontmatter } from "../../../lib/frontmatter.js";
import { atomicWriteFile } from "../../../lib/filesystem.js";
import { ok, err, nowIso } from "../../../lib/utils.js";
import { makeSourceId, todayStamp } from "./paths.js";
import { appendEvent } from "./actions-meta.js";
import type { ActionResult, SourceManifest } from "./types.js";

function sha256(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function listExistingSourceIds(wikiRoot: string): string[] {
	const dir = path.join(wikiRoot, "raw");
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((e) => e.isDirectory() && e.name.startsWith("SRC-"))
			.map((e) => e.name);
	} catch {
		return [];
	}
}

function createSourcePage(wikiRoot: string, sourceId: string, title: string, kind: string, capturedAt: string, originType: string, originValue: string, tags: string[]): string {
	const fm: Record<string, unknown> = {
		type: "source",
		source_id: sourceId,
		title,
		kind,
		status: "captured",
		captured_at: capturedAt,
		origin_type: originType,
		origin_value: originValue,
		aliases: [],
		tags,
		source_ids: [sourceId],
		summary: "",
	};
	const body = [
		`# ${title}`,
		"",
		"## Source at a glance",
		`- Source ID: ${sourceId}`,
		`- Kind: ${kind}`,
		`- Captured: ${capturedAt}`,
		`- Origin: ${originType}`,
		"",
		"## Summary",
		"",
		"## Key claims",
		"",
		"## Entities and concepts mentioned",
		"",
		"## Reliability / caveats",
		"",
		"## Integration targets",
		"",
		"## Open questions",
		"",
	].join("\n");
	const content = stringifyFrontmatter(fm, body);
	const rel = path.join("pages", "sources", `${sourceId}.md`);
	const abs = path.join(wikiRoot, rel);
	mkdirSync(path.dirname(abs), { recursive: true });
	atomicWriteFile(abs, content);
	return rel;
}

export function captureText(
	wikiRoot: string,
	text: string,
	options?: { title?: string; kind?: string; tags?: string[] },
	now = new Date(),
): ActionResult {
	const existingIds = listExistingSourceIds(wikiRoot);
	const sourceId = makeSourceId(existingIds, now);
	const packetDir = path.join("raw", sourceId);
	const absPacket = path.join(wikiRoot, packetDir);
	mkdirSync(path.join(absPacket, "original"), { recursive: true });

	const capturedAt = now.toISOString();
	const title = options?.title ?? text.split("\n").find((l) => l.trim())?.slice(0, 80) ?? sourceId;
	const kind = options?.kind ?? "note";
	const hash = sha256(text);

	writeFileSync(path.join(absPacket, "original", "source.txt"), text, "utf-8");
	writeFileSync(path.join(absPacket, "extracted.md"), text, "utf-8");

	const manifest: SourceManifest = {
		version: 1,
		sourceId,
		title,
		kind,
		origin: { type: "text", value: "(inline)" },
		capturedAt,
		hash,
		status: "captured",
	};
	atomicWriteFile(path.join(absPacket, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

	const sourcePagePath = createSourcePage(wikiRoot, sourceId, title, kind, capturedAt, "text", "(inline)", options?.tags ?? []);

	appendEvent(wikiRoot, { ts: capturedAt, kind: "capture", title: `Captured ${title}`, sourceIds: [sourceId], pagePaths: [sourcePagePath] });

	return ok({
		text: `Captured ${sourceId}: ${title}`,
		details: { sourceId, packetDir, sourcePagePath, title, status: "captured" },
	});
}

export function captureFile(
	wikiRoot: string,
	absoluteFilePath: string,
	options?: { title?: string; kind?: string; tags?: string[] },
	now = new Date(),
): ActionResult {
	if (!existsSync(absoluteFilePath)) return err(`File not found: ${absoluteFilePath}`);

	const existingIds = listExistingSourceIds(wikiRoot);
	const sourceId = makeSourceId(existingIds, now);
	const packetDir = path.join("raw", sourceId);
	const absPacket = path.join(wikiRoot, packetDir);
	mkdirSync(path.join(absPacket, "original"), { recursive: true });

	const capturedAt = now.toISOString();
	const ext = path.extname(absoluteFilePath) || ".bin";
	const destOriginal = path.join(absPacket, "original", `source${ext}`);
	copyFileSync(absoluteFilePath, destOriginal);

	const content = readFileSync(absoluteFilePath, "utf-8");
	const hash = sha256(content);
	writeFileSync(path.join(absPacket, "extracted.md"), content, "utf-8");

	const title = options?.title ?? path.basename(absoluteFilePath, ext);
	const kind = options?.kind ?? (ext === ".pdf" ? "pdf" : "note");

	const manifest: SourceManifest = {
		version: 1,
		sourceId,
		title,
		kind,
		origin: { type: "file", value: absoluteFilePath },
		capturedAt,
		hash,
		status: "captured",
	};
	atomicWriteFile(path.join(absPacket, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

	const sourcePagePath = createSourcePage(wikiRoot, sourceId, title, kind, capturedAt, "file", absoluteFilePath, options?.tags ?? []);

	appendEvent(wikiRoot, { ts: capturedAt, kind: "capture", title: `Captured ${title}`, sourceIds: [sourceId], pagePaths: [sourcePagePath] });

	return ok({
		text: `Captured ${sourceId}: ${title}`,
		details: { sourceId, packetDir, sourcePagePath, title, status: "captured" },
	});
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/extensions/wiki.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add core/pi/extensions/wiki/actions-capture.ts tests/extensions/wiki.test.ts
git commit -m "Add wiki source capture: text and file capture with packet + source page"
```

---

## Task 5: Ensure page (resolve/create/conflict)

**Files:**
- Create: `core/pi/extensions/wiki/actions-pages.ts`
- Test: `tests/extensions/wiki.test.ts` (append)

- [ ] **Step 1: Write failing tests**

Append to `tests/extensions/wiki.test.ts`:

```ts
describe("wiki ensure page", () => {
	it("creates a new page when none exists", async () => {
		const { handleEnsurePage } = await import("../../core/pi/extensions/wiki/actions-pages.js");
		const { rebuildAllMeta } = await import("../../core/pi/extensions/wiki/actions-meta.js");
		rebuildAllMeta(wikiRoot);

		const result = handleEnsurePage(wikiRoot, { type: "concept", title: "Test Concept" });
		expect(result.isOk()).toBe(true);
		if (!result.isOk()) return;
		const details = result.value.details as { created: boolean; path: string };
		expect(details.created).toBe(true);
		expect(existsSync(path.join(wikiRoot, details.path))).toBe(true);
	});

	it("resolves an existing page by title", async () => {
		const { handleEnsurePage } = await import("../../core/pi/extensions/wiki/actions-pages.js");
		const { rebuildAllMeta } = await import("../../core/pi/extensions/wiki/actions-meta.js");
		writeFileSync(
			path.join(wikiRoot, "pages", "test-concept.md"),
			"---\ntype: concept\ntitle: Test Concept\naliases: []\ntags: []\nstatus: draft\nupdated: 2026-04-10\nsource_ids: []\nsummary: \n---\n# Test Concept\n",
		);
		rebuildAllMeta(wikiRoot);

		const result = handleEnsurePage(wikiRoot, { type: "concept", title: "Test Concept" });
		expect(result.isOk()).toBe(true);
		if (!result.isOk()) return;
		const details = result.value.details as { created: boolean; resolved: boolean };
		expect(details.created).toBe(false);
		expect(details.resolved).toBe(true);
	});

	it("resolves by alias", async () => {
		const { handleEnsurePage } = await import("../../core/pi/extensions/wiki/actions-pages.js");
		const { rebuildAllMeta } = await import("../../core/pi/extensions/wiki/actions-meta.js");
		writeFileSync(
			path.join(wikiRoot, "pages", "rag.md"),
			"---\ntype: concept\ntitle: Retrieval Augmented Generation\naliases:\n  - RAG\ntags: []\nstatus: draft\nupdated: 2026-04-10\nsource_ids: []\nsummary: \n---\n# RAG\n",
		);
		rebuildAllMeta(wikiRoot);

		const result = handleEnsurePage(wikiRoot, { type: "concept", title: "RAG" });
		expect(result.isOk()).toBe(true);
		if (!result.isOk()) return;
		const details = result.value.details as { created: boolean; resolved: boolean; path: string };
		expect(details.created).toBe(false);
		expect(details.resolved).toBe(true);
		expect(details.path).toBe("pages/rag.md");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/extensions/wiki.test.ts`
Expected: FAIL

- [ ] **Step 3: Create actions-pages.ts**

```ts
// core/pi/extensions/wiki/actions-pages.ts
import { mkdirSync } from "node:fs";
import path from "node:path";
import { stringifyFrontmatter } from "../../../lib/frontmatter.js";
import { atomicWriteFile } from "../../../lib/filesystem.js";
import { ok, nowIso } from "../../../lib/utils.js";
import { dedupeSlug, slugifyTitle, todayStamp } from "./paths.js";
import { loadRegistry, appendEvent } from "./actions-meta.js";
import type { ActionResult, CanonicalPageType, RegistryData } from "./types.js";

interface EnsurePageParams {
	type: CanonicalPageType;
	title: string;
	aliases?: string[];
	tags?: string[];
	summary?: string;
}

export function handleEnsurePage(wikiRoot: string, params: EnsurePageParams): ActionResult {
	const registry = loadRegistry(wikiRoot);
	const normalizedTitle = params.title.trim().toLowerCase();
	const normalizedAliases = new Set((params.aliases ?? []).map((a) => a.trim().toLowerCase()));

	const matches = registry.pages.filter((p) => {
		if (p.type !== params.type) return false;
		const names = [p.title, ...p.aliases].map((v) => v.trim().toLowerCase());
		return names.includes(normalizedTitle) || [...normalizedAliases].some((a) => names.includes(a));
	});

	if (matches.length > 1) {
		return ok({
			text: `Conflict: ${matches.length} pages matched "${params.title}". Candidates: ${matches.map((p) => p.path).join(", ")}`,
			details: { resolved: false, created: false, conflict: true, candidates: matches.map((p) => ({ path: p.path, title: p.title })) },
		});
	}

	if (matches.length === 1) {
		const page = matches[0];
		return ok({
			text: `Resolved existing page: ${page.path}`,
			details: { resolved: true, created: false, conflict: false, path: page.path, title: page.title, type: page.type },
		});
	}

	// Create new page
	const existingSlugs = registry.pages.filter((p) => p.type === params.type).map((p) => path.basename(p.path, ".md"));
	const slug = dedupeSlug(slugifyTitle(params.title), existingSlugs);
	const relPath = `pages/${slug}.md`;
	const absPath = path.join(wikiRoot, relPath);

	const fm: Record<string, unknown> = {
		type: params.type,
		title: params.title,
		aliases: params.aliases ?? [],
		tags: params.tags ?? [],
		status: "draft",
		updated: todayStamp(),
		source_ids: [],
		summary: params.summary ?? "",
	};
	const body = [
		`# ${params.title}`,
		"",
		"## Current understanding",
		"",
		"## Evidence",
		"",
		"## Tensions / caveats",
		"",
		"## Open questions",
		"",
		"## Related pages",
		"",
	].join("\n");

	mkdirSync(path.dirname(absPath), { recursive: true });
	atomicWriteFile(absPath, stringifyFrontmatter(fm, body));

	appendEvent(wikiRoot, { ts: nowIso(), kind: "page-create", title: `Created ${params.type}: ${params.title}`, pagePaths: [relPath] });

	return ok({
		text: `Created page: ${relPath}`,
		details: { resolved: true, created: true, conflict: false, path: relPath, title: params.title, type: params.type },
	});
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/extensions/wiki.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add core/pi/extensions/wiki/actions-pages.ts tests/extensions/wiki.test.ts
git commit -m "Add wiki ensure page: resolve existing, create new, detect conflicts"
```

---

## Task 6: Lint

**Files:**
- Create: `core/pi/extensions/wiki/actions-lint.ts`
- Test: `tests/extensions/wiki.test.ts` (append)

- [ ] **Step 1: Write failing test for lint**

Append to `tests/extensions/wiki.test.ts`:

```ts
describe("wiki lint", () => {
	it("detects missing frontmatter fields", async () => {
		const { handleWikiLint } = await import("../../core/pi/extensions/wiki/actions-lint.js");
		writeFileSync(path.join(wikiRoot, "pages", "bad.md"), "---\ntype: concept\n---\n# Bad\n");
		const result = handleWikiLint(wikiRoot, "frontmatter");
		expect(result.isOk()).toBe(true);
		if (!result.isOk()) return;
		const details = result.value.details as { counts: { frontmatter: number } };
		expect(details.counts.frontmatter).toBeGreaterThan(0);
	});

	it("detects broken wikilinks", async () => {
		const { handleWikiLint } = await import("../../core/pi/extensions/wiki/actions-lint.js");
		writeFileSync(
			path.join(wikiRoot, "pages", "linker.md"),
			"---\ntype: concept\ntitle: Linker\naliases: []\ntags: []\nstatus: active\nupdated: 2026-04-10\nsource_ids: []\nsummary: \n---\n# Linker\n\nSee [[nonexistent-page]].\n",
		);
		const result = handleWikiLint(wikiRoot, "links");
		expect(result.isOk()).toBe(true);
		if (!result.isOk()) return;
		const details = result.value.details as { counts: { brokenLinks: number } };
		expect(details.counts.brokenLinks).toBeGreaterThan(0);
	});

	it("detects orphan pages", async () => {
		const { handleWikiLint } = await import("../../core/pi/extensions/wiki/actions-lint.js");
		writeFileSync(
			path.join(wikiRoot, "pages", "orphan.md"),
			"---\ntype: concept\ntitle: Orphan\naliases: []\ntags: []\nstatus: active\nupdated: 2026-04-10\nsource_ids: []\nsummary: \n---\n# Orphan\n\nNo links.\n",
		);
		const result = handleWikiLint(wikiRoot, "orphans");
		expect(result.isOk()).toBe(true);
		if (!result.isOk()) return;
		const details = result.value.details as { counts: { orphans: number } };
		expect(details.counts.orphans).toBeGreaterThan(0);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/extensions/wiki.test.ts`
Expected: FAIL

- [ ] **Step 3: Create actions-lint.ts**

```ts
// core/pi/extensions/wiki/actions-lint.ts
import path from "node:path";
import { atomicWriteFile } from "../../../lib/filesystem.js";
import { ok } from "../../../lib/utils.js";
import { scanPages, buildRegistry, buildBacklinks } from "./actions-meta.js";
import { normalizeWikiLink } from "./paths.js";
import type { ActionResult, BacklinksData, LintIssue, LintRun, RegistryData } from "./types.js";

const CANONICAL_REQUIRED = ["type", "title", "status", "updated", "source_ids", "summary"] as const;
const SOURCE_REQUIRED = ["type", "source_id", "title", "status", "captured_at", "origin_type", "origin_value", "source_ids"] as const;

function lintLinks(pages: ReturnType<typeof scanPages>, registry: RegistryData): LintIssue[] {
	const known = new Set(registry.pages.map((p) => p.path));
	const issues: LintIssue[] = [];
	for (const page of pages) {
		for (const raw of page.rawLinks) {
			const normalized = normalizeWikiLink(raw);
			if (!normalized || !known.has(normalized)) {
				issues.push({ kind: "broken-link", severity: "warning", path: page.relativePath, message: `Broken link: [[${raw}]]` });
			}
		}
	}
	return issues;
}

function lintOrphans(registry: RegistryData, backlinks: BacklinksData): LintIssue[] {
	return registry.pages
		.filter((p) => p.type !== "source")
		.filter((p) => {
			const rec = backlinks.byPath[p.path];
			return rec && rec.inbound.length === 0 && rec.outbound.length === 0;
		})
		.map((p) => ({ kind: "orphan", severity: "warning" as const, path: p.path, message: "No inbound or outbound wiki links." }));
}

function lintFrontmatter(pages: ReturnType<typeof scanPages>): LintIssue[] {
	const issues: LintIssue[] = [];
	for (const page of pages) {
		const required = page.frontmatter.type === "source" ? SOURCE_REQUIRED : CANONICAL_REQUIRED;
		for (const field of required) {
			if (!(field in page.frontmatter)) {
				issues.push({ kind: "frontmatter", severity: "error", path: page.relativePath, message: `Missing: ${field}` });
			}
		}
	}
	return issues;
}

function lintDuplicates(registry: RegistryData): LintIssue[] {
	const issues: LintIssue[] = [];
	const seen = new Map<string, string>();
	for (const p of registry.pages.filter((e) => e.type !== "source")) {
		const norm = p.title.trim().toLowerCase();
		if (seen.has(norm)) {
			issues.push({ kind: "duplicate", severity: "warning", path: p.path, message: `Duplicate title with ${seen.get(norm)}` });
		} else {
			seen.set(norm, p.path);
		}
	}
	return issues;
}

function lintCoverage(registry: RegistryData, backlinks: BacklinksData): LintIssue[] {
	const issues: LintIssue[] = [];
	for (const p of registry.pages) {
		if (p.type === "source") {
			const inbound = backlinks.byPath[p.path]?.inbound ?? [];
			if (inbound.filter((i) => !i.includes("/sources/")).length === 0) {
				issues.push({ kind: "coverage", severity: "info", path: p.path, message: "Source not cited by any canonical page." });
			}
		} else if (p.sourceIds.length === 0) {
			issues.push({ kind: "coverage", severity: "warning", path: p.path, message: "No source_ids listed." });
		}
	}
	return issues;
}

function lintStaleness(registry: RegistryData): LintIssue[] {
	return registry.pages
		.filter((p) => p.type === "source" && p.status === "captured")
		.map((p) => ({ kind: "staleness", severity: "info" as const, path: p.path, message: "Source still in captured state." }));
}

export function handleWikiLint(wikiRoot: string, mode = "all"): ActionResult {
	const pages = scanPages(wikiRoot);
	const registry = buildRegistry(pages);
	const backlinks = buildBacklinks(registry);
	const all: LintIssue[] = [];

	if (mode === "links" || mode === "all") all.push(...lintLinks(pages, registry));
	if (mode === "orphans" || mode === "all") all.push(...lintOrphans(registry, backlinks));
	if (mode === "frontmatter" || mode === "all") all.push(...lintFrontmatter(pages));
	if (mode === "duplicates" || mode === "all") all.push(...lintDuplicates(registry));
	if (mode === "coverage" || mode === "all") all.push(...lintCoverage(registry, backlinks));
	if (mode === "staleness" || mode === "all") all.push(...lintStaleness(registry));

	const counts = {
		total: all.length,
		brokenLinks: all.filter((i) => i.kind === "broken-link").length,
		orphans: all.filter((i) => i.kind === "orphan").length,
		frontmatter: all.filter((i) => i.kind === "frontmatter").length,
		duplicates: all.filter((i) => i.kind === "duplicate").length,
		coverage: all.filter((i) => i.kind === "coverage").length,
		staleness: all.filter((i) => i.kind === "staleness").length,
	};

	const report = [`# Lint Report`, ``, `Mode: ${mode}`, `Total: ${counts.total}`, ``, ...all.map((i) => `- **${i.severity}** [${i.kind}] \`${i.path}\` — ${i.message}`), ""].join("\n");
	atomicWriteFile(path.join(wikiRoot, "meta", "lint-report.md"), report);

	const text = `Lint: ${counts.total} issues (links=${counts.brokenLinks} orphans=${counts.orphans} fm=${counts.frontmatter} dup=${counts.duplicates} cov=${counts.coverage} stale=${counts.staleness})`;
	return ok({ text, details: { counts, issues: all } });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/extensions/wiki.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add core/pi/extensions/wiki/actions-lint.ts tests/extensions/wiki.test.ts
git commit -m "Add wiki lint: links, orphans, frontmatter, duplicates, coverage, staleness"
```

---

## Task 7: Extension index (tool registration + hooks)

**Files:**
- Create: `core/pi/extensions/wiki/index.ts`

- [ ] **Step 1: Create index.ts with all 6 tools and 4 hooks**

```ts
// core/pi/extensions/wiki/index.ts
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import { EmptyToolParams, type RegisteredExtensionTool, registerTools, toToolResult } from "../../../lib/utils.js";
import { captureFile, captureText } from "./actions-capture.js";
import { handleWikiLint } from "./actions-lint.js";
import { buildWikiDigest, handleWikiStatus, loadRegistry, rebuildAllMeta } from "./actions-meta.js";
import { handleEnsurePage } from "./actions-pages.js";
import { handleWikiSearch } from "./actions-search.js";
import { getWikiRoot, isProtectedPath, isWikiPagePath } from "./paths.js";
import type { CanonicalPageType } from "./types.js";

const CANONICAL_TYPE_ENUM = StringEnum(["concept", "entity", "synthesis", "analysis", "evolution", "procedure", "decision"] as const);
const LINT_MODE_ENUM = StringEnum(["links", "orphans", "frontmatter", "duplicates", "coverage", "staleness", "all"] as const);

export default function (pi: ExtensionAPI) {
	let dirty = false;

	const tools: RegisteredExtensionTool[] = [
		{
			name: "wiki_status",
			label: "Wiki Status",
			description: "Show wiki page counts, source states, and recent events.",
			parameters: EmptyToolParams,
			async execute() {
				return toToolResult(handleWikiStatus(getWikiRoot()));
			},
		},
		{
			name: "wiki_capture",
			label: "Wiki Capture Source",
			description: "Capture text or a local file into an immutable source packet and create a source page.",
			parameters: Type.Object({
				input_type: StringEnum(["text", "file"] as const),
				value: Type.String({ description: "The text content or absolute file path to capture" }),
				title: Type.Optional(Type.String({ description: "Override title" })),
				kind: Type.Optional(Type.String({ description: "Source kind: note, article, pdf, etc." })),
				tags: Type.Optional(Type.Array(Type.String())),
			}),
			async execute(_toolCallId, params) {
				const p = params as Static<typeof this.parameters>;
				const root = getWikiRoot();
				const result = p.input_type === "file"
					? captureFile(root, p.value, { title: p.title, kind: p.kind, tags: p.tags })
					: captureText(root, p.value, { title: p.title, kind: p.kind, tags: p.tags });
				rebuildAllMeta(root);
				return toToolResult(result);
			},
		},
		{
			name: "wiki_search",
			label: "Wiki Search",
			description: "Search the wiki registry by title, alias, tags, type, or free text.",
			parameters: Type.Object({
				query: Type.String({ description: "Search query" }),
				type: Type.Optional(CANONICAL_TYPE_ENUM),
				limit: Type.Optional(Type.Number({ description: "Max results", default: 10 })),
			}),
			async execute(_toolCallId, params) {
				const p = params as { query: string; type?: string; limit?: number };
				return toToolResult(handleWikiSearch(loadRegistry(getWikiRoot()), p.query, p.type, p.limit));
			},
		},
		{
			name: "wiki_ensure_page",
			label: "Wiki Ensure Page",
			description: "Resolve an existing canonical page by title/alias, or create it if missing. Deduplicates.",
			parameters: Type.Object({
				type: CANONICAL_TYPE_ENUM,
				title: Type.String({ description: "Page title" }),
				aliases: Type.Optional(Type.Array(Type.String())),
				tags: Type.Optional(Type.Array(Type.String())),
				summary: Type.Optional(Type.String({ description: "One-line summary" })),
			}),
			async execute(_toolCallId, params) {
				const p = params as { type: CanonicalPageType; title: string; aliases?: string[]; tags?: string[]; summary?: string };
				const result = handleEnsurePage(getWikiRoot(), p);
				rebuildAllMeta(getWikiRoot());
				return toToolResult(result);
			},
		},
		{
			name: "wiki_lint",
			label: "Wiki Lint",
			description: "Run structural health checks: broken links, orphans, frontmatter, duplicates, coverage, staleness.",
			parameters: Type.Object({
				mode: Type.Optional(LINT_MODE_ENUM),
			}),
			async execute(_toolCallId, params) {
				const p = params as { mode?: string };
				return toToolResult(handleWikiLint(getWikiRoot(), p.mode));
			},
		},
		{
			name: "wiki_rebuild",
			label: "Wiki Rebuild Meta",
			description: "Force-rebuild the wiki registry, backlinks, index, and log from current pages.",
			parameters: EmptyToolParams,
			async execute() {
				rebuildAllMeta(getWikiRoot());
				return toToolResult({ isOk: () => true, isErr: () => false, value: { text: "Rebuilt wiki metadata." } } as any);
			},
		},
	];
	registerTools(pi, tools);

	// --- Hooks ---

	pi.on("tool_call", async (event) => {
		if (event.toolName !== "write" && event.toolName !== "edit") return undefined;
		const root = getWikiRoot();
		const inputPath = (event.input as { path?: string }).path;
		if (!inputPath) return undefined;
		const abs = require("node:path").resolve(inputPath);
		if (isProtectedPath(root, abs)) {
			return { block: true, reason: `Wiki protects this path. Use wiki tools to modify raw/ and meta/.` };
		}
		if (isWikiPagePath(root, abs)) {
			dirty = true;
		}
		return undefined;
	});

	pi.on("agent_end", async () => {
		if (!dirty) return;
		dirty = false;
		rebuildAllMeta(getWikiRoot());
	});

	pi.on("before_agent_start", async (event) => {
		const digest = buildWikiDigest(getWikiRoot());
		if (!digest) return;
		return { systemPrompt: event.systemPrompt + digest };
	});
}
```

- [ ] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to wiki extension

- [ ] **Step 3: Commit**

```bash
git add core/pi/extensions/wiki/index.ts
git commit -m "Add wiki extension index: 6 tools, tool_call/agent_end/before_agent_start hooks"
```

---

## Task 8: Wiki-maintainer skill

**Files:**
- Create: `core/pi/skills/wiki-maintainer/SKILL.md`

- [ ] **Step 1: Create the skill file**

```markdown
---
name: wiki-maintainer
description: Maintain a persistent interlinked markdown wiki from raw sources. Use when capturing sources, integrating into canonical pages, answering questions from the wiki, or running audits.
---

# Wiki Maintainer

You are maintaining a persistent markdown wiki under ~/nixpi/Wiki/ with three layers:

1. **raw/** — immutable source packets (never edit directly)
2. **pages/** — editable wiki pages (source pages + canonical pages)
3. **meta/** — generated registry, backlinks, index, logs (never edit directly)

## Rules

1. Never edit raw/ or meta/ directly. Use wiki tools.
2. Every source must become a source page before it influences canonical pages.
3. Search before creating. Use wiki_search then wiki_ensure_page.
4. Cite factual claims with source page links: [[sources/SRC-2026-04-10-001|SRC-2026-04-10-001]]
5. Use Tensions / caveats and Open questions when evidence is uncertain.
6. Query mode is read-only by default. Only file analysis pages when asked.

## Capture workflow

1. wiki_capture (text or file)
2. Read the source page in pages/sources/
3. Improve the source page
4. wiki_search for impacted canonical pages
5. wiki_ensure_page for missing pages
6. Update canonical pages with citations

## Query workflow

1. wiki_search
2. Read relevant pages
3. Synthesize answer with citations
4. Only create analysis pages if explicitly asked

## Audit workflow

1. wiki_lint for mechanical issues
2. Reason about semantic gaps, contradictions, stale claims
3. Report tensions before resolving them

## Page types

All canonical pages use frontmatter type field: concept, entity, synthesis, analysis, evolution, procedure, decision.

Source pages live in pages/sources/. Everything else is flat in pages/.
```

- [ ] **Step 2: Commit**

```bash
git add core/pi/skills/wiki-maintainer/SKILL.md
git commit -m "Add wiki-maintainer skill: teaches Pi wiki maintenance workflows"
```

---

## Task 9: Remove old extensions and wire up new one

**Files:**
- Delete: `core/pi/extensions/objects/` (all files)
- Delete: `core/pi/extensions/episodes/` (all files)
- Delete: `core/pi/skills/object-store/SKILL.md`
- Delete: `tests/extensions/objects.test.ts`
- Delete: `tests/extensions/episodes.test.ts`
- Delete: `tests/integration/object-lifecycle.test.ts`
- Delete: `tests/integration/nixpi-seeding.test.ts`
- Modify: `core/lib/interactions.ts` — strip to only `requireConfirmation`
- Modify: `core/pi/extensions/persona/index.ts` — import wiki digest
- Modify: `core/pi/extensions/nixpi/actions.ts` — bootstrap Wiki/ dirs
- Modify: `package.json` — update extension list
- Modify: `tests/e2e/extension-registration.test.ts`
- Modify: `vitest.config.ts` — remove nixos_vps_provisioner path

- [ ] **Step 1: Delete old extension directories and tests**

```bash
rm -rf core/pi/extensions/objects/
rm -rf core/pi/extensions/episodes/
rm -rf core/pi/skills/object-store/
rm -f tests/extensions/objects.test.ts
rm -f tests/extensions/episodes.test.ts
rm -f tests/extensions/os-update.test.ts
rm -f tests/integration/object-lifecycle.test.ts
rm -f tests/integration/nixpi-seeding.test.ts
```

- [ ] **Step 2: Strip interactions.ts to only requireConfirmation**

Replace `core/lib/interactions.ts` with:

```ts
/** Minimal confirmation helper for OS extension actions. */
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export async function requireConfirmation(
	ctx: ExtensionContext,
	action: string,
): Promise<string | null> {
	if (!ctx.hasUI) {
		return `Cannot perform "${action}" without interactive user confirmation.`;
	}
	const confirmed = await ctx.ui.confirm("Confirm action", `Allow: ${action}?`);
	if (!confirmed) return `User declined: ${action}`;
	return null;
}
```

- [ ] **Step 3: Update persona/index.ts to use wiki digest**

In `core/pi/extensions/persona/index.ts`, change the import:

```ts
// OLD:
import { buildMemoryDigest } from "../objects/digest.js";

// NEW:
import { buildWikiDigest } from "../wiki/actions-meta.js";
```

And in the `before_agent_start` handler, change:

```ts
// OLD:
memoryDigest ??= buildMemoryDigest(ctx.cwd);

// NEW:
memoryDigest ??= buildWikiDigest(getWikiRoot());
```

Add the import for `getWikiRoot`:

```ts
import { getWikiRoot } from "../wiki/paths.js";
```

- [ ] **Step 4: Update nixpi/actions.ts — bootstrap Wiki/ dirs**

In `core/pi/extensions/nixpi/actions.ts`, change `NIXPI_DIRS`:

```ts
// OLD:
const NIXPI_DIRS = ["Persona", "Skills", "Evolutions", "Objects", "Episodes", "Agents", "audit"];

// NEW:
const NIXPI_DIRS = ["Persona", "Skills", "Agents", "audit", "Wiki/raw", "Wiki/pages/sources", "Wiki/meta"];
```

- [ ] **Step 5: Update package.json extension list**

In `package.json`, change the `pi.extensions` array:

```json
"pi": {
    "extensions": [
        "./core/pi/extensions/persona",
        "./core/pi/extensions/os",
        "./core/pi/extensions/wiki",
        "./core/pi/extensions/nixpi"
    ],
    "skills": [
        "./core/pi/skills"
    ]
}
```

- [ ] **Step 6: Update extension-registration.test.ts**

Replace the extension list test and remove episodes/objects test blocks:

```ts
describe("runtime package extension list", () => {
    it("ships a curated default extension set", () => {
        const packageJson = JSON.parse(readFileSync("package.json", "utf-8")) as {
            pi?: { extensions?: string[] };
        };
        const extensionList = packageJson.pi?.extensions ?? [];

        expect(extensionList).toEqual([
            "./core/pi/extensions/persona",
            "./core/pi/extensions/os",
            "./core/pi/extensions/wiki",
            "./core/pi/extensions/nixpi",
        ]);
    });
});

// Remove the "episodes registration" and "objects registration" describe blocks entirely.
// Add:

describe("wiki registration", () => {
    it("registers expected tools and events", async () => {
        const mod = await import("../../core/pi/extensions/wiki/index.js");
        const api = createMockExtensionAPI();
        mod.default(api as never);

        expect(toolNames(api)).toEqual(
            expect.arrayContaining(["wiki_status", "wiki_capture", "wiki_search", "wiki_ensure_page", "wiki_lint", "wiki_rebuild"]),
        );
        expect(eventNames(api)).toEqual(expect.arrayContaining(["tool_call", "agent_end", "before_agent_start"]));
    });
});
```

- [ ] **Step 7: Update vitest.config.ts**

Remove `nixos_vps_provisioner` from the include pattern:

```ts
include: ["tests/**/*.test.ts"],
```

- [ ] **Step 8: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass. No import errors.

- [ ] **Step 9: Run biome check**

Run: `npx biome check .`
Expected: No formatting/lint errors (fix any that arise)

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Replace objects/episodes with wiki extension, strip interactions.ts, wire persona digest"
```

---

## Task 10: Update skills, persona, and docs

**Files:**
- Modify: `core/pi/skills/self-evolution/SKILL.md`
- Modify: `core/pi/skills/first-boot/SKILL.md`
- Modify: `core/pi/skills/recovery/SKILL.md`
- Modify: `core/pi/skills/builtin-services/SKILL.md`
- Modify: `core/pi/persona/SKILL.md`
- Modify: `core/pi/persona/FACULTY.md`
- Modify: `docs/reference/memory-model.md`
- Modify: `docs/architecture/index.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Update self-evolution skill**

In `core/pi/skills/self-evolution/SKILL.md`, replace all references to "evolution objects" or "Objects/" with wiki-native language. Evolution proposals are now wiki pages under `pages/` with `type: evolution` frontmatter. Use `wiki_ensure_page type=evolution` to create them.

- [ ] **Step 2: Update first-boot, recovery, builtin-services skills**

Replace references to "Objects/", "Episodes/", "episode_create", "memory_create" etc. with wiki equivalents. "wiki_capture" for capturing observations. "wiki_ensure_page" for creating knowledge pages.

- [ ] **Step 3: Update persona SKILL.md and FACULTY.md**

Replace "object store", "episodic memory", "Objects/", "Episodes/" references with "wiki", "~/nixpi/Wiki/", "wiki pages", "source capture".

- [ ] **Step 4: Rewrite docs/reference/memory-model.md**

Replace the entire file with a description of the wiki memory architecture: raw packets → source pages → canonical pages → generated metadata. Reference the spec for details.

- [ ] **Step 5: Update docs/architecture/index.md**

Update the subsystem table. Replace "Pi Extensions — Tool surface for Pi" with a note about the wiki extension. Remove references to Objects/Episodes from the control flow summary.

- [ ] **Step 6: Update AGENTS.md**

In the Extension Action Pattern section, update the extension list. Replace `objects` and `episodes` references with `wiki`. Document the wiki extension's action files (`actions-capture.ts`, `actions-search.ts`, etc.).

- [ ] **Step 7: Run tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Update skills, persona, and docs for wiki memory model"
```

---

## Task 11: Integration test

**Files:**
- Create: `tests/integration/wiki-lifecycle.test.ts`

- [ ] **Step 1: Write integration test**

```ts
// tests/integration/wiki-lifecycle.test.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTempNixPi, type TempNixPi } from "../helpers/temp-nixpi.js";

let temp: TempNixPi;
let wikiRoot: string;

beforeEach(() => {
	temp = createTempNixPi();
	wikiRoot = path.join(temp.nixPiDir, "Wiki");
	mkdirSync(path.join(wikiRoot, "raw"), { recursive: true });
	mkdirSync(path.join(wikiRoot, "pages", "sources"), { recursive: true });
	mkdirSync(path.join(wikiRoot, "meta"), { recursive: true });
});

afterEach(() => {
	temp.cleanup();
});

describe("wiki lifecycle", () => {
	it("capture → ensure → search → lint end-to-end", async () => {
		const { captureText } = await import("../../core/pi/extensions/wiki/actions-capture.js");
		const { handleEnsurePage } = await import("../../core/pi/extensions/wiki/actions-pages.js");
		const { handleWikiSearch } = await import("../../core/pi/extensions/wiki/actions-search.js");
		const { handleWikiLint } = await import("../../core/pi/extensions/wiki/actions-lint.js");
		const { rebuildAllMeta, loadRegistry } = await import("../../core/pi/extensions/wiki/actions-meta.js");

		// 1. Capture a text source
		const capture = captureText(wikiRoot, "AI alignment is the problem of ensuring AI systems act according to human values.");
		expect(capture.isOk()).toBe(true);

		// 2. Rebuild meta
		rebuildAllMeta(wikiRoot);

		// 3. Ensure a canonical page
		const ensured = handleEnsurePage(wikiRoot, { type: "concept", title: "AI Alignment" });
		expect(ensured.isOk()).toBe(true);
		rebuildAllMeta(wikiRoot);

		// 4. Search for it
		const registry = loadRegistry(wikiRoot);
		const search = handleWikiSearch(registry, "alignment");
		expect(search.isOk()).toBe(true);
		if (search.isOk()) {
			const matches = (search.value.details as { matches: Array<{ title: string }> }).matches;
			expect(matches.some((m) => m.title === "AI Alignment")).toBe(true);
		}

		// 5. Lint
		const lint = handleWikiLint(wikiRoot);
		expect(lint.isOk()).toBe(true);

		// 6. Verify events were logged
		const eventsRaw = readFileSync(path.join(wikiRoot, "meta", "events.jsonl"), "utf-8");
		const events = eventsRaw.trim().split("\n").map((l) => JSON.parse(l));
		expect(events.length).toBeGreaterThanOrEqual(2); // capture + page-create
	});
});
```

- [ ] **Step 2: Run integration test**

Run: `npx vitest run tests/integration/wiki-lifecycle.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add tests/integration/wiki-lifecycle.test.ts
git commit -m "Add wiki lifecycle integration test: capture → ensure → search → lint"
```

---

## Task 12: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Run biome check**

Run: `npm run check`
Expected: Clean

- [ ] **Step 3: Run TypeScript build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 4: Verify no stale imports**

Run: `grep -r "from.*objects" core/ tests/ --include="*.ts" | grep -v node_modules | grep -v dist`
Run: `grep -r "from.*episodes" core/ tests/ --include="*.ts" | grep -v node_modules | grep -v dist`
Expected: No matches

- [ ] **Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "Final cleanup: verify no stale imports, all tests pass"
```
