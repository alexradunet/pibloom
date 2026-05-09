import type { RegistryEntry, WikiPageType } from "./types.ts";

export const KNOWLEDGE_TYPES = new Set<WikiPageType>(["concept", "entity", "synthesis", "analysis", "evolution", "procedure", "decision", "identity"]);
// Context-only types: wiki pages for notes/context; live planner state is in CalDAV.
export const OPERATIONAL_TYPES = new Set<WikiPageType>(["task", "event", "reminder"]);

// These task/event/reminder statuses are kept for wiki lint validation of context pages.
// These task/event/reminder statuses are kept for wiki lint validation of context pages.
// The authoritative status for live planner items is the CalDAV VTODO/VEVENT STATUS property.
export const TASK_STATUSES = new Set(["open", "in-progress", "waiting", "done", "cancelled"]);
export const EVENT_STATUSES = new Set(["scheduled", "done", "cancelled"]);
export const REMINDER_STATUSES = new Set(["open", "snoozed", "done", "cancelled"]);
export const CANONICAL_STATUSES = new Set(["draft", "active", "contested", "superseded", "archived"]);
export const EVOLUTION_STATUSES = new Set(["proposed", "planning", "implementing", "validating", "reviewing", "applied", "rejected", "active"]);
export const DECISION_STATUSES = new Set([...CANONICAL_STATUSES, "applied", "rejected"]);
export const CONCEPT_STATUSES = new Set([...CANONICAL_STATUSES, "applied"]);
export const ENTITY_STATUSES = new Set([...CANONICAL_STATUSES, "planned", "retired"]);

export function validStatusesForType(type: WikiPageType): ReadonlySet<string> {
	if (type === "task") return TASK_STATUSES;
	if (type === "event") return EVENT_STATUSES;
	if (type === "reminder") return REMINDER_STATUSES;
	if (type === "evolution") return EVOLUTION_STATUSES;
	if (type === "decision") return DECISION_STATUSES;
	if (type === "concept") return CONCEPT_STATUSES;
	if (type === "entity") return ENTITY_STATUSES;
	return CANONICAL_STATUSES;
}

const TYPE_ID_PREFIXES: Record<string, readonly string[]> = {
	dashboard: ["home"],
	"daily-note": ["journal"],
	daily_note: ["journal"],
	journal: ["journal"],
	"evolution-index": ["evolution"],
};

export function validIdPrefixesForType(type: string): readonly string[] {
	return TYPE_ID_PREFIXES[type] ?? [type];
}

export const REQUIRED_FRONTMATTER_FIELDS: Record<WikiPageType, readonly string[]> = {
	// v2 base required fields for all types
	"daily-note":     ["id", "type", "title", "domain", "areas", "confidence", "last_confirmed", "decay", "created", "updated", "summary"],
	concept:          ["id", "type", "title", "domain", "areas", "confidence", "last_confirmed", "decay", "created", "updated", "summary"],
	person:           ["id", "type", "title", "domain", "areas", "confidence", "last_confirmed", "decay", "created", "updated", "summary"],
	project:          ["id", "type", "title", "domain", "areas", "confidence", "last_confirmed", "decay", "created", "updated", "summary"],
	area:             ["id", "type", "title", "domain", "areas", "confidence", "last_confirmed", "decay", "created", "updated", "summary"],
	decision:         ["id", "type", "title", "domain", "areas", "confidence", "last_confirmed", "decay", "created", "updated", "summary"],
	evolution:        ["id", "type", "title", "domain", "areas", "confidence", "last_confirmed", "decay", "created", "updated", "summary"],
	host:             ["id", "type", "title", "domain", "areas", "confidence", "last_confirmed", "decay", "created", "updated", "summary"],
	service:          ["id", "type", "title", "domain", "areas", "confidence", "last_confirmed", "decay", "created", "updated", "summary"],
	account:          ["id", "type", "title", "domain", "areas", "confidence", "last_confirmed", "decay", "created", "updated", "summary"],
	"financial-goal": ["id", "type", "title", "domain", "areas", "confidence", "last_confirmed", "decay", "created", "updated", "summary"],
	"income-source":  ["id", "type", "title", "domain", "areas", "confidence", "last_confirmed", "decay", "created", "updated", "summary"],
	snapshot:         ["id", "type", "title", "domain", "areas", "confidence", "last_confirmed", "decay", "created", "updated", "summary"],
	dashboard:        ["id", "type", "title", "domain", "areas", "confidence", "last_confirmed", "decay", "created", "updated", "summary"],
	source:           ["id", "type", "title", "domain", "areas", "confidence", "last_confirmed", "decay", "created", "updated", "summary"],
	// Legacy v1 types — kept for backward compat with pages/ tree
	entity:    ["id", "type", "title", "domain", "areas", "created", "updated", "summary"],
	synthesis: ["id", "type", "title", "domain", "areas", "created", "updated", "summary"],
	analysis:  ["id", "type", "title", "domain", "areas", "created", "updated", "summary"],
	procedure: ["id", "type", "title", "domain", "areas", "created", "updated", "summary"],
	identity:  ["id", "type", "title", "domain", "areas", "created", "updated", "summary"],
	journal:   ["id", "type", "title", "domain", "areas", "created", "updated", "summary"],
	task:      ["id", "type", "title", "domain", "areas", "created", "updated", "summary"],
	event:     ["id", "type", "title", "domain", "areas", "created", "updated", "summary"],
	reminder:  ["id", "type", "title", "domain", "areas", "created", "updated", "summary"],
};

export const SEARCH_FIELD_WEIGHTS = {
	exactTitle: 120,
	exactAlias: 110,
	exactDomain: 55,
	exactArea: 52,
	exactSummary: 50,
	exactSourceId: 45,
	exactPath: 40,
	exactHeading: 35,
	tokenTitle: 18,
	tokenAlias: 14,
	tokenDomain: 10,
	tokenArea: 10,
	tokenSummary: 8,
	tokenHeading: 6,
	tokenSourceId: 5,
	tokenTag: 4,
	tokenPath: 3,
} as const;

export type LintMode =
	| "links" | "frontmatter" | "duplicates" | "supersedes-cycles"
	| "strict";

export interface SearchableRegistryEntry {
	title: RegistryEntry["title"];
	aliases: RegistryEntry["aliases"];
	domain: RegistryEntry["domain"];
	areas: RegistryEntry["areas"];
	summary: RegistryEntry["summary"];
	headings: RegistryEntry["headings"];
	tags: RegistryEntry["tags"];
	sourceIds: RegistryEntry["sourceIds"];
	path: RegistryEntry["path"];
}
