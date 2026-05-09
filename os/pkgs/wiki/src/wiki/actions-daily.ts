/**
 * wiki_daily — append bullets to today's daily note; auto-create if missing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ok, err } from "./lib/core-utils.ts";
import type { ActionResult } from "./types.ts";
import { normalizeDomain, todayStamp } from "./paths.ts";

function dailyAreaForDomain(domain: string): string {
  return domain === "technical" ? "ops" : "journal";
}

/** Build a v2 daily-note skeleton. Exported so other actions (e.g. ingest) reuse it. */
export function dailyNoteSkeleton(date: string, domainInput = "personal"): string {
  const domain = normalizeDomain(domainInput) ?? "personal";
  return [
    "---",
    `id: daily-note/${date}`,
    `type: daily-note`,
    `title: ${date}`,
    `domain: ${domain}`,
    `areas: [${dailyAreaForDomain(domain)}]`,
    `confidence: high`,
    `last_confirmed: ${date}`,
    `decay: fast`,
    `created: ${date}`,
    `updated: ${date}`,
    `summary: Daily note for ${date}.`,
    "---",
    "",
    "## Morning",
    "- ",
    "",
    "## Work / Projects",
    "- ",
    "",
    "## Captured",
    "- ",
    "",
    "## Evening / Reflection",
    "- ",
  ].join("\n");
}

function ensureDailyNote(dailyDir: string, today: string, domain?: string): string {
  const filePath = path.join(dailyDir, `${today}.md`);
  if (!existsSync(filePath)) {
    writeFileSync(filePath, dailyNoteSkeleton(today, domain), "utf-8");
  }
  return filePath;
}

function isDailyDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export interface DailyAppendOptions {
  section?: string;    // which section to append under; defaults to "Captured"
  date?: string;       // override date (YYYY-MM-DD); defaults to today
  domain?: string;     // frontmatter domain for auto-created daily notes
}

export function handleDailyAppend(
  wikiRoot: string,
  bullets: string[],
  opts: DailyAppendOptions = {},
): ActionResult<{ path: string; appended: number }> {
  if (!bullets.length) return err("No bullets provided.");

  const today = opts.date ?? todayStamp();
  if (!isDailyDate(today)) return err(`Invalid daily note date: ${today}. Expected YYYY-MM-DD.`);

  const dailyDir = path.join(wikiRoot, "daily");
  mkdirSync(dailyDir, { recursive: true });
  const filePath = ensureDailyNote(dailyDir, today, opts.domain);

  const section = opts.section ?? "Captured";
  let content = readFileSync(filePath, "utf-8");

  const bulletBlock = bullets.map((b) => (b.startsWith("- ") ? b : `- ${b}`)).join("\n");

  if (content.includes(`## ${section}`)) {
    content = content.replace(`## ${section}\n`, `## ${section}\n${bulletBlock}\n`);
  } else {
    content = content + `\n## ${section}\n${bulletBlock}\n`;
  }

  // Update the `updated:` frontmatter date
  content = content.replace(/^updated: .+$/m, `updated: ${today}`);

  writeFileSync(filePath, content, "utf-8");

  return ok({
    text: `Appended ${bullets.length} bullet(s) to daily/${today}.md under ## ${section}.`,
    details: { path: `daily/${today}.md`, appended: bullets.length },
  });
}

export function handleDailyGet(
  wikiRoot: string,
  date?: string,
): ActionResult<{ path: string; content: string; exists: boolean }> {
  const day = date ?? todayStamp();
  if (!isDailyDate(day)) return err(`Invalid daily note date: ${day}. Expected YYYY-MM-DD.`);

  const filePath = path.join(wikiRoot, "daily", `${day}.md`);
  const exists = existsSync(filePath);
  const content = exists ? readFileSync(filePath, "utf-8") : "";
  return ok({
    text: exists ? content : `No daily note for ${day} yet.`,
    details: { path: `daily/${day}.md`, content, exists },
  });
}
