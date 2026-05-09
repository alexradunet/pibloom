/**
 * Wiki v2 tool manifest — 8 tools replacing the previous 16.
 *
 * Tools:
 *   wiki_status        — host + page counts (read)
 *   wiki_search        — ripgrep-backed search (read)
 *   wiki_ensure_object — resolve or create a typed object (write)
 *   wiki_daily         — append bullets to today's daily note (write)
 *   wiki_ingest        — single-step ingest: secret-strip → sources/ → daily/ (write)
 *   wiki_lint          — 4 strict structural checks (read)
 *   wiki_rebuild       — force-rebuild registry + backlinks (write)
 *   wiki_session_capture — capture session memory to daily note + objects (write)
 */

export type ToolRisk = "read" | "cache-write" | "wiki-write" | "system-read" | "system-write" | "high-impact";

export type ToolManifestEntry = {
  name: string;
  label: string;
  description: string;
  risk: ToolRisk;
  mutatesWiki?: boolean;
  mutatesCache?: boolean;
  requiresConfirmation?: boolean;
  parameters: Record<string, unknown>;
};

const domainParam = { type: "string", description: "Optional domain such as technical or personal." };
const areasParam = { type: "array", items: { type: "string" }, description: "Optional areas such as nixos, pi, health, writing, etc." };
const hostsParam = { type: "array", items: { type: "string" }, description: "Optional host scope. Omit for global knowledge shared across hosts." };
const tagsParam = { type: "array", items: { type: "string" } };

export const toolManifest: ToolManifestEntry[] = [
  {
    name: "wiki_status",
    label: "Wiki Status",
    description: "Show wiki root, current host, page counts, and type distribution.",
    risk: "read",
    parameters: { domain: domainParam },
  },
  {
    name: "wiki_search",
    label: "Wiki Search",
    description: "Search wiki pages by title, domain, areas, type, tags, and summary text. Use ripgrep directly for body search.",
    risk: "read",
    parameters: {
      query: { type: "string", description: "Search query." },
      type: { type: "string", description: "Filter by type (e.g. decision, project, person)." },
      domain: domainParam,
      areas: areasParam,
      hosts: hostsParam,
      limit: { type: "number", default: 10 },
      host_scope: { type: "string", enum: ["current", "all"] },
      folder: { type: "string", description: "Optional path prefix filter, e.g. objects/ or daily/." },
    },
  },
  {
    name: "wiki_ensure_object",
    label: "Wiki Ensure Object",
    description: "Resolve an existing object by title/slug or create a new typed object in objects/. Reads types/<type>.md for schema. AI fills all required frontmatter.",
    risk: "wiki-write",
    mutatesWiki: true,
    parameters: {
      type: { type: "string", description: "Object type (daily-note, concept, person, project, area, decision, evolution, host, service, account, financial-goal, snapshot, dashboard, source, …)." },
      title: { type: "string", description: "Human-readable title." },
      domain: domainParam,
      areas: areasParam,
      hosts: hostsParam,
      tags: tagsParam,
      summary: { type: "string", description: "Dense one-line summary." },
      body: { type: "string", description: "Optional initial Markdown body. Replaces the skeleton when provided." },
      confidence: { type: "string", enum: ["high", "medium", "low"], description: "Confidence in this object's content." },
    },
  },
  {
    name: "wiki_daily",
    label: "Wiki Daily",
    description: "Get today's daily note (action=get, read) or append bullets to it (action=append, write). Auto-creates today's note if missing.",
    risk: "read",        // action=get is read; action=append is write and is dynamically gated/locked in the dispatcher
    mutatesWiki: false,  // declared false because action=get is the read default
    parameters: {
      action: { type: "string", enum: ["get", "append"], description: "get: read today's note. append: add bullets." },
      bullets: { type: "array", items: { type: "string" }, description: "Bullets to append (for action=append)." },
      section: { type: "string", description: "Section heading to append under. Defaults to Captured." },
      domain: domainParam,
      date: { type: "string", description: "Override date (YYYY-MM-DD). Defaults to today." },
    },
  },
  {
    name: "wiki_ingest",
    label: "Wiki Ingest",
    description: "Single-step ingest: secret-strip content → write verbatim to sources/<channel>/YYYY-MM-DD.md → append summary bullet to today's daily note. Agent then extracts/updates objects in objects/.",
    risk: "wiki-write",
    mutatesWiki: true,
    parameters: {
      content: { type: "string", description: "Raw text content to ingest (will be secret-stripped)." },
      channel: { type: "string", description: "Source channel: whatsapp | gmail | calendar | drive | journal | web | voice | other. Defaults to other." },
      title: { type: "string", description: "Optional title override for the source page." },
      summary: { type: "string", description: "Optional one-line summary for the daily note bullet. If omitted, agent derives one after ingest." },
      domain: domainParam,
      areas: areasParam,
    },
  },
  {
    name: "wiki_lint",
    label: "Wiki Lint",
    description: "Run structural checks on the wiki. Default mode (strict) runs all 4 checks: links, frontmatter, duplicates, supersedes-cycles.",
    risk: "read",
    parameters: {
      mode: {
        type: "string",
        enum: ["strict", "links", "frontmatter", "duplicates", "supersedes-cycles"],
        description: "Which checks to run. Defaults to strict (all 4).",
      },
      domain: domainParam,
    },
  },
  {
    name: "wiki_rebuild",
    label: "Wiki Rebuild",
    description: "Force-rebuild registry, backlinks, and FTS index from disk.",
    risk: "wiki-write",
    mutatesWiki: true,
    parameters: { domain: domainParam },
  },
  {
    name: "wiki_decay_pass",
    label: "Wiki Decay Pass",
    description: "Scan all pages for stale confidence based on decay setting and last_confirmed date. Downgrades confidence: high→medium→low when threshold exceeded. Returns report of changes and pages already at confidence:low for review.",
    risk: "wiki-write",
    mutatesWiki: true,
    parameters: {
      dry_run: { type: "boolean", description: "If true, report what would change without writing files. Defaults to false." },
      domain: domainParam,
    },
  },
  {
    name: "wiki_session_capture",
    label: "Wiki Session Capture",
    description: "Capture explicit session/conversation memory: append a summary bullet to today's daily note and create/update relevant objects.",
    risk: "wiki-write",
    mutatesWiki: true,
    parameters: {
      summary: { type: "string", description: "Session/conversation summary to preserve." },
      title: { type: "string", description: "Optional session title." },
      domain: domainParam,
      areas: areasParam,
      tags: tagsParam,
      hosts: hostsParam,
      decisions: { type: "array", items: { type: "string" }, description: "Decisions made or reinforced." },
      follow_ups: { type: "array", items: { type: "string" }, description: "Follow-up tasks to add to planner." },
      files_changed: { type: "array", items: { type: "string" }, description: "Files changed or discussed." },
      commands: { type: "array", items: { type: "string" }, description: "Commands run." },
      related_pages: { type: "array", items: { type: "string" }, description: "Related wiki page slugs." },
    },
  },
];

export function getToolManifestEntry(name: string): ToolManifestEntry | undefined {
  return toolManifest.find((tool) => tool.name === name);
}
