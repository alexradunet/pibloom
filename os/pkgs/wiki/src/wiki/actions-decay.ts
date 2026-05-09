/**
 * wiki_decay_pass — scan pages for stale confidence and downgrade.
 *
 * Decay thresholds:
 *   fast   → stale after 30 days
 *   normal → stale after 90 days
 *   slow   → stale after 365 days
 *
 * Confidence transitions:
 *   high → medium (when stale)
 *   medium → low (when stale)
 *   low → unchanged (already flagged; agent should review or archive)
 *
 * Returns a report of all changes made and all pages already at confidence:low.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ok } from "./lib/core-utils.ts";
import type { ActionResult } from "./types.ts";
import { scanPages } from "./actions-meta.ts";
import { todayStamp } from "./paths.ts";

const DECAY_DAYS: Record<string, number> = {
  fast: 30,
  normal: 90,
  slow: 365,
};

const CONFIDENCE_DOWNGRADE: Record<string, string> = {
  high: "medium",
  medium: "low",
};

function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.floor(Math.abs(db - da) / 86_400_000);
}

export interface DecayPassResult {
  downgraded: Array<{ path: string; title: string; from: string; to: string; daysSince: number }>;
  alreadyLow: Array<{ path: string; title: string; daysSince: number }>;
  checked: number;
  changed: number;
}

export function handleDecayPass(wikiRoot: string, dryRun = false): ActionResult<DecayPassResult> {
  const pages = scanPages(wikiRoot);
  const today = todayStamp();
  const result: DecayPassResult = { downgraded: [], alreadyLow: [], checked: 0, changed: 0 };

  for (const page of pages) {
    const fm = page.frontmatter as Record<string, unknown>;
    const confidence = String(fm.confidence ?? "");
    const decay = String(fm.decay ?? "normal");
    const lastConfirmed = String(fm.last_confirmed ?? fm.created ?? "");

    // Skip pages without lifecycle metadata.
    if (!confidence || !lastConfirmed) continue;
    // Skip planner-backed types and daily notes — they are historical records not living claims
    const type = String(fm.type ?? "");
    if (["task", "event", "reminder", "daily-note", "journal"].includes(type)) continue;

    result.checked++;

    const threshold = DECAY_DAYS[decay] ?? 90;
    const days = daysBetween(lastConfirmed, today);
    const isStale = days > threshold;

    if (confidence === "low") {
      result.alreadyLow.push({ path: page.relativePath, title: String(fm.title ?? ""), daysSince: days });
      continue;
    }

    if (!isStale) continue;

    const newConfidence = CONFIDENCE_DOWNGRADE[confidence];
    if (!newConfidence) continue;

    result.downgraded.push({
      path: page.relativePath,
      title: String(fm.title ?? ""),
      from: confidence,
      to: newConfidence,
      daysSince: days,
    });

    if (!dryRun) {
      const filePath = path.join(wikiRoot, page.relativePath);
      const content = readFileSync(filePath, "utf-8");
      const updated = content
        .replace(/^confidence: .+$/m, `confidence: ${newConfidence}`)
        .replace(/^updated: .+$/m, `updated: ${today}`);
      writeFileSync(filePath, updated, "utf-8");
      result.changed++;
    }
  }

  const lines: string[] = [
    `Decay pass complete (${dryRun ? "dry-run" : "applied"}):`,
    `  Pages checked: ${result.checked}`,
    `  Downgraded:    ${result.downgraded.length}`,
    `  Already low:   ${result.alreadyLow.length}`,
  ];

  if (result.downgraded.length > 0) {
    lines.push("", "Downgraded:");
    for (const d of result.downgraded.slice(0, 20)) {
      lines.push(`  ${d.path}: ${d.from} → ${d.to} (${d.daysSince}d stale)`);
    }
    if (result.downgraded.length > 20) lines.push(`  … and ${result.downgraded.length - 20} more`);
  }

  if (result.alreadyLow.length > 0) {
    lines.push("", `confidence:low pages needing review (${result.alreadyLow.length}):`);
    for (const p of result.alreadyLow.slice(0, 15)) {
      lines.push(`  ${p.path} (${p.daysSince}d since confirmed)`);
    }
    if (result.alreadyLow.length > 15) lines.push(`  … and ${result.alreadyLow.length - 15} more`);
  }

  return ok({ text: lines.join("\n"), details: result });
}
