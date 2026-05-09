import type { ActionResult as SharedActionResult } from "./lib/core-utils.ts";

export type ActionResult<TDetails extends object = Record<string, unknown>> = SharedActionResult<TDetails>;

export const PAGE_TYPES = [
	"source",
	"concept",
	"entity",
	"synthesis",
	"analysis",
	"evolution",
	"procedure",
	"decision",
	"identity",
	"journal",
	// v2 types
	"daily-note",
	"person",
	"project",
	"area",
	"host",
	"service",
	"account",
	"financial-goal",
	"income-source",
	"snapshot",
	"dashboard",
	// Context-only types: wiki pages for notes/context; live state lives in CalDAV planner.
	"task",
	"event",
	"reminder",
] as const;
export type WikiPageType = (typeof PAGE_TYPES)[number];

export const CANONICAL_PAGE_TYPES = [
	"concept",
	"entity",
	"synthesis",
	"analysis",
	"evolution",
	"procedure",
	"decision",
	"identity",
	"journal",
	// v2 canonical types
	"daily-note",
	"person",
	"project",
	"area",
	"host",
	"service",
	"account",
	"financial-goal",
	"income-source",
	"snapshot",
	"dashboard",
	// Context-only: wiki note for task/event/reminder context; live planner state is in CalDAV.
	"task",
	"event",
	"reminder",
] as const;
export type CanonicalPageType = (typeof CANONICAL_PAGE_TYPES)[number];

export interface SourceManifest {
	version: number;
	sourceId: string;
	title: string;
	kind: string;
	origin: { type: "url" | "file" | "text"; value: string };
	capturedAt: string;
	integratedAt?: string;
	hash: string;
	status: "captured" | "integrated" | "superseded";
}

export interface SourcePageFrontmatter {
	id: string;
	type: "source";
	source_id: string;
	title: string;
	kind: string;
	status: "captured" | "integrated" | "superseded";
	captured_at: string;
	integrated_at?: string;
	created: string;
	updated: string;
	origin_type: "text" | "file" | "url";
	origin_value: string;
	aliases: string[];
	tags: string[];
	hosts: string[];
	domain?: string;
	areas: string[];
	source_ids: string[];
	integration_targets: string[];
	summary: string;
}

export interface CanonicalPageFrontmatter {
	type: CanonicalPageType;
	title: string;
	tags?: string[];
	hosts?: string[];
	domain?: string;
	areas?: string[];
	status?: string;
	updated?: string;
	summary: string;
	// v2 lifecycle fields
	id?: string;
	confidence?: string;
	last_confirmed?: string;
	decay?: string;
	supersedes?: string;
	created?: string;
	aliases?: string[];
	last_reviewed?: string;
	next_review?: string;
	source_ids?: string[];
	// relation fields
	projects?: string[];
	people?: string[];
	systems?: string[];
	related?: string[];
	sources?: string[];
	depends_on?: string[];
	blocked_by?: string[];
	completed?: string;
	// extra domain-specific fields (type-safe via index)
	[key: string]: unknown;
}

export type WikiFrontmatter = SourcePageFrontmatter | CanonicalPageFrontmatter;

export interface RegistryEntry {
	type: WikiPageType;
	path: string;
	folder: string;
	title: string;
	aliases: string[];
	summary: string;
	status:
		| "draft" | "active" | "contested" | "superseded" | "archived"
		| "proposed" | "planning" | "implementing" | "validating" | "reviewing" | "applied" | "rejected"
		| "planned" | "retired"
		| "captured" | "integrated"
		| "open" | "in-progress" | "waiting" | "done" | "cancelled"
		| "scheduled" | "snoozed";
	tags: string[];
	hosts: string[];
	domain?: string;
	areas: string[];
	updated: string;
	sourceIds: string[];
	linksOut: string[];
	headings: string[];
	wordCount: number;
	// object-model fields
	id?: string;
	nextReview?: string;
	supersedes?: string;
}

export interface RegistryData {
	version: number;
	generatedAt: string;
	pages: RegistryEntry[];
}

export interface WikiMetaArtifacts {
	registry: RegistryData;
	backlinks: BacklinksData;
	index: string;
	log: string;
}

