import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getNixPiDir, safePath } from "../../core/lib/filesystem.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../core/lib/frontmatter.js";
import {
	createLogger,
	errorResult,
	formatResumeMessage,
	getPendingInteractions,
	guardServiceName,
	nowIso,
	requestInteraction,
	requestSelection,
	requestTextInput,
	resolveInteractionReply,
	requireConfirmation,
} from "../../core/lib/shared.js";

function makeSessionContext(prefix: string, options?: { sessionFile?: boolean }) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	const sessionFile = path.join(dir, "session.jsonl");
	const ctx = {
		hasUI: false,
		sessionManager: {
			getSessionFile: () => (options?.sessionFile === false ? null : sessionFile),
			getSessionDir: () => dir,
			getSessionId: () => "session",
		},
	} as never;
	return {
		ctx,
		dir,
		storePath: options?.sessionFile === false ? path.join(dir, "session.nixpi-interactions.json") : `${sessionFile}.nixpi-interactions.json`,
	};
}

// ---------------------------------------------------------------------------
// safePath
// ---------------------------------------------------------------------------
describe("safePath", () => {
	it("resolves normal paths within root", () => {
		expect(safePath("/workspace", "Inbox", "note.md")).toBe("/workspace/Inbox/note.md");
	});

	it("resolves nested paths", () => {
		expect(safePath("/workspace", "Projects", "myproj", "task.md")).toBe("/workspace/Projects/myproj/task.md");
	});

	it("returns root when no segments given", () => {
		expect(safePath("/workspace")).toBe("/workspace");
	});

	it("throws on ../ traversal", () => {
		expect(() => safePath("/workspace", "../../etc/passwd")).toThrow("Path traversal blocked");
	});

	it("throws on absolute path segment", () => {
		expect(() => safePath("/workspace", "/etc/passwd")).toThrow("Path traversal blocked");
	});

	it("throws on traversal hidden in nested segments", () => {
		expect(() => safePath("/workspace", "Projects", "..", "..", "etc", "shadow")).toThrow("Path traversal blocked");
	});

	it("allows segments that contain dots but don't escape", () => {
		expect(safePath("/workspace", "my.project", "note.md")).toBe("/workspace/my.project/note.md");
	});
});

// ---------------------------------------------------------------------------
// parseFrontmatter
// ---------------------------------------------------------------------------
describe("parseFrontmatter", () => {
	it("returns empty attributes when no frontmatter present", () => {
		const result = parseFrontmatter("just some text");
		expect(result.attributes).toEqual({});
		expect(result.body).toBe("just some text");
		expect(result.bodyBegin).toBe(1);
		expect(result.frontmatter).toBe("");
	});

	it("returns empty attributes when closing --- is missing", () => {
		const result = parseFrontmatter("---\nkey: value\n");
		expect(result.attributes).toEqual({});
		expect(result.body).toBe("---\nkey: value\n");
	});

	it("parses simple key/value pairs", () => {
		const input = "---\ntitle: Hello\nstatus: active\n---\nbody";
		const result = parseFrontmatter(input);
		expect(result.attributes).toEqual({ title: "Hello", status: "active" });
		expect(result.body).toBe("body");
	});

	it("parses comma-separated values as arrays for known keys", () => {
		const input = "---\ntags: a, b, c\n---\n";
		const result = parseFrontmatter(input);
		expect(result.attributes).toEqual({ tags: ["a", "b", "c"] });
	});

	it("preserves comma-containing values as strings for non-array keys", () => {
		const input = "---\ndescription: Hello, world\n---\n";
		const result = parseFrontmatter(input);
		expect(result.attributes).toEqual({ description: "Hello, world" });
	});

	it("parses YAML list items", () => {
		const input = "---\ntags:\n  - alpha\n  - beta\n---\nbody";
		const result = parseFrontmatter(input);
		expect(result.attributes).toEqual({ tags: ["alpha", "beta"] });
	});

	it("ignores comments", () => {
		const input = "---\n# this is a comment\nkey: val\n---\n";
		const result = parseFrontmatter(input);
		expect(result.attributes).toEqual({ key: "val" });
	});

	it("preserves body content", () => {
		const input = "---\nk: v\n---\nline1\nline2";
		const result = parseFrontmatter(input);
		expect(result.body).toBe("line1\nline2");
	});

	it("calculates bodyBegin accurately", () => {
		// ---       line 1
		// k: v      line 2
		// ---       line 3
		// body      line 4
		const input = "---\nk: v\n---\nbody";
		const result = parseFrontmatter(input);
		expect(result.bodyBegin).toBe(4);
	});

	it("returns empty attributes for malformed YAML", () => {
		const input = "---\nkey: val\nno-colon-here\nother: ok\n---\n";
		const result = parseFrontmatter(input);
		expect(result.attributes).toEqual({});
		expect(result.body).toBe(input);
	});
});

