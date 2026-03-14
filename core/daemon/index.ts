import { readFileSync } from "node:fs";
/**
 * Pi Daemon — Matrix room agent supervisor.
 *
 * Runs in two modes:
 * - single-agent fallback: current `@pi:bloom` room daemon
 * - multi-agent mode: one Matrix client per configured agent, one Pi session per `(room, agent)`
 */
import os from "node:os";
import { join } from "node:path";
import {
	type MatrixAgentCredentials,
	type MatrixCredentials,
	matrixAgentCredentialsPath,
	matrixCredentialsPath,
} from "../lib/matrix.js";
import { sanitizeRoomAlias } from "../lib/room-alias.js";
import { createLogger } from "../lib/shared.js";
import { type AgentDefinition, loadAgentDefinitionsResult } from "./agent-registry.js";
import { AgentSupervisor } from "./agent-supervisor.js";
import { startWithRetry } from "./lifecycle.js";
import { createMultiAgentRuntime } from "./multi-agent-runtime.js";
import type { MatrixBridge } from "./contracts/matrix.js";
import type { MatrixTextEvent } from "./contracts/matrix.js";
import type { SessionEvent } from "./contracts/session.js";
import type { BloomSessionLike } from "./contracts/session.js";
import { MatrixJsSdkBridge } from "./runtime/matrix-js-sdk-bridge.js";
import { PiRoomSession, type PiRoomSessionOptions } from "./runtime/pi-room-session.js";
import { loadSchedulerState, saveSchedulerState } from "./proactive.js";

const log = createLogger("pi-daemon");

const IDLE_TIMEOUT_MS = Number.parseInt(process.env.BLOOM_DAEMON_IDLE_TIMEOUT_MS ?? "", 10) || 15 * 60 * 1000;
const SESSION_BASE = join(os.homedir(), ".pi", "agent", "sessions", "bloom-rooms");
const STORAGE_PATH = join(os.homedir(), ".pi", "pi-daemon", "matrix-state.json");
const SCHEDULER_STATE_PATH = join(os.homedir(), ".pi", "pi-daemon", "scheduler-state.json");
const MATRIX_AGENT_STORAGE_DIR = join(os.homedir(), ".pi", "pi-daemon", "matrix-agents");
const DEFAULT_MATRIX_IDENTITY = "default";
const TYPING_TIMEOUT_MS = 30_000;
const TYPING_REFRESH_MS = 20_000;

const ROOM_FAILURE_WINDOW_MS = 60_000;
const ROOM_FAILURE_THRESHOLD = 3;
const ROOM_QUARANTINE_MS = 5 * 60_000;

interface RoomFailureState {
	count: number;
	windowStart: number;
	quarantinedUntil: number;
}

async function main(): Promise<void> {
	log.info("starting pi-daemon", { idleTimeoutMs: IDLE_TIMEOUT_MS });

	const { agents, errors } = loadAgentDefinitionsResult();
	for (const error of errors) {
		log.warn("skipping invalid agent definition", { error });
	}
	if (agents.length === 0) {
		log.info("no valid multi-agent definitions found, using single-agent fallback", {
			invalidDefinitions: errors.length,
		});
		await runSingleAgentDaemon();
		return;
	}

	log.info("multi-agent definitions found, starting supervisor", {
		agents: agents.map((agent) => agent.id),
	});
	await runMultiAgentDaemon(agents);
}

