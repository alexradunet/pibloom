import path from "node:path";
import { getBloomDir } from "../../../lib/filesystem.js";
import { walkMdFiles } from "./actions.js";
import { readMemoryRecord } from "./memory.js";

interface DigestItem {
	ref: string;
	title: string;
	summary: string;
	type: string;
	score: number;
}

interface ScopePreference {
	scope: string;
	value?: string;
}

function recordRef(filepath: string, attributes: Record<string, unknown>): string {
	return `${String(attributes.type ?? "note")}/${String(attributes.slug ?? path.basename(filepath, ".md"))}`;
}

function asString(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return fallback;
}

function scopeBonus(scope: string, scopeValue: string, preferences: ScopePreference[]): number {
	for (const preference of preferences) {
		if (preference.scope !== scope) continue;
		if (preference.value && scopeValue) {
			if (preference.value === scopeValue) return 35;
			continue;
		}
		return 20;
	}
	return 0;
}

function buildDigestItem(filepath: string, preferences: ScopePreference[]): DigestItem | null {
	const record = readMemoryRecord(filepath);
	if (!record) return null;
	const type = asString(record.attributes.type, "note");
	const status = asString(record.attributes.status, "active");
	if (status !== "active") return null;
	const title = asString(record.attributes.title, asString(record.attributes.slug, path.basename(filepath, ".md")));
	const summary = asString(record.attributes.summary, title);
	const score =
		asNumber(record.attributes.salience, 0.5) * 10 +
		scopeBonus(asString(record.attributes.scope, "global"), asString(record.attributes.scope_value), preferences);
	return {
		ref: recordRef(filepath, record.attributes),
		title,
		summary,
		type,
		score,
	};
}

function topItems(type: string, limit: number, preferences: ScopePreference[]): DigestItem[] {
	const dir = path.join(getBloomDir(), "Objects");
	const items = walkMdFiles(dir)
		.map((filepath) => buildDigestItem(filepath, preferences))
		.filter((item): item is DigestItem => item !== null && item.type === type)
		.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
	return items.slice(0, limit);
}

function renderSection(title: string, items: DigestItem[]): string[] {
	if (items.length === 0) return [];
	return [title, ...items.map((item) => `- ${item.ref} — ${item.summary}`), ""];
}

function inferScopePreferences(cwd?: string): ScopePreference[] {
	const preferences: ScopePreference[] = [
		{ scope: "room" },
		{ scope: "project" },
		{ scope: "host" },
		{ scope: "global" },
	];
	if (!cwd) return preferences;
	const project = path.basename(cwd);
	if (project) {
		preferences.unshift({ scope: "project", value: project });
	}
	return preferences;
}

export function buildMemoryDigest(cwd?: string): string {
	const preferences = inferScopePreferences(cwd);
	const sections = [
		...renderSection("Active Preferences", topItems("preference", 5, preferences)),
		...renderSection("Active Projects", topItems("project", 3, preferences)),
		...renderSection("Open Threads", topItems("thread", 5, preferences)),
		...renderSection("Useful Procedures", topItems("procedure", 3, preferences)),
		...renderSection("High-Signal Facts", topItems("fact", 5, preferences)),
	];
	if (sections.length === 0) return "";
	return `\n\n[BLOOM MEMORY DIGEST]\n${sections.join("\n").trimEnd()}`;
}
