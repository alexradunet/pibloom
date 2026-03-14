import { describe, expect, it, vi } from "vitest";

import type { AgentDefinition } from "../../core/daemon/agent-registry.js";
import { createMultiAgentRuntime } from "../../core/daemon/multi-agent-runtime.js";

function makeAgent(id: string): AgentDefinition {
	return {
		id,
		name: id[0]?.toUpperCase() + id.slice(1),
		instructionsPath: `/tmp/${id}/AGENTS.md`,
		instructionsBody: `# ${id}`,
		matrix: {
			username: id,
			userId: `@${id}:bloom`,
			autojoin: true,
		},
		respond: {
			mode: id === "host" ? "host" : "mentioned",
			allowAgentMentions: true,
			maxPublicTurnsPerRoot: 2,
			cooldownMs: 1500,
		},
	};
}

describe("createMultiAgentRuntime", () => {
	it("does not create a scheduler when there are no proactive jobs", async () => {
		const bridge = {
			onTextEvent: vi.fn(),
			start: vi.fn(async () => undefined),
			stop: vi.fn(),
			sendText: vi.fn(async () => undefined),
			setTyping: vi.fn(async () => undefined),
			getRoomAlias: vi.fn(async () => "#room:bloom"),
		};
		const supervisor = {
			handleEnvelope: vi.fn(),
			dispatchProactiveJob: vi.fn(async () => undefined),
			shutdown: vi.fn(async () => undefined),
		};
		const createScheduler = vi.fn();
		const runtime = createMultiAgentRuntime({
			agents: [makeAgent("host")],
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			matrixAgentStorageDir: "/tmp/matrix-agents",
			loadAgentCredentials: () => ({
				homeserver: "http://localhost:6167",
				userId: "@host:bloom",
				accessToken: "token",
				password: "secret",
				username: "host",
			}),
			loadSchedulerState: () => ({}),
			saveSchedulerState: () => undefined,
			onSchedulerError: () => undefined,
			createBridge: () => bridge,
			createSupervisor: () => supervisor,
			createScheduler,
		});

		await runtime.start();
		await runtime.stop();

		expect(runtime.proactiveJobs).toBe(0);
		expect(createScheduler).not.toHaveBeenCalled();
		expect(bridge.start).toHaveBeenCalledTimes(1);
		expect(bridge.stop).toHaveBeenCalledTimes(1);
		expect(supervisor.shutdown).toHaveBeenCalledTimes(1);
	});

	it("starts and stops the scheduler when proactive jobs exist", async () => {
		const agent = makeAgent("host");
		agent.proactive = {
			jobs: [
				{
					id: "daily-heartbeat",
					kind: "heartbeat",
					room: "!ops:bloom",
					intervalMinutes: 1440,
					prompt: "Heartbeat",
				},
			],
		};
		const bridge = {
			onTextEvent: vi.fn(),
			start: vi.fn(async () => undefined),
			stop: vi.fn(),
			sendText: vi.fn(async () => undefined),
			setTyping: vi.fn(async () => undefined),
			getRoomAlias: vi.fn(async () => "#room:bloom"),
		};
		const supervisor = {
			handleEnvelope: vi.fn(),
			dispatchProactiveJob: vi.fn(async () => undefined),
			shutdown: vi.fn(async () => undefined),
		};
		const scheduler = {
			start: vi.fn(),
			stop: vi.fn(),
		};
		const runtime = createMultiAgentRuntime({
			agents: [agent],
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			matrixAgentStorageDir: "/tmp/matrix-agents",
			loadAgentCredentials: () => ({
				homeserver: "http://localhost:6167",
				userId: "@host:bloom",
				accessToken: "token",
				password: "secret",
				username: "host",
			}),
			loadSchedulerState: () => ({}),
			saveSchedulerState: () => undefined,
			onSchedulerError: () => undefined,
			createBridge: () => bridge,
			createSupervisor: () => supervisor,
			createScheduler: vi.fn(() => scheduler),
		});

		await runtime.start();
		await runtime.stop();

		expect(runtime.proactiveJobs).toBe(1);
		expect(scheduler.start).toHaveBeenCalledTimes(1);
		expect(scheduler.stop).toHaveBeenCalledTimes(1);
	});

	it("tears down scheduler, supervisor, and bridge when startup fails", async () => {
		const agent = makeAgent("host");
		agent.proactive = {
			jobs: [
				{
					id: "daily-heartbeat",
					kind: "heartbeat",
					room: "!ops:bloom",
					intervalMinutes: 1440,
					prompt: "Heartbeat",
				},
			],
		};
		const bridge = {
			onTextEvent: vi.fn(),
			start: vi.fn(async () => {
				throw new Error("boom");
			}),
			stop: vi.fn(),
			sendText: vi.fn(async () => undefined),
			setTyping: vi.fn(async () => undefined),
			getRoomAlias: vi.fn(async () => "#room:bloom"),
		};
		const supervisor = {
			handleEnvelope: vi.fn(),
			dispatchProactiveJob: vi.fn(async () => undefined),
			shutdown: vi.fn(async () => undefined),
		};
		const scheduler = {
			start: vi.fn(),
			stop: vi.fn(),
		};
		const runtime = createMultiAgentRuntime({
			agents: [agent],
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			matrixAgentStorageDir: "/tmp/matrix-agents",
			loadAgentCredentials: () => ({
				homeserver: "http://localhost:6167",
				userId: "@host:bloom",
				accessToken: "token",
				password: "secret",
				username: "host",
			}),
			loadSchedulerState: () => ({}),
			saveSchedulerState: () => undefined,
			onSchedulerError: () => undefined,
			createBridge: () => bridge,
			createSupervisor: () => supervisor,
			createScheduler: vi.fn(() => scheduler),
		});

		await expect(runtime.start()).rejects.toThrow("boom");
		expect(scheduler.start).not.toHaveBeenCalled();
		expect(scheduler.stop).toHaveBeenCalledTimes(1);
		expect(supervisor.shutdown).toHaveBeenCalledTimes(1);
		expect(bridge.stop).toHaveBeenCalledTimes(1);
	});

	it("routes bridge text events into supervisor envelopes", async () => {
		let textHandler:
			| ((identityId: string, event: { roomId: string; eventId: string; senderUserId: string; body: string; timestamp: number }) => void)
			| undefined;
		const bridge = {
			onTextEvent: vi.fn((handler) => {
				textHandler = handler;
			}),
			start: vi.fn(async () => undefined),
			stop: vi.fn(),
			sendText: vi.fn(async () => undefined),
			setTyping: vi.fn(async () => undefined),
			getRoomAlias: vi.fn(async () => "#room:bloom"),
		};
		const supervisor = {
			handleEnvelope: vi.fn(),
			dispatchProactiveJob: vi.fn(async () => undefined),
			shutdown: vi.fn(async () => undefined),
		};
		const runtime = createMultiAgentRuntime({
			agents: [makeAgent("host")],
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			matrixAgentStorageDir: "/tmp/matrix-agents",
			loadAgentCredentials: () => ({
				homeserver: "http://localhost:6167",
				userId: "@host:bloom",
				accessToken: "token",
				password: "secret",
				username: "host",
			}),
			loadSchedulerState: () => ({}),
			saveSchedulerState: () => undefined,
			onSchedulerError: () => undefined,
			createBridge: () => bridge,
			createSupervisor: () => supervisor,
		});

		await runtime.start();
		textHandler?.("host", {
			roomId: "!room:bloom",
			eventId: "$evt1",
			senderUserId: "@alex:bloom",
			body: "hello",
			timestamp: 1_000,
		});

		expect(supervisor.handleEnvelope).toHaveBeenCalledWith({
			roomId: "!room:bloom",
			eventId: "$evt1",
			senderUserId: "@alex:bloom",
			body: "hello",
			senderKind: "human",
			mentions: [],
			timestamp: 1_000,
		});
	});
});