// ---------------------------------------------------------------------------
// stringifyFrontmatter
// ---------------------------------------------------------------------------
describe("stringifyFrontmatter", () => {
	it("serializes basic key/value pairs", () => {
		const result = stringifyFrontmatter({ title: "Test", status: "done" }, "body");
		expect(result).toBe("---\ntitle: Test\nstatus: done\n---\nbody");
	});

	it("serializes arrays as YAML block sequences", () => {
		const result = stringifyFrontmatter({ tags: ["a", "b"] }, "");
		expect(result).toBe("---\ntags:\n  - a\n  - b\n---\n");
	});

	it("preserves URLs with colons in values", () => {
		const result = stringifyFrontmatter({ url: "https://example.com" }, "");
		const parsed = parseFrontmatter(result);
		expect(parsed.attributes).toEqual({ url: "https://example.com" });
	});

	it("handles empty data", () => {
		const result = stringifyFrontmatter({}, "content");
		expect(result).toBe("---\n---\ncontent");
	});

	it("handles empty content", () => {
		const result = stringifyFrontmatter({ k: "v" }, "");
		expect(result).toBe("---\nk: v\n---\n");
	});
});

// ---------------------------------------------------------------------------
// parseFrontmatter <-> stringifyFrontmatter roundtrip
// ---------------------------------------------------------------------------
describe("frontmatter roundtrip", () => {
	it("roundtrip preserves data with simple values", () => {
		const data = { title: "Hello", status: "active" };
		const body = "some body";
		const str = stringifyFrontmatter(data, body);
		const parsed = parseFrontmatter(str);
		expect(parsed.attributes).toEqual(data);
		expect(parsed.body).toBe(body);
	});

	it("roundtrip preserves arrays", () => {
		const data = { tags: ["x", "y", "z"] };
		const str = stringifyFrontmatter(data, "");
		const parsed = parseFrontmatter(str);
		expect(parsed.attributes).toEqual(data);
	});
});

// ---------------------------------------------------------------------------
// errorResult
// ---------------------------------------------------------------------------
describe("errorResult", () => {
	it("returns the expected shape", () => {
		const result = errorResult("something broke");
		expect(result).toEqual({
			content: [{ type: "text", text: "something broke" }],
			details: {},
			isError: true,
		});
	});
});

// ---------------------------------------------------------------------------
// nowIso
// ---------------------------------------------------------------------------
describe("nowIso", () => {
	it("returns ISO string without milliseconds", () => {
		const result = nowIso();
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
	});

	it("returns the correct date when mocked", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-06-15T12:30:45.123Z"));
		expect(nowIso()).toBe("2025-06-15T12:30:45Z");
		vi.useRealTimers();
	});
});

// ---------------------------------------------------------------------------
// getNixPiDir
// ---------------------------------------------------------------------------
describe("getNixPiDir", () => {
	const origEnv = { ...process.env };

	afterEach(() => {
		process.env = { ...origEnv };
	});

	it("returns NIXPI_DIR when set", () => {
		process.env.NIXPI_DIR = "/custom";
		expect(getNixPiDir()).toBe("/custom");
	});

	it("defaults to ~/nixpi for the user workspace when NIXPI_DIR is not set", () => {
		delete process.env.NIXPI_DIR;
		const result = getNixPiDir();
		expect(result).toMatch(/\/nixpi$/);
	});
});

