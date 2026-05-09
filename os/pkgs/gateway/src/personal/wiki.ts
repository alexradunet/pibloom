import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function getPersonalWikiRoot(): string {
  return process.env.OWNLOOM_WIKI_ROOT_PERSONAL
    ?? process.env.OWNLOOM_WIKI_ROOT
    ?? path.join(os.homedir(), "wiki");
}

// ── Gateway wiki search ────────────────────────────────────────────────────
// Minimal inline search against registry.json — avoids subprocess overhead.
// For richer search (FTS5 body hits), use the Pi agent's wiki_search tool.

interface RegistryEntry {
  type: string;
  path: string;
  title: string;
  summary: string;
  areas: string[];
  domain?: string;
  hosts: string[];
}

interface RegistryData {
  pages: RegistryEntry[];
}

function loadRegistry(wikiRoot: string): RegistryData | null {
  const p = path.join(wikiRoot, "meta", "registry.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as RegistryData;
  } catch {
    return null;
  }
}

function scoreEntry(entry: RegistryEntry, tokens: string[]): number {
  let score = 0;
  const title = entry.title.toLowerCase();
  const summary = entry.summary.toLowerCase();
  for (const token of tokens) {
    if (title.includes(token)) score += 3;
    if (summary.includes(token)) score += 2;
    if (entry.areas.some((a) => a.toLowerCase().includes(token))) score += 1;
  }
  return score;
}

/** Search wiki pages by keyword. Returns a WhatsApp-formatted string. */
export function wikiSearch(query: string, limit = 5): string {
  const wikiRoot = getPersonalWikiRoot();
  const registry = loadRegistry(wikiRoot);
  if (!registry) return "⚠️ Wiki registry not found. Run wiki_rebuild.";

  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "Usage: wiki <query>  |  wiki show <title>";

  const matches = registry.pages
    .map((entry) => ({ entry, score: scoreEntry(entry, tokens) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (matches.length === 0) return `No wiki results for: ${query}`;

  const lines: string[] = [`*Wiki: ${query}*`];
  for (const { entry } of matches) {
    const slug = entry.path.replace(/\.md$/, "");
    lines.push("");
    lines.push(`*${entry.title}*`);
    if (entry.summary) {
      const s = entry.summary.length > 120 ? `${entry.summary.slice(0, 120)}…` : entry.summary;
      lines.push(s);
    }
    lines.push(`_${slug}_`);
  }
  return lines.join("\n");
}

/** Preview the body of a single wiki page. Returns a WhatsApp-formatted string. */
export function wikiShowPage(pageQuery: string): string {
  const wikiRoot = getPersonalWikiRoot();
  const registry = loadRegistry(wikiRoot);
  if (!registry) return "⚠️ Wiki registry not found.";

  const q = pageQuery.trim().toLowerCase();
  const entry = registry.pages.find(
    (p) =>
      p.title.toLowerCase().includes(q) ||
      p.path.toLowerCase().includes(q.replace(/\s+/g, "-")),
  );
  if (!entry) return `No wiki page found: ${pageQuery}`;

  const fullPath = path.join(wikiRoot, entry.path);
  let preview = entry.summary || "(no preview)";
  try {
    const raw = readFileSync(fullPath, "utf-8");
    const bodyStart = raw.startsWith("---\n") ? raw.indexOf("\n---\n", 4) + 5 : 0;
    const body = raw.slice(bodyStart).trim();
    if (body) preview = body.slice(0, 600);
  } catch {
    // fall through to summary
  }

  return `*${entry.title}*\n_${entry.path}_\n\n${preview}${preview.length >= 600 ? "…" : ""}`;
}
