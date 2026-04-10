import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { atomicWriteFile } from "../../../lib/filesystem.js";
import { parseFrontmatter } from "../../../lib/frontmatter.js";
import { nowIso, ok } from "../../../lib/utils.js";
import { countWords, extractHeadings, extractWikiLinks, normalizeWikiLink } from "./paths.js";
import type { ActionResult, BacklinksData, RegistryData, RegistryEntry, WikiEvent, WikiPageType } from "./types.js";
import { PAGE_TYPES } from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function asString(v: unknown, fallback = ""): string {
	if (typeof v === "string") return v;
	return fallback;
}

function asStringArray(v: unknown): string[] {
	if (Array.isArray(v)) {
		return v.filter((x): x is string => typeof x === "string");
	}
	if (typeof v === "string" && v.trim()) {
		return [v.trim()];
	}
	return [];
}

// ---------------------------------------------------------------------------
// ParsedPage (internal)
// ---------------------------------------------------------------------------

interface ParsedPage {
	relativePath: string;
	frontmatter: Record<string, unknown>;
	body: string;
	headings: string[];
	rawLinks: string[];
	normalizedLinks: string[];
	wordCount: number;
}

// ---------------------------------------------------------------------------
// scanPages
// ---------------------------------------------------------------------------

function walkMdFiles(dir: string, results: string[]): void {
	let entries: import("node:fs").Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true }) as import("node:fs").Dirent[];
	} catch {
		return;
	}
	for (const entry of entries) {
		const name = entry.name as string;
		const full = path.join(dir, name);
		if (entry.isDirectory()) {
			walkMdFiles(full, results);
		} else if (entry.isFile() && name.endsWith(".md")) {
			results.push(full);
		}
	}
}

export function scanPages(wikiRoot: string): ParsedPage[] {
	const pagesDir = path.join(wikiRoot, "pages");
	if (!existsSync(pagesDir)) return [];

	const files: string[] = [];
	walkMdFiles(pagesDir, files);
	files.sort();

	return files.map((filePath) => {
		const raw = readFileSync(filePath, "utf-8");
		const { attributes, body } = parseFrontmatter(raw);
		const headings = extractHeadings(body);
		const rawLinks = extractWikiLinks(body);
		const normalizedLinks = rawLinks.map((l) => normalizeWikiLink(l)).filter((l): l is string => l !== undefined);
		return {
			relativePath: path.relative(wikiRoot, filePath).replace(/\\/g, "/"),
			frontmatter: attributes,
			body,
			headings,
			rawLinks,
			normalizedLinks,
			wordCount: countWords(body),
		};
	});
}

// ---------------------------------------------------------------------------
// buildRegistry
// ---------------------------------------------------------------------------

export function buildRegistry(pages: ParsedPage[]): RegistryData {
	const entries: RegistryEntry[] = pages.map((p) => {
		const fm = p.frontmatter;
		const type = (PAGE_TYPES.includes(fm.type as WikiPageType) ? fm.type : "concept") as WikiPageType;
		const title = asString(fm.title) || path.basename(p.relativePath, ".md");
		return {
			type,
			path: p.relativePath,
			title,
			aliases: asStringArray(fm.aliases),
			summary: asString(fm.summary),
			status: asString(fm.status, "draft") as RegistryEntry["status"],
			tags: asStringArray(fm.tags),
			updated: asString(fm.updated),
			sourceIds: asStringArray(fm.sourceIds),
			linksOut: p.normalizedLinks,
			headings: p.headings,
			wordCount: p.wordCount,
		};
	});

	entries.sort((a, b) => a.path.localeCompare(b.path));

	return {
		version: 1,
		generatedAt: nowIso(),
		pages: entries,
	};
}

// ---------------------------------------------------------------------------
// buildBacklinks
// ---------------------------------------------------------------------------

export function buildBacklinks(registry: RegistryData): BacklinksData {
	const pathSet = new Set(registry.pages.map((p) => p.path));
	const byPath: Record<string, { inbound: string[]; outbound: string[] }> = {};

	for (const entry of registry.pages) {
		if (!byPath[entry.path]) byPath[entry.path] = { inbound: [], outbound: [] };
	}

	for (const entry of registry.pages) {
		const validOut = entry.linksOut.filter((l) => pathSet.has(l));
		const deduped = [...new Set(validOut)].sort();
		byPath[entry.path].outbound = deduped;

		for (const target of deduped) {
			if (!byPath[target]) byPath[target] = { inbound: [], outbound: [] };
			byPath[target].inbound.push(entry.path);
		}
	}

	// Sort and dedupe inbound arrays
	for (const key of Object.keys(byPath)) {
		byPath[key].inbound = [...new Set(byPath[key].inbound)].sort();
	}

	return {
		version: 1,
		generatedAt: nowIso(),
		byPath,
	};
}

// ---------------------------------------------------------------------------
// renderIndex
// ---------------------------------------------------------------------------

