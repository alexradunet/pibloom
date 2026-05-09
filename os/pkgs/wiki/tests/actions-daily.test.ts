/**
 * actions-daily tests — wiki_daily handlers.
 *
 * Covers: get (existing/missing date), append (existing/new section,
 * auto-create today/arbitrary-date, frontmatter date update, leading-dash
 * normalization, error on empty bullets).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleDailyAppend, handleDailyGet } from "../src/wiki/actions-daily.ts";
import { todayStamp } from "../src/wiki/paths.ts";

describe("actions-daily", () => {
  let wikiRoot: string;

  beforeEach(() => {
    wikiRoot = mkdtempSync(path.join(os.tmpdir(), "ownloom-wiki-daily-"));
  });

  afterEach(() => {
    rmSync(wikiRoot, { recursive: true, force: true });
  });

  it("get returns graceful message when daily note is missing", () => {
    const result = handleDailyGet(wikiRoot, "2099-01-01");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.details?.exists).toBe(false);
      expect(result.value.text).toContain("No daily note");
    }
  });

  it("append auto-creates a fully-formed v2 daily note when missing", () => {
    const result = handleDailyAppend(wikiRoot, ["first bullet"], { date: "2099-06-15" });
    expect(result.isOk()).toBe(true);

    const filePath = path.join(wikiRoot, "daily", "2099-06-15.md");
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf-8");

    // v2 frontmatter
    expect(content).toContain("id: daily-note/2099-06-15");
    expect(content).toContain("type: daily-note");
    expect(content).toContain("decay: fast");
    expect(content).toContain("confidence: high");
    expect(content).toContain("last_confirmed: 2099-06-15");
    // No v1 leakage
    expect(content).not.toContain("schema_version");
    expect(content).not.toContain("object_type");
    expect(content).not.toContain("validation_level");
    // Sections
    expect(content).toContain("## Morning");
    expect(content).toContain("## Captured");
    // Bullet inserted under Captured (default section)
    expect(content).toContain("- first bullet");
  });

  it("append can auto-create a technical daily note", () => {
    const result = handleDailyAppend(wikiRoot, ["ops bullet"], { date: "2099-06-16", domain: "technical" });
    expect(result.isOk()).toBe(true);

    const content = readFileSync(path.join(wikiRoot, "daily", "2099-06-16.md"), "utf-8");
    expect(content).toContain("domain: technical");
    expect(content).toContain("areas: [ops]");
    expect(content).toContain("- ops bullet");
  });

  it("append inserts under existing section and updates `updated:` field", () => {
    const today = todayStamp();
    handleDailyAppend(wikiRoot, ["first"], { section: "Captured" });
    const r = handleDailyAppend(wikiRoot, ["second"], { section: "Captured" });
    expect(r.isOk()).toBe(true);

    const content = readFileSync(path.join(wikiRoot, "daily", `${today}.md`), "utf-8");
    expect(content).toContain("- first");
    expect(content).toContain("- second");
    expect(content).toContain(`updated: ${today}`);
  });

  it("append creates a new section when section heading is missing", () => {
    const today = todayStamp();
    handleDailyAppend(wikiRoot, ["x"]);
    const r = handleDailyAppend(wikiRoot, ["custom bullet"], { section: "Brand New Section" });
    expect(r.isOk()).toBe(true);

    const content = readFileSync(path.join(wikiRoot, "daily", `${today}.md`), "utf-8");
    expect(content).toContain("## Brand New Section");
    expect(content).toContain("- custom bullet");
  });

  it("append normalizes bullets that already start with '- '", () => {
    const today = todayStamp();
    handleDailyAppend(wikiRoot, ["- already-prefixed", "raw-text"]);
    const content = readFileSync(path.join(wikiRoot, "daily", `${today}.md`), "utf-8");
    // Both forms should appear normalized — exactly one "- " each
    expect(content).toContain("- already-prefixed");
    expect(content).toContain("- raw-text");
    expect(content).not.toContain("- - already-prefixed"); // no double-dash
  });

  it("append rejects empty bullets list", () => {
    const r = handleDailyAppend(wikiRoot, []);
    expect(r.isErr()).toBe(true);
  });

  it("rejects non-date path segments", () => {
    expect(handleDailyGet(wikiRoot, "../objects/secret").isErr()).toBe(true);
    expect(handleDailyAppend(wikiRoot, ["x"], { date: "2026-05-09/evil" }).isErr()).toBe(true);
  });

  it("get returns content of an existing daily note", () => {
    handleDailyAppend(wikiRoot, ["sentinel-bullet"], { date: "2099-06-15" });
    const r = handleDailyGet(wikiRoot, "2099-06-15");
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.details?.exists).toBe(true);
      expect(r.value.text).toContain("sentinel-bullet");
    }
  });

  it("preserves existing custom content when appending", () => {
    const today = todayStamp();
    const filePath = path.join(wikiRoot, "daily");
    writeFileSync(
      path.join(wikiRoot, `daily-seed-${today}.md`),
      "" /* sanity check tmpdir is writable */,
    );
    // Pre-create a note with custom content
    handleDailyAppend(wikiRoot, ["seed"]);
    const before = readFileSync(path.join(filePath, `${today}.md`), "utf-8");
    expect(before).toContain("- seed");

    handleDailyAppend(wikiRoot, ["appended"]);
    const after = readFileSync(path.join(filePath, `${today}.md`), "utf-8");
    expect(after).toContain("- seed");
    expect(after).toContain("- appended");
  });
});
