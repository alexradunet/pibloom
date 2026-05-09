/**
 * Wiki v2 dispatcher — routes callWikiTool to the 8 v2 tool implementations.
 */
import { handleDailyAppend, handleDailyGet } from "../wiki/actions-daily.ts";
import { handleDecayPass } from "../wiki/actions-decay.ts";
import { handleIngest } from "../wiki/actions-ingest.ts";
import { handleWikiLint } from "../wiki/actions-lint.ts";
import { buildWikiDigest, handleWikiStatus, loadRegistry, rebuildAllMeta } from "../wiki/actions-meta.ts";
import { handleEnsurePage } from "../wiki/actions-pages.ts";
import { handleWikiSearch } from "../wiki/actions-search.ts";
import { err, ok } from "../wiki/lib/core-utils.ts";
import { toToolResult } from "../wiki/lib/utils.ts";
import { mkdirSync, rmSync, statSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { getCurrentHost, getWikiRoot, getWikiRootForDomain, getWikiRoots, getWorkspaceProfile, todayStamp } from "../wiki/paths.ts";
import { getToolManifestEntry } from "./manifest.ts";

export type HarnessToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details?: Record<string, unknown>;
  isError?: boolean;
};

export type ToolExecutionPolicy = {
  allowMutation?: boolean;
  allowCacheMutation?: boolean;
  allowHighImpact?: boolean;
};

export type CallToolOptions = {
  signal?: AbortSignal;
  policy?: ToolExecutionPolicy;
  lockTimeoutMs?: number;
};

function wikiRootForTool(domain: string | undefined): string {
  return getWikiRootForDomain(domain);
}

function maybeRebuild(wikiRoot: string, result: HarnessToolResult, mutatesWiki: boolean): HarnessToolResult {
  if (mutatesWiki && !result.isError) rebuildAllMeta(wikiRoot);
  return result;
}

function policyError(message: string): HarnessToolResult {
  return { content: [{ type: "text", text: message }], details: { ok: false, policyError: true }, isError: true };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tryAcquireLock(lockPath: string, staleMs: number): boolean {
  try {
    mkdirSync(lockPath);
    writeFileSync(path.join(lockPath, "owner"), `${process.pid}\n${new Date().toISOString()}\n`);
    return true;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
  }
  try {
    const ageMs = Date.now() - statSync(lockPath).mtimeMs;
    if (ageMs < staleMs) return false;
    rmSync(lockPath, { recursive: true, force: true });
    mkdirSync(lockPath);
    writeFileSync(path.join(lockPath, "owner"), `${process.pid}\n${new Date().toISOString()}\n`);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "EEXIST" || error.code === "ENOENT")) return false;
    throw error;
  }
}

async function withWikiMutationLock<T>(wikiRoot: string, timeoutMs: number, operation: () => Promise<T>): Promise<T> {
  const metaDir = path.join(wikiRoot, "meta");
  mkdirSync(metaDir, { recursive: true });
  const lockPath = path.join(metaDir, ".wiki-mutation.lock");
  const staleMs = Math.max(10_000, timeoutMs * 2);
  const deadline = Date.now() + timeoutMs;

  while (!tryAcquireLock(lockPath, staleMs)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for wiki mutation lock: ${lockPath}`);
    await sleep(100);
  }
  try {
    return await operation();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

// ── session capture (inlined, ~40 lines, no separate file) ────────────────────

function handleSessionCaptureInline(
  wikiRoot: string,
  params: Record<string, unknown>,
): HarnessToolResult {
  const today = todayStamp();
  const summary = String(params.summary ?? "");
  const title = String(params.title ?? `Session capture ${today}`);
  const decisions = (params.decisions as string[] | undefined) ?? [];
  const followUps = (params.follow_ups as string[] | undefined) ?? [];
  const filesChanged = (params.files_changed as string[] | undefined) ?? [];
  const commands = (params.commands as string[] | undefined) ?? [];
  const relatedPages = (params.related_pages as string[] | undefined) ?? [];

  // Build bullet block for daily note
  const bullets: string[] = [`**${title}** — ${summary}`];
  if (decisions.length) bullets.push(...decisions.map((d) => `  - decision: ${d.replace(/\[\[|\]\]/g, "")}`));
  if (filesChanged.length) bullets.push(...filesChanged.map((f) => `  - changed: ${f}`));
  if (followUps.length) bullets.push(...followUps.map((f) => `  - follow-up: ${f}`));
  if (relatedPages.length) bullets.push(...relatedPages.map((p) => `  - related: [[${p}]]`));
  if (commands.length) bullets.push(...commands.map((c) => `  - ran: \`${c}\``));

  const appendResult = handleDailyAppend(wikiRoot, bullets, { section: "Captured" });
  if (appendResult.isErr()) return toToolResult(appendResult);

  const text = [
    `Session captured to daily/${today}.md.`,
    decisions.length ? `${decisions.length} decision(s) logged.` : "",
    followUps.length ? `${followUps.length} follow-up(s) — add to planner as needed.` : "",
  ].filter(Boolean).join(" ");

  return toToolResult(ok({ text, details: { daily: `daily/${today}.md`, summary, decisions, followUps } }));
}

