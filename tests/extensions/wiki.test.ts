import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	appendEvent,
	buildBacklinks,
	buildRegistry,
	buildWikiDigest,
	handleWikiStatus,
	readEvents,
	rebuildAllMeta,
	scanPages,
} from "../../core/pi/extensions/wiki/actions-meta.js";
import { captureFile, captureText } from "../../core/pi/extensions/wiki/actions-capture.js";
import { handleEnsurePage } from "../../core/pi/extensions/wiki/actions-pages.js";
import { handleWikiSearch, searchRegistry } from "../../core/pi/extensions/wiki/actions-search.js";
import {
	countWords,
	dedupeSlug,
	extractHeadings,
	extractWikiLinks,
	isProtectedPath,
	makeSourceId,
	normalizeWikiLink,
	slugifyTitle,
} from "../../core/pi/extensions/wiki/paths.js";

const WIKI_ROOT = "/home/user/nixpi/Wiki";

// ---------------------------------------------------------------------------
// slugifyTitle
// ---------------------------------------------------------------------------
describe("slugifyTitle", () => {
	it("lowercases and kebab-cases a normal title", () => {
		expect(slugifyTitle("Hello World")).toBe("hello-world");
	});

	it("strips non-alphanumeric characters", () => {
		expect(slugifyTitle("Foo: Bar & Baz!")).toBe("foo-bar-baz");
	});

	it("collapses multiple separators into one dash", () => {
		expect(slugifyTitle("foo   ---   bar")).toBe("foo-bar");
	});

	it("strips leading and trailing dashes", () => {
		expect(slugifyTitle("  --hello--  ")).toBe("hello");
	});

	it("returns 'untitled' for empty string", () => {
		expect(slugifyTitle("")).toBe("untitled");
	});

	it("returns 'untitled' for string with only non-alphanumeric chars", () => {
		expect(slugifyTitle("!!! ???")).toBe("untitled");
	});

	it("handles accented characters via NFKD normalization", () => {
		// é normalises to e + combining accent; the combining accent is stripped, leaving e
		expect(slugifyTitle("Café")).toBe("cafe");
	});
});

// ---------------------------------------------------------------------------
// makeSourceId
// ---------------------------------------------------------------------------
describe("makeSourceId", () => {
	const fixedDate = new Date("2025-06-15T12:00:00Z");

	it("generates SRC-YYYY-MM-DD-001 with no existing IDs", () => {
		expect(makeSourceId([], fixedDate)).toBe("SRC-2025-06-15-001");
	});

	it("increments from the highest existing ID on the same day", () => {
		const existing = ["SRC-2025-06-15-001", "SRC-2025-06-15-002"];
		expect(makeSourceId(existing, fixedDate)).toBe("SRC-2025-06-15-003");
	});

	it("ignores IDs from other days", () => {
		const existing = ["SRC-2025-06-14-005"];
		expect(makeSourceId(existing, fixedDate)).toBe("SRC-2025-06-15-001");
	});

	it("pads the sequence number to 3 digits", () => {
		const existing = Array.from({ length: 9 }, (_, i) => `SRC-2025-06-15-00${i + 1}`);
		expect(makeSourceId(existing, fixedDate)).toBe("SRC-2025-06-15-010");
	});

	it("uses same day prefix as todayStamp", () => {
		const result = makeSourceId([], fixedDate);
		expect(result).toMatch(/^SRC-2025-06-15-\d{3}$/);
	});
});

// ---------------------------------------------------------------------------
// dedupeSlug
// ---------------------------------------------------------------------------
describe("dedupeSlug", () => {
	it("returns the base slug unchanged when there is no conflict", () => {
		expect(dedupeSlug("my-page", ["other-page"])).toBe("my-page");
	});

	it("appends -2 on the first conflict", () => {
		expect(dedupeSlug("my-page", ["my-page"])).toBe("my-page-2");
	});

	it("keeps incrementing past -2 when needed", () => {
		expect(dedupeSlug("my-page", ["my-page", "my-page-2", "my-page-3"])).toBe("my-page-4");
	});

	it("handles empty existing slugs", () => {
		expect(dedupeSlug("foo", [])).toBe("foo");
	});
});

