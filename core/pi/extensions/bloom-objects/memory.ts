import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter, stringifyFrontmatter } from "../../../lib/frontmatter.js";
import { nowIso } from "../../../lib/shared.js";

export interface MemoryRecord {
	filepath: string;
	attributes: Record<string, unknown>;
	body: string;
}

export interface QueryResult {
	ref: string;
	title?: string;
	summary?: string;
	score: number;
	reasons: string[];
	filepath: string;
}

export interface ScopePreference {
	scope: string;
	value?: string;
}

export function normalizeScalar(value: unknown): string | number | boolean | null {
	if (value === null) return null;
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
	return String(value);
}

function normalizeArray(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.map((item) => String(item).trim()).filter(Boolean);
	}
	if (typeof value === "string") {
		return value
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
	}
	return [];
}

function coerceNumber(value: unknown, fallback = 0): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return fallback;
}

function confidenceBonus(confidence: string | undefined): number {
	switch ((confidence ?? "").toLowerCase()) {
		case "high":
			return 10;
		case "medium":
			return 5;
		default:
			return 0;
	}
}

function safeTimestamp(value: unknown): number {
	if (typeof value !== "string") return 0;
	const time = Date.parse(value);
	return Number.isFinite(time) ? time : 0;
}

export function normalizeFields(fields?: Record<string, unknown>): Record<string, unknown> {
	if (!fields) return {};
	const normalized: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(fields)) {
		if (value === undefined) continue;
		if (key === "tags" || key === "links" || key === "source") {
			normalized[key] = normalizeArray(value);
			continue;
		}
		if (key === "salience") {
			normalized[key] = coerceNumber(value, 0);
			continue;
		}
		if (key === "scope_value") {
			normalized[key] = normalizeScalar(value);
			continue;
		}
		normalized[key] = normalizeScalar(value);
	}
	return normalized;
}

function scopePreferenceBonus(
	recordScope: string,
	recordScopeValue: string,
	preferences?: ScopePreference[],
): { bonus: number; matched?: string } {
	if (!preferences || preferences.length === 0) return { bonus: 0 };
	let best: { bonus: number; matched?: string } = { bonus: 0 };
	for (const preference of preferences) {
		const candidate = preferenceBonus(preference, recordScope, recordScopeValue);
		if (candidate && candidate.bonus > best.bonus) best = candidate;
	}
	return best;
}

function preferenceBonus(
	preference: ScopePreference,
	recordScope: string,
	recordScopeValue: string,
): { bonus: number; matched?: string } | null {
	if (preference.scope !== recordScope) return null;
	if (preference.value && recordScopeValue && preference.value === recordScopeValue) {
		return { bonus: 35, matched: `${recordScope}:${recordScopeValue}` };
	}
	return { bonus: 20, matched: recordScope };
}

export function defaultObjectBody(attributes: Record<string, unknown>): string {
	const title = typeof attributes.title === "string" ? attributes.title : undefined;
	return title ? `# ${title}\n` : "";
}

export function mergeObjectState(params: {
	type: string;
	slug: string;
	fields?: Record<string, unknown>;
	existing?: Record<string, unknown>;
}): Record<string, unknown> {
	const now = nowIso();
	const normalizedFields = normalizeFields(params.fields);
	const existing = params.existing ?? {};
	const merged: Record<string, unknown> = {
		...existing,
		type: params.type,
		slug: params.slug,
		origin: existing.origin ?? "pi",
		created: existing.created ?? now,
		modified: now,
		scope: existing.scope ?? "global",
		confidence: existing.confidence ?? "medium",
		status: existing.status ?? "active",
		salience: existing.salience ?? 0.5,
		...normalizedFields,
	};

	if (!merged.summary && typeof merged.title === "string") {
		merged.summary = `${merged.title}`;
	}
	if (!merged.last_accessed) merged.last_accessed = merged.modified;
	if (!merged.last_confirmed) merged.last_confirmed = merged.modified;
	return merged;
}

export function readMemoryRecord(filepath: string): MemoryRecord | null {
	try {
		if (!fs.existsSync(filepath)) return null;
		const raw = fs.readFileSync(filepath, "utf-8");
		const { attributes, body } = parseFrontmatter<Record<string, unknown>>(raw);
		return { filepath, attributes, body };
	} catch {
		return null;
	}
}

export function writeMemoryRecord(record: MemoryRecord): void {
	fs.mkdirSync(path.dirname(record.filepath), { recursive: true });
	fs.writeFileSync(record.filepath, stringifyFrontmatter(record.attributes, record.body));
}

export function formatRef(attributes: Record<string, unknown>, filepath: string): string {
	const type = String(attributes.type ?? "note");
	const slug = String(attributes.slug ?? path.basename(filepath, ".md"));
	return `${type}/${slug}`;
}

