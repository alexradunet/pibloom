import { ok } from "./lib/core-utils.ts";
import { SEARCH_FIELD_WEIGHTS } from "./rules.ts";
import {
	appliesToHost,
	folderMatches,
	formatAreasSuffix,
	formatDomainSuffix,
	formatHostsSuffix,
	getCurrentHost,
	normalizeAreas,
	normalizeDomain,
	normalizePageFolder,
} from "./paths.ts";
import type { ActionResult, RegistryData, RegistryEntry, WikiPageType } from "./types.ts";
import { queryFts } from "./fts.ts";

export interface SearchMatch {
	type: string;
	path: string;
	folder: string;
	title: string;
	summary: string;
	hosts: string[];
	domain?: string;
	areas: string[];
	score: number;
}

export interface SearchResult {
	query: string;
	hostScope: "current" | "all";
	host?: string;
	domain?: string;
	areas: string[];
	folder?: string;
	matches: SearchMatch[];
}

export interface SearchOptions {
	type?: WikiPageType | string;
	limit?: number;
	hostScope?: "current" | "all";
	host?: string;
	domain?: string;
	areas?: string[];
	folder?: string;
	/** Wiki root path for FTS body-content augmentation. Optional; FTS is skipped when absent. */
	wikiRoot?: string;
}

function tokenize(input: string): string[] {
	return [...new Set(input.split(/[^a-z0-9]+/).filter(Boolean))];
}

function includesAny(values: string[], query: string): boolean {
	return values.some((value) => value.includes(query));
}

function scoreExactMatches(
	normalized: string,
	fields: {
		title: string;
		aliases: string[];
		domain?: string;
		areas: string[];
		summary: string;
		sourceIds: string[];
		path: string;
		headings: string[];
	},
): number {
	let score = 0;
	if (fields.title === normalized) score += SEARCH_FIELD_WEIGHTS.exactTitle;
	if (fields.aliases.includes(normalized)) score += SEARCH_FIELD_WEIGHTS.exactAlias;
	if (fields.domain === normalized) score += SEARCH_FIELD_WEIGHTS.exactDomain;
	if (fields.areas.includes(normalized)) score += SEARCH_FIELD_WEIGHTS.exactArea;
	if (fields.summary.includes(normalized)) score += SEARCH_FIELD_WEIGHTS.exactSummary;
	if (fields.sourceIds.includes(normalized)) score += SEARCH_FIELD_WEIGHTS.exactSourceId;
	if (fields.path.includes(normalized)) score += SEARCH_FIELD_WEIGHTS.exactPath;
	if (includesAny(fields.headings, normalized)) score += SEARCH_FIELD_WEIGHTS.exactHeading;
	return score;
}

function scoreTokenMatches(
	tokens: string[],
	fields: {
		title: string;
		aliases: string[];
		domain?: string;
		areas: string[];
		summary: string;
		headings: string[];
		tags: string[];
		sourceIds: string[];
		path: string;
	},
): number {
	let score = 0;
	for (const token of tokens) {
		if (fields.title.includes(token)) score += SEARCH_FIELD_WEIGHTS.tokenTitle;
		if (includesAny(fields.aliases, token)) score += SEARCH_FIELD_WEIGHTS.tokenAlias;
		if (fields.domain?.includes(token)) score += SEARCH_FIELD_WEIGHTS.tokenDomain;
		if (includesAny(fields.areas, token)) score += SEARCH_FIELD_WEIGHTS.tokenArea;
		if (fields.summary.includes(token)) score += SEARCH_FIELD_WEIGHTS.tokenSummary;
		if (includesAny(fields.headings, token)) score += SEARCH_FIELD_WEIGHTS.tokenHeading;
		if (includesAny(fields.sourceIds, token)) score += SEARCH_FIELD_WEIGHTS.tokenSourceId;
		if (includesAny(fields.tags, token)) score += SEARCH_FIELD_WEIGHTS.tokenTag;
		if (fields.path.includes(token)) score += SEARCH_FIELD_WEIGHTS.tokenPath;
	}
	return score;
}

function scoreEntry(entry: RegistryEntry, normalized: string, tokens: string[]): number {
	const normalizedFields = {
		title: entry.title.toLowerCase(),
		aliases: entry.aliases.map((alias) => alias.toLowerCase()),
		domain: entry.domain?.toLowerCase(),
		areas: entry.areas.map((area) => area.toLowerCase()),
		summary: entry.summary.toLowerCase(),
		headings: entry.headings.map((heading) => heading.toLowerCase()),
		tags: entry.tags.map((tag) => tag.toLowerCase()),
		sourceIds: entry.sourceIds.map((sourceId) => sourceId.toLowerCase()),
		path: entry.path.toLowerCase(),
	};

	return scoreExactMatches(normalized, normalizedFields) + scoreTokenMatches(tokens, normalizedFields);
}