// ---------------------------------------------------------------------------
// isProtectedPath
// ---------------------------------------------------------------------------
describe("isProtectedPath", () => {
	it("blocks paths under raw/", () => {
		expect(isProtectedPath(WIKI_ROOT, path.join(WIKI_ROOT, "raw", "SRC-2025-06-15-001", "manifest.json"))).toBe(true);
	});

	it("blocks paths directly in raw/", () => {
		expect(isProtectedPath(WIKI_ROOT, path.join(WIKI_ROOT, "raw", "something.txt"))).toBe(true);
	});

	it("blocks paths under meta/", () => {
		expect(isProtectedPath(WIKI_ROOT, path.join(WIKI_ROOT, "meta", "registry.json"))).toBe(true);
	});

	it("allows paths under pages/", () => {
		expect(isProtectedPath(WIKI_ROOT, path.join(WIKI_ROOT, "pages", "concepts", "foo.md"))).toBe(false);
	});

	it("allows WIKI_SCHEMA.md at the root", () => {
		expect(isProtectedPath(WIKI_ROOT, path.join(WIKI_ROOT, "WIKI_SCHEMA.md"))).toBe(false);
	});

	it("does not block paths outside the wiki root", () => {
		expect(isProtectedPath(WIKI_ROOT, "/tmp/some-other-file.txt")).toBe(false);
	});

	it("returns true for the raw/ directory itself", async () => {
		const { isProtectedPath } = await import("../../core/pi/extensions/wiki/paths.js");
		expect(isProtectedPath("/home/user/nixpi/Wiki", "/home/user/nixpi/Wiki/raw")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// isWikiPagePath
// ---------------------------------------------------------------------------
describe("isWikiPagePath", () => {
	it("returns true for pages/ paths", async () => {
		const { isWikiPagePath } = await import("../../core/pi/extensions/wiki/paths.js");
		expect(isWikiPagePath("/home/user/nixpi/Wiki", "/home/user/nixpi/Wiki/pages/my-page.md")).toBe(true);
	});

	it("returns true for the pages/ directory itself", async () => {
		const { isWikiPagePath } = await import("../../core/pi/extensions/wiki/paths.js");
		expect(isWikiPagePath("/home/user/nixpi/Wiki", "/home/user/nixpi/Wiki/pages")).toBe(true);
	});

	it("returns false for raw/ paths", async () => {
		const { isWikiPagePath } = await import("../../core/pi/extensions/wiki/paths.js");
		expect(isWikiPagePath("/home/user/nixpi/Wiki", "/home/user/nixpi/Wiki/raw/SRC-001/manifest.json")).toBe(false);
	});

	it("returns false for paths outside wiki root", async () => {
		const { isWikiPagePath } = await import("../../core/pi/extensions/wiki/paths.js");
		expect(isWikiPagePath("/home/user/nixpi/Wiki", "/home/user/other/file.md")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// normalizeWikiLink
// ---------------------------------------------------------------------------
describe("normalizeWikiLink", () => {
	it("resolves sources/ prefix to pages/sources/*.md", () => {
		expect(normalizeWikiLink("sources/SRC-2025-06-15-001")).toBe("pages/sources/SRC-2025-06-15-001.md");
	});

	it("resolves sources/ prefix even when .md is already present", () => {
		expect(normalizeWikiLink("sources/SRC-2025-06-15-001.md")).toBe("pages/sources/SRC-2025-06-15-001.md");
	});

	it("resolves bare slug to pages/*.md", () => {
		expect(normalizeWikiLink("my-concept")).toBe("pages/my-concept.md");
	});

	it("preserves existing pages/ prefix", () => {
		expect(normalizeWikiLink("pages/concepts/foo")).toBe("pages/concepts/foo.md");
	});

	it("returns undefined for empty string", () => {
		expect(normalizeWikiLink("")).toBeUndefined();
	});

	it("returns undefined for whitespace-only string", () => {
		expect(normalizeWikiLink("   ")).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// extractWikiLinks
// ---------------------------------------------------------------------------
describe("extractWikiLinks", () => {
	it("extracts a simple [[target]] link", () => {
		expect(extractWikiLinks("See [[my-concept]] for details.")).toEqual(["my-concept"]);
	});

	it("extracts the target from [[target|label]] links", () => {
		expect(extractWikiLinks("See [[my-concept|My Concept]] here.")).toEqual(["my-concept"]);
	});

	it("extracts multiple links from the same text", () => {
		const links = extractWikiLinks("[[foo]] and [[bar|Bar Label]] and [[baz]]");
		expect(links).toEqual(["foo", "bar", "baz"]);
	});

	it("ignores anchor fragments in [[target#section]] links", () => {
		expect(extractWikiLinks("See [[my-concept#intro]].")).toEqual(["my-concept"]);
	});

	it("returns empty array when there are no wiki links", () => {
		expect(extractWikiLinks("No links here.")).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// extractHeadings
// ---------------------------------------------------------------------------
describe("extractHeadings", () => {
	it("extracts an h1 heading", () => {
		expect(extractHeadings("# Hello World")).toEqual(["Hello World"]);
	});

	it("extracts h1 through h6", () => {
		const md = ["# H1", "## H2", "### H3", "#### H4", "##### H5", "###### H6"].join("\n");
		expect(extractHeadings(md)).toEqual(["H1", "H2", "H3", "H4", "H5", "H6"]);
	});

	it("strips the # prefix and surrounding whitespace", () => {
		expect(extractHeadings("##  Spaced Heading  ")).toEqual(["Spaced Heading"]);
	});

	it("does not extract inline # characters", () => {
		expect(extractHeadings("Some text with # in it")).toEqual([]);
	});

	it("returns empty array for text with no headings", () => {
		expect(extractHeadings("Just a paragraph.")).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// countWords
// ---------------------------------------------------------------------------
describe("countWords", () => {
	it("counts space-separated tokens", () => {
		expect(countWords("hello world foo")).toBe(3);
	});

	it("returns 0 for empty string", () => {
		expect(countWords("")).toBe(0);
	});

	it("returns 0 for whitespace-only string", () => {
		expect(countWords("   ")).toBe(0);
	});

	it("handles multiple spaces between words", () => {
		expect(countWords("one   two   three")).toBe(3);
	});

	it("counts a single word as 1", () => {
		expect(countWords("word")).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// wiki meta
// ---------------------------------------------------------------------------

describe("wiki meta", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(path.join(os.tmpdir(), "wiki-test-"));
		mkdirSync(path.join(tmpDir, "pages"), { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	// -------------------------------------------------------------------------
	// buildRegistry
	// -------------------------------------------------------------------------

	it("buildRegistry creates registry with correct title/type/tags from frontmatter", () => {
		const content = `---
title: My Concept
type: concept
tags:
  - ai
  - memory
summary: A test concept page
status: active
---
This is the body of my concept.
`;
		mkdirSync(path.join(tmpDir, "pages"), { recursive: true });
		writeFileSync(path.join(tmpDir, "pages", "my-concept.md"), content, "utf-8");

		const pages = scanPages(tmpDir);
		expect(pages).toHaveLength(1);

		const registry = buildRegistry(pages);
		expect(registry.version).toBe(1);
		expect(registry.pages).toHaveLength(1);

		const entry = registry.pages[0];
		expect(entry.title).toBe("My Concept");
		expect(entry.type).toBe("concept");
		expect(entry.tags).toEqual(["ai", "memory"]);
		expect(entry.summary).toBe("A test concept page");
		expect(entry.status).toBe("active");
		expect(entry.path).toBe("pages/my-concept.md");
	});

	// -------------------------------------------------------------------------
	// buildBacklinks
	// -------------------------------------------------------------------------

	it("buildBacklinks correctly computes inbound/outbound when A links to B", () => {
		const pageA = `---
title: Page A
type: concept
---
See [[b]] for more.
`;
		const pageB = `---
title: Page B
type: concept
---
No links here.
`;
		writeFileSync(path.join(tmpDir, "pages", "a.md"), pageA, "utf-8");
		writeFileSync(path.join(tmpDir, "pages", "b.md"), pageB, "utf-8");

		const pages = scanPages(tmpDir);
		const registry = buildRegistry(pages);
		const backlinks = buildBacklinks(registry);

		const aPath = "pages/a.md";
		const bPath = "pages/b.md";

		expect(backlinks.byPath[aPath].outbound).toContain(bPath);
		expect(backlinks.byPath[aPath].inbound).toEqual([]);
		expect(backlinks.byPath[bPath].inbound).toContain(aPath);
		expect(backlinks.byPath[bPath].outbound).toEqual([]);
	});

	// -------------------------------------------------------------------------
	// rebuildAllMeta
	// -------------------------------------------------------------------------

	it("rebuildAllMeta creates registry.json, backlinks.json, index.md, log.md in meta/", () => {
		const content = `---
title: Test Page
type: concept
status: active
---
Hello world.
`;
		writeFileSync(path.join(tmpDir, "pages", "test-page.md"), content, "utf-8");

		rebuildAllMeta(tmpDir);

		const metaDir = path.join(tmpDir, "meta");
		expect(existsSync(path.join(metaDir, "registry.json"))).toBe(true);
		expect(existsSync(path.join(metaDir, "backlinks.json"))).toBe(true);
		expect(existsSync(path.join(metaDir, "index.md"))).toBe(true);
		expect(existsSync(path.join(metaDir, "log.md"))).toBe(true);

		const registry = JSON.parse(readFileSync(path.join(metaDir, "registry.json"), "utf-8"));
		expect(registry.pages).toHaveLength(1);
		expect(registry.pages[0].title).toBe("Test Page");

		const indexContent = readFileSync(path.join(metaDir, "index.md"), "utf-8");
		expect(indexContent).toContain("# Wiki Index");
		expect(indexContent).toContain("Test Page");
	});

	// -------------------------------------------------------------------------
	// appendEvent / readEvents
	// -------------------------------------------------------------------------

	it("appendEvent adds an event and readEvents returns it; second append gives 2 events", async () => {
		const event1: Parameters<typeof appendEvent>[1] = {
			ts: "2026-04-10T12:00:00Z",
			kind: "capture",
			title: "First Capture",
			sourceIds: ["SRC-2026-04-10-001"],
			pagePaths: ["pages/sources/SRC-2026-04-10-001.md"],
		};
		const event2: Parameters<typeof appendEvent>[1] = {
			ts: "2026-04-10T13:00:00Z",
			kind: "integrate",
			title: "First Integration",
		};

		await appendEvent(tmpDir, event1);
		const events1 = await readEvents(tmpDir);
		expect(events1).toHaveLength(1);
		expect(events1[0].kind).toBe("capture");
		expect(events1[0].title).toBe("First Capture");

		await appendEvent(tmpDir, event2);
		const events2 = await readEvents(tmpDir);
		expect(events2).toHaveLength(2);
		expect(events2[1].kind).toBe("integrate");
	});

	// -------------------------------------------------------------------------
	// handleWikiStatus
	// -------------------------------------------------------------------------

	it("handleWikiStatus returns 'Wiki not initialized.' when pages/ missing", () => {
		rmSync(path.join(tmpDir, "pages"), { recursive: true, force: true });

		const result = handleWikiStatus(tmpDir);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.text).toBe("Wiki not initialized.");
			expect(result.value.details?.initialized).toBe(false);
		}
	});

	it("handleWikiStatus returns correct counts when pages exist", () => {
		const sourcePage = `---
title: SRC-2026-04-10-001
type: source
status: captured
---
Raw content.
`;
		const conceptPage = `---
title: My Concept
type: concept
status: active
---
Concept content.
`;
		mkdirSync(path.join(tmpDir, "pages", "sources"), { recursive: true });
		writeFileSync(path.join(tmpDir, "pages", "sources", "SRC-2026-04-10-001.md"), sourcePage, "utf-8");
		writeFileSync(path.join(tmpDir, "pages", "my-concept.md"), conceptPage, "utf-8");

		const result = handleWikiStatus(tmpDir);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.text).toContain("Pages: 2 total");
			expect(result.value.text).toContain("1 source");
			expect(result.value.text).toContain("1 canonical");
			expect(result.value.text).toContain("1 captured");
			expect(result.value.details?.total).toBe(2);
		}
	});

	// -------------------------------------------------------------------------
	// buildWikiDigest
	// -------------------------------------------------------------------------

	it("buildWikiDigest returns empty string when meta/ missing", () => {
		const result = buildWikiDigest(tmpDir);
		expect(result).toBe("");
	});

	it("buildWikiDigest returns digest with active canonical pages", () => {
		const activeConcept = `---
title: Active Concept
type: concept
status: active
summary: A great concept
---
${Array(100).fill("word").join(" ")}
`;
		const draftConcept = `---
title: Draft Concept
type: concept
status: draft
summary: Not yet ready
---
Short.
`;
		const sourcePage = `---
title: SRC-001
type: source
status: active
summary: A source
---
Some raw content here.
`;
		writeFileSync(path.join(tmpDir, "pages", "active-concept.md"), activeConcept, "utf-8");
		writeFileSync(path.join(tmpDir, "pages", "draft-concept.md"), draftConcept, "utf-8");
		mkdirSync(path.join(tmpDir, "pages", "sources"), { recursive: true });
		writeFileSync(path.join(tmpDir, "pages", "sources", "SRC-001.md"), sourcePage, "utf-8");

		rebuildAllMeta(tmpDir);

		const digest = buildWikiDigest(tmpDir);
		expect(digest).toContain("[WIKI MEMORY DIGEST]");
		expect(digest).toContain("Active Concept (concept)");
		expect(digest).toContain("A great concept");
		// Draft and source pages should not appear
		expect(digest).not.toContain("Draft Concept");
		expect(digest).not.toContain("SRC-001");
	});
});

// ---------------------------------------------------------------------------
// Task 3: searchRegistry / handleWikiSearch
// ---------------------------------------------------------------------------

describe("searchRegistry", () => {
	const makeRegistry = (pages: Array<Partial<import("../../core/pi/extensions/wiki/types.js").RegistryEntry>>) => ({
		version: 1,
		generatedAt: new Date().toISOString(),
		pages: pages.map((p) => ({
			type: "concept" as const,
			path: p.path ?? "pages/unnamed.md",
			title: p.title ?? "Unnamed",
			aliases: p.aliases ?? [],
			summary: p.summary ?? "",
			status: "active" as const,
			tags: p.tags ?? [],
			updated: "2026-01-01",
			sourceIds: p.sourceIds ?? [],
			linksOut: [],
			headings: p.headings ?? [],
			wordCount: 10,
			...p,
		})),
	});

	it("exact title match gets score 120 and is ranked first", () => {
		const registry = makeRegistry([
			{ title: "Attention Mechanism", path: "pages/attention-mechanism.md", summary: "attention" },
			{ title: "Attention", path: "pages/attention.md" },
		]);
		const result = searchRegistry(registry, "Attention");
		expect(result.matches.length).toBeGreaterThan(0);
		expect(result.matches[0].title).toBe("Attention");
		expect(result.matches[0].score).toBeGreaterThanOrEqual(120);
	});

	it("alias match ranks highly", () => {
		const registry = makeRegistry([
			{ title: "Multi-Head Attention", path: "pages/mha.md", aliases: ["MHA", "attention heads"] },
			{ title: "Unrelated Page", path: "pages/unrelated.md" },
		]);
		const result = searchRegistry(registry, "MHA");
		expect(result.matches[0].title).toBe("Multi-Head Attention");
		expect(result.matches[0].score).toBeGreaterThanOrEqual(110);
	});

	it("type filter works (only returns matching type)", () => {
		const registry = makeRegistry([
			{ title: "Alpha", path: "pages/alpha.md", type: "concept" as const },
			{ title: "Alpha Entity", path: "pages/alpha-entity.md", type: "entity" as const },
		]);
		const result = searchRegistry(registry, "alpha", "entity");
		expect(result.matches.every((m) => m.type === "entity")).toBe(true);
		expect(result.matches.some((m) => m.title === "Alpha")).toBe(false);
	});

	it("returns empty result when no matches", () => {
		const registry = makeRegistry([{ title: "Unrelated", path: "pages/unrelated.md" }]);
		const result = searchRegistry(registry, "zzznomatch999");
		expect(result.matches).toHaveLength(0);
	});
});

describe("handleWikiSearch", () => {
	it("returns 'No wiki matches' text when empty", () => {
		const registry = {
			version: 1,
			generatedAt: new Date().toISOString(),
			pages: [],
		};
		const result = handleWikiSearch(registry, "ghost");
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.text).toContain("No wiki matches for: ghost");
		}
	});
});

// ---------------------------------------------------------------------------
// Task 4: captureText / captureFile
// ---------------------------------------------------------------------------

describe("captureText / captureFile", () => {
	let wikiRoot: string;

	beforeEach(() => {
		wikiRoot = mkdtempSync(path.join(os.tmpdir(), "wiki-capture-test-"));
		mkdirSync(path.join(wikiRoot, "raw"), { recursive: true });
		mkdirSync(path.join(wikiRoot, "pages", "sources"), { recursive: true });
		mkdirSync(path.join(wikiRoot, "meta"), { recursive: true });
	});

	afterEach(() => {
		rmSync(wikiRoot, { recursive: true, force: true });
	});

	it("captureText creates packet dir with manifest.json, extracted.md, and original/", () => {
		const result = captureText(wikiRoot, "Hello world\nSecond line");
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			const { packetDir } = result.value.details as { packetDir: string };
			const absPacket = path.join(wikiRoot, packetDir);
			expect(existsSync(path.join(absPacket, "manifest.json"))).toBe(true);
			expect(existsSync(path.join(absPacket, "extracted.md"))).toBe(true);
			expect(existsSync(path.join(absPacket, "original"))).toBe(true);
		}
	});

	it("captureText creates source page at pages/sources/SRC-*.md", () => {
		const result = captureText(wikiRoot, "Some important text");
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			const { sourcePagePath } = result.value.details as { sourcePagePath: string };
			expect(sourcePagePath).toMatch(/^pages\/sources\/SRC-.+\.md$/);
			expect(existsSync(path.join(wikiRoot, sourcePagePath))).toBe(true);
		}
	});

	it("captureText manifest has correct fields", () => {
		const result = captureText(wikiRoot, "Test content", { title: "My Note", kind: "note" });
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			const { packetDir } = result.value.details as { packetDir: string };
			const manifest = JSON.parse(readFileSync(path.join(wikiRoot, packetDir, "manifest.json"), "utf-8"));
			expect(manifest.sourceId).toMatch(/^SRC-/);
			expect(manifest.title).toBe("My Note");
			expect(manifest.kind).toBe("note");
			expect(manifest.status).toBe("captured");
			expect(manifest.hash).toMatch(/^sha256:/);
		}
	});

	it("captureText uses title from options if provided, infers from first line if not", () => {
		const resultWithTitle = captureText(wikiRoot, "First line\nSecond", { title: "Custom Title" });
		expect(resultWithTitle.isOk()).toBe(true);
		if (resultWithTitle.isOk()) {
			expect(resultWithTitle.value.details?.title).toBe("Custom Title");
		}

		const resultInferred = captureText(wikiRoot, "Inferred title line\nMore content");
		expect(resultInferred.isOk()).toBe(true);
		if (resultInferred.isOk()) {
			expect(resultInferred.value.details?.title).toBe("Inferred title line");
		}
	});

	it("captureFile returns err when file doesn't exist", () => {
		const result = captureFile(wikiRoot, "/tmp/nonexistent-file-xyz.txt");
		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error).toContain("File not found");
		}
	});

	it("captureFile with existing file creates packet with original copy and source page", () => {
		const tmpFile = path.join(wikiRoot, "test-input.txt");
		writeFileSync(tmpFile, "File content here", "utf-8");

		const result = captureFile(wikiRoot, tmpFile, { title: "Test File" });
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			const { packetDir, sourcePagePath } = result.value.details as { packetDir: string; sourcePagePath: string };
			expect(existsSync(path.join(wikiRoot, packetDir, "original", "source.txt"))).toBe(true);
			expect(existsSync(path.join(wikiRoot, packetDir, "manifest.json"))).toBe(true);
			expect(existsSync(path.join(wikiRoot, sourcePagePath))).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// Task 5: handleEnsurePage
// ---------------------------------------------------------------------------

describe("handleEnsurePage", () => {
	let wikiRoot: string;

	beforeEach(() => {
		wikiRoot = mkdtempSync(path.join(os.tmpdir(), "wiki-pages-test-"));
		mkdirSync(path.join(wikiRoot, "pages"), { recursive: true });
		mkdirSync(path.join(wikiRoot, "meta"), { recursive: true });
	});

	afterEach(() => {
		rmSync(wikiRoot, { recursive: true, force: true });
	});

	it("creates new page when none exists (details.created === true, file exists on disk)", () => {
		rebuildAllMeta(wikiRoot);
		const result = handleEnsurePage(wikiRoot, { type: "concept", title: "Machine Learning" });
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.details?.created).toBe(true);
			expect(result.value.details?.resolved).toBe(true);
			const relPath = result.value.details?.path as string;
			expect(existsSync(path.join(wikiRoot, relPath))).toBe(true);
		}
	});

	it("resolves existing page by exact title match (details.created === false, details.resolved === true)", () => {
		const existingPage = `---
title: Neural Networks
type: concept
aliases: []
status: active
tags: []
updated: "2026-01-01"
source_ids: []
summary: A page about neural networks
---
# Neural Networks
`;
		writeFileSync(path.join(wikiRoot, "pages", "neural-networks.md"), existingPage, "utf-8");
		rebuildAllMeta(wikiRoot);

		const result = handleEnsurePage(wikiRoot, { type: "concept", title: "Neural Networks" });
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.details?.created).toBe(false);
			expect(result.value.details?.resolved).toBe(true);
		}
	});

	it("resolves existing page by alias (details.path matches the aliased page)", () => {
		const existingPage = `---
title: Reinforcement Learning
type: concept
aliases:
  - RL
status: active
tags: []
updated: "2026-01-01"
source_ids: []
summary: ""
---
# Reinforcement Learning
`;
		writeFileSync(path.join(wikiRoot, "pages", "reinforcement-learning.md"), existingPage, "utf-8");
		rebuildAllMeta(wikiRoot);

		const result = handleEnsurePage(wikiRoot, { type: "concept", title: "RL" });
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.details?.path).toBe("pages/reinforcement-learning.md");
			expect(result.value.details?.created).toBe(false);
		}
	});

	it("reports conflict when multiple pages match", () => {
		const page1 = `---
title: Transformer
type: concept
aliases:
  - transformer model
status: active
tags: []
updated: "2026-01-01"
source_ids: []
summary: ""
---
# Transformer
`;
		const page2 = `---
title: Transformer Model
type: concept
aliases:
  - transformer
status: active
tags: []
updated: "2026-01-01"
source_ids: []
summary: ""
---
# Transformer Model
`;
		writeFileSync(path.join(wikiRoot, "pages", "transformer.md"), page1, "utf-8");
		writeFileSync(path.join(wikiRoot, "pages", "transformer-model.md"), page2, "utf-8");
		rebuildAllMeta(wikiRoot);

		const result = handleEnsurePage(wikiRoot, { type: "concept", title: "Transformer" });
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.details?.conflict).toBe(true);
			expect(result.value.details?.resolved).toBe(false);
		}
	});

	it("created page has correct frontmatter (type, title, status: 'draft')", () => {
		rebuildAllMeta(wikiRoot);
		const result = handleEnsurePage(wikiRoot, { type: "entity", title: "Anthropic" });
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			const relPath = result.value.details?.path as string;
			const content = readFileSync(path.join(wikiRoot, relPath), "utf-8");
			expect(content).toContain("type: entity");
			expect(content).toContain("title: Anthropic");
			expect(content).toContain("status: draft");
		}
	});

	it("slug is generated from title (kebab-case)", () => {
		rebuildAllMeta(wikiRoot);
		const result = handleEnsurePage(wikiRoot, { type: "concept", title: "Deep Learning Fundamentals" });
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			const relPath = result.value.details?.path as string;
			expect(relPath).toContain("deep-learning-fundamentals");
		}
	});
});