// ── main dispatcher ───────────────────────────────────────────────────────────

export async function callWikiTool(name: string, params: Record<string, any> = {}, options: CallToolOptions = {}): Promise<HarnessToolResult> {
  const manifest = getToolManifestEntry(name);
  if (!manifest) {
    return { content: [{ type: "text", text: `Unknown wiki tool: ${name}` }], details: { ok: false }, isError: true };
  }

  const mutatesWiki = Boolean(manifest.mutatesWiki) || (name === "wiki_daily" && params.action !== "get");
  const mutatesCache = Boolean(manifest.mutatesCache);
  if (mutatesWiki && !options.policy?.allowMutation) return policyError(`Refusing wiki-write tool ${name} without mutation approval. Safe next step: use 'ownloom-wiki mutate ${name} ...' for intentional writes, or add --yes/OWNLOOM_WIKI_ALLOW_MUTATION=1 in a reviewed automation path.`);
  if (mutatesCache && !options.policy?.allowCacheMutation) return policyError(`${name} is a cache-write tool and requires allowCacheMutation policy.`);

  const invoke = () => callWikiToolUnlocked(name, params, options);
  if (mutatesWiki) {
    const wikiRoot = wikiRootForTool(params.domain);
    return withWikiMutationLock(wikiRoot, options.lockTimeoutMs ?? 30_000, invoke);
  }
  return invoke();
}

async function callWikiToolUnlocked(name: string, params: Record<string, any>, options: CallToolOptions): Promise<HarnessToolResult> {
  switch (name) {
    case "wiki_status": {
      const wikiRoot = wikiRootForTool(params.domain);
      return toToolResult(handleWikiStatus(wikiRoot));
    }

    case "wiki_search": {
      const wikiRoot = wikiRootForTool(params.domain);
      return toToolResult(handleWikiSearch(loadRegistry(wikiRoot), params.query, {
        type: params.type,
        limit: params.limit,
        hostScope: params.host_scope,
        domain: params.domain,
        areas: params.areas,
        folder: params.folder,
        wikiRoot,
      }));
    }

    case "wiki_ensure_object": {
      const wikiRoot = wikiRootForTool(params.domain);
      return maybeRebuild(wikiRoot, toToolResult(handleEnsurePage(wikiRoot, {
        type: params.type,
        title: params.title,
        aliases: params.aliases,
        tags: params.tags,
        hosts: params.hosts,
        domain: params.domain,
        areas: params.areas,
        folder: params.folder ?? "objects",
        summary: params.summary,
        body: params.body,
        confidence: params.confidence,
      })), true);
    }

    case "wiki_daily": {
      const wikiRoot = wikiRootForTool(params.domain);
      if (params.action === "get") {
        return toToolResult(handleDailyGet(wikiRoot, params.date));
      }
      if (params.action !== "append") {
        return toToolResult(err(`Invalid wiki_daily action: ${params.action ?? "<missing>"}. Expected get or append.`));
      }
      if (!options.policy?.allowMutation) {
        return policyError(`wiki_daily append is a write operation. Use 'ownloom-wiki mutate wiki_daily ...' or add --yes.`);
      }
      return maybeRebuild(wikiRoot, toToolResult(handleDailyAppend(wikiRoot, params.bullets ?? [], {
        section: params.section,
        date: params.date,
      })), true);
    }

    case "wiki_ingest": {
      const wikiRoot = wikiRootForTool(params.domain);
      return maybeRebuild(wikiRoot, toToolResult(handleIngest(wikiRoot, params.content ?? "", {
        channel: params.channel,
        title: params.title,
        summary: params.summary,
        domain: params.domain,
        areas: params.areas,
        tags: params.tags,
      })), true);
    }

    case "wiki_lint": {
      const wikiRoot = wikiRootForTool(params.domain);
      return toToolResult(handleWikiLint(wikiRoot, params.mode));
    }

    case "wiki_decay_pass": {
      const wikiRoot = wikiRootForTool(params.domain);
      return maybeRebuild(wikiRoot, toToolResult(handleDecayPass(wikiRoot, Boolean(params.dry_run))), !params.dry_run);
    }

    case "wiki_rebuild": {
      const wikiRoot = wikiRootForTool(params.domain);
      rebuildAllMeta(wikiRoot);
      return toToolResult(ok({ text: "Rebuilt wiki metadata." }));
    }

    case "wiki_session_capture": {
      const wikiRoot = wikiRootForTool(params.domain);
      return maybeRebuild(wikiRoot, handleSessionCaptureInline(wikiRoot, params), true);
    }

    // Tombstones for removed tools — return helpful error
    case "wiki_capture":
    case "wiki_ingest_prepare":
    case "wiki_ingest_propose":
    case "wiki_ingest_finalize":
      return { content: [{ type: "text", text: `${name} is removed in wiki v2. Use wiki_ingest for single-step ingest.` }], details: { ok: false }, isError: true };

    case "wiki_steward":
    case "wiki_memory_status":
      return { content: [{ type: "text", text: `${name} is removed in wiki v2. Use wiki_status + wiki_lint for health checks.` }], details: { ok: false }, isError: true };

    default:
      return { content: [{ type: "text", text: `Tool is declared but not implemented: ${name}` }], details: { ok: false }, isError: true };
  }
}

