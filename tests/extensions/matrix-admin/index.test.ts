import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockExtensionAPI } from "../../helpers/mock-extension-api.js";
import { createMockExtensionContext } from "../../helpers/mock-extension-context.js";

function makeTempPiDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-test-"));
  const credentials = {
    homeserver: "http://localhost:6167",
    botUserId: "@pi:nixpi",
    botAccessToken: "tok_test",
    botPassword: "pw",
  };
  fs.writeFileSync(path.join(dir, "matrix-credentials.json"), JSON.stringify(credentials));
  return dir;
}

function toolNames(api: ReturnType<typeof createMockExtensionAPI>): string[] {
  return (api._registeredTools as Array<{ name: string }>).map((t) => t.name);
}

async function executeTool(
  api: ReturnType<typeof createMockExtensionAPI>,
  toolName: string,
  params: Record<string, unknown>,
) {
  const tool = (api._registeredTools as Array<{ name: string; execute: Function }>).find(
    (t) => t.name === toolName,
  );
  if (!tool) throw new Error(`Tool ${toolName} not found`);
  return tool.execute("test-id", params, undefined, undefined, createMockExtensionContext());
}

describe("matrix-admin extension registration", () => {
  let tmpDir: string;
  let origPiDir: string | undefined;

  beforeEach(() => {
    tmpDir = makeTempPiDir();
    origPiDir = process.env.NIXPI_PI_DIR;
    process.env.NIXPI_PI_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    if (origPiDir !== undefined) {
      process.env.NIXPI_PI_DIR = origPiDir;
    } else {
      delete process.env.NIXPI_PI_DIR;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("registers the matrix_admin tool", async () => {
    const mod = await import("../../../core/pi/extensions/matrix-admin/index.js");
    const api = createMockExtensionAPI();
    mod.default(api as never);
    expect(toolNames(api)).toContain("matrix_admin");
  });
});

describe("matrix_admin tool execute", () => {
  let tmpDir: string;
  let origPiDir: string | undefined;

  beforeEach(() => {
    tmpDir = makeTempPiDir();
    origPiDir = process.env.NIXPI_PI_DIR;
    process.env.NIXPI_PI_DIR = tmpDir;
    // Pre-populate admin room cache
    fs.writeFileSync(
      path.join(tmpDir, "matrix-admin.json"),
      JSON.stringify({ adminRoomId: "!admin:nixpi" }),
    );
    vi.resetModules();
  });

  afterEach(() => {
    if (origPiDir !== undefined) {
      process.env.NIXPI_PI_DIR = origPiDir;
    } else {
      delete process.env.NIXPI_PI_DIR;
    }
    vi.unstubAllGlobals();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns error for dangerous commands without running them", async () => {
    const mod = await import("../../../core/pi/extensions/matrix-admin/index.js");
    const api = createMockExtensionAPI();
    mod.default(api as never);

    const result = await executeTool(api, "matrix_admin", { command: "server shutdown" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/dangerous/i);
  });

  it("returns response text on successful command", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ next_batch: "s1" }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ event_id: "$e1" }) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          next_batch: "s2",
          rooms: { join: { "!admin:nixpi": { timeline: { events: [
            { type: "m.room.message", sender: "@conduit:nixpi", content: { body: "User list: @alex:nixpi" } },
          ] } } } },
        }),
      } as Response);

    vi.stubGlobal("fetch", mockFetch);

    const mod = await import("../../../core/pi/extensions/matrix-admin/index.js");
    const api = createMockExtensionAPI();
    mod.default(api as never);

    const result = await executeTool(api, "matrix_admin", { command: "users list-users" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("User list: @alex:nixpi");
  });

  it("returns isError:true when runCommand returns ok:false", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ next_batch: "s1" }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ event_id: "$e1" }) } as Response)
      .mockResolvedValue({ ok: true, json: async () => ({ next_batch: "sN", rooms: {} }) } as Response);

    vi.stubGlobal("fetch", mockFetch);

    const mod = await import("../../../core/pi/extensions/matrix-admin/index.js");
    const api = createMockExtensionAPI();
    mod.default(api as never);

    const result = await executeTool(api, "matrix_admin", { command: "users list-users", timeout_ms: 50 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("timeout");
  });
});
