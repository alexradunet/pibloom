import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AgentDefinition } from "../../core/daemon/agent-registry.js";
import { collectScheduledJobs, loadSchedulerState, saveSchedulerState } from "../../core/daemon/proactive.js";

function makeAgent(id: string): AgentDefinition {
	return {
		id,
		name: id[0]?.toUpperCase() + id.slice(1),
		instructionsPath: `/tmp/${id}/AGENTS.md`,
		instructionsBody: `# ${id}`,
		matrix: {
			username: id,
			userId: `@${id}:garden`,
			autojoin: true,
		},
		respond: {
			mode: "mentioned",
			allowAgentMentions: true,
			maxPublicTurnsPerRoot: 2,
			cooldownMs: 1500,
		},
	};
}

describe("proactive daemon helpers", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("collects scheduled jobs across agent overlays", () => {
		const host = makeAgent("host");
		host.proactive = {
			jobs: [
				{
					id: "daily-heartbeat",
					kind: "heartbeat",
					room: "!ops:garden",
					intervalMinutes: 1440,
					prompt: "Heartbeat",
					quietIfNoop: true,
					noOpToken: "HEARTBEAT_OK",
				},
			],
		};
		const planner = makeAgent("planner");
		planner.proactive = {
			jobs: [
				{
					id: "morning-check",
					kind: "cron",
					room: "!planning:garden",
					cron: "0 9 * * *",
					prompt: "Morning check",
				},
			],
		};

		expect(collectScheduledJobs([host, planner])).toEqual([
			{
				id: "daily-heartbeat",
				agentId: "host",
				roomId: "!ops:garden",
				kind: "heartbeat",
				intervalMinutes: 1440,
				prompt: "Heartbeat",
				quietIfNoop: true,
				noOpToken: "HEARTBEAT_OK",
			},
			{
				id: "morning-check",
				agentId: "planner",
				roomId: "!planning:garden",
				kind: "cron",
				cron: "0 9 * * *",
				prompt: "Morning check",
			},
		]);
	});

	it("loads empty scheduler state when the file is missing or malformed", () => {
		const dir = mkdtempSync(join(tmpdir(), "garden-proactive-"));
		tempDirs.push(dir);
		const missingPath = join(dir, "scheduler-state.json");
		expect(loadSchedulerState(missingPath)).toEqual({});

		writeFileSync(missingPath, "{not json", "utf-8");
		expect(loadSchedulerState(missingPath)).toEqual({});

		saveSchedulerState(missingPath, {
			"host::!ops:garden::daily-heartbeat": { lastRunAt: 123 },
		});
		expect(loadSchedulerState(missingPath)).toEqual({
			"host::!ops:garden::daily-heartbeat": { lastRunAt: 123 },
		});
	});

	it("writes scheduler state as formatted json", () => {
		const dir = mkdtempSync(join(tmpdir(), "garden-proactive-"));
		tempDirs.push(dir);
		const statePath = join(dir, "nested", "scheduler-state.json");

		saveSchedulerState(statePath, {
			"host::!ops:garden::daily-heartbeat": { lastRunAt: 456 },
		});

		expect(readFileSync(statePath, "utf-8")).toContain('"host::!ops:garden::daily-heartbeat"');
		expect(readFileSync(statePath, "utf-8")).toContain('"lastRunAt": 456');
	});
});
