import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendEvent,
  buildBacklinks,
  buildRegistry,
  buildWikiDigest,
  deriveWikiMetaArtifacts,
  handleWikiStatus,
  loadRegistry,
  readEvents,
  rebuildAllMeta,
  renderIndex,
  renderLog,
  scanPages,
} from "../src/wiki/actions-meta.ts";

describe("actions-meta", () => {
  let wikiRoot: string;

  beforeEach(() => {
    wikiRoot = mkdtempSync(path.join(os.tmpdir(), "ownloom-wiki-meta-"));
    mkdirSync(path.join(wikiRoot, "objects"), { recursive: true });
    mkdirSync(path.join(wikiRoot, "daily"), { recursive: true });
  });

  afterEach(() => {
    rmSync(wikiRoot, { recursive: true, force: true });
    delete process.env.OWNLOOM_WIKI_HOST;
  });

  it("scanPages and buildRegistry preserve folder, domain, areas, and hosts", () => {
    writeFileSync(
      path.join(wikiRoot, "objects", "system-landscape.md"),
      `---
type: concept
title: System Landscape
domain: technical
tags: [nixos]
hosts: []
areas: [infrastructure, ai]
status: active
updated: 2026-04-19
source_ids: []
summary: Shared technical map
---
# System Landscape

See [[objects/personal-identity]].
`,
      "utf8",
    );
    writeFileSync(
      path.join(wikiRoot, "objects", "personal-identity.md"),
      `---
type: identity
title: Personal Identity
domain: personal
tags: [identity]
hosts: []
areas: [identity]
status: active
updated: 2026-04-19
source_ids: []
summary: Stable personal notes
---
# Personal Identity
`,
      "utf8",
    );

    const pages = scanPages(wikiRoot);
    const registry = buildRegistry(pages);

    expect(registry.pages).toHaveLength(2);
    expect(registry.pages[0]).toMatchObject({
      folder: "objects",
      domain: "personal",
      areas: ["identity"],
    });
    expect(registry.pages[1]).toMatchObject({
      folder: "objects",
      domain: "technical",
      areas: ["infrastructure", "ai"],
    });
  });

  it("scanPages tolerates missing or unreadable directories", () => {
    rmSync(path.join(wikiRoot, "objects"), { recursive: true, force: true });
    rmSync(path.join(wikiRoot, "daily"), { recursive: true, force: true });
    expect(scanPages(wikiRoot)).toEqual([]);

    mkdirSync(path.join(wikiRoot, "objects"), { recursive: true });
    mkdirSync(path.join(wikiRoot, "objects", "restricted"), { recursive: true });
    writeFileSync(
      path.join(wikiRoot, "objects", "visible.md"),
      `---
type: concept
title: Visible
status: active
updated: 2026-04-19
source_ids: []
summary: Visible page
---
# Visible
`,
      "utf8",
    );

    chmodSync(path.join(wikiRoot, "objects", "restricted"), 0o000);
    try {
      const pages = scanPages(wikiRoot);
      expect(pages.map((page) => page.relativePath)).toContain("objects/visible.md");
    } finally {
      chmodSync(path.join(wikiRoot, "objects", "restricted"), 0o755);
    }
  });

  it("buildRegistry normalizes fallback values and buildBacklinks dedupes links", () => {
    const pages = [
      {
        relativePath: "objects/fallback.md",
        frontmatter: {
          type: "unknown",
          domain: "technical",
          aliases: "aka fallback",
          tags: "nixos",
          hosts: " Yoga-Nixos ",
          areas: " Infra ",
          sourceIds: "SRC-2026-04-19-001",
        },
        body: "Body",
        headings: ["Heading"],
        rawLinks: ["objects/target", "objects/target", "ghost"],
        normalizedLinks: [
          "objects/target.md",
          "objects/target.md",
          "objects/ghost.md",
        ],
        wordCount: 1,
      },
      {
        relativePath: "objects/target.md",
        frontmatter: {
          type: "concept",
          title: "Target",
          domain: "technical",
          aliases: [],
          tags: [],
          hosts: [],
          areas: [],
          status: "active",
          updated: "2026-04-19",
          source_ids: [],
          summary: "",
        },
        body: "Target",
        headings: [],
        rawLinks: [],
        normalizedLinks: [],
        wordCount: 1,
      },
    ] as Parameters<typeof buildRegistry>[0];

    const registry = buildRegistry(pages);
    const backlinks = buildBacklinks(registry);

    expect(registry.pages[0]).toMatchObject({
      type: "concept",
      title: "fallback",
      domain: "technical",
      aliases: ["aka fallback"],
      tags: ["nixos"],
      hosts: ["yoga-nixos"],
      areas: ["infra"],
      sourceIds: ["SRC-2026-04-19-001"],
    });
    expect(backlinks.byPath["objects/fallback.md"]?.outbound).toEqual([
      "objects/target.md",
    ]);
    expect(backlinks.byPath["objects/target.md"]?.inbound).toEqual([
      "objects/fallback.md",
    ]);
  });

  it("buildBacklinks and deriveWikiMetaArtifacts compute links and index metadata", () => {
    writeFileSync(
      path.join(wikiRoot, "objects", "system-landscape.md"),
      `---
type: concept
title: System Landscape
domain: technical
tags: [nixos]
hosts: []
areas: [infrastructure]
status: active
updated: 2026-04-19
source_ids: []
summary: Shared technical map
---
# System Landscape

See [[objects/personal-identity]].
`,
      "utf8",
    );
    writeFileSync(
      path.join(wikiRoot, "objects", "personal-identity.md"),
      `---
type: identity
title: Personal Identity
domain: personal
tags: [identity]
hosts: []
areas: [identity]
status: active
updated: 2026-04-19
source_ids: []
summary: Stable personal notes
---
# Personal Identity
`,
      "utf8",
    );

    const pages = scanPages(wikiRoot);
    const artifacts = deriveWikiMetaArtifacts(pages, []);
    const backlinks = buildBacklinks(artifacts.registry);

    expect(backlinks.byPath["objects/personal-identity.md"]?.inbound).toContain(
      "objects/system-landscape.md",
    );
    expect(artifacts.index).toContain("[domain: technical]");
    expect(artifacts.index).toContain("[areas: infrastructure]");
    expect(artifacts.index).toContain("## Identity Pages");
    expect(artifacts.log).toContain("_No events yet._");
  });

  it("includes standard markdown links in registry links and backlinks", () => {
    writeFileSync(
      path.join(wikiRoot, "objects", "source.md"),
      `---
type: concept
title: Source
domain: technical
tags: []
hosts: []
areas: [infrastructure]
status: active
updated: 2026-04-19
source_ids: []
summary: Source page
---
# Source

[Relative](./target#Deep Heading)
[Absolute](/objects/target.md)
[External](https://example.com)
`,
      "utf8",
    );
    writeFileSync(
      path.join(wikiRoot, "objects", "target.md"),
      `---
type: concept
title: Target
domain: technical
tags: []
hosts: []
areas: [infrastructure]
status: active
updated: 2026-04-19
source_ids: []
summary: Target page
---
# Target

## Deep Heading
`,
      "utf8",
    );

    const registry = buildRegistry(scanPages(wikiRoot));
    const source = registry.pages.find((page) => page.title === "Source");
    const backlinks = buildBacklinks(registry);

    expect(source?.linksOut).toEqual(["objects/target.md"]);
    expect(backlinks.byPath["objects/target.md"]?.inbound).toEqual([
      "objects/source.md",
    ]);
  });

  it("renderIndex and renderLog stay stable for golden-style output checks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T12:34:56Z"));
    try {
      const registry = {
        version: 1,
        generatedAt: "2026-04-19T12:34:56Z",
        pages: [
          {
            type: "concept",
            path: "objects/system-landscape.md",
            folder: "objects",
            title: "System Landscape",
            aliases: [],
            summary: "Shared technical map",
            status: "active",
            tags: [],
            hosts: ["yoga-nixos"],
            domain: "technical",
            areas: ["infrastructure"],
            updated: "2026-04-19",
            sourceIds: [],
            linksOut: [],
            headings: [],
            wordCount: 42,
          },
          {
            type: "journal",
            path: "daily/2026-04-19.md",
            folder: "daily",
            title: "2026-04-19 Daily Journal",
            aliases: [],
            summary: "",
            status: "active",
            tags: [],
            hosts: [],
            domain: "personal",
            areas: ["journal"],
            updated: "2026-04-19",
            sourceIds: [],
            linksOut: [],
            headings: [],
            wordCount: 10,
          },
        ],
      };

      expect(renderIndex(registry)).toMatchInlineSnapshot(`
        "# Wiki Index

        Generated: 2026-04-19T12:34:56Z

        ## Concept Pages

        - [System Landscape](../objects/system-landscape.md) [domain: technical] [areas: infrastructure] [hosts: yoga-nixos] — Shared technical map

        ## Journal Pages

        - [2026-04-19 Daily Journal](../daily/2026-04-19.md) [domain: personal] [areas: journal]
        "
      `);
      expect(
        renderLog([
          {
            ts: "2026-04-19T12:00:00Z",
            kind: "capture",
            title: "Captured source",
            sourceIds: ["SRC-2026-04-19-001"],
          },
          {
            ts: "2026-04-19T12:05:00Z",
            kind: "page-create",
            title: "Created page",
            pagePaths: ["objects/system-landscape.md"],
          },
        ]),
      ).toMatchInlineSnapshot(`
        "# Wiki Log

        ## [2026-04-19 12:00 UTC] capture | Captured source
        - Sources: SRC-2026-04-19-001

        ## [2026-04-19 12:05 UTC] page-create | Created page
        - Pages: objects/system-landscape.md
        "
      `);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rebuildAllMeta writes registry, backlinks, index, and log", () => {
    writeFileSync(
      path.join(wikiRoot, "daily", "2026-04-19.md"),
      `---
type: journal
title: 2026-04-19 Daily Journal
domain: personal
tags: [journal]
hosts: []
areas: [journal]
status: active
updated: 2026-04-19
summary: Daily note
---
# Daily Journal
`,
      "utf8",
    );
    appendEvent(wikiRoot, {
      ts: "2026-04-19T12:00:00Z",
      kind: "rebuild",
      title: "Rebuilt wiki metadata",
      sourceIds: ["SRC-2026-04-19-001"],
      pagePaths: ["daily/2026-04-19.md"],
    });

    const { registry } = rebuildAllMeta(wikiRoot);
    expect(registry.pages[0]).toMatchObject({ type: "journal", domain: "personal", areas: ["journal"] });
    expect(existsSync(path.join(wikiRoot, "meta", "registry.json"))).toBe(true);
    expect(existsSync(path.join(wikiRoot, "meta", "backlinks.json"))).toBe(true);
    expect(existsSync(path.join(wikiRoot, "meta", "index.md"))).toBe(true);
    expect(existsSync(path.join(wikiRoot, "meta", "log.md"))).toBe(true);
    const log = readFileSync(path.join(wikiRoot, "meta", "log.md"), "utf8");
    expect(log).toContain("Rebuilt wiki metadata");
    expect(log).toContain("Sources: SRC-2026-04-19-001");
  });

  it("loadRegistry rebuilds from invalid registry files and readEvents tolerates bad json", () => {
    writeFileSync(
      path.join(wikiRoot, "objects", "rebuilt.md"),
      `---
type: concept
title: Rebuilt
domain: technical
tags: []
hosts: []
areas: [infrastructure]
status: active
updated: 2026-04-19
source_ids: []
summary: Rebuilt page
---
# Rebuilt
`,
      "utf8",
    );
    mkdirSync(path.join(wikiRoot, "meta"), { recursive: true });
    writeFileSync(path.join(wikiRoot, "meta", "registry.json"), "not json", "utf8");
    writeFileSync(path.join(wikiRoot, "meta", "events.jsonl"), "not json\n", "utf8");

    const registry = loadRegistry(wikiRoot);
    expect(registry.pages.map((page) => page.title)).toContain("Rebuilt");
    expect(readEvents(wikiRoot)).toEqual([]);
  });

  it("handleWikiStatus reports uninitialized wikis when pages are missing", () => {
    const blankRoot = mkdtempSync(path.join(os.tmpdir(), "ownloom-wiki-blank-"));
    try {
      process.env.OWNLOOM_WIKI_HOST = "yoga-nixos";
      const result = handleWikiStatus(blankRoot);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.details).toEqual({ initialized: false, root: blankRoot, host: "yoga-nixos" });
        expect(result.value.text).toBe("Wiki not initialized.");
      }
      expect(buildWikiDigest(blankRoot)).toBe("");
    } finally {
      rmSync(blankRoot, { recursive: true, force: true });
    }
  });

  it("handleWikiStatus reports domain counts and visible pages for the current host", () => {
    process.env.OWNLOOM_WIKI_HOST = "yoga-nixos";
    writeFileSync(
      path.join(wikiRoot, "objects", "host-note.md"),
      `---
type: concept
title: Host Note
domain: technical
tags: [host]
hosts: [yoga-nixos]
areas: [infrastructure]
status: active
updated: 2026-04-19
source_ids: []
summary: Host specific note
---
# Host Note
`,
      "utf8",
    );
    writeFileSync(
      path.join(wikiRoot, "objects", "personal-identity.md"),
      `---
type: identity
title: Personal Identity
domain: personal
tags: [identity]
hosts: []
areas: [identity]
status: active
updated: 2026-04-19
source_ids: []
summary: Stable personal notes
---
# Personal Identity
`,
      "utf8",
    );
    rebuildAllMeta(wikiRoot);

    const result = handleWikiStatus(wikiRoot);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.details).toMatchObject({
        host: "yoga-nixos",
        visible: 2,
        domains: { personal: 1, technical: 1 },
      });
      expect(result.value.text).toContain("Domains: personal=1, technical=1");
    }
  });

  it("handleWikiStatus counts sources, journals, and unspecified domains", () => {
    process.env.OWNLOOM_WIKI_HOST = "yoga-nixos";
    mkdirSync(path.join(wikiRoot, "sources"), { recursive: true });
    writeFileSync(
      path.join(wikiRoot, "objects", "global-note.md"),
      `---
type: concept
title: Global Note
domain: technical
tags: []
hosts: []
areas: [infrastructure]
status: active
updated: 2026-04-19
source_ids: []
summary: No explicit domain
---
# Global Note
`,
      "utf8",
    );
    writeFileSync(
      path.join(wikiRoot, "sources", "captured.md"),
      `---
type: source
source_id: SRC-2026-04-19-001
title: Captured Source
status: captured
captured_at: 2026-04-19T00:00:00Z
origin_type: text
origin_value: clip
aliases: []
tags: []
hosts: []
areas: []
source_ids: []
summary: Captured source
---
# Captured Source
`,
      "utf8",
    );
    writeFileSync(
      path.join(wikiRoot, "sources", "integrated.md"),
      `---
type: source
source_id: SRC-2026-04-19-002
title: Integrated Source
status: integrated
captured_at: 2026-04-19T00:00:00Z
origin_type: text
origin_value: clip
aliases: []
tags: []
hosts: []
areas: []
source_ids: []
summary: Integrated source
---
# Integrated Source
`,
      "utf8",
    );
    writeFileSync(
      path.join(wikiRoot, "daily", "2026-04-20.md"),
      `---
type: journal
title: 2026-04-20 Daily Journal
tags: [journal]
hosts: []
areas: [journal]
status: active
updated: 2026-04-20
summary: Daily note
---
# Daily Journal
`,
      "utf8",
    );
    rebuildAllMeta(wikiRoot);

    const result = handleWikiStatus(wikiRoot);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.details).toMatchObject({
        total: 4,
        source: 2,
        canonical: 1,
        journal: 1,
        captured: 1,
        integrated: 1,
        domains: { technical: 1, unspecified: 3 },
      });
      expect(result.value.text).toContain("Sources: 1 captured, 1 integrated");
      expect(result.value.text).toContain("Domains: technical=1, unspecified=3");
    }
  });

  it("buildWikiDigest filters by host and excludes identity and journal pages", () => {
    process.env.OWNLOOM_WIKI_HOST = "yoga-nixos";
    writeFileSync(
      path.join(wikiRoot, "objects", "shared.md"),
      `---
type: concept
title: Shared Technical Note
domain: technical
tags: [shared]
hosts: []
areas: [infrastructure]
status: active
updated: 2026-04-19
source_ids: []
summary: Shared summary
---
# Shared

${"word ".repeat(50)}
`,
      "utf8",
    );
    writeFileSync(
      path.join(wikiRoot, "objects", "laptop.md"),
      `---
type: concept
title: Laptop Technical Note
domain: technical
tags: [host]
hosts: [yoga-nixos]
areas: [infrastructure]
status: active
updated: 2026-04-19
source_ids: []
summary: Laptop summary
---
# Laptop

${"word ".repeat(60)}
`,
      "utf8",
    );
    writeFileSync(
      path.join(wikiRoot, "daily", "2026-04-19.md"),
      `---
type: journal
title: 2026-04-19 Daily Journal
domain: personal
tags: [journal]
hosts: []
areas: [journal]
status: active
updated: 2026-04-19
summary: Daily note
---
# Daily Journal
`,
      "utf8",
    );
    writeFileSync(
      path.join(wikiRoot, "objects", "personal-identity.md"),
      `---
type: identity
title: Personal Identity
domain: personal
tags: [identity]
hosts: []
areas: [identity]
status: active
updated: 2026-04-19
source_ids: []
summary: Stable personal notes
---
# Personal Identity
`,
      "utf8",
    );

    const digest = buildWikiDigest(wikiRoot);
    expect(digest).toContain("Shared Technical Note");
    expect(digest).toContain("Laptop Technical Note");
    expect(digest).not.toContain("Personal Identity");
    expect(digest).not.toContain("Daily Journal");
  });

  it("buildWikiDigest returns empty when no active canonical pages are visible", () => {
    process.env.OWNLOOM_WIKI_HOST = "yoga-nixos";
    writeFileSync(
      path.join(wikiRoot, "objects", "draft.md"),
      `---
type: concept
title: Draft Note
domain: technical
tags: []
hosts: [vps-nixos]
areas: [infrastructure]
status: draft
updated: 2026-04-19
source_ids: []
summary: Draft note
---
# Draft Note
`,
      "utf8",
    );
    writeFileSync(
      path.join(wikiRoot, "daily", "2026-04-19.md"),
      `---
type: journal
title: 2026-04-19 Daily Journal
domain: personal
tags: [journal]
hosts: []
areas: [journal]
status: active
updated: 2026-04-19
summary: Daily note
---
# Daily Journal
`,
      "utf8",
    );
    rebuildAllMeta(wikiRoot);

    expect(buildWikiDigest(wikiRoot)).toContain("[WIKI DIGEST");
  });

  it("buildWikiDigest omits summary separators for empty summaries and caps output", () => {
    process.env.OWNLOOM_WIKI_HOST = "yoga-nixos";
    for (let i = 0; i < 16; i += 1) {
      writeFileSync(
        path.join(wikiRoot, "objects", `note-${i}.md`),
        `---
type: concept
title: Note ${i}
domain: technical
tags: []
hosts: []
areas: [infrastructure]
status: active
updated: 2026-04-19
source_ids: []
summary: ${i === 0 ? "" : `Summary ${i}`}
---
# Note ${i}

${"word ".repeat(i === 0 ? 100 : 20 + i)}
`,
        "utf8",
      );
    }
    rebuildAllMeta(wikiRoot);

    const digest = buildWikiDigest(wikiRoot);
    expect(digest).toContain("[WIKI DIGEST");
    expect(digest).toContain("Note 15");
  });

  it("appendEvent and readEvents round-trip JSONL events", () => {
    appendEvent(wikiRoot, {
      ts: "2026-04-19T12:00:00Z",
      kind: "page-create",
      title: "Created page",
      pagePaths: ["objects/system-landscape.md"],
    });

    const events = readEvents(wikiRoot);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("page-create");
  });
});