async function runMultiAgentDaemon(agents: readonly AgentDefinition[]): Promise<void> {
	const runtime = createMultiAgentRuntime({
		agents,
		sessionBaseDir: SESSION_BASE,
		idleTimeoutMs: IDLE_TIMEOUT_MS,
		matrixAgentStorageDir: MATRIX_AGENT_STORAGE_DIR,
		loadAgentCredentials: loadAgentMatrixCredentials,
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
		log.info("shutting down", { signal, mode: "multi-agent" });
		await runtime.stop();
		await new Promise((r) => setTimeout(r, 100));
		process.exit(0);
	}

	process.on("SIGTERM", () => void shutdown("SIGTERM"));
	process.on("SIGINT", () => void shutdown("SIGINT"));

	await startWithRetry(
		async () => {
			await runtime.start();
			log.info("pi-daemon running", {
				mode: "multi-agent",
				agents: agents.map((agent) => agent.id),
				proactiveJobs: runtime.proactiveJobs,
			});
		},
		async () => {
			await runtime.stop();
		},
		{
			onRetry: (error, retryDelay) => {
				log.error("failed to start daemon transport, retrying", {
					error: String(error),
					retryMs: retryDelay,
				});
			},
		},
	);
}

async function runSingleAgentDaemon(): Promise<void> {
	const rooms = new Map<string, BloomSessionLike>();
	const preambleSent = new Set<string>();
	const roomFailures = new Map<string, RoomFailureState>();
	const credentials = loadPrimaryMatrixCredentials();
	const bridge: MatrixBridge = new MatrixJsSdkBridge({
		identities: [
			{
				id: DEFAULT_MATRIX_IDENTITY,
				userId: credentials.botUserId,
				homeserver: credentials.homeserver,
				accessToken: credentials.botAccessToken,
				storagePath: STORAGE_PATH,
				autojoin: true,
			},
		],
	});
	bridge.onTextEvent((_identityId, event) => {
		void handleMessage(event);
	});
	const typingIntervals = new Map<string, ReturnType<typeof setInterval>>();

	const createSession = (options: PiRoomSessionOptions): BloomSessionLike => new PiRoomSession(options);

	function startTyping(roomId: string): void {
		if (typingIntervals.has(roomId)) return;

		void bridge.setTyping(DEFAULT_MATRIX_IDENTITY, roomId, true, TYPING_TIMEOUT_MS).catch((err) => {
			log.warn("failed to set typing=true", { roomId, error: String(err) });
		});

		const interval = setInterval(() => {
			void bridge.setTyping(DEFAULT_MATRIX_IDENTITY, roomId, true, TYPING_TIMEOUT_MS).catch((err) => {
				log.warn("failed to refresh typing state", { roomId, error: String(err) });
			});
		}, TYPING_REFRESH_MS);
		interval.unref();
		typingIntervals.set(roomId, interval);
	}

	function stopTyping(roomId: string): void {
		const interval = typingIntervals.get(roomId);
		if (!interval) return;

		clearInterval(interval);
		typingIntervals.delete(roomId);

		void bridge.setTyping(DEFAULT_MATRIX_IDENTITY, roomId, false).catch((err) => {
			log.warn("failed to set typing=false", { roomId, error: String(err) });
		});
	}

	function handleRoomEvent(roomId: string, event: SessionEvent): void {
		if (event.type === "agent_start") {
			startTyping(roomId);
		} else if (event.type === "agent_end") {
			stopTyping(roomId);
		}
	}

	async function getOrSpawn(roomId: string, alias: string): Promise<BloomSessionLike> {
		const failureState = roomFailures.get(roomId);
		if (failureState && failureState.quarantinedUntil > Date.now()) {
			throw new Error("room temporarily quarantined after repeated failures");
		}

		const existing = rooms.get(roomId);
		if (existing?.alive) return existing;
		if (existing) rooms.delete(roomId);

		const sanitized = sanitizeRoomAlias(alias);
		const sessionDir = join(SESSION_BASE, sanitized);

		const rp = createSession({
			roomId,
			roomAlias: alias,
			sanitizedAlias: sanitized,
			sessionDir,
			idleTimeoutMs: IDLE_TIMEOUT_MS,
			onAgentEnd: async (text) => {
				try {
					await bridge.sendText(DEFAULT_MATRIX_IDENTITY, roomId, text);
				} catch (err) {
					log.error("failed to send response to Matrix", { roomId, error: String(err) });
				}
			},
			onEvent: (event) => {
				handleRoomEvent(roomId, event);
			},
			onExit: (_code) => {
				rooms.delete(roomId);
				preambleSent.delete(roomId);
				stopTyping(roomId);
				if (_code !== 0 && _code !== null) {
					handleProcessError(roomId, _code, roomFailures);
				}
			},
		});

		await rp.spawn();
		rooms.set(roomId, rp);
		return rp;
	}

	async function handleMessage(message: MatrixTextEvent): Promise<void> {
		try {
			const alias = await bridge.getRoomAlias(DEFAULT_MATRIX_IDENTITY, message.roomId);
			const rp = await getOrSpawn(message.roomId, alias);

			log.info("routing message", { roomId: message.roomId, sender: message.senderUserId, mode: "single-agent" });

			const prefix = `[matrix: ${message.senderUserId}] `;
			if (!preambleSent.has(message.roomId)) {
				const preamble = `[system] You are Pi in Matrix room ${alias}. Respond to messages from this room.\n\n`;
				await rp.sendMessage(preamble + prefix + message.body);
				preambleSent.add(message.roomId);
			} else {
				await rp.sendMessage(prefix + message.body);
			}
		} catch (err) {
			const errStr = String(err);
			log.error("failed to handle message", { roomId: message.roomId, error: errStr, mode: "single-agent" });
			stopTyping(message.roomId);

			try {
				await bridge.sendText(
					DEFAULT_MATRIX_IDENTITY,
					message.roomId,
					"Sorry, I hit an error processing your message. Please try again.",
				);
			} catch {
				/* best effort */
			}
		}
	}

	async function shutdown(signal: string): Promise<void> {
		log.info("shutting down", { signal, mode: "single-agent" });
		for (const roomId of [...typingIntervals.keys()]) {
			stopTyping(roomId);
		}
		bridge.stop();
		for (const rp of rooms.values()) {
			rp.dispose();
		}
		rooms.clear();
		await new Promise((r) => setTimeout(r, 5000));
		process.exit(0);
	}

	process.on("SIGTERM", () => void shutdown("SIGTERM"));
	process.on("SIGINT", () => void shutdown("SIGINT"));

	await startWithRetry(async () => {
		await bridge.start();
		log.info("pi-daemon running", { mode: "single-agent" });
	});
}

function handleProcessError(codeRoomId: string, code: number, failures: Map<string, RoomFailureState>): void {
	const now = Date.now();
	const prev = failures.get(codeRoomId);
	const next =
		!prev || now - prev.windowStart > ROOM_FAILURE_WINDOW_MS
			? { count: 1, windowStart: now, quarantinedUntil: 0 }
			: { ...prev, count: prev.count + 1 };

	if (next.count >= ROOM_FAILURE_THRESHOLD) {
		next.quarantinedUntil = now + ROOM_QUARANTINE_MS;
		log.error("room session quarantined after repeated failures", {
			roomId: codeRoomId,
			code,
			failures: next.count,
			quarantinedUntil: new Date(next.quarantinedUntil).toISOString(),
		});
	} else {
		log.warn("room session failed", { roomId: codeRoomId, code, failures: next.count });
	}

	failures.set(codeRoomId, next);
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

main().catch((err) => {
	log.error("fatal error", { error: String(err) });
	process.exit(1);
});
