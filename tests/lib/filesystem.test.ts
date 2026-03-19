import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getGardenDir, safePath } from "../../core/lib/filesystem.js";

const ROOT = path.join(os.tmpdir(), "garden-fs-test-root");

// ---------------------------------------------------------------------------
// safePath
// ---------------------------------------------------------------------------
describe("safePath", () => {
	it("resolves a valid subpath under the root", () => {
		const result = safePath(ROOT, "Skills", "my-skill");
		expect(result).toBe(path.join(ROOT, "Skills", "my-skill"));
	});

	it("allows a path equal to the root (no segments)", () => {
		const result = safePath(ROOT);
		expect(result).toBe(path.resolve(ROOT));
	});

	it("throws on path traversal with ../", () => {
		expect(() => safePath(ROOT, "../escape")).toThrow("Path traversal blocked");
	});

	it("throws on deep path traversal that escapes root", () => {
		expect(() => safePath(ROOT, "Skills", "../../etc/passwd")).toThrow("Path traversal blocked");
	});

	it("handles nested valid subpath correctly", () => {
		const result = safePath(ROOT, "Objects", "notes", "my-note.md");
		expect(result).toBe(path.join(ROOT, "Objects", "notes", "my-note.md"));
	});
});

// ---------------------------------------------------------------------------
// getGardenDir
// ---------------------------------------------------------------------------
describe("getGardenDir", () => {
	let origBloomDir: string | undefined;

	beforeEach(() => {
		origBloomDir = process.env.GARDEN_DIR;
	});

	afterEach(() => {
		if (origBloomDir !== undefined) {
			process.env.GARDEN_DIR = origBloomDir;
		} else {
			delete process.env.GARDEN_DIR;
		}
	});

	it("returns GARDEN_DIR when env var is set", () => {
		process.env.GARDEN_DIR = "/custom/garden";
		expect(getGardenDir()).toBe("/custom/garden");
	});

	it("falls back to ~/Garden when env var is not set", () => {
		delete process.env.GARDEN_DIR;
		const expected = path.join(os.homedir(), "Garden");
		expect(getGardenDir()).toBe(expected);
	});

	it("reflects changes to GARDEN_DIR dynamically", () => {
		process.env.GARDEN_DIR = "/first/path";
		expect(getGardenDir()).toBe("/first/path");

		process.env.GARDEN_DIR = "/second/path";
		expect(getGardenDir()).toBe("/second/path");
	});
});
