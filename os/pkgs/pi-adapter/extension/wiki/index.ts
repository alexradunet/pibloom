/**
 * ownloom-wiki v2 — second-brain extension.
 *
 * @tools wiki_status, wiki_search, wiki_ensure_object, wiki_daily, wiki_ingest, wiki_lint, wiki_rebuild, wiki_session_capture, wiki_decay_pass
 * @hooks tool_call, agent_end, session_start, session_before_compact
 */
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type ExtensionAPI, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
	callWikiTool,
	getWikiRoot,
	getWikiRootForDomain,
	getWikiRoots,
	isProtectedPath,
	isWikiPagePath,
	rebuildAllMeta,
	toolManifest,
	todayStamp,
} from "../../../wiki/src/api.ts";
import { readMemoryPaths, readMemoryStats } from "./prompt-context.ts";
import { buildCompactionContext, saveContext } from "./runtime-policy.ts";

const execFileAsync = promisify(execFile);

// ── /today helper ─────────────────────────────────────────────────────────────

async function buildTodayDigest(wikiRoot: string): Promise<string> {
	const today = todayStamp();
	const lines: string[] = [`🗓️  ${today} — pi today`];

	// 1. meta/about-alex/current-context
	const ctxPath = path.join(wikiRoot, "meta", "about-alex", "current-context.md");
	if (existsSync(ctxPath)) {
		const raw = readFileSync(ctxPath, "utf-8");
		// Extract body (skip frontmatter)
		const body = raw.replace(/^---[\s\S]*?---\n/, "").trim();
		lines.push("", "## 🧠 Current context", body);
	}

	// 2. Planner: today + overdue
	try {
		const [{ stdout: todayOut }, { stdout: overdueOut }] = await Promise.all([
			execFileAsync("ownloom-planner", ["list", "today", "--json"], { timeout: 8_000 }),
			execFileAsync("ownloom-planner", ["list", "overdue", "--json"], { timeout: 8_000 }),
		]);
		const todayItems: any[] = JSON.parse(todayOut.trim() || "[]");
		const overdueItems: any[] = JSON.parse(overdueOut.trim() || "[]");
		lines.push("", "## 📋 Planner");
		if (overdueItems.length > 0) {
			lines.push(`⚠️  Overdue (${overdueItems.length}):`);
			for (const i of overdueItems.slice(0, 5)) lines.push(`  - ${i.title} (${(i.due ?? "?").slice(0, 10)})`);
		}
		if (todayItems.length > 0) {
			lines.push(`Today (${todayItems.length}):`);
			for (const i of todayItems) lines.push(`  - ${i.title}`);
		} else {
			lines.push("No tasks due today.");
		}
	} catch {
		lines.push("", "## 📋 Planner", "(unavailable)");
	}

	// 3. Active projects (type:project, status:active, recently touched)
	try {
		const projectResult = await callWikiTool("wiki_search", { query: "project", type: "project", domain: "personal", limit: 8 }, { policy: {} });
		const projectText = projectResult.content[0]?.text ?? "";
		if (projectText && !projectText.startsWith("No wiki")) {
			lines.push("", "## 🚀 Active projects", projectText);
		}
	} catch { /* skip */ }

	// 4. Sources captured in last 7 days not yet compiled
	try {
		const srcResult = await callWikiTool("wiki_search", { query: "source captured", type: "source", domain: "personal", limit: 6 }, { policy: {} });
		const srcText = srcResult.content[0]?.text ?? "";
		if (srcText && !srcText.startsWith("No wiki")) {
			lines.push("", "## 📥 Recent sources (may need extraction)", srcText);
		}
	} catch { /* skip */ }

	// 5. Pages with confidence:low (decay-flagged)
	try {
		const { execFileSync } = await import("node:child_process");
		const lowOut = execFileSync("rg", ["--files-with-matches", "^confidence: low", path.join(wikiRoot, "objects")], { encoding: "utf-8", timeout: 5_000 }).trim();
		const lowFiles = lowOut ? lowOut.split("\n").filter(Boolean).slice(0, 8) : [];
		if (lowFiles.length > 0) {
			lines.push("", `## 🟡 Low-confidence pages (${lowFiles.length}) — needs review or archive`);
			for (const f of lowFiles) lines.push(`  - ${path.basename(f, ".md")}`);
		}
	} catch { /* skip */ }

	return lines.join("\n");
}

// ── Parameter schemas ────────────────────────────────────────────────────────

const REQUIRED_TOOL_PARAMS: Record<string, readonly string[]> = {
	wiki_search: ["query"],
	wiki_ensure_object: ["type", "title"],
	wiki_daily: ["action"],
	wiki_ingest: ["content"],
	wiki_session_capture: ["summary"],
};

type ManifestParam = {
	type?: string;
	description?: string;
	default?: unknown;
	enum?: readonly unknown[];
	items?: ManifestParam;
};

