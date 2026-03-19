import { describe, expect, it } from "vitest";

import type { AgentDefinition } from "../../core/daemon/agent-registry.js";
import { createRoomState } from "../../core/daemon/room-state.js";
import { classifySender, extractMentions, routeRoomEnvelope } from "../../core/daemon/router.js";

function makeAgent(id: string, userId: string, mode: AgentDefinition["respond"]["mode"]): AgentDefinition {
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

const host = makeAgent("host", "@pi:garden", "host");
const planner = makeAgent("planner", "@planner:garden", "mentioned");
const critic = makeAgent("critic", "@critic:garden", "mentioned");
const silent = makeAgent("silent", "@silent:garden", "silent");
const agents = [host, planner, critic, silent];

describe("extractMentions", () => {
	it("finds explicit Matrix user id mentions", () => {
		expect(extractMentions("hey @planner:garden and @critic:garden", agents)).toEqual([
			"@planner:garden",
			"@critic:garden",
		]);
	});

	it("preserves mention order from the message body instead of agent registry order", () => {
		const registryOrderedAgents = [critic, host, planner, silent];
		expect(extractMentions("@planner:garden first, then @critic:garden", registryOrderedAgents)).toEqual([
			"@planner:garden",
			"@critic:garden",
		]);
	});

	it("does not return duplicate mentions", () => {
		expect(extractMentions("@planner:garden @planner:garden", agents)).toEqual(["@planner:garden"]);
	});
});

describe("classifySender", () => {
	it("classifies self messages", () => {
		expect(classifySender("@pi:garden", "@pi:garden", agents)).toEqual({ senderKind: "self" });
	});

	it("classifies known agents", () => {
		expect(classifySender("@planner:garden", "@pi:garden", agents)).toEqual({
			senderKind: "agent",
			senderAgentId: "planner",
		});
	});

	it("classifies non-agent users as human", () => {
		expect(classifySender("@alex:garden", "@pi:garden", agents)).toEqual({ senderKind: "human" });
	});
});

describe("routeRoomEnvelope", () => {
	it("routes human messages without mentions to the host agent", () => {
		const state = createRoomState();
		const result = routeRoomEnvelope(
			{
				roomId: "!room:garden",
				eventId: "$evt1",
				senderUserId: "@alex:garden",
				body: "hello there",
				senderKind: "human",
				mentions: [],
				timestamp: 1_000,
			},
			agents,
			state,
		);

		expect(result).toEqual({ targets: ["host"], reason: "host-default" });
	});

	it("routes explicit human mentions only to the mentioned agents", () => {
		const state = createRoomState();
		const result = routeRoomEnvelope(
			{
				roomId: "!room:garden",
				eventId: "$evt2",
				senderUserId: "@alex:garden",
				body: "@planner:garden help me",
				senderKind: "human",
				mentions: ["@planner:garden"],
				timestamp: 1_000,
			},
			agents,
			state,
		);

		expect(result).toEqual({ targets: ["planner"], reason: "explicit-mention" });
	});

	it("routes multiple explicit mentions to the first eligible agent in mention order", () => {
		const state = createRoomState();
		const result = routeRoomEnvelope(
			{
				roomId: "!room:garden",
				eventId: "$evt3",
				senderUserId: "@alex:garden",
				body: "@planner:garden and @critic:garden weigh in",
				senderKind: "human",
				mentions: ["@planner:garden", "@critic:garden"],
				timestamp: 1_000,
			},
			agents,
			state,
		);

		expect(result).toEqual({ targets: ["planner"], reason: "explicit-mention" });
	});

	it("never auto-targets silent agents", () => {
		const state = createRoomState();
		const result = routeRoomEnvelope(
			{
				roomId: "!room:garden",
				eventId: "$evt4",
				senderUserId: "@alex:garden",
				body: "@silent:garden speak",
				senderKind: "human",
				mentions: ["@silent:garden"],
				timestamp: 1_000,
			},
			agents,
			state,
		);

		expect(result).toEqual({ targets: [], reason: "ignored-policy" });
	});

	it("requires explicit mention for agent-to-agent routing", () => {
		const state = createRoomState();
		const result = routeRoomEnvelope(
			{
				roomId: "!room:garden",
				eventId: "$evt5",
				senderUserId: "@planner:garden",
				body: "I have thoughts",
				senderKind: "agent",
				senderAgentId: "planner",
				mentions: [],
				timestamp: 1_000,
			},
			agents,
			state,
		);

		expect(result).toEqual({ targets: [], reason: "ignored-policy" });
	});

	it("allows agent-to-agent routing when a peer agent is explicitly mentioned", () => {
		const state = createRoomState();
		const result = routeRoomEnvelope(
			{
				roomId: "!room:garden",
				eventId: "$evt6",
				senderUserId: "@planner:garden",
				body: "@critic:garden please review",
				senderKind: "agent",
				senderAgentId: "planner",
				mentions: ["@critic:garden"],
				timestamp: 1_000,
			},
			agents,
			state,
		);

		expect(result).toEqual({ targets: ["critic"], reason: "agent-mention" });
	});

	it("rejects duplicate event ids", () => {
		const state = createRoomState();
		const envelope = {
			roomId: "!room:garden",
			eventId: "$evt7",
			senderUserId: "@alex:garden",
			body: "hello",
			senderKind: "human" as const,
			mentions: [],
			timestamp: 1_000,
		};

		expect(routeRoomEnvelope(envelope, agents, state)).toEqual({
			targets: ["host"],
			reason: "host-default",
		});
		expect(routeRoomEnvelope(envelope, agents, state)).toEqual({
			targets: [],
			reason: "ignored-duplicate",
		});
	});

	it("blocks rapid repeat replies during cooldown", () => {
		const state = createRoomState();
		expect(
			routeRoomEnvelope(
				{
					roomId: "!room:garden",
					eventId: "$evt8",
					senderUserId: "@alex:garden",
					body: "hello",
					senderKind: "human",
					mentions: [],
					timestamp: 10_000,
				},
				agents,
				state,
			),
		).toEqual({ targets: ["host"], reason: "host-default" });

		expect(
			routeRoomEnvelope(
				{
					roomId: "!room:garden",
					eventId: "$evt9",
					senderUserId: "@alex:garden",
					body: "hello again",
					senderKind: "human",
					mentions: [],
					timestamp: 10_500,
				},
				agents,
				state,
			),
		).toEqual({ targets: [], reason: "ignored-cooldown" });
	});

	it("blocks replies when the per-root budget is exhausted", () => {
		const state = createRoomState();
		const baseEnvelope = {
			roomId: "!room:garden",
			senderUserId: "@alex:garden",
			body: "@planner:garden help",
			senderKind: "human" as const,
			mentions: ["@planner:garden"],
		};

		expect(
			routeRoomEnvelope({ ...baseEnvelope, eventId: "$evt10", timestamp: 20_000 }, agents, state, {
				rootEventId: "$root1",
			}),
		).toEqual({ targets: ["planner"], reason: "explicit-mention" });
		expect(
			routeRoomEnvelope({ ...baseEnvelope, eventId: "$evt11", timestamp: 22_000 }, agents, state, {
				rootEventId: "$root1",
			}),
		).toEqual({ targets: ["planner"], reason: "explicit-mention" });
		expect(
			routeRoomEnvelope({ ...baseEnvelope, eventId: "$evt12", timestamp: 24_000 }, agents, state, {
				rootEventId: "$root1",
			}),
		).toEqual({ targets: [], reason: "ignored-budget" });
	});

	it("ignores self messages", () => {
		const state = createRoomState();
		const result = routeRoomEnvelope(
			{
				roomId: "!room:garden",
				eventId: "$evt-self",
				senderUserId: "@pi:garden",
				body: "I am the bot",
				senderKind: "self",
				mentions: [],
				timestamp: 1_000,
			},
			agents,
			state,
		);

		expect(result).toEqual({ targets: [], reason: "ignored-self" });
	});

	it("blocks agent-to-self mentions", () => {
		const state = createRoomState();
		const result = routeRoomEnvelope(
			{
				roomId: "!room:garden",
				eventId: "$evt13",
				senderUserId: "@planner:garden",
				body: "@planner:garden talk to myself",
				senderKind: "agent",
				senderAgentId: "planner",
				mentions: ["@planner:garden"],
				timestamp: 1_000,
			},
			agents,
			state,
		);

		// Should not route to self
		expect(result.targets).not.toContain("planner");
	});

	it("blocks unknown sender kinds", () => {
		const state = createRoomState();
		const result = routeRoomEnvelope(
			{
				roomId: "!room:garden",
				eventId: "$evt14",
				senderUserId: "@unknown:garden",
				body: "hello",
				senderKind: "unknown" as const,
				mentions: [],
				timestamp: 1_000,
			},
			agents,
			state,
		);

		expect(result).toEqual({ targets: [], reason: "ignored-policy" });
	});

	it("allows routing after cooldown expires", () => {
		const state = createRoomState();
		const baseEnvelope = {
			roomId: "!room:garden",
			senderUserId: "@alex:garden",
			body: "hello",
			senderKind: "human" as const,
			mentions: [] as string[],
		};

		// First message routes
		expect(routeRoomEnvelope({ ...baseEnvelope, eventId: "$evt15", timestamp: 30_000 }, agents, state)).toEqual({
			targets: ["host"],
			reason: "host-default",
		});

		// Within cooldown, blocked
		expect(routeRoomEnvelope({ ...baseEnvelope, eventId: "$evt16", timestamp: 30_500 }, agents, state)).toEqual({
			targets: [],
			reason: "ignored-cooldown",
		});

		// After cooldown (1500ms), routes again
		expect(routeRoomEnvelope({ ...baseEnvelope, eventId: "$evt17", timestamp: 31_600 }, agents, state)).toEqual({
			targets: ["host"],
			reason: "host-default",
		});
	});

	it("respects custom total reply budget", () => {
		const state = createRoomState();
		const baseEnvelope = {
			roomId: "!room:garden",
			senderUserId: "@alex:garden",
			body: "hello",
			senderKind: "human" as const,
			mentions: [] as string[],
		};

		// With budget of 1 and same root event
		expect(
			routeRoomEnvelope({ ...baseEnvelope, eventId: "$evt18", timestamp: 40_000 }, agents, state, {
				rootEventId: "$root-budget",
				totalReplyBudget: 1,
			}),
		).toEqual({ targets: ["host"], reason: "host-default" });

		// Second message blocked by budget (same root)
		expect(
			routeRoomEnvelope({ ...baseEnvelope, eventId: "$evt19", timestamp: 42_000 }, agents, state, {
				rootEventId: "$root-budget",
				totalReplyBudget: 1,
			}),
		).toEqual({ targets: [], reason: "ignored-budget" });
	});

	it("blocks agent-to-agent routing when allowAgentMentions is false", () => {
		const restrictedAgent: AgentDefinition = {
			...critic,
			respond: { ...critic.respond, allowAgentMentions: false },
		};
		const restrictedAgents = [host, planner, restrictedAgent, silent];
		const state = createRoomState();

		const result = routeRoomEnvelope(
			{
				roomId: "!room:garden",
				eventId: "$evt20",
				senderUserId: "@planner:garden",
				body: "@critic:garden please review",
				senderKind: "agent",
				senderAgentId: "planner",
				mentions: ["@critic:garden"],
				timestamp: 1_000,
			},
			restrictedAgents,
			state,
		);

		expect(result).toEqual({ targets: [], reason: "ignored-policy" });
	});

	it("ignores messages with no host agent when there are no mentions", () => {
		const noHostAgents = [planner, critic, silent];
		const state = createRoomState();

		const result = routeRoomEnvelope(
			{
				roomId: "!room:garden",
				eventId: "$evt21",
				senderUserId: "@alex:garden",
				body: "hello",
				senderKind: "human",
				mentions: [],
				timestamp: 1_000,
			},
			noHostAgents,
			state,
		);

		expect(result).toEqual({ targets: [], reason: "ignored-policy" });
	});

	it("handles empty agents list", () => {
		const state = createRoomState();

		const result = routeRoomEnvelope(
			{
				roomId: "!room:garden",
				eventId: "$evt22",
				senderUserId: "@alex:garden",
				body: "hello",
				senderKind: "human",
				mentions: [],
				timestamp: 1_000,
			},
			[],
			state,
		);

		expect(result).toEqual({ targets: [], reason: "ignored-policy" });
	});
});