// ── context builders ──────────────────────────────────────────────────────────

export function buildWikiContextPrompt(): string {
  const wikiRoot = getWikiRoot();
  const wikiRoots = getWikiRoots();
  const host = getCurrentHost();
  const workspace = getWorkspaceProfile();
  const domainLines = Object.entries(workspace.domains)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([domain, profile]) => `-   ${domain}: ${profile.root ?? "unconfigured"}`);

  return [
    "[LLM WIKI CONTEXT]",
    `- Wiki root: ${wikiRoot}`,
    ...(Object.keys(wikiRoots).length > 0 ? [`- Wiki roots: ${Object.entries(wikiRoots).map(([d, r]) => `${d}:${r}`).join(", ")}`] : []),
    `- Current host: ${host}`,
    `- Workspace: ${workspace.name}`,
    `- Default domain: ${workspace.defaultDomain}`,
    "- Workspace domain roots:",
    ...domainLines,
    "- Plain-Markdown wiki. No app-specific syntax. Use standard Markdown links in note bodies.",
    "- Wiki v2 layout: daily/ (spine), objects/ (typed objects), types/ (schemas), sources/ (evidence), meta/about-alex/ (agent model of Alex).",
    "- domain: technical or personal separates system and personal knowledge. areas: [...] for long-lived themes.",
    "- Frontmatter: id, type, title, domain, areas, confidence (high|medium|low), last_confirmed, decay (slow|normal|fast), created, updated, summary.",
    "- No v1 compatibility: pages/ archive scanning, wiki_ensure_page, and NIXPI_* wiki env fallbacks are removed.",
    "- Types defined in types/<type>.md — extensible by dropping a new file.",
    "- wiki_search: query, type, domain, areas, hosts, folder, host_scope filters.",
    "- wiki_ensure_object: resolves or creates a typed object in objects/; reads types/<type>.md for schema.",
    "- wiki_daily: get today's note or append bullets to it (action=get|append).",
    "- wiki_ingest: single-step — secret-strip → sources/<channel>/ → today's daily → agent extracts objects.",
    "- wiki_lint: 4 strict modes: links, frontmatter, duplicates, supersedes-cycles. Default=strict (all 4).",
    "- wiki_session_capture: appends session summary bullet to today's daily note.",
    "- wiki_decay_pass: scan all pages for stale confidence; downgrade high→medium→low when last_confirmed exceeds decay threshold.",
    "- wiki_rebuild: force-rebuild registry + backlinks.",
    "- body search: use ripgrep directly — rg 'pattern' wiki/objects/ wiki/daily/ wiki/sources/",
    "- Pages with hosts: [...] apply only to those hosts. Pages without hosts are global.",
    "- meta/about-alex/ is the agent's model of Alex — update it when patterns, context, or values are observed.",
  ].join("\n");
}

export function buildWikiContext(format: "markdown" | "json" = "markdown") {
  const context = {
    host: getCurrentHost(),
    wikiRoot: getWikiRoot(),
    wikiRoots: getWikiRoots(),
    workspace: getWorkspaceProfile(),
    wikiContext: buildWikiContextPrompt(),
    wikiDigest: buildWikiDigest(getWikiRoot()),
  };

  if (format === "json") return JSON.stringify(context, null, 2);
  return [context.wikiContext, context.wikiDigest].filter(Boolean).join("\n\n");
}
