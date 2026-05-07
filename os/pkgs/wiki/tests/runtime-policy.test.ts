import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildCompactionContext,
  saveContext,
} from "../../pi-adapter/extension/wiki/runtime-policy.ts";

describe("runtime-policy helpers", () => {
  const originalHome = process.env.HOME;
  const originalHostname = process.env.HOSTNAME;

  beforeEach(() => {
    process.env.HOME = path.join("/tmp", "nixpi-wiki-runtime-policy-home");
    rmSync(process.env.HOME, { recursive: true, force: true });
    mkdirSync(process.env.HOME, { recursive: true });
    process.env.HOSTNAME = "runtime-test-host";
  });

  afterEach(() => {
    if (process.env.HOME) rmSync(process.env.HOME, { recursive: true, force: true });
    if (originalHome) process.env.HOME = originalHome;
    else delete process.env.HOME;
    if (originalHostname) process.env.HOSTNAME = originalHostname;
    else delete process.env.HOSTNAME;
  });

  it("saves compaction context to the Pi agent directory", () => {
    const context = { savedAt: "2026-04-23T00:00:00.000Z", host: "old-host", cwd: "/tmp/work" };
    saveContext(context);

    const contextPath = path.join(process.env.HOME!, ".pi", "agent", "context.json");
    expect(existsSync(contextPath)).toBe(true);
    expect(JSON.parse(readFileSync(contextPath, "utf-8"))).toEqual(context);
  });

  it("builds compaction context with host and cwd", () => {
    const context = buildCompactionContext("/tmp/project");
    expect(context.cwd).toBe("/tmp/project");
    expect(context.host).toBe("runtime-test-host");
    expect(typeof context.savedAt).toBe("string");
  });
});
