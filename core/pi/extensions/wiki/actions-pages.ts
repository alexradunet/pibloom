import { mkdirSync } from "node:fs";
import path from "node:path";
import { stringifyFrontmatter } from "../../../lib/frontmatter.js";
import { atomicWriteFile } from "../../../lib/filesystem.js";
import { nowIso, ok } from "../../../lib/utils.js";
import { appendEvent, loadRegistry } from "./actions-meta.js";
import { dedupeSlug, slugifyTitle, todayStamp } from "./paths.js";
import type { ActionResult, CanonicalPageType } from "./types.js";

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
			details: {
				resolved: false,
				created: false,
				conflict: true,
				candidates: matches.map((p) => ({ path: p.path, title: p.title })),
			},
		});
	}

	if (matches.length === 1 && matches[0]) {
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

	void appendEvent(wikiRoot, {
		ts: nowIso(),
		kind: "page-create",
		title: `Created ${params.type}: ${params.title}`,
		pagePaths: [relPath],
	});

	return ok({
		text: `Created page: ${relPath}`,
		details: { resolved: true, created: true, conflict: false, path: relPath, title: params.title, type: params.type },
	});
}
