import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoomRegistry } from "../../daemon/room-registry.js";
import { SessionPool } from "../../daemon/session-pool.js";

// Mock createAgentSession — we can't actually create real sessions in unit tests
vi.mock("@mariozechner/pi-coding-agent", () => ({
	createAgentSession: vi.fn().mockResolvedValue({
		session: {
			sessionFile: "/tmp/mock-session.jsonl",
			dispose: vi.fn(),
			subscribe: vi.fn().mockReturnValue(() => {}),
			prompt: vi.fn().mockResolvedValue(undefined),
		},
		extensionsResult: { extensions: [], diagnostics: [] },
	}),
	SessionManager: {
		create: vi.fn().mockReturnValue({}),
		open: vi.fn().mockReturnValue({}),
	},
	DefaultResourceLoader: class {
		reload = vi.fn().mockResolvedValue(undefined);
	},
}));

describe("SessionPool", () => {
	let dir: string;
	let registry: RoomRegistry;

	let pool: SessionPool | undefined;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "session-pool-"));
		registry = new RoomRegistry(join(dir, "rooms.json"));
		vi.clearAllMocks();
	});

	afterEach(() => {
		pool?.disposeAll();
		pool = undefined;
	});

	it("creates a new session for an unknown room", async () => {
		pool = new SessionPool({
			registry,
			maxSessions: 3,
			idleTimeoutMs: 15 * 60 * 1000,
			sessionDir: join(dir, "sessions"),
			extensionFactories: [],
		});

		const session = await pool.getOrCreate("!abc:bloom", "#general:bloom");
		expect(session).toBeDefined();
		expect(session.prompt).toBeDefined();
		expect(registry.get("!abc:bloom")).toBeDefined();
	});

	it("returns the same session for the same room", async () => {
		pool = new SessionPool({
			registry,
			maxSessions: 3,
			idleTimeoutMs: 15 * 60 * 1000,
			sessionDir: join(dir, "sessions"),
			extensionFactories: [],
		});

		const s1 = await pool.getOrCreate("!abc:bloom", "#general:bloom");
		const s2 = await pool.getOrCreate("!abc:bloom", "#general:bloom");
		expect(s1).toBe(s2);
	});

	it("evicts LRU session when max reached", async () => {
		pool = new SessionPool({
			registry,
			maxSessions: 2,
			idleTimeoutMs: 15 * 60 * 1000,
			sessionDir: join(dir, "sessions"),
			extensionFactories: [],
		});

		await pool.getOrCreate("!a:bloom", "#a:bloom");
		await pool.getOrCreate("!b:bloom", "#b:bloom");
		await pool.getOrCreate("!c:bloom", "#c:bloom");

		expect(pool.loadedCount()).toBe(2);
	});

	it("disposes all sessions on shutdown", async () => {
		pool = new SessionPool({
			registry,
			maxSessions: 3,
			idleTimeoutMs: 15 * 60 * 1000,
			sessionDir: join(dir, "sessions"),
			extensionFactories: [],
		});

		await pool.getOrCreate("!abc:bloom", "#general:bloom");
		pool.disposeAll();
		expect(pool.loadedCount()).toBe(0);
	});
});
