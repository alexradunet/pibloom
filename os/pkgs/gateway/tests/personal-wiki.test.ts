import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { formatLocalDate } from "../src/personal/date.js";
import { PersonalConversationCaptureService } from "../src/personal/conversation-capture.js";
import { PersonalJournalService } from "../src/personal/journal.js";

function withPersonalWikiRoot<T>(fn: (wikiRoot: string) => T): T {
  const previous = process.env.OWNLOOM_WIKI_ROOT;
  const wikiRoot = mkdtempSync(path.join(os.tmpdir(), "ownloom-gateway-personal-wiki-"));
  process.env.OWNLOOM_WIKI_ROOT = wikiRoot;
  try {
    return fn(wikiRoot);
  } finally {
    if (previous === undefined) {
      delete process.env.OWNLOOM_WIKI_ROOT;
    } else {
      process.env.OWNLOOM_WIKI_ROOT = previous;
    }
    rmSync(wikiRoot, { recursive: true, force: true });
  }
}

function withTimeZone<T>(timeZone: string, fn: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previous;
    }
  }
}

test("personal journal append keeps multiline entries under one markdown bullet", () => {
  withPersonalWikiRoot((wikiRoot) => {
    const service = new PersonalJournalService();
    const result = service.appendWhatsAppLog("User: first line\r\nsecond line\nthird line");

    assert.ok(result);

    const today = formatLocalDate(new Date());
    const journalFile = path.join(wikiRoot, "daily", `${today}.md`);
    const content = readFileSync(journalFile, "utf-8");

    assert.match(content, /### WhatsApp\n- \d\d:\d\d - User: first line\n  second line\n  third line/);
  });
});

test("personal WhatsApp auto-capture writes ordinary conversation turns to the daily journal", () => {
  withPersonalWikiRoot((wikiRoot) => {
    const clock = { now: () => new Date(2026, 3, 28, 10, 15) };
    const service = new PersonalConversationCaptureService(clock);
    const captured = service.captureUserMessage({ channel: "whatsapp" } as any, "Travel itinerary:\nDay 1 Naples\nDay 2 Pompeii");

    assert.equal(captured, true);

    const journalFile = path.join(wikiRoot, "daily", "2026-04-28.md");
    const content = readFileSync(journalFile, "utf-8");

    assert.match(content, /### WhatsApp conversation/);
    assert.match(content, /10:15 - User: Travel itinerary/);
    assert.match(content, /Day 1 Naples/);
    assert.match(content, /Day 2 Pompeii/);
  });
});

test("personal WhatsApp auto-capture ignores basic transport command noise", () => {
  withPersonalWikiRoot((_wikiRoot) => {
    const clock = { now: () => new Date(2026, 3, 28, 10, 15) };
    const service = new PersonalConversationCaptureService(clock);

    assert.equal(service.captureUserMessage({ channel: "whatsapp" } as any, "/help"), false);
    assert.equal(service.captureUserMessage({ channel: "whatsapp" } as any, "status"), false);
    assert.equal(service.captureUserMessage({ channel: "whatsapp" } as any, "reset"), false);
  });
});

test("personal journal uses local date instead of UTC date near Bucharest midnight", () => {
  withTimeZone("Europe/Bucharest", () => {
    withPersonalWikiRoot((wikiRoot) => {
      const clock = { now: () => new Date(Date.UTC(2026, 3, 25, 21, 30)) };
      const service = new PersonalJournalService(clock);
      const result = service.appendWhatsAppLog("User: local midnight check");

      assert.ok(result);
      assert.equal(result.date, "2026-04-26");
      assert.equal(result.time, "00:30");

      const journalFile = path.join(wikiRoot, "daily", "2026-04-26.md");
      const content = readFileSync(journalFile, "utf-8");
      assert.match(content, /00:30 - User: local midnight check/);
    });
  });
});