function applyExactFilter(
	expected: string | undefined,
	actual: string,
	scoreValue: number,
	reason: string,
	state: { score: number; reasons: string[] },
): boolean {
	if (!expected) return true;
	if (actual !== expected) return false;
	state.score += scoreValue;
	state.reasons.push(reason);
	return true;
}

function applyLinkFilter(
	linkTo: string | undefined,
	links: string[],
	state: { score: number; reasons: string[] },
): boolean {
	if (!linkTo) return true;
	if (!links.includes(linkTo)) return false;
	state.score += 15;
	state.reasons.push("link");
	return true;
}

function applyTagFilter(
	requiredTags: string[] | undefined,
	tags: string[],
	state: { score: number; reasons: string[] },
): boolean {
	if (!requiredTags || requiredTags.length === 0) return true;
	const tagMatches = requiredTags.filter((tag) => tags.includes(tag));
	if (tagMatches.length === 0) return false;
	state.score += tagMatches.length * 30;
	state.reasons.push(`tags:${tagMatches.length}`);
	return true;
}

function applyTextScore(
	text: string | undefined,
	record: MemoryRecord,
	title: string | undefined,
	summary: string | undefined,
	tags: string[],
	state: { score: number; reasons: string[] },
): boolean {
	if (!text) return true;
	const query = text.toLowerCase();
	let matched = false;
	matched = scoreTextMatch(title, query, 20, "title", state) || matched;
	matched = scoreTextMatch(summary, query, 15, "summary", state) || matched;
	if (tags.some((tag) => tag.toLowerCase().includes(query))) {
		state.score += 10;
		state.reasons.push("tag-text");
		matched = true;
	}
	if (record.body.toLowerCase().includes(query)) {
		state.score += 10;
		state.reasons.push("body");
		matched = true;
	}
	return matched;
}

function scoreTextMatch(
	value: string | undefined,
	query: string,
	scoreValue: number,
	reason: string,
	state: { score: number; reasons: string[] },
): boolean {
	if (!value?.toLowerCase().includes(query)) return false;
	state.score += scoreValue;
	state.reasons.push(reason);
	return true;
}

function applyMetadataBonuses(
	record: MemoryRecord,
	recordScope: string,
	recordScopeValue: string,
	preferredScopes: ScopePreference[] | undefined,
	state: { score: number; reasons: string[] },
) {
	state.score += confidenceBonus(
		typeof record.attributes.confidence === "string" ? record.attributes.confidence : undefined,
	);
	state.score += Math.round(coerceNumber(record.attributes.salience, 0) * 10);
	const scopeBonus = scopePreferenceBonus(recordScope, recordScopeValue, preferredScopes);
	state.score += scopeBonus.bonus;
	if (scopeBonus.matched) state.reasons.push(`preferred:${scopeBonus.matched}`);
	state.score += safeTimestamp(record.attributes.last_accessed) > 0 ? 3 : 0;
	state.score += safeTimestamp(record.attributes.modified) > 0 ? 2 : 0;
}

export function scoreRecord(
	record: MemoryRecord,
	params: {
		text?: string;
		type?: string;
		tags?: string[];
		scope?: string;
		scope_value?: string;
		status?: string;
		link_to?: string;
		preferred_scopes?: ScopePreference[];
	},
): QueryResult | null {
	const ref = formatRef(record.attributes, record.filepath);
	const title = typeof record.attributes.title === "string" ? record.attributes.title : undefined;
	const summary = typeof record.attributes.summary === "string" ? record.attributes.summary : undefined;
	const tags = normalizeArray(record.attributes.tags);
	const links = normalizeArray(record.attributes.links);
	const reasons: string[] = [];
	const state = { score: 0, reasons };

	const recordType = String(record.attributes.type ?? "note");
	const recordScope = String(record.attributes.scope ?? "global");
	const recordScopeValue = String(record.attributes.scope_value ?? "");
	const recordStatus = String(record.attributes.status ?? "active");

	if (!applyExactFilter(params.type, recordType, 50, "type", state)) return null;
	if (!applyExactFilter(params.scope, recordScope, 25, "scope", state)) return null;
	if (!applyExactFilter(params.scope_value, recordScopeValue, 15, "scope_value", state)) return null;
	if (!applyExactFilter(params.status, recordStatus, 10, "status", state)) return null;
	if (!applyLinkFilter(params.link_to, links, state)) return null;
	if (!applyTagFilter(params.tags, tags, state)) return null;
	if (!applyTextScore(params.text, record, title, summary, tags, state)) return null;
	applyMetadataBonuses(record, recordScope, recordScopeValue, params.preferred_scopes, state);

	return {
		ref,
		title,
		summary,
		score: state.score,
		reasons,
		filepath: record.filepath,
	};
}
