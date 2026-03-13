import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentDefinition } from "../../daemon/agent-registry.js";

// Mock child_process.spawn to use a stand-in process instead of `pi`
vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	return {
		...actual,
		spawn: (_cmd: string, _args: string[], opts: Record<string, unknown>) => {
			return actual.spawn(
				"node",
				[
					"-e",
					`
				process.stdin.resume();
				process.stdin.on("data", (d) => {
					const line = d.toString().trim();
					try {
						const cmd = JSON.parse(line);
						if (cmd.type === "prompt") {
							process.stdout.write(JSON.stringify({type:"agent_start"}) + "\\n");
							process.stdout.write(JSON.stringify({type:"agent_end",messages:[{role:"assistant",content:"hi"}]}) + "\\n");
						}
					} catch {}
				});
			`,
				],
				{ ...opts, stdio: ["pipe", "pipe", "pipe"] },
			);
		},
	};
});

function makeAgent(
	id: string,
	userId: string,
	mode: AgentDefinition["respond"]["mode"],
): AgentDefinition {
	return {
		id,
		name: id[0]?.toUpperCase() + id.slice(1),
		instructionsPath: `/tmp/${id}/AGENTS.md`,
		instructionsBody: `# ${id}`,
		matrix: {
			username: userId.slice(1, userId.indexOf(":")),
			userId,
			autojoin: true,
		},
		respond: {
			mode,
			allowAgentMentions: true,
			maxPublicTurnsPerRoot: 2,
			cooldownMs: 1500,
		},
	};
}

describe("AgentSession", () => {
	let tmpDir: string;
	let socketDir: string;
	let sessionBaseDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "agent-session-"));
		socketDir = join(tmpDir, "sockets");
		sessionBaseDir = join(tmpDir, "sessions");
		mkdirSync(socketDir, { recursive: true });
		mkdirSync(sessionBaseDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("creates separate socket files and session directories for the same room with different agents", async () => {
		const { AgentSession } = await import("../../daemon/agent-session.js");
		const host = makeAgent("host", "@pi:bloom", "host");
		const planner = makeAgent("planner", "@planner:bloom", "mentioned");

		const hostSession = new AgentSession({
			roomId: "!abc:bloom",
			roomAlias: "#general:bloom",
			agent: host,
			socketDir,
			sessionBaseDir,
			idleTimeoutMs: 60_000,
			onAgentEnd: vi.fn(),
			onEvent: vi.fn(),
			onExit: vi.fn(),
		});
		const plannerSession = new AgentSession({
			roomId: "!abc:bloom",
			roomAlias: "#general:bloom",
			agent: planner,
			socketDir,
			sessionBaseDir,
			idleTimeoutMs: 60_000,
			onAgentEnd: vi.fn(),
			onEvent: vi.fn(),
			onExit: vi.fn(),
		});

		await hostSession.spawn();
		await plannerSession.spawn();

		expect(existsSync(join(socketDir, "room-general_bloom-host.sock"))).toBe(true);
		expect(existsSync(join(socketDir, "room-general_bloom-planner.sock"))).toBe(true);
		expect(existsSync(join(sessionBaseDir, "general_bloom", "host"))).toBe(true);
		expect(existsSync(join(sessionBaseDir, "general_bloom", "planner"))).toBe(true);

		hostSession.dispose();
		plannerSession.dispose();
	});

	it("tags callbacks with the agent id", async () => {
		const { AgentSession } = await import("../../daemon/agent-session.js");
		const planner = makeAgent("planner", "@planner:bloom", "mentioned");
		const onAgentEnd = vi.fn();
		const onEvent = vi.fn();
		const session = new AgentSession({
			roomId: "!abc:bloom",
			roomAlias: "#general:bloom",
			agent: planner,
			socketDir,
			sessionBaseDir,
			idleTimeoutMs: 60_000,
			onAgentEnd,
			onEvent,
			onExit: vi.fn(),
		});

		await session.spawn();
		session.sendMessage("hello");
		await new Promise((r) => setTimeout(r, 200));

		expect(onAgentEnd).toHaveBeenCalledWith("planner", "hi");
		expect(onEvent).toHaveBeenCalledWith("planner", expect.objectContaining({ type: "agent_start" }));
		expect(onEvent).toHaveBeenCalledWith("planner", expect.objectContaining({ type: "agent_end" }));

		session.dispose();
	});

	it("cleans up idle sessions independently", async () => {
		const { AgentSession } = await import("../../daemon/agent-session.js");
		const host = makeAgent("host", "@pi:bloom", "host");
		const planner = makeAgent("planner", "@planner:bloom", "mentioned");
		const hostSession = new AgentSession({
			roomId: "!abc:bloom",
			roomAlias: "#general:bloom",
			agent: host,
			socketDir,
			sessionBaseDir,
			idleTimeoutMs: 200,
			onAgentEnd: vi.fn(),
			onEvent: vi.fn(),
			onExit: vi.fn(),
		});
		const plannerSession = new AgentSession({
			roomId: "!abc:bloom",
			roomAlias: "#general:bloom",
			agent: planner,
			socketDir,
			sessionBaseDir,
			idleTimeoutMs: 1000,
			onAgentEnd: vi.fn(),
			onEvent: vi.fn(),
			onExit: vi.fn(),
		});

		await hostSession.spawn();
		await plannerSession.spawn();
		await new Promise((r) => setTimeout(r, 400));

		expect(hostSession.alive).toBe(false);
		expect(plannerSession.alive).toBe(true);

		plannerSession.dispose();
	});
});
