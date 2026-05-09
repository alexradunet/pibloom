/**
 * actions-decay tests — wiki_decay_pass.
 *
 * Covers: dry-run safety, daily-note exclusion, planner-type exclusion,
 * confidence transitions (high→medium, medium→low, low unchanged),
 * decay thresholds (fast/normal/slow), legacy-page skip, fresh-page skip.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleDecayPass } from "../src/wiki/actions-decay.ts";

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function writePage(
  wikiRoot: string,
  folder: string,
  slug: string,
  fm: Record<string, string>,
): string {
  mkdirSync(path.join(wikiRoot, folder), { recursive: true });
  const lines = ["---", ...Object.entries(fm).map(([k, v]) => `${k}: ${v}`), "---", "", `# ${fm.title ?? slug}`, ""];
  const filePath = path.join(wikiRoot, folder, `${slug}.md`);
  writeFileSync(filePath, lines.join("\n"));
  return filePath;
}

describe("handleDecayPass", () => {
  let wikiRoot: string;

  beforeEach(() => {
    wikiRoot = mkdtempSync(path.join(os.tmpdir(), "ownloom-wiki-decay-"));
    mkdirSync(path.join(wikiRoot, "meta"), { recursive: true });
  });

  afterEach(() => {
    rmSync(wikiRoot, { recursive: true, force: true });
  });

  it("dry-run reports without writing", () => {
    const file = writePage(wikiRoot, "objects", "stale-concept", {
      id: "concept/stale-concept",
      type: "concept",
      title: "Stale Concept",
      domain: "technical",
      areas: "[]",
      confidence: "high",
      decay: "slow",
      last_confirmed: daysAgo(400), // > 365 day slow threshold
      created: daysAgo(400),
      updated: daysAgo(400),
      summary: "Stale.",
    });

    const before = readFileSync(file, "utf-8");
    const r = handleDecayPass(wikiRoot, true);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.text).toContain("dry-run");
      expect(r.value.details?.downgraded.length).toBe(1);
      expect(r.value.details?.changed).toBe(0);
    }
    expect(readFileSync(file, "utf-8")).toBe(before); // file unchanged
  });

  it("downgrades high→medium when stale", () => {
    const file = writePage(wikiRoot, "objects", "stale-fast", {
      id: "concept/stale-fast",
      type: "concept",
      title: "Stale Fast",
      domain: "technical",
      areas: "[]",
      confidence: "high",
      decay: "fast",
      last_confirmed: daysAgo(60), // > 30d threshold
      created: daysAgo(60),
      updated: daysAgo(60),
      summary: "Fast-decay stale.",
    });

    const r = handleDecayPass(wikiRoot, false);
    expect(r.isOk()).toBe(true);
    const content = readFileSync(file, "utf-8");
    expect(content).toContain("confidence: medium");
    expect(content).not.toContain("confidence: high");
  });

  it("downgrades medium→low when stale", () => {
    const file = writePage(wikiRoot, "objects", "medium-stale", {
      id: "concept/medium-stale",
      type: "concept",
      title: "Medium",
      domain: "technical",
      areas: "[]",
      confidence: "medium",
      decay: "normal",
      last_confirmed: daysAgo(120), // > 90d threshold
      created: daysAgo(120),
      updated: daysAgo(120),
      summary: "Medium stale.",
    });

    handleDecayPass(wikiRoot, false);
    expect(readFileSync(file, "utf-8")).toContain("confidence: low");
  });

  it("does not downgrade pages already at confidence:low", () => {
    const file = writePage(wikiRoot, "objects", "already-low", {
      id: "concept/already-low",
      type: "concept",
      title: "Already Low",
      domain: "technical",
      areas: "[]",
      confidence: "low",
      decay: "fast",
      last_confirmed: daysAgo(500),
      created: daysAgo(500),
      updated: daysAgo(500),
      summary: "Already low.",
    });

    const r = handleDecayPass(wikiRoot, false);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.details?.alreadyLow.length).toBe(1);
      expect(r.value.details?.downgraded.length).toBe(0);
    }
    expect(readFileSync(file, "utf-8")).toContain("confidence: low");
  });

  it("does not downgrade fresh pages even if decay=fast", () => {
    const file = writePage(wikiRoot, "objects", "fresh", {
      id: "concept/fresh",
      type: "concept",
      title: "Fresh",
      domain: "technical",
      areas: "[]",
      confidence: "high",
      decay: "fast",
      last_confirmed: daysAgo(5),
      created: daysAgo(5),
      updated: daysAgo(5),
      summary: "Fresh.",
    });

    handleDecayPass(wikiRoot, false);
    expect(readFileSync(file, "utf-8")).toContain("confidence: high");
  });

  it("excludes daily-notes from the pass", () => {
    writePage(wikiRoot, "daily", "2020-01-01", {
      id: "daily-note/2020-01-01",
      type: "daily-note",
      title: "2020-01-01",
      domain: "personal",
      areas: "[journal]",
      confidence: "high",
      decay: "fast",
      last_confirmed: daysAgo(2000),
      created: daysAgo(2000),
      updated: daysAgo(2000),
      summary: "Old daily.",
    });

    const r = handleDecayPass(wikiRoot, false);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.details?.checked).toBe(0);
      expect(r.value.details?.downgraded.length).toBe(0);
    }
  });

  it("excludes planner types (task, event, reminder)", () => {
    for (const type of ["task", "event", "reminder"]) {
      writePage(wikiRoot, "objects", `old-${type}`, {
        id: `${type}/old-${type}`,
        type,
        title: `Old ${type}`,
        domain: "personal",
        areas: "[]",
        confidence: "high",
        decay: "fast",
        last_confirmed: daysAgo(500),
        created: daysAgo(500),
        updated: daysAgo(500),
        summary: "Old planner item.",
      });
    }

    const r = handleDecayPass(wikiRoot, false);
    if (r.isOk()) {
      expect(r.value.details?.checked).toBe(0);
      expect(r.value.details?.downgraded.length).toBe(0);
    }
  });

  it("skips pages without lifecycle metadata", () => {
    writePage(wikiRoot, "objects", "v1-legacy", {
      id: "concept/v1-legacy",
      type: "concept",
      title: "V1 Legacy",
      domain: "technical",
      areas: "[]",
      // no confidence, no last_confirmed
      summary: "Legacy.",
    });

    const r = handleDecayPass(wikiRoot, false);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.details?.checked).toBe(0);
    }
  });

  it("respects per-decay thresholds", () => {
    // slow=365, so 200d-old slow page should NOT be downgraded
    const slowFile = writePage(wikiRoot, "objects", "slow-200d", {
      id: "concept/slow-200d",
      type: "concept",
      title: "Slow 200d",
      domain: "technical",
      areas: "[]",
      confidence: "high",
      decay: "slow",
      last_confirmed: daysAgo(200),
      created: daysAgo(200),
      updated: daysAgo(200),
      summary: "200d slow.",
    });

    // normal=90, so 200d-old normal page SHOULD be downgraded
    const normalFile = writePage(wikiRoot, "objects", "normal-200d", {
      id: "concept/normal-200d",
      type: "concept",
      title: "Normal 200d",
      domain: "technical",
      areas: "[]",
      confidence: "high",
      decay: "normal",
      last_confirmed: daysAgo(200),
      created: daysAgo(200),
      updated: daysAgo(200),
      summary: "200d normal.",
    });

    handleDecayPass(wikiRoot, false);
    expect(readFileSync(slowFile, "utf-8")).toContain("confidence: high");
    expect(readFileSync(normalFile, "utf-8")).toContain("confidence: medium");
  });
});
