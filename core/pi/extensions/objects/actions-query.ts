/**
 * Query handlers for objects: list and search.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getNixPiDir, safePathWithin } from "../../../lib/filesystem.js";
import { parseFrontmatter } from "../../../lib/frontmatter.js";
import { errorResult, textToolResult, truncate } from "../../../lib/utils.js";
import { walkMdFiles } from "./actions.js";
import { readMemoryRecord, type ScopePreference, scoreRecord } from "./memory.js";

type QueryParams = {
	text?: string;
	type?: string;
	tags?: string[];
	scope?: string;
	scope_value?: string;
	status?: string;
	link_to?: string;
	preferred_scopes?: ScopePreference[];
	limit?: number;
};

function resolveObjectsDir(directory?: string) {
	if (!directory) return { dir: path.join(getNixPiDir(), "Objects") };
	try {
		return { dir: safePathWithin(os.homedir(), directory) };
	} catch {
		return { error: errorResult("Path traversal blocked: invalid directory") };
	}
}

function matchesObjectFilters(
	attributes: Record<string, unknown>,
	type: string | undefined,
	filters: Record<string, string>,
): boolean {
	if (type && String(attributes.type ?? "note") !== type) return false;
	return Object.entries(filters).every(([key, val]) => {
		if (key === "tag") {
			const tags = Array.isArray(attributes.tags) ? attributes.tags : [];
			return (tags as string[]).includes(val);
		}
		return String(attributes[key] ?? "") === val;
	});
}

function formatObjectListEntry(attributes: Record<string, unknown>): string {
	const type = String(attributes.type ?? "note");
	const slug = String(attributes.slug ?? "unknown");
	const title = attributes.title ? ` — ${attributes.title}` : "";
	return `${type}/${slug}${title}`;
}

function collectObjectListEntries(
	dir: string,
	type: string | undefined,
	filters: Record<string, string>,
	signal?: AbortSignal,
): string[] {
	const results: string[] = [];
	for (const filepath of walkMdFiles(dir)) {
		if (signal?.aborted) break;
		try {
			const raw = fs.readFileSync(filepath, "utf-8");
			const { attributes } = parseFrontmatter<Record<string, unknown>>(raw);
			if (!matchesObjectFilters(attributes, type, filters)) continue;
			results.push(formatObjectListEntry(attributes));
		} catch {
			// Skip unreadable files
		}
	}
	return results;
}

function formatSearchMatch(filepath: string, attributes: Record<string, unknown>): string {
	const type = String(attributes.type ?? "note");
	const slug = String(attributes.slug ?? path.basename(filepath, ".md"));
	const ref = `${type}/${slug}`;
	const title = attributes.title ? ` — ${attributes.title}` : "";
	return `${ref}${title}`;
}

function collectSearchMatches(workspaceDir: string, pattern: string, signal?: AbortSignal): string[] {
	const matches: string[] = [];
	const files = fs.globSync("**/*.md", { cwd: workspaceDir });

	for (const file of files) {
		if (signal?.aborted) break;
		try {
			const filepath = path.join(workspaceDir, file);
			const raw = fs.readFileSync(filepath, "utf-8");
			if (!raw.includes(pattern)) continue;
			const { attributes } = parseFrontmatter<Record<string, unknown>>(raw);
			matches.push(formatSearchMatch(filepath, attributes));
		} catch {
			// Skip unreadable files
		}
	}

	return matches;
}

function queryLimit(limit: number | undefined): number {
	return Math.max(1, Math.min(100, Number(limit ?? 10)));
}

function collectRankedMatches(dir: string, params: QueryParams, signal?: AbortSignal) {
	const results = [];
	for (const filepath of walkMdFiles(dir)) {
		if (signal?.aborted) break;
		const record = readMemoryRecord(filepath);
		if (!record) continue;
		const scored = scoreRecord(record, params);
		if (!scored) continue;
		results.push(scored);
	}
	return results;
}

function formatRankedResult(result: {
	ref: string;
	title?: string;
	summary?: string;
	score: number;
	reasons: string[];
}): string {
	const title = result.title ? ` — ${result.title}` : "";
	const summary = result.summary ? `\n  ${result.summary}` : "";
	return `${result.ref}${title} [score=${result.score}; ${result.reasons.join(", ")}]${summary}`;
}

/** List objects, optionally filtered by type or frontmatter fields. */
export function listObjects(
	params: { type?: string; directory?: string; filters?: Record<string, string> },
	signal?: AbortSignal,
) {
	const filters = params.filters ?? {};
	const resolved = resolveObjectsDir(params.directory);
	if (resolved.error) return resolved.error;

	const results = collectObjectListEntries(resolved.dir, params.type, filters, signal);

	const text = results.length > 0 ? results.join("\n") : "No objects found";
	return textToolResult(truncate(text));
}

/** Search markdown files in ~/nixpi/ for a pattern. */
export function searchObjects(params: { pattern: string }, signal?: AbortSignal) {
	const workspaceDir = getNixPiDir();
	const matches = collectSearchMatches(workspaceDir, params.pattern, signal);

	const text = matches.length > 0 ? matches.join("\n") : "No matches found";
	return textToolResult(truncate(text));
}

/** Query ranked object matches from ~/nixpi/Objects/. */
export function queryObjects(params: QueryParams, signal?: AbortSignal) {
	const workspaceDir = getNixPiDir();
	const dir = path.join(workspaceDir, "Objects");
	const limit = queryLimit(params.limit);
	const results = collectRankedMatches(dir, params, signal);

	results.sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref));
	const top = results.slice(0, limit);
	const text =
		top.length > 0 ? top.map((result) => formatRankedResult(result)).join("\n") : "No matching objects found";

	return textToolResult(truncate(text), { count: top.length, results: top });
}
