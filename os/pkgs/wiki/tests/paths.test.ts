import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appliesToHost,
  buildPagePath,
  countWords,
  dedupeSlug,
  extractHeadings,
  extractWikiLinks,
  folderMatches,
  formatAreasSuffix,
  formatDomainSuffix,
  formatHostsSuffix,
  getWikiRoot,
  getWikiRootForDomain,
  getWikiRoots,
  getWorkspaceProfile,
  inferDomainFromFolder,
  isProtectedPath,
  isWikiPagePath,
  makeSourceId,
  normalizeAreas,
  normalizeDomain,
  normalizeHosts,
  normalizePageFolder,
  normalizeWikiLink,
  slugifyTitle,
} from "../src/wiki/paths.ts";

afterEach(() => {
  delete process.env.OWNLOOM_WIKI_ROOT;
  delete process.env.OWNLOOM_WIKI_DIR;
  delete process.env.OWNLOOM_WIKI_HOST;
  delete process.env.OWNLOOM_WIKI_WORKSPACE;
  delete process.env.OWNLOOM_WIKI_DEFAULT_DOMAIN;

});

describe("getWikiRoot", () => {
  it("uses OWNLOOM_WIKI_ROOT when set", () => {
    process.env.OWNLOOM_WIKI_ROOT = "/tmp/ownloom-wiki";
    expect(getWikiRoot()).toBe("/tmp/ownloom-wiki");
  });

  it("falls back to ~/wiki", () => {
    delete process.env.OWNLOOM_WIKI_ROOT;
    delete process.env.OWNLOOM_WIKI_DIR;
    expect(getWikiRoot()).toBe(path.join(process.env.HOME ?? "/root", "wiki"));
  });

  it("uses one root for every domain", () => {
    process.env.OWNLOOM_WIKI_ROOT = "/tmp/default-wiki";
    expect(getWikiRoots()).toEqual({ wiki: "/tmp/default-wiki" });
    expect(getWikiRootForDomain(" technical ")).toBe("/tmp/default-wiki");
    expect(getWikiRootForDomain("personal")).toBe("/tmp/default-wiki");
    expect(getWikiRootForDomain("unknown")).toBe("/tmp/default-wiki");
    expect(getWikiRootForDomain(undefined)).toBe("/tmp/default-wiki");
  });

  it("does not infer sibling split roots", () => {
    process.env.OWNLOOM_WIKI_ROOT = "/srv/wiki";

    expect(getWikiRootForDomain("technical")).toBe("/srv/wiki");
    expect(getWikiRootForDomain("personal")).toBe("/srv/wiki");
    expect(getWikiRootForDomain("unknown")).toBe("/srv/wiki");
  });
});

describe("workspace roots", () => {
  it("defaults technical and personal domains to the same wiki root", () => {
    process.env.OWNLOOM_WIKI_ROOT = "/tmp/wiki";

    const profile = getWorkspaceProfile();

    expect(profile.name).toBe("ownloom");
    expect(profile.defaultDomain).toBe("technical");
    expect(profile.domains.technical?.root).toBe("/tmp/wiki");
    expect(profile.domains.personal?.root).toBe("/tmp/wiki");
  });

  it("supports workspace env overrides without changing domain availability", () => {
    process.env.OWNLOOM_WIKI_WORKSPACE = "work";
    process.env.OWNLOOM_WIKI_ROOT = "/work/wiki";

    const profile = getWorkspaceProfile();

    expect(profile.name).toBe("work");
    expect(profile.domains.technical?.root).toBe("/work/wiki");
    expect(profile.domains.personal?.root).toBe("/work/wiki");
  });

  it("supports ownloom workspace and default-domain env", () => {
    process.env.OWNLOOM_WIKI_ROOT = "/ownloom/wiki";
    process.env.OWNLOOM_WIKI_WORKSPACE = "client-work";
    process.env.OWNLOOM_WIKI_DEFAULT_DOMAIN = "work";

    const profile = getWorkspaceProfile();

    expect(profile.name).toBe("client-work");
    expect(profile.defaultDomain).toBe("work");
    expect(profile.domains.technical?.root).toBe("/ownloom/wiki");
    expect(profile.domains.personal?.root).toBe("/ownloom/wiki");
  });
});

