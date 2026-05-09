import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, type Dirent } from "node:fs";
import { buildFtsIndex } from "./fts.ts";
import path from "node:path";
import { atomicWriteFile } from "./lib/filesystem.ts";
import { parseFrontmatter } from "./lib/frontmatter.ts";
import { nowIso, ok } from "./lib/core-utils.ts";
import {
	appliesToHost,
	countWords,
	extractHeadings,
	extractMarkdownLinks,
	extractWikiLinks,
	formatAreasSuffix,
	formatDomainSuffix,
	formatHostsSuffix,
	getCurrentHost,
	getPageFolder,
	inferDomainFromFolder,
	normalizeAreas,
	normalizeDomain,
	normalizeHosts,
	normalizeMarkdownLink,
	normalizeWikiLink,
	todayStamp,
} from "./paths.ts";
import type {
	ActionResult,
	BacklinksData,
	RegistryData,
	RegistryEntry,
	WikiEvent,
	WikiMetaArtifacts,
	WikiPageType,
	WikiStatusDetails,
} from "./types.ts";
import { PAGE_TYPES } from "./types.ts";

function asString(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function pickField(frontmatter: Record<string, unknown>, ...keys: string[]): unknown {
	for (const key of keys) {
		if (key in frontmatter) return frontmatter[key];
	}
	return undefined;
}

function asStringArray(value: unknown): string[] {
	if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
	if (typeof value === "string" && value.trim()) return [value.trim()];
	return [];
}

interface ParsedPage {
	relativePath: string;
	frontmatter: Record<string, unknown>;
	body: string;
	headings: string[];
	rawLinks: string[];
	normalizedLinks: string[];
	wordCount: number;
}

function listMarkdownFiles(dir: string): string[] {
	const files: string[] = [];
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return files;
	}

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...listMarkdownFiles(fullPath));
			continue;
		}
		if (entry.isFile() && entry.name.endsWith(".md")) files.push(fullPath);
	}
	return files;
}

