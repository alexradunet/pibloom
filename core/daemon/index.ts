import { readFileSync } from "node:fs";
/**
 * Pi Daemon — Matrix room agent supervisor.
 *
 * Always runs through the multi-agent supervisor.
 * When no valid overlays exist, a default host agent is synthesized from the primary Pi account.
 */
import os from "node:os";
import { join } from "node:path";
import { getDaemonStateDir, getPiDir } from "../lib/filesystem.js";
import {
	type MatrixAgentCredentials,
	type MatrixCredentials,
	matrixAgentCredentialsPath,
	matrixCredentialsPath,
} from "../lib/matrix.js";
import { createLogger } from "../lib/shared.js";
import { type AgentDefinition, loadAgentDefinitionsResult } from "./agent-registry.js";
import { loadDaemonConfig } from "./config.js";
import { startWithRetry } from "./lifecycle.js";
import { createMultiAgentRuntime } from "./multi-agent-runtime.js";
import { loadSchedulerState, saveSchedulerState } from "./proactive.js";

const log = createLogger("nixpi-daemon");

const config = loadDaemonConfig();
const ROOM_SESSION_BASE = join(getPiDir(), "sessions", "nixpi-rooms");
const SCHEDULER_STATE_PATH = join(getDaemonStateDir(), "scheduler-state.json");

async function main(): Promise<void> {
	log.info("starting nixpi-daemon", { idleTimeoutMs: config.idleTimeoutMs });

	const credentials = loadPrimaryMatrixCredentials();
	const { agents: configuredAgents, errors } = loadAgentDefinitionsResult();
	for (const error of errors) {
		log.warn("skipping invalid agent definition", { error });
	}
	const agents = configuredAgents.length > 0 ? configuredAgents : [createDefaultAgent(credentials)];

	if (configuredAgents.length === 0) {
		log.info("no valid multi-agent definitions found, using default host agent", {
			invalidDefinitions: errors.length,
		});
		await runDaemon(agents, (agentId) => {
			if (agentId !== "host") {
				throw new Error(`No Matrix credentials at synthetic agent ${agentId}`);
			}
			return {
				homeserver: credentials.homeserver,
				userId: credentials.botUserId,
				accessToken: credentials.botAccessToken,
				password: credentials.botPassword,
				username: credentials.botUserId.slice(1, credentials.botUserId.indexOf(":")),
			};
		});
	} else {
		log.info("multi-agent definitions found, starting supervisor", {
			agents: agents.map((agent) => agent.id),
		});
		await runDaemon(agents, loadAgentMatrixCredentials);
	}
}

async function runDaemon(
	agents: readonly AgentDefinition[],
	loadAgentCredentials: (agentId: string) => MatrixAgentCredentials,
): Promise<void> {
	const runtime = createMultiAgentRuntime({
		agents,
		sessionBaseDir: ROOM_SESSION_BASE,
		idleTimeoutMs: config.idleTimeoutMs,
		loadAgentCredentials,
		loadSchedulerState: () => loadSchedulerState(SCHEDULER_STATE_PATH),
		saveSchedulerState: (state) => {
			try {
				saveSchedulerState(SCHEDULER_STATE_PATH, state);
			} catch (error) {
				log.warn("failed to persist scheduler state", { error: String(error) });
			}
		},
		onSchedulerError: (job, error) => {
			log.warn("proactive job failed", {
				jobId: job.jobId,
				agentId: job.agentId,
				roomId: job.roomId,
				kind: job.kind,
				error: String(error),
			});
		},
	});
	async function shutdown(signal: string): Promise<void> {
		log.info("shutting down", { signal, mode: "unified" });
		await runtime.stop();
		await new Promise((r) => setTimeout(r, 100));
		process.exit(0);
	}

	process.on("SIGTERM", () => void shutdown("SIGTERM"));
	process.on("SIGINT", () => void shutdown("SIGINT"));

	await startWithRetry(
		async () => {
			await runtime.start();
			log.info("nixpi-daemon running", {
				mode: "unified",
				agents: agents.map((agent) => agent.id),
				proactiveJobs: runtime.proactiveJobs,
			});
		},
		async () => {
			await runtime.stop();
		},
		{
			initialDelayMs: config.initialRetryDelayMs,
			maxDelayMs: config.maxRetryDelayMs,
			onRetry: (error, retryDelay) => {
				log.error("failed to start daemon transport, retrying", {
					error: String(error),
					retryMs: retryDelay,
				});
			},
		},
	);
}

function loadPrimaryMatrixCredentials(): MatrixCredentials {
	const path = matrixCredentialsPath();
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as MatrixCredentials;
	} catch {
		throw new Error(`No credentials at ${path}`);
	}
}

function loadAgentMatrixCredentials(agentId: string): MatrixAgentCredentials {
	const path = matrixAgentCredentialsPath(agentId);
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as MatrixAgentCredentials;
	} catch {
		throw new Error(`No Matrix credentials at ${path}`);
	}
}

function createDefaultAgent(credentials: MatrixCredentials): AgentDefinition {
	const username = credentials.botUserId.slice(1, credentials.botUserId.indexOf(":"));
	return {
		id: "host",
		name: "Pi",
		description: "Default host agent",
		instructionsPath: "<builtin>",
		instructionsBody: "You are Pi. Respond helpfully to Matrix room messages.",
		matrix: {
			username,
			userId: credentials.botUserId,
			autojoin: false,
		},
		respond: {
			mode: "host",
			allowAgentMentions: true,
			maxPublicTurnsPerRoot: 2,
			cooldownMs: 1500,
		},
	};
}

main().catch((err) => {
	log.error("fatal error", { error: String(err) });
	process.exit(1);
});
