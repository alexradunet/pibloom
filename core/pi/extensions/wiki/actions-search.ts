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
	return ok({ text: lines.join("\n"), details: result as unknown as Record<string, unknown> });
}