describe("domain, area, and host normalization", () => {
  it("normalizes domains and areas", () => {
    expect(normalizeDomain(" Technical ")).toBe("technical");
    expect(normalizeAreas([" AI ", "ai", "Infra "])).toEqual(["ai", "infra"]);
  });

  it("uses OWNLOOM_WIKI_HOST", () => {
    process.env.OWNLOOM_WIKI_HOST = "ownloom-host";
    expect(appliesToHost(["ownloom-host"])).toBe(true);
  });

  it("normalizes hosts and evaluates host scope", () => {
    expect(normalizeHosts([" Yoga-Nixos ", "yoga-nixos", "vps-nixos "])).toEqual(["yoga-nixos", "vps-nixos"]);
    expect(appliesToHost([], "yoga-nixos")).toBe(true);
    expect(appliesToHost(["*"], "yoga-nixos")).toBe(true);
    expect(appliesToHost(["yoga-nixos"], "yoga-nixos")).toBe(true);
    expect(appliesToHost(["vps-nixos"], "yoga-nixos")).toBe(false);
  });

  it("formats domain, area, and host suffixes", () => {
    expect(formatDomainSuffix("technical")).toBe(" [domain: technical]");
    expect(formatAreasSuffix(["infra", "ai"])).toBe(" [areas: infra, ai]");
    expect(formatHostsSuffix(["yoga-nixos", "vps-nixos"])).toBe(" [hosts: yoga-nixos, vps-nixos]");
    expect(formatHostsSuffix([])).toBe("");
  });
});

describe("folder helpers", () => {
  it("normalizes wiki folders and blocks traversal", () => {
    expect(normalizePageFolder(" objects ")).toBe("objects");
    expect(() => normalizePageFolder("../bad")).toThrow(/Invalid wiki folder/);
  });

  it("builds page paths and extracts folders", () => {
    expect(buildPagePath("foo", "objects")).toBe("objects/foo.md");
    expect(buildPagePath("foo")).toBe("objects/foo.md");
  });

  it("matches folders by exact prefix", () => {
    expect(folderMatches("objects", undefined)).toBe(true);
    expect(folderMatches("objects", "objects")).toBe(true);
    expect(folderMatches("objects", "daily")).toBe(false);
  });

  it("infers domains from convenience folders", () => {
    expect(inferDomainFromFolder("technical")).toBe("technical");
    expect(inferDomainFromFolder("personal")).toBe("personal");
    expect(inferDomainFromFolder("objects")).toBeUndefined();
  });
});

describe("slug, ids, and wiki links", () => {
  it("slugifies titles and dedupes slugs", () => {
    expect(slugifyTitle("Café Notes")).toBe("cafe-notes");
    expect(dedupeSlug("page", ["page", "page-2"])).toBe("page-3");
  });

  it("builds source ids", () => {
    const date = new Date("2026-04-19T12:00:00Z");
    expect(makeSourceId([], date)).toBe("SRC-2026-04-19-001");
    expect(makeSourceId(["SRC-2026-04-19-001", "SRC-2026-04-19-002"], date)).toBe("SRC-2026-04-19-003");
  });

  it("normalizes wiki links", () => {
    // v2: sources/ is a top-level directory
    expect(normalizeWikiLink("sources/SRC-2026-04-19-001")).toBe("sources/SRC-2026-04-19-001.md");
    // v2: objects/ is a top-level directory
    expect(normalizeWikiLink("objects/ownloom-vps")).toBe("objects/ownloom-vps.md");
    // Bare top-level object paths stay in objects/.
    expect(normalizeWikiLink("objects/system-landscape")).toBe(
      "objects/system-landscape.md",
    );
    expect(normalizeWikiLink("objects/system-landscape")).toBe(
      "objects/system-landscape.md",
    );
    expect(normalizeWikiLink("objects/system-landscape#Overview")).toBe(
      "objects/system-landscape.md",
    );
  });
});

describe("path protection and markdown extraction", () => {
  const wikiRoot = "/tmp/ownloom-wiki";

  it("protects raw and meta but allows wiki page folders", () => {
    expect(isProtectedPath(wikiRoot, `${wikiRoot}/raw/SRC-001/manifest.json`)).toBe(true);
    expect(isProtectedPath(wikiRoot, `${wikiRoot}/meta/registry.json`)).toBe(true);
    expect(isProtectedPath(wikiRoot, `${wikiRoot}/objects/foo.md`)).toBe(false);
    expect(isWikiPagePath(wikiRoot, `${wikiRoot}/objects/foo.md`)).toBe(true);
    expect(isWikiPagePath(wikiRoot, `${wikiRoot}/sources/web/2026-05-09.md`)).toBe(true);
    expect(isWikiPagePath(wikiRoot, `${wikiRoot}/raw/SRC-001/manifest.json`)).toBe(false);
  });

  it("extracts wiki links, headings, and word counts", () => {
    const markdown = `# Hello\n\nSee [[objects/system-landscape#Next Step|System Landscape]].\n\n## Next Step`;
    expect(extractWikiLinks(markdown)).toEqual(["objects/system-landscape#Next Step"]);
    expect(extractHeadings(markdown)).toEqual(["Hello", "Next Step"]);
    expect(countWords("one two three")).toBe(3);
  });
});