function matchesAreas(entry: RegistryEntry, areas: string[]): boolean {
	if (areas.length === 0) return true;
	return areas.every((area) => entry.areas.includes(area));
}

export function searchRegistry(registry: RegistryData, query: string, options: SearchOptions = {}): SearchResult {
	const host = options.host ?? getCurrentHost();
	const hostScope = options.hostScope ?? "current";
	const domain = normalizeDomain(options.domain);
	const areas = normalizeAreas(options.areas);
	const folder = normalizePageFolder(options.folder);
	const normalized = query.trim().toLowerCase();
	const tokens = tokenize(normalized);

	if (!normalized) {
		return {
			query,
			hostScope,
			...(hostScope === "current" ? { host } : {}),
			...(domain ? { domain } : {}),
			areas,
			...(folder ? { folder } : {}),
			matches: [],
		};
	}

	const matches = registry.pages
		.filter((entry) => !options.type || entry.type === options.type)
		.filter((entry) => hostScope === "all" || appliesToHost(entry.hosts, host))
		.filter((entry) => !domain || entry.domain === domain)
		.filter((entry) => matchesAreas(entry, areas))
		.filter((entry) => folderMatches(entry.folder, folder))
		.map((entry) => ({ entry, score: scoreEntry(entry, normalized, tokens) }))
		.filter((match) => match.score > 0)
		.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
		.slice(0, options.limit ?? 10)
		.map(({ entry, score }) => ({
			type: entry.type,
			path: entry.path,
			folder: entry.folder,
			title: entry.title,
			summary: entry.summary,
			hosts: entry.hosts,
			domain: entry.domain,
			areas: entry.areas,
			score,
		}));

	// Augment with FTS body-content matches when registry results are sparse
	const limit = options.limit ?? 10;
	if (options.wikiRoot && matches.length < limit) {
		const existingPaths = new Set(matches.map((m) => m.path));
		const ftsHits = queryFts(options.wikiRoot, normalized, limit);
		for (const hit of ftsHits) {
			if (matches.length >= limit) break;
			if (existingPaths.has(hit.path)) continue;
			const entry = registry.pages.find((p) => p.path === hit.path);
			if (!entry) continue;
			if (options.type && entry.type !== options.type) continue;
			if (hostScope !== "all" && !appliesToHost(entry.hosts, host)) continue;
			if (domain && entry.domain !== domain) continue;
			if (!matchesAreas(entry, areas)) continue;
			if (folder && !folderMatches(entry.folder, folder)) continue;
			matches.push({
				type: entry.type,
				path: entry.path,
				folder: entry.folder,
				title: entry.title,
				summary: hit.snippet || entry.summary,
				hosts: entry.hosts,
				domain: entry.domain,
				areas: entry.areas,
				score: 1,
			});
		}
	}

	return {
		query,
		hostScope,
		...(hostScope === "current" ? { host } : {}),
		...(domain ? { domain } : {}),
		areas,
		...(folder ? { folder } : {}),
		matches,
	};
}

export function handleWikiSearch(registry: RegistryData, query: string, options: SearchOptions = {}): ActionResult<SearchResult> {
	const result = searchRegistry(registry, query, options);
	const scopeBits = [
		result.host ? `host=${result.host}` : undefined,
		result.domain ? `domain=${result.domain}` : undefined,
		result.areas.length > 0 ? `areas=${result.areas.join(",")}` : undefined,
		result.folder ? `folder=${result.folder}` : undefined,
	]
		.filter(Boolean)
		.join(" ");
	const scopeText = scopeBits ? ` (${scopeBits})` : "";

	if (result.matches.length === 0) {
		return ok({ text: `No wiki matches for${scopeText}: ${query}`, details: result });
	}

	const lines = [
		`Top matches for${scopeText}: ${query}`,
		...result.matches.map((match) =>
			`- [${match.score}] ${match.title} (${match.type}) — ${match.path}${formatDomainSuffix(match.domain)}${formatAreasSuffix(match.areas)}${formatHostsSuffix(match.hosts)}`,
		),
	];
	return ok({ text: lines.join("\n"), details: result });
}