// ---------------------------------------------------------------------------
// createLogger
// ---------------------------------------------------------------------------
describe("createLogger", () => {
	it("returns debug/info/warn/error methods", () => {
		const logger = createLogger("test");
		expect(typeof logger.debug).toBe("function");
		expect(typeof logger.info).toBe("function");
		expect(typeof logger.warn).toBe("function");
		expect(typeof logger.error).toBe("function");
	});

	it("logs JSON to console.log for info", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		const logger = createLogger("mycomp");
		logger.info("hello");
		expect(spy).toHaveBeenCalledOnce();
		const parsed = JSON.parse(spy.mock.calls[0][0] as string);
		expect(parsed.level).toBe("info");
		expect(parsed.component).toBe("mycomp");
		expect(parsed.msg).toBe("hello");
		expect(parsed.ts).toBeDefined();
		spy.mockRestore();
	});

	it("logs to console.error for error level", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const logger = createLogger("comp");
		logger.error("fail");
		expect(spy).toHaveBeenCalledOnce();
		const parsed = JSON.parse(spy.mock.calls[0][0] as string);
		expect(parsed.level).toBe("error");
		spy.mockRestore();
	});

	it("logs to console.warn for warn level", () => {
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const logger = createLogger("comp");
		logger.warn("caution");
		expect(spy).toHaveBeenCalledOnce();
		const parsed = JSON.parse(spy.mock.calls[0][0] as string);
		expect(parsed.level).toBe("warn");
		spy.mockRestore();
	});

	it("logs to console.log for debug level", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		const logger = createLogger("comp");
		logger.debug("trace msg");
		expect(spy).toHaveBeenCalledOnce();
		const parsed = JSON.parse(spy.mock.calls[0][0] as string);
		expect(parsed.level).toBe("debug");
		expect(parsed.msg).toBe("trace msg");
		spy.mockRestore();
	});

	it("includes extra fields in log output", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		const logger = createLogger("comp");
		logger.info("msg", { extra: "data" });
		const parsed = JSON.parse(spy.mock.calls[0][0] as string);
		expect(parsed.extra).toBe("data");
		spy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// requireConfirmation
// ---------------------------------------------------------------------------
describe("requireConfirmation", () => {
	it("returns Matrix confirmation instructions when no UI and requireUi is true", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shared-confirm-"));
		const ctx = {
			hasUI: false,
			sessionManager: {
				getSessionFile: () => path.join(dir, "session.jsonl"),
				getSessionDir: () => dir,
				getSessionId: () => "session",
			},
		} as never;
		const result = await requireConfirmation(ctx, "delete file");
		expect(result).toMatch(
			/^Confirmation required for "delete file"\. Reply here with "confirm [a-z0-9]{6}" to approve or "deny [a-z0-9]{6}" to cancel\.$/,
		);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("returns null when no UI and requireUi is false", async () => {
		const ctx = { hasUI: false } as never;
		const result = await requireConfirmation(ctx, "delete file", { requireUi: false });
		expect(result).toBeNull();
	});

	it("reuses the same pending token for repeated no-UI requests", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shared-confirm-"));
		const sessionFile = path.join(dir, "session.jsonl");
		const ctx = {
			hasUI: false,
			sessionManager: {
				getSessionFile: () => sessionFile,
				getSessionDir: () => dir,
				getSessionId: () => "session",
			},
		} as never;

		const first = await requireConfirmation(ctx, "delete file");
		const second = await requireConfirmation(ctx, "delete file");

		expect(first).toBe(second);
		const saved = JSON.parse(fs.readFileSync(`${sessionFile}.nixpi-interactions.json`, "utf-8")) as {
			records: Array<{ token: string; status: string; kind: string }>;
		};
		expect(saved.records).toHaveLength(1);
		expect(saved.records[0]?.kind).toBe("confirm");
		expect(saved.records[0]?.status).toBe("pending");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("returns null when user confirms", async () => {
		const ctx = { hasUI: true, ui: { confirm: async () => true } } as never;
		const result = await requireConfirmation(ctx, "delete file");
		expect(result).toBeNull();
	});

	it("returns error when user declines", async () => {
		const ctx = { hasUI: true, ui: { confirm: async () => false } } as never;
		const result = await requireConfirmation(ctx, "delete file");
		expect(result).toBe("User declined: delete file");
	});

	it("consumes an approved Matrix confirmation on retry", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shared-confirm-"));
		const sessionFile = path.join(dir, "session.jsonl");
		const token = "abc123";
		fs.writeFileSync(
			`${sessionFile}.nixpi-interactions.json`,
			JSON.stringify({
				records: [
					{
						token,
						kind: "confirm",
						key: "delete file",
						prompt: "Allow: delete file?",
						status: "resolved",
						resolution: "approved",
						createdAt: "2026-03-15T00:00:00Z",
						updatedAt: "2026-03-15T00:00:00Z",
					},
				],
			}),
		);
		const ctx = {
			hasUI: false,
			sessionManager: {
				getSessionFile: () => sessionFile,
				getSessionDir: () => dir,
				getSessionId: () => "session",
			},
		} as never;

		const result = await requireConfirmation(ctx, "delete file");

		expect(result).toBeNull();
		const saved = JSON.parse(fs.readFileSync(`${sessionFile}.nixpi-interactions.json`, "utf-8")) as {
			records: Array<{ token: string; status: string }>;
		};
		expect(saved.records[0]?.token).toBe(token);
		expect(saved.records[0]?.status).toBe("consumed");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("returns a decline after Matrix denial and consumes it", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shared-confirm-"));
		const sessionFile = path.join(dir, "session.jsonl");
		fs.writeFileSync(
			`${sessionFile}.nixpi-interactions.json`,
			JSON.stringify({
				records: [
					{
						token: "abc123",
						kind: "confirm",
						key: "delete file",
						prompt: "Allow: delete file?",
						status: "resolved",
						resolution: "denied",
						createdAt: "2026-03-15T00:00:00Z",
						updatedAt: "2026-03-15T00:00:00Z",
					},
				],
			}),
		);
		const ctx = {
			hasUI: false,
			sessionManager: {
				getSessionFile: () => sessionFile,
				getSessionDir: () => dir,
				getSessionId: () => "session",
			},
		} as never;

		const result = await requireConfirmation(ctx, "delete file");

		expect(result).toBe("User declined: delete file");
		const saved = JSON.parse(fs.readFileSync(`${sessionFile}.nixpi-interactions.json`, "utf-8")) as {
			records: Array<{ status: string }>;
		};
		expect(saved.records[0]?.status).toBe("consumed");
		fs.rmSync(dir, { recursive: true, force: true });
	});
});

describe("requestSelection", () => {
	it("returns a numbered prompt for no-UI sessions and resolves the saved choice", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shared-select-"));
		const sessionFile = path.join(dir, "session.jsonl");
		const ctx = {
			hasUI: false,
			sessionManager: {
				getSessionFile: () => sessionFile,
				getSessionDir: () => dir,
				getSessionId: () => "session",
			},
		} as never;

		const first = await requestSelection(ctx, "pick-action", "Choose action", ["init", "status"]);
		expect(first.value).toBeNull();
		expect(first.prompt).toContain("1. init");
		expect(first.prompt).toContain("2. status");

		fs.writeFileSync(
			`${sessionFile}.nixpi-interactions.json`,
			JSON.stringify({
				records: [
					{
						token: "abc123",
						kind: "select",
						key: "pick-action",
						prompt: "Choose action",
						options: ["init", "status"],
						status: "resolved",
						resolution: "status",
						createdAt: "2026-03-15T00:00:00Z",
						updatedAt: "2026-03-15T00:00:00Z",
					},
				],
			}),
		);

		const second = await requestSelection(ctx, "pick-action", "Choose action", ["init", "status"]);
		expect(second.value).toBe("status");
		fs.rmSync(dir, { recursive: true, force: true });
	});
});

describe("requestTextInput", () => {
	it("returns a chat prompt and consumes resolved input", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shared-input-"));
		const sessionFile = path.join(dir, "session.jsonl");
		const ctx = {
			hasUI: false,
			sessionManager: {
				getSessionFile: () => sessionFile,
				getSessionDir: () => dir,
				getSessionId: () => "session",
			},
		} as never;

		const first = await requestTextInput(ctx, "note", "Enter a short note", { placeholder: "one sentence" });
		expect(first.value).toBeNull();
		expect(first.prompt).toContain("Enter a short note");

		fs.writeFileSync(
			`${sessionFile}.nixpi-interactions.json`,
			JSON.stringify({
				records: [
					{
						token: "abc123",
						kind: "input",
						key: "note",
						prompt: "Enter a short note",
						status: "resolved",
						resolution: "hello world",
						createdAt: "2026-03-15T00:00:00Z",
						updatedAt: "2026-03-15T00:00:00Z",
					},
				],
			}),
		);

		const second = await requestTextInput(ctx, "note", "Enter a short note");
		expect(second.value).toBe("hello world");
		fs.rmSync(dir, { recursive: true, force: true });
	});
});

describe("interaction store helpers", () => {
	it("returns null when interaction persistence is unavailable", () => {
		const result = requestInteraction({ hasUI: false } as never, {
			kind: "confirm",
			key: "delete file",
			prompt: "Allow: delete file?",
		});
		expect(result).toBeNull();
	});

	it("stores interactions under sessionDir/sessionId when no session file exists", () => {
		const { ctx, dir, storePath } = makeSessionContext("shared-sessiondir-", { sessionFile: false });
		const result = requestInteraction(ctx, {
			kind: "input",
			key: "nickname",
			prompt: "Enter nickname",
		});

		expect(result?.state).toBe("pending");
		expect(fs.existsSync(storePath)).toBe(true);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("resolves confirm replies using synonyms and stores the resolved value", () => {
		const { ctx, dir, storePath } = makeSessionContext("shared-confirm-reply-");
		const pending = requestInteraction(ctx, {
			kind: "confirm",
			key: "delete file",
			prompt: "Allow: delete file?",
		});

		if (!pending || pending.state !== "pending") throw new Error("expected pending interaction");
		const resolved = resolveInteractionReply(ctx, `yes ${pending.record.token}`);

		expect(resolved?.value).toBe("approved");
		expect(resolved?.record.status).toBe("resolved");
		const saved = JSON.parse(fs.readFileSync(storePath, "utf-8")) as {
			records: Array<{ resolution?: string; status: string }>;
		};
		expect(saved.records[0]?.resolution).toBe("approved");
		expect(saved.records[0]?.status).toBe("resolved");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("supports select replies by number or exact option text", () => {
		const { ctx, dir } = makeSessionContext("shared-select-reply-");

		const first = requestInteraction(ctx, {
			kind: "select",
			key: "mode",
			prompt: "Choose mode",
			options: ["fast", "safe"],
		});
		if (!first || first.state !== "pending") throw new Error("expected first pending interaction");
		const byNumber = resolveInteractionReply(ctx, `2 ${first.record.token}`);
		expect(byNumber?.value).toBe("safe");

		const second = requestInteraction(ctx, {
			kind: "select",
			key: "theme",
			prompt: "Choose theme",
			options: ["Light", "Dark"],
		});
		if (!second || second.state !== "pending") throw new Error("expected second pending interaction");
		const byExactText = resolveInteractionReply(ctx, `dark ${second.record.token}`);
		expect(byExactText?.value).toBe("Dark");

		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("marks untokened replies as ambiguous when multiple pending interactions exist", () => {
		const { ctx, dir } = makeSessionContext("shared-ambiguous-");
		requestInteraction(ctx, {
			kind: "input",
			key: "first",
			prompt: "First prompt",
		});
		const second = requestInteraction(ctx, {
			kind: "input",
			key: "second",
			prompt: "Second prompt",
		});

		if (!second || second.state !== "pending") throw new Error("expected second pending interaction");
		const resolved = resolveInteractionReply(ctx, "typed answer");

		expect(resolved?.value).toBe("typed answer");
		expect(resolved?.record.key).toBe("second");
		expect(resolved?.ambiguous).toBe(true);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("extracts tokens from the start of replies and ignores invalid replies", () => {
		const { ctx, dir } = makeSessionContext("shared-token-prefix-");
		const pending = requestInteraction(ctx, {
			kind: "input",
			key: "nickname",
			prompt: "Enter nickname",
		});

		if (!pending || pending.state !== "pending") throw new Error("expected pending interaction");
		expect(resolveInteractionReply(ctx, "   ")).toBeNull();
		const resolved = resolveInteractionReply(ctx, `${pending.record.token} Bloom`);
		expect(resolved?.value).toBe("Bloom");

		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("lists only pending interactions", () => {
		const { ctx, dir } = makeSessionContext("shared-pending-list-");
		requestInteraction(ctx, {
			kind: "confirm",
			key: "first",
			prompt: "First prompt",
		});
		const second = requestInteraction(ctx, {
			kind: "input",
			key: "second",
			prompt: "Second prompt",
		});
		if (!second || second.state !== "pending") throw new Error("expected second pending interaction");
		resolveInteractionReply(ctx, `${second.record.token} hello`);

		const pending = getPendingInteractions(ctx);
		expect(pending).toHaveLength(1);
		expect(pending[0]?.key).toBe("first");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("formats default and templated resume messages", () => {
		expect(
			formatResumeMessage(
				{
					token: "tok123",
					kind: "confirm",
					key: "deploy",
					prompt: "Deploy now?",
					status: "resolved",
					createdAt: "2026-03-15T00:00:00Z",
					updatedAt: "2026-03-15T00:00:00Z",
				},
				"denied",
			),
		).toContain("denied confirmation tok123");

		expect(
			formatResumeMessage(
				{
					token: "sel123",
					kind: "select",
					key: "theme",
					prompt: "Theme?",
					status: "resolved",
					createdAt: "2026-03-15T00:00:00Z",
					updatedAt: "2026-03-15T00:00:00Z",
				},
				"Dark",
			),
		).toContain('selected "Dark"');

		expect(
			formatResumeMessage(
				{
					token: "inp123",
					kind: "input",
					key: "nickname",
					prompt: "Nickname?",
					status: "resolved",
					resumeMessage: "Resume with {{value}} using {{token}}.",
					createdAt: "2026-03-15T00:00:00Z",
					updatedAt: "2026-03-15T00:00:00Z",
				},
				"Bloom",
			),
		).toBe("Resume with Bloom using inp123.");
	});

	it("trims persisted interaction history to the latest 32 records", () => {
		const { ctx, dir, storePath } = makeSessionContext("shared-trim-");
		for (let i = 0; i < 35; i += 1) {
			requestInteraction(ctx, {
				kind: "input",
				key: `note-${i}`,
				prompt: `Prompt ${i}`,
			});
		}

		const saved = JSON.parse(fs.readFileSync(storePath, "utf-8")) as {
			records: Array<{ key: string }>;
		};
		expect(saved.records).toHaveLength(32);
		expect(saved.records[0]?.key).toBe("note-3");
		expect(saved.records.at(-1)?.key).toBe("note-34");
		fs.rmSync(dir, { recursive: true, force: true });
	});
});

// ---------------------------------------------------------------------------
// guardServiceName
// ---------------------------------------------------------------------------
describe("guardServiceName", () => {
	it("returns null for nixpi- prefixed names", () => {
		expect(guardServiceName("nixpi-os")).toBeNull();
		expect(guardServiceName("nixpi-test")).toBeNull();
	});

	it("returns null for nixpi names with numbers", () => {
		expect(guardServiceName("nixpi-svc1")).toBeNull();
		expect(guardServiceName("nixpi-v2-api")).toBeNull();
	});

	it("returns error for non-nixpi names", () => {
		const result = guardServiceName("not-nixpi");
		expect(result).toContain("Security error");
	});

	it("returns error for empty string", () => {
		expect(guardServiceName("")).not.toBeNull();
	});

	it("rejects shell metacharacters", () => {
		expect(guardServiceName("nixpi-;rm -rf /")).not.toBeNull();
		expect(guardServiceName("nixpi-$(whoami)")).not.toBeNull();
		expect(guardServiceName("nixpi-`id`")).not.toBeNull();
	});

	it("rejects path separators", () => {
		expect(guardServiceName("nixpi-../../etc")).not.toBeNull();
		expect(guardServiceName("nixpi-foo/bar")).not.toBeNull();
	});

	it("rejects spaces", () => {
		expect(guardServiceName("nixpi- evil")).not.toBeNull();
	});

	it("rejects uppercase letters", () => {
		expect(guardServiceName("nixpi-Foo")).not.toBeNull();
	});

	it("rejects nixpi- with nothing after it", () => {
		expect(guardServiceName("nixpi-")).not.toBeNull();
	});

	it("rejects nixpi- starting with hyphen", () => {
		expect(guardServiceName("nixpi--double")).not.toBeNull();
	});

	it("accepts alternate prefixes when requested", () => {
		expect(guardServiceName("agent-router", "agent")).toBeNull();
	});
});