function manifestParamToType(param: ManifestParam): any {
	const options = { description: param.description, default: param.default };
	if (param.enum?.length) return Type.Union(param.enum.map((value) => Type.Literal(value as string | number | boolean)), options);
	if (param.type === "array") return Type.Array(manifestParamToType(param.items ?? { type: "string" }), options);
	if (param.type === "number") return Type.Number(options);
	if (param.type === "boolean") return Type.Boolean(options);
	return Type.String(options);
}

function manifestParamsToSchema(toolName: string, params: Record<string, ManifestParam>) {
	const required = new Set(REQUIRED_TOOL_PARAMS[toolName] ?? []);
	return Type.Object(Object.fromEntries(
		Object.entries(params).map(([name, param]) => {
			const schema = manifestParamToType(param);
			return [name, required.has(name) ? schema : Type.Optional(schema)];
		}),
	));
}

type RegisteredExtensionTool = {
	name: string;
	label?: string;
	description?: string;
	parameters?: unknown;
	execute: (...args: any[]) => unknown;
};

// ── Tool execution ────────────────────────────────────────────────────────────

async function executeCoreWikiTool(
	name: string,
	params: Record<string, unknown> | undefined,
	signal: AbortSignal | undefined,
) {
	return callWikiTool(name, params ?? {}, {
		signal,
		policy: { allowMutation: true, allowCacheMutation: true },
	});
}

// ── Extension entry ───────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const dirtyRoots = new Set<string>();

	// Register all wiki tools declared by the shared ownloom-wiki manifest.
	const tools: RegisteredExtensionTool[] = toolManifest.map((manifest) => ({
		name: manifest.name,
		label: manifest.label,
		description: manifest.description,
		parameters: manifestParamsToSchema(manifest.name, manifest.parameters as Record<string, ManifestParam>),
		async execute(_toolCallId: string, params: unknown, signal: AbortSignal | undefined) {
			return executeCoreWikiTool(manifest.name, (params ?? {}) as Record<string, unknown>, signal);
		},
	}));
	for (const tool of tools) pi.registerTool(tool);

	pi.registerCommand("memory", {
		description: "Show memory file stats and paths. Usage: /memory",
		handler: async (_args, ctx) => {
			const { memoryPath, userPath, memoryChars, userChars } = readMemoryStats();
			const memPct = Math.round((memoryChars / 3000) * 100);
			const usrPct = Math.round((userChars / 1500) * 100);
			ctx.ui.notify(
				`MEMORY.md: ${memoryChars} chars (${memPct}% of ~3k)\n` +
				`USER.md:   ${userChars} chars (${usrPct}% of ~1.5k)\n` +
				`Paths: ${memoryPath}\n       ${userPath}`,
				"info"
			);
		},
	});

	pi.registerCommand("today", {
		description: "Daily briefing: current context, planner, active projects, stale sources, low-confidence pages. Usage: /today",
		handler: async (_args, ctx) => {
			const wikiRoot = getWikiRootForDomain("personal");
			const digest = await buildTodayDigest(wikiRoot);
			ctx.ui.notify(digest, "info");
		},
	});

	// Protect raw/ and meta/proposals/ from direct writes; allow meta/about-alex/ and meta/audit/
	function protectOrMark(pathValue: string) {
		const wikiRoots = [...new Set([getWikiRoot(), ...Object.values(getWikiRoots())])];
		for (const wikiRoot of wikiRoots) {
			if (isProtectedPath(wikiRoot, pathValue)) {
				return {
					block: true as const,
					reason: "Wiki protects raw/ and meta/proposals/. Use wiki tools for those. meta/about-alex/ and meta/audit/ are agent-writeable.",
				};
			}
			if (isWikiPagePath(wikiRoot, pathValue)) dirtyRoots.add(wikiRoot);
		}
		return undefined;
	}

	pi.on("tool_call", async (event) => {
		if (isToolCallEventType("write", event)) return protectOrMark(event.input.path);
		if (isToolCallEventType("edit", event)) return protectOrMark(event.input.path);
		return undefined;
	});

	// Notify when memory files are updated
	pi.on("tool_result", async (event: any, ctx: any) => {
		if (event.toolName !== "edit" && event.toolName !== "write") return;
		const { memoryPath, userPath } = readMemoryPaths();
		const edited: string = event.input?.path ?? "";
		if (edited === memoryPath) ctx.ui.notify("💭 MEMORY.md updated", "info");
		else if (edited === userPath) ctx.ui.notify("💭 USER.md updated", "info");
	});

	pi.on("agent_end", async () => {
		if (dirtyRoots.size === 0) return;
		const roots = [...dirtyRoots];
		dirtyRoots.clear();
		for (const wikiRoot of roots) rebuildAllMeta(wikiRoot);
	});

	pi.on("session_before_compact", async (_event, ctx) => {
		saveContext(buildCompactionContext(ctx.cwd));
		return undefined;
	});
}