export function scanPages(wikiRoot: string): ParsedPage[] {
	// v2 layout: scan daily/, objects/, sources/, meta/about-alex/
	const scanDirs = ["daily", "objects", "sources", "meta/about-alex", "meta/audit"];
	const files: string[] = [];
	for (const dir of scanDirs) {
		const dirPath = path.join(wikiRoot, dir);
		if (existsSync(dirPath)) files.push(...listMarkdownFiles(dirPath));
	}
	files.sort();
	if (files.length === 0) return [];

	const parsedPages: ParsedPage[] = [];
	for (const filePath of files) {
		let raw: string;
		try {
			raw = readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { attributes, body } = parseFrontmatter(raw);
		const headings = extractHeadings(body);
		const rawLinks = extractWikiLinks(body);
		const normalizedWikiLinks = rawLinks.map((link) => normalizeWikiLink(link)).filter((link): link is string => link !== undefined);
		const normalizedMarkdownLinks = extractMarkdownLinks(body)
			.map((link) => normalizeMarkdownLink(path.relative(wikiRoot, filePath).replace(/\\/g, "/"), link))
			.filter((link): link is string => link !== undefined);

		parsedPages.push({
			relativePath: path.relative(wikiRoot, filePath).replace(/\\/g, "/"),
			frontmatter: attributes,
			body,
			headings,
			rawLinks,
			normalizedLinks: [...new Set([...normalizedWikiLinks, ...normalizedMarkdownLinks])],
			wordCount: countWords(body),
		});
	}
	return parsedPages;
}

export function buildRegistry(pages: ParsedPage[]): RegistryData {
	const entries: RegistryEntry[] = pages.map((page) => {
		const frontmatter = page.frontmatter;
		const type = (PAGE_TYPES.includes(frontmatter.type as WikiPageType) ? frontmatter.type : "concept") as WikiPageType;
		const title = asString(frontmatter.title) || path.basename(page.relativePath, ".md");
		const folder = getPageFolder(page.relativePath);
		const domain = normalizeDomain(asString(pickField(frontmatter, "domain"))) ?? inferDomainFromFolder(folder);
		return {
			type,
			path: page.relativePath,
			folder,
			title,
			aliases: asStringArray(frontmatter.aliases),
			summary: asString(frontmatter.summary),
			status: asString(frontmatter.status, "draft") as RegistryEntry["status"],
			tags: asStringArray(frontmatter.tags),
			hosts: normalizeHosts(asStringArray(frontmatter.hosts)),
			...(domain ? { domain } : {}),
			areas: normalizeAreas(asStringArray(frontmatter.areas)),
			updated: asString(frontmatter.updated),
			sourceIds: asStringArray(pickField(frontmatter, "sourceIds", "source_ids")),
			linksOut: page.normalizedLinks,
			headings: page.headings,
			wordCount: page.wordCount,
			// object-model fields
			...(frontmatter.id ? { id: asString(frontmatter.id) } : {}),
			...(frontmatter.next_review ? { nextReview: asString(frontmatter.next_review) } : {}),
			...(frontmatter.supersedes ? { supersedes: asString(frontmatter.supersedes) } : {}),
		};
	});

	entries.sort((a, b) => a.path.localeCompare(b.path));
	return { version: 1, generatedAt: nowIso(), pages: entries };
}

export function buildBacklinks(registry: RegistryData): BacklinksData {
	const pathSet = new Set(registry.pages.map((page) => page.path));
	const byPath: Record<string, { inbound: string[]; outbound: string[] }> = {};

	for (const entry of registry.pages) {
		if (!byPath[entry.path]) byPath[entry.path] = { inbound: [], outbound: [] };
	}

	for (const entry of registry.pages) {
		const outbound = [...new Set(entry.linksOut.filter((link) => pathSet.has(link)))].sort();
		byPath[entry.path].outbound = outbound;
		for (const target of outbound) {
			if (!byPath[target]) byPath[target] = { inbound: [], outbound: [] };
			byPath[target].inbound.push(entry.path);
		}
	}

	for (const key of Object.keys(byPath)) {
		byPath[key].inbound = [...new Set(byPath[key].inbound)].sort();
	}

	return { version: 1, generatedAt: nowIso(), byPath };
}

function markdownLinkLabel(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

function markdownLinkFromMeta(targetPath: string): string {
	return path.posix.relative("meta", targetPath.replace(/\\/g, "/"));
}

export function renderIndex(registry: RegistryData): string {
	const lines: string[] = ["# Wiki Index", "", `Generated: ${nowIso()}`, ""];

	const sectionOrder: WikiPageType[] = [
		"source",
		"task",
		"event",
		"reminder",
		"concept",
		"entity",
		"synthesis",
		"analysis",
		"evolution",
		"procedure",
		"decision",
		"identity",
		"journal",
	];
	const sectionLabel: Record<WikiPageType, string> = {
		source:           "Source Pages",
		task:             "Task Pages",
		event:            "Event Pages",
		reminder:         "Reminder Pages",
		concept:          "Concept Pages",
		entity:           "Entity Pages",
		synthesis:        "Synthesis Pages",
		analysis:         "Analysis Pages",
		evolution:        "Evolution Pages",
		procedure:        "Procedure Pages",
		decision:         "Decision Pages",
		identity:         "Identity Pages",
		journal:          "Journal Pages",
		// v2 types
		"daily-note":     "Daily Notes",
		person:           "Person Pages",
		project:          "Project Pages",
		area:             "Area Pages",
		host:             "Host Pages",
		service:          "Service Pages",
		account:          "Account Pages",
		"financial-goal": "Financial Goal Pages",
		"income-source":  "Income Source Pages",
		snapshot:         "Snapshot Pages",
		dashboard:        "Dashboard Pages",
	};

	for (const type of sectionOrder) {
		const entries = registry.pages.filter((page) => page.type === type);
		if (entries.length === 0) continue;
		lines.push(`## ${sectionLabel[type]}`, "");
		for (const entry of entries) {
			const displayPath = entry.path.replace(/\.md$/, "");
			const label = entry.title || displayPath;
			const summary = entry.summary ? ` — ${entry.summary}` : "";
			lines.push(
				`- [${markdownLinkLabel(label)}](${markdownLinkFromMeta(entry.path)})${formatDomainSuffix(entry.domain)}${formatAreasSuffix(entry.areas)}${formatHostsSuffix(entry.hosts)}${summary}`,
			);
		}
		lines.push("");
	}

	return lines.join("\n");
}

export function renderLog(events: WikiEvent[]): string {
	if (events.length === 0) return "# Wiki Log\n\n_No events yet._\n";

	const lines = ["# Wiki Log", ""];
	for (const event of events) {
		const timestamp = event.ts.replace("T", " ").replace(/:\d{2}(\.\d+)?Z$/, " UTC");
		lines.push(`## [${timestamp}] ${event.kind} | ${event.title}`);
		if (event.sourceIds && event.sourceIds.length > 0) lines.push(`- Sources: ${event.sourceIds.join(", ")}`);
		if (event.pagePaths && event.pagePaths.length > 0) lines.push(`- Pages: ${event.pagePaths.join(", ")}`);
		lines.push("");
	}
	return lines.join("\n");
}

export function deriveWikiMetaArtifacts(pages: ParsedPage[], events: WikiEvent[]): WikiMetaArtifacts {
	const registry = buildRegistry(pages);
	const backlinks = buildBacklinks(registry);
	return { registry, backlinks, index: renderIndex(registry), log: renderLog(events) };
}

export function rebuildAllMeta(wikiRoot: string): { registry: RegistryData; backlinks: BacklinksData } {
	const metaDir = path.join(wikiRoot, "meta");
	mkdirSync(metaDir, { recursive: true });

	const pages = scanPages(wikiRoot);
	const events = readEventsSync(wikiRoot);
	const artifacts = deriveWikiMetaArtifacts(pages, events);

	atomicWriteFile(path.join(metaDir, "registry.json"), JSON.stringify(artifacts.registry, null, 2));
	atomicWriteFile(path.join(metaDir, "backlinks.json"), JSON.stringify(artifacts.backlinks, null, 2));
	atomicWriteFile(path.join(metaDir, "index.md"), artifacts.index);
	atomicWriteFile(path.join(metaDir, "log.md"), artifacts.log);

	try {
		buildFtsIndex(
			wikiRoot,
			pages.map((p) => ({
				path: p.relativePath,
				title: asString(p.frontmatter.title) || path.basename(p.relativePath, ".md"),
				body: p.body,
			})),
		);
	} catch (err) {
		console.error("wiki: FTS index build failed (non-fatal):", err instanceof Error ? err.message : String(err));
	}

	return { registry: artifacts.registry, backlinks: artifacts.backlinks };
}

function hasRequiredGeneratedMeta(wikiRoot: string): boolean {
	return ["registry.json", "backlinks.json", "index.md"].every((fileName) => existsSync(path.join(wikiRoot, "meta", fileName)));
}

export function loadRegistry(wikiRoot: string): RegistryData {
	const registryPath = path.join(wikiRoot, "meta", "registry.json");
	try {
		const registry = JSON.parse(readFileSync(registryPath, "utf-8")) as RegistryData;
		if (!hasRequiredGeneratedMeta(wikiRoot)) return rebuildAllMeta(wikiRoot).registry;
		return registry;
	} catch {
		return rebuildAllMeta(wikiRoot).registry;
	}
}

function eventsPath(wikiRoot: string): string {
	return path.join(wikiRoot, "meta", "events.jsonl");
}

function readEventsSync(wikiRoot: string): WikiEvent[] {
	try {
		return readFileSync(eventsPath(wikiRoot), "utf-8")
			.split("\n")
			.filter((line) => line.trim())
			.map((line) => JSON.parse(line) as WikiEvent);
	} catch {
		return [];
	}
}

export function appendEvent(wikiRoot: string, event: WikiEvent): void {
	const metaDir = path.join(wikiRoot, "meta");
	mkdirSync(metaDir, { recursive: true });
	appendFileSync(path.join(metaDir, "events.jsonl"), `${JSON.stringify(event)}\n`, "utf-8");
}

export function readEvents(wikiRoot: string): WikiEvent[] {
	return readEventsSync(wikiRoot);
}

function countByDomain(pages: RegistryEntry[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const page of pages) {
		const key = page.domain ?? "unspecified";
		counts[key] = (counts[key] ?? 0) + 1;
	}
	return counts;
}

export function handleWikiStatus(wikiRoot: string): ActionResult<WikiStatusDetails> {
	// v2: check daily/ or objects/
	const initialized = ["daily", "objects"].some((d) => existsSync(path.join(wikiRoot, d)));
	if (!initialized) {
		return ok({ text: "Wiki not initialized.", details: { initialized: false, root: wikiRoot, host: getCurrentHost() } });
	}

	const registry = loadRegistry(wikiRoot);
	const host = getCurrentHost();
	const visiblePages = registry.pages.filter((page) => appliesToHost(page.hosts, host));
	const total = registry.pages.length;
	const sourceCount = registry.pages.filter((page) => page.type === "source").length;
	const journalCount = registry.pages.filter((page) => page.type === "journal" || page.type === "daily-note").length;
	const canonicalCount = total - sourceCount - journalCount;
	const capturedCount = registry.pages.filter((page) => page.type === "source" && page.status === "captured").length;
	const integratedCount = registry.pages.filter((page) => page.type === "source" && page.status === "integrated").length;
	const domains = countByDomain(visiblePages);
	const domainText = Object.entries(domains)
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([domain, count]) => `${domain}=${count}`)
		.join(", ");

	const text = [
		`Wiki root: ${wikiRoot}`,
		`Host: ${host}`,
		`Pages: ${total} total (${sourceCount} source, ${canonicalCount} canonical, ${journalCount} journal)`,
		`Visible here: ${visiblePages.length}`,
		`Sources: ${capturedCount} captured, ${integratedCount} integrated`,
		domainText ? `Domains: ${domainText}` : undefined,
	]
		.filter(Boolean)
		.join("\n");

	return ok({
		text,
		details: {
			initialized: true,
			host,
			root: wikiRoot,
			total,
			visible: visiblePages.length,
			source: sourceCount,
			canonical: canonicalCount,
			journal: journalCount,
			captured: capturedCount,
			integrated: integratedCount,
			domains,
		},
	});
}

export interface WikiDigestOptions {
	domain?: string;
}

export function buildWikiDigest(wikiRoot: string, options: WikiDigestOptions = {}): string {
	const registryPath = path.join(wikiRoot, "meta", "registry.json");
	const initialized = ["daily", "objects"].some((d) => existsSync(path.join(wikiRoot, d)));
	if (!existsSync(registryPath) && !initialized) return "";

	const host = getCurrentHost();
	const registry = loadRegistry(wikiRoot);
	const today = todayStamp();

	const domain = normalizeDomain(options.domain);
	const visible = (p: RegistryEntry) => appliesToHost(p.hosts, host) && (!domain || p.domain === domain);

	const domainLabel = domain ? ` — ${domain}` : "";
	const lines: string[] = [`\n\n[WIKI DIGEST${domainLabel} — ${host} — ${today}]`];

	// Today's daily note
	const todayNote = registry.pages.find(
		(p) => (p.type === "journal" || p.type === "daily-note") &&
			p.path.includes(`daily/${today}`) &&
			visible(p),
	);
	lines.push(todayNote
		? `- TODAY NOTE: ${todayNote.path}`
		: `- TODAY NOTE: none yet for ${today} — create with wiki_daily action=append`);

	// Active knowledge notes (top 10 by word count, non-operational)
	const knowledge = registry.pages
		.filter((p) => !["source", "identity", "journal", "task", "event", "reminder"].includes(p.type))
		.filter((p) => p.status === "active")
		.filter(visible)
		.sort((a, b) => b.wordCount - a.wordCount)
		.slice(0, 10);
	if (knowledge.length > 0) {
		lines.push("- ---");
		for (const entry of knowledge) {
			const summary = entry.summary ? ` — ${entry.summary}` : "";
			lines.push(
				`- ${entry.title} (${entry.type})${formatDomainSuffix(entry.domain)}${formatAreasSuffix(entry.areas)}${summary}`,
			);
		}
	}

	return lines.join("\n");
}