function renderIndex(registry: RegistryData): string {
	const lines: string[] = ["# Wiki Index", "", `Generated: ${nowIso()}`, ""];

	const sectionOrder: WikiPageType[] = [
		"source",
		"concept",
		"entity",
		"synthesis",
		"analysis",
		"evolution",
		"procedure",
		"decision",
	];
	const sectionLabel: Record<WikiPageType, string> = {
		source: "Source Pages",
		concept: "Concept Pages",
		entity: "Entity Pages",
		synthesis: "Synthesis Pages",
		analysis: "Analysis Pages",
		evolution: "Evolution Pages",
		procedure: "Procedure Pages",
		decision: "Decision Pages",
	};

	for (const type of sectionOrder) {
		const entries = registry.pages.filter((p) => p.type === type);
		if (entries.length === 0) continue;
		lines.push(`## ${sectionLabel[type]}`, "");
		for (const entry of entries) {
			// Strip pages/ prefix and .md suffix for the display path
			const displayPath = entry.path.replace(/^pages\//, "").replace(/\.md$/, "");
			const label = entry.title || displayPath;
			const summary = entry.summary ? ` — ${entry.summary}` : "";
			lines.push(`- [[${displayPath}|${label}]]${summary}`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// rebuildLog
// ---------------------------------------------------------------------------

function rebuildLog(wikiRoot: string): void {
	const events = readEventsSync(wikiRoot);
	const metaDir = path.join(wikiRoot, "meta");
	mkdirSync(metaDir, { recursive: true });

	let content: string;
	if (events.length === 0) {
		content = "# Wiki Log\n\n_No events yet._\n";
	} else {
		const lines = ["# Wiki Log", ""];
		for (const ev of events) {
			const ts = ev.ts.replace("T", " ").replace(/:\d{2}(\.\d+)?Z$/, " UTC");
			lines.push(`## [${ts}] ${ev.kind} | ${ev.title}`);
			if (ev.sourceIds && ev.sourceIds.length > 0) {
				lines.push(`- Sources: ${ev.sourceIds.join(", ")}`);
			}
			if (ev.pagePaths && ev.pagePaths.length > 0) {
				lines.push(`- Pages: ${ev.pagePaths.join(", ")}`);
			}
			lines.push("");
		}
		content = lines.join("\n");
	}

	atomicWriteFile(path.join(metaDir, "log.md"), content);
}

// ---------------------------------------------------------------------------
// rebuildAllMeta
// ---------------------------------------------------------------------------

export function rebuildAllMeta(wikiRoot: string): { registry: RegistryData; backlinks: BacklinksData } {
	const metaDir = path.join(wikiRoot, "meta");
	mkdirSync(metaDir, { recursive: true });

	const pages = scanPages(wikiRoot);
	const registry = buildRegistry(pages);
	const backlinks = buildBacklinks(registry);

	atomicWriteFile(path.join(metaDir, "registry.json"), JSON.stringify(registry, null, 2));
	atomicWriteFile(path.join(metaDir, "backlinks.json"), JSON.stringify(backlinks, null, 2));
	atomicWriteFile(path.join(metaDir, "index.md"), renderIndex(registry));

	rebuildLog(wikiRoot);

	return { registry, backlinks };
}

// ---------------------------------------------------------------------------
// loadRegistry
// ---------------------------------------------------------------------------

export function loadRegistry(wikiRoot: string): RegistryData {
	const registryPath = path.join(wikiRoot, "meta", "registry.json");
	try {
		const raw = readFileSync(registryPath, "utf-8");
		return JSON.parse(raw) as RegistryData;
	} catch {
		return rebuildAllMeta(wikiRoot).registry;
	}
}

// ---------------------------------------------------------------------------
// appendEvent / readEvents
// ---------------------------------------------------------------------------

function eventsPath(wikiRoot: string): string {
	return path.join(wikiRoot, "meta", "events.jsonl");
}

function readEventsSync(wikiRoot: string): WikiEvent[] {
	try {
		const raw = readFileSync(eventsPath(wikiRoot), "utf-8");
		return raw
			.split("\n")
			.filter((line) => line.trim())
			.map((line) => JSON.parse(line) as WikiEvent);
	} catch {
		return [];
	}
}

export async function appendEvent(wikiRoot: string, event: WikiEvent): Promise<void> {
	const metaDir = path.join(wikiRoot, "meta");
	mkdirSync(metaDir, { recursive: true });
	appendFileSync(path.join(metaDir, "events.jsonl"), `${JSON.stringify(event)}\n`, "utf-8");
}

export async function readEvents(wikiRoot: string): Promise<WikiEvent[]> {
	return readEventsSync(wikiRoot);
}

// ---------------------------------------------------------------------------
// handleWikiStatus
// ---------------------------------------------------------------------------

export function handleWikiStatus(wikiRoot: string): ActionResult {
	const pagesDir = path.join(wikiRoot, "pages");
	if (!existsSync(pagesDir)) {
		return ok({ text: "Wiki not initialized.", details: { initialized: false } });
	}

	const registry = loadRegistry(wikiRoot);
	const total = registry.pages.length;
	const sourceCount = registry.pages.filter((p) => p.type === "source").length;
	const canonicalCount = total - sourceCount;
	const capturedCount = registry.pages.filter((p) => p.type === "source" && p.status === "captured").length;
	const integratedCount = registry.pages.filter((p) => p.type === "source" && p.status === "integrated").length;

	const text = `Pages: ${total} total (${sourceCount} source, ${canonicalCount} canonical)\nSources: ${capturedCount} captured, ${integratedCount} integrated`;

	return ok({
		text,
		details: {
			total,
			source: sourceCount,
			canonical: canonicalCount,
			captured: capturedCount,
			integrated: integratedCount,
		},
	});
}

// ---------------------------------------------------------------------------
// buildWikiDigest
// ---------------------------------------------------------------------------

export function buildWikiDigest(wikiRoot: string): string {
	const registryPath = path.join(wikiRoot, "meta", "registry.json");
	if (!existsSync(registryPath)) return "";

	const registry = loadRegistry(wikiRoot);
	const active = registry.pages
		.filter((p) => p.type !== "source" && p.status === "active")
		.sort((a, b) => b.wordCount - a.wordCount)
		.slice(0, 15);

	if (active.length === 0) return "";

	const lines = ["\n\n[WIKI MEMORY DIGEST]"];
	for (const entry of active) {
		const summary = entry.summary ? ` — ${entry.summary}` : "";
		lines.push(`- ${entry.title} (${entry.type})${summary}`);
	}

	return lines.join("\n");
}
