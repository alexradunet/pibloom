import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockExtensionAPI } from "./helpers/mock-extension-api.ts";
import { toolManifest } from "../src/tools/manifest.ts";

const state = vi.hoisted(() => ({
  wikiRoot: "/tmp/wiki-root",
  protectWrite: false,
  pagePath: false,
  coreToolCalls: [] as Array<{ name: string; params: Record<string, unknown>; policy: Record<string, unknown> | undefined }>,
  rebuildCalls: [] as string[],
}));

vi.mock("../src/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api.ts")>();
  return {
    ...actual,
    callWikiTool: async (name: string, params: Record<string, unknown>, options?: { policy?: Record<string, unknown> }) => {
      state.coreToolCalls.push({ name, params, policy: options?.policy });
      return { content: [{ type: "text", text: `${name} ok` }], details: { ok: true } };
    },
    getWikiRoot: () => state.wikiRoot,
    getWikiRoots: () => ({ wiki: state.wikiRoot }),
    isProtectedPath: () => state.protectWrite,
    isWikiPagePath: (wikiRoot: string, pathValue: string) => state.pagePath && pathValue.startsWith(`${wikiRoot}/objects/`),
    rebuildAllMeta: (wikiRoot: string) => {
      state.rebuildCalls.push(wikiRoot);
      return {
        registry: { version: 1, generatedAt: "now", pages: [] },
        backlinks: { version: 1, generatedAt: "now", byPath: {} },
      };
    },
    todayStamp: () => "2026-05-07",
  };
});

describe("PI adapter", () => {
  const originalHome = process.env.HOME;

  beforeEach(() => {
    vi.resetModules();
    state.wikiRoot = path.join(process.cwd(), ".tmp-test-wiki");
    state.protectWrite = false;
    state.pagePath = false;
    state.coreToolCalls = [];
    state.rebuildCalls = [];
    rmSync(state.wikiRoot, { recursive: true, force: true });
    mkdirSync(path.join(state.wikiRoot, "objects"), { recursive: true });
    process.env.HOME = path.join(process.cwd(), ".tmp-test-home");
    mkdirSync(path.join(process.env.HOME, "NixPI", "hosts", "nixpi-vps"), { recursive: true });
    writeFileSync(path.join(process.env.HOME, "NixPI", "hosts", "nixpi-vps", "default.nix"), "{}\n");
  });

  afterEach(() => {
    rmSync(state.wikiRoot, { recursive: true, force: true });
    if (process.env.HOME) rmSync(process.env.HOME, { recursive: true, force: true });
    if (originalHome) process.env.HOME = originalHome;
    else delete process.env.HOME;
    vi.resetModules();
  });

  async function loadWikiAdapter() {
    const api = createMockExtensionAPI();
    const mod = await import("../../pi-adapter/extension/wiki/index.ts");
    mod.default(api as never);
    return api;
  }

  async function loadNixpiAdapter() {
    const api = createMockExtensionAPI();
    const mod = await import("../../pi-adapter/extension/index.ts");
    mod.default(api as never);
    return api;
  }

  it("registers the shared wiki manifest as PI tools", async () => {
    const api = await loadWikiAdapter();
    expect(api._registeredTools.map((tool) => tool.name)).toEqual(toolManifest.map((tool) => tool.name));
    expect(api._registeredCommands.map((command) => command.name)).toEqual(expect.arrayContaining(["memory", "today"]));
  });

  it("full NixPI adapter keeps only wiki tools plus nixpi_planner as registered tools", async () => {
    const api = await loadNixpiAdapter();
    const names = api._registeredTools.map((tool) => tool.name);
    expect(names).toEqual([...toolManifest.map((tool) => tool.name), "nixpi_planner"]);
    expect(api._registeredCommands.map((command) => command.name)).toContain("nixpi");
  });

  it("wiki registered tools delegate to the shared dispatcher with mutation policy", async () => {
    const api = await loadWikiAdapter();
    const search = api._registeredTools.find((tool) => tool.name === "wiki_search");
    if (!search || typeof search.execute !== "function") throw new Error("wiki_search not found");
    await search.execute("tool-call", { query: "planner", domain: "technical" });
    expect(state.coreToolCalls).toEqual([
      {
        name: "wiki_search",
        params: { query: "planner", domain: "technical" },
        policy: { allowMutation: true, allowCacheMutation: true },
      },
    ]);
  });

  it("blocks protected direct wiki writes and rebuilds metadata after allowed direct page edits", async () => {
    const api = await loadWikiAdapter();

    state.protectWrite = true;
    const blocked = await api.fireEvent("tool_call", { toolName: "write", input: { path: path.join(state.wikiRoot, "raw", "x.md") } });
    expect(blocked).toMatchObject({ block: true });

    state.protectWrite = false;
    state.pagePath = true;
    const pagePath = path.join(state.wikiRoot, "objects", "x.md");
    const allowed = await api.fireEvent("tool_call", { toolName: "write", input: { path: pagePath } });
    expect(allowed).toBeUndefined();
    await api.fireEvent("agent_end");
    expect(state.rebuildCalls).toEqual([state.wikiRoot]);
  });
});
