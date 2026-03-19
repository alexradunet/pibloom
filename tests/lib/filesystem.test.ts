import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getNixpiDir, safePath } from "../../core/lib/filesystem.js";

const ROOT = path.join(os.tmpdir(), "workspace-fs-test-root");

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
// getNixpiDir
// ---------------------------------------------------------------------------
describe("getNixpiDir", () => {
	let origNixpiDir: string | undefined;

	beforeEach(() => {
		origNixpiDir = process.env.NIXPI_DIR;
	});

	afterEach(() => {
		if (origNixpiDir !== undefined) {
			process.env.NIXPI_DIR = origNixpiDir;
		} else {
			delete process.env.NIXPI_DIR;
		}
	});

	it("returns NIXPI_DIR when env var is set", () => {
		process.env.NIXPI_DIR = "/custom/nixpi";
		expect(getNixpiDir()).toBe("/custom/nixpi");
	});

	it("falls back to ~/nixPI when env var is not set", () => {
		delete process.env.NIXPI_DIR;
		const expected = path.join(os.homedir(), "nixPI");
		expect(getNixpiDir()).toBe(expected);
	});

	it("reflects changes to NIXPI_DIR dynamically", () => {
		process.env.NIXPI_DIR = "/first/path";
		expect(getNixpiDir()).toBe("/first/path");

		process.env.NIXPI_DIR = "/second/path";
		expect(getNixpiDir()).toBe("/second/path");
	});
});