export interface BacklinksData {
	version: number;
	generatedAt: string;
	byPath: Record<string, { inbound: string[]; outbound: string[] }>;
}

export interface WikiEvent {
	ts: string;
	kind: "capture" | "session-capture" | "integrate" | "page-create" | "lint" | "rebuild" | "steward";
	title: string;
	sourceIds?: string[];
	pagePaths?: string[];
}

export interface LintIssue {
	kind: string;
	severity: "info" | "warning" | "error";
	path: string;
	message: string;
}

export interface LintRun {
	mode: string;
	counts: {
		total: number;
		brokenLinks: number;
		orphans: number;
		frontmatter: number;
		duplicates: number;
		coverage: number;
		staleness: number;
		staleReviews: number;
		emptySummary: number;
		duplicateIds: number;
		unresolvedIds: number;
		thinContent: number;
		crossrefGaps: number;
		contradictionReview: number;
		missingConcepts: number;
	};
	issues: LintIssue[];
}

export interface CaptureDetails {
	sourceId: string;
	packetDir: string;
	sourcePagePath: string;
	title: string;
	status: "captured";
}

export interface SessionCaptureDetails extends CaptureDetails {
	dailyJournalPath: string;
	proposalPath?: string;
}

export interface PreparedSource {
	sourceId: string;
	title: string;
	kind: string;
	status: SourceManifest["status"];
	capturedAt: string;
	integratedAt?: string;
	packetDir: string;
	manifestPath: string;
	extractedPath: string;
	sourcePagePath: string;
	sourcePageExists: boolean;
	summary: string;
	integrationTargets: string[];
	ready: boolean;
	blockers: string[];
}

export interface IngestPrepareDetails {
	count: number;
	sources: PreparedSource[];
}

export interface IngestFinalizeDetails {
	integratedAt: string;
	finalized: string[];
	skipped: Array<{ sourceId: string; reason: string }>;
}

export interface IngestProposeDetails {
	proposals: Array<{
		sourceId: string;
		proposalPath: string;
		canonicalPatches?: Array<{ targetPath: string; exists: boolean; alreadyCitesSource: boolean }>;
	}>;
	skipped: Array<{ sourceId: string; reason: string }>;
}

export interface EnsurePageConflictDetails {
	resolved: false;
	created: false;
	conflict: true;
	candidates: Array<{ path: string; title: string }>;
}

export interface EnsurePageResolvedDetails {
	resolved: true;
	created: boolean;
	conflict: false;
	path: string;
	title: string;
	type: WikiPageType;
}

export type EnsurePageDetails = EnsurePageConflictDetails | EnsurePageResolvedDetails;

export interface WikiStatusDetails {
	initialized: boolean;
	host?: string;
	root?: string;
	total?: number;
	visible?: number;
	source?: number;
	canonical?: number;
	journal?: number;
	captured?: number;
	integrated?: number;
	domains?: Record<string, number>;
}

export interface LintDetails {
	counts: LintRun["counts"];
	issues: LintIssue[];
}

export interface StewardActionItem {
	queue: string;
	path: string;
	kind: string;
	severity: LintIssue["severity"];
	risk: "low" | "medium" | "high";
	autoFix: "safe" | "review" | "no";
	evidence: string;
	proposedHandling: string;
}

export interface StewardActionQueue {
	name: string;
	label: string;
	description: string;
	items: StewardActionItem[];
}

export interface WikiStewardDetails {
	reportPath: string;
	proposalPath: string;
	lintCounts: LintRun["counts"];
	reviewQueue: LintIssue[];
	discoveryQueue: LintIssue[];
	actionQueues: StewardActionQueue[];
	capturedSources: PreparedSource[];
	websearchSuggestions: string[];
}

export interface MemoryStatusDetails {
	health: "ok" | "review" | "warning";
	root: string;
	host: string;
	registryGeneratedAt: string;
	registryMtime?: string;
	registryAgeMinutes?: number;
	todayJournalPath?: string;
	pageCount: number;
	lintCounts: LintRun["counts"];
	capturedSources: PreparedSource[];
	staleReviews: number;
}
