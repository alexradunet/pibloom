/**
 * wiki_ingest — single-step ingest for v2.
 *
 * Flow: secret-strip → write verbatim to sources/<channel>/YYYY-MM-DD.md
 *       → append summarized bullet to today's daily note
 *       → return guidance for agent to extract/update objects.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ok, err } from "./lib/core-utils.ts";
import type { ActionResult } from "./types.ts";
import { normalizeDomain, todayStamp } from "./paths.ts";
import { dailyNoteSkeleton } from "./actions-daily.ts";

const SOURCE_CHANNELS = new Set(["whatsapp", "gmail", "calendar", "drive", "journal", "web", "voice", "other"]);

const REDACT_PATTERNS: [RegExp, string][] = [
  // Long token-like strings near secret-named fields
  [/\b([A-Za-z0-9_\-]{20,})\b(?=.*(?:key|token|secret|password|passwd|pwd|api[-_]?key))/gi, "[REDACTED]"],
  // password=value, secret=value, token=value, etc (case-insensitive)
  [/(?:password|passwd|pwd|secret|token|api[-_]?key)\s*[:=]\s*\S+/gi, "[REDACTED-FIELD]"],
  // Environment variable style: UPPER_SECRET=, UPPER_KEY=, UPPER_TOKEN=, UPPER_PASSWORD=
  [/\b[A-Z][A-Z0-9_]*(?:SECRET|KEY|TOKEN|PASSWORD|PASSWD|PWD|API_KEY)[A-Z0-9_]*\s*=\s*\S+/g, "[REDACTED-ENV]"],
  // IBANs (ISO 13616: 2 country letters + 2 check digits + 11-30 alphanumerics)
  [/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, "[REDACTED-IBAN]"],
  // Card numbers
  [/\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g, "[REDACTED-CARD]"],
];

export function stripSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of REDACT_PATTERNS) {
    out = out.replace(pattern, replacement as string);
  }
  return out;
}

export interface IngestOptions {
  channel?: string;   // whatsapp | gmail | calendar | drive | journal | web | voice | other
  title?: string;
  domain?: string;
  areas?: string[];
  tags?: string[];
  summary?: string;   // if provided, used as the daily-note bullet; otherwise agent derives it
}

export function handleIngest(
  wikiRoot: string,
  content: string,
  opts: IngestOptions = {},
): ActionResult<{ sourcePath: string; dailyPath: string; bulletin: string }> {
  if (!content.trim()) return err("Ingest content is empty.");

  const today = todayStamp();
  const channel = opts.channel ?? "other";
  if (!SOURCE_CHANNELS.has(channel)) {
    return err(`Invalid source channel: ${channel}. Expected one of: ${[...SOURCE_CHANNELS].join(", ")}.`);
  }
  const domain = normalizeDomain(opts.domain) ?? "personal";
  const areas = opts.areas?.length ? opts.areas : ["inbox"];
  const clean = stripSecrets(content);

  // 1. Write verbatim (secret-stripped) to sources/<channel>/YYYY-MM-DD.md
  const sourceDir = path.join(wikiRoot, "sources", channel);
  mkdirSync(sourceDir, { recursive: true });

  // Append to today's source file for this channel (multiple ingests/day merge)
  const sourcePath = path.join(sourceDir, `${today}.md`);
  const sourceHeader = existsSync(sourcePath) ? "\n\n---\n\n" : [
    "---",
    `id: source/${channel}-${today}`,
    `type: source`,
    `title: ${opts.title ?? `${channel} capture ${today}`}`,
    `channel: ${channel}`,
    `status: captured`,
    `domain: ${domain}`,
    `areas: [${areas.join(", ")}]`,
    `confidence: high`,
    `last_confirmed: ${today}`,
    `decay: normal`,
    `created: ${today}`,
    `updated: ${today}`,
    `summary: ${opts.title ?? `${channel} capture ${today}`}`,
    "---",
    "",
  ].join("\n");

  writeFileSync(sourcePath, sourceHeader + clean, { flag: "a" });

  // 2. Ensure today's daily note exists
  const dailyDir = path.join(wikiRoot, "daily");
  mkdirSync(dailyDir, { recursive: true });
  const dailyPath = path.join(dailyDir, `${today}.md`);

  if (!existsSync(dailyPath)) {
    writeFileSync(dailyPath, dailyNoteSkeleton(today, domain), "utf-8");
  }

  // 3. Append a captured bullet to daily note
  const wikilink = `sources/${channel}/${today}`; // resolves to sources/<channel>/<date>.md
  const bullet = opts.summary
    ? `- [[${wikilink}]] — ${opts.summary}`
    : `- [[${wikilink}]] captured from ${channel} — review and extract objects`;

  const dailyContent = readFileSync(dailyPath, "utf-8");
  const updated = dailyContent.includes("## Captured")
    ? dailyContent.replace(/## Captured\n/, `## Captured\n${bullet}\n`)
    : dailyContent + `\n${bullet}\n`;
  writeFileSync(dailyPath, updated, "utf-8");

  const bulletin = [
    `Ingested to sources/${channel}/${today}.md and linked in daily/${today}.md.`,
    `Next: extract or update objects in objects/ for any entities, decisions, or concepts mentioned.`,
    opts.summary ? `Summary: ${opts.summary}` : `Review the source and write a summary bullet in today's daily note.`,
  ].join(" ");

  return ok({ text: bulletin, details: { sourcePath: `sources/${channel}/${today}.md`, dailyPath: `daily/${today}.md`, bulletin } });
}
