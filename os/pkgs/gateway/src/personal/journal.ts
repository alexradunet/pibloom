import path from "node:path";
import type { Clock } from "./date.js";
import { formatLocalDate, formatLocalTimeMinute, systemClock } from "./date.js";
import { atomicWriteFile } from "./markdown.js";
import { appendBulletUnderHeading, ensureMarkdownFile, updateFrontmatterUpdated } from "./wiki-mutation.js";
import { getPersonalWikiRoot } from "./wiki.js";

/**
 * Ensure today's gateway journal note exists.
 *
 * This is intentionally a tiny local append log, not the canonical live planner
 * or structured wiki object path. Keep it independent from removed wiki v1 tools.
 */
function ensureDailyNote(filePath: string, date: string): string {
  return ensureMarkdownFile(filePath, () => `# ${date}\n\n## Log\n\n`);
}

function appendUnderLog(raw: string, entry: string, sectionTitle = "WhatsApp"): string {
  return appendBulletUnderHeading(raw, {
    heading: `### ${sectionTitle}`,
    parentHeading: "## Log",
    entry,
    blankLineAfterHeading: false,
  });
}

export function normalizeJournalEntry(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .trim()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n  ");
}

export type JournalAppendResult = {
  date: string;
  time: string;
  filePath: string;
};

export class PersonalJournalService {
  constructor(private readonly clock: Clock = systemClock) {}

  appendWhatsAppLog(
    entry: string,
    options: { sectionTitle?: string } = {},
  ): JournalAppendResult | null {
    const entryText = normalizeJournalEntry(entry);
    if (!entryText) return null;

    const now = this.clock.now();
    const date = formatLocalDate(now);
    const time = formatLocalTimeMinute(now);
    const wikiRoot = getPersonalWikiRoot();
    const filePath = path.join(wikiRoot, "daily", `${date}.md`);

    const raw = ensureDailyNote(filePath, date);
    const line = `${time} - ${entryText}`;
    const updated = updateFrontmatterUpdated(raw, date);
    const next = appendUnderLog(updated, line, options.sectionTitle ?? "WhatsApp");
    atomicWriteFile(filePath, next);

    return { date, time, filePath };
  }
}
