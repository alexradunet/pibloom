/**
 * Pi Daemon — always-on Matrix room agent.
 *
 * Entry point: wires MatrixListener, SessionPool, and RoomRegistry,
 * then listens for Matrix messages and routes them to per-room AgentSessions.
 */
import os from "node:os";
import { join } from "node:path";
import type { AgentSessionEvent, ExtensionFactory } from "@mariozechner/pi-coding-agent";
import { extractResponseText, matrixCredentialsPath } from "../lib/matrix.js";
import { createLogger } from "../lib/shared.js";
import { type IncomingMessage, MatrixListener } from "./matrix-listener.js";
import { RoomRegistry } from "./room-registry.js";
import { SessionPool } from "./session-pool.js";

const log = createLogger("pi-daemon");

const MAX_SESSIONS = Number.parseInt(process.env.BLOOM_DAEMON_MAX_SESSIONS ?? "3", 10);
const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const REGISTRY_PATH = join(os.homedir(), ".pi", "pi-daemon", "rooms.json");
const SESSION_DIR = join(os.homedir(), ".pi", "agent", "sessions", "bloom-rooms");
const STORAGE_PATH = join(os.homedir(), ".pi", "pi-daemon", "matrix-state.json");

/** Build extension factories for daemon sessions. */
function buildExtensionFactories(): ExtensionFactory[] {
	const bloomRoomsFactory: ExtensionFactory = (_pi) => {
		// Room tools will be registered here in a future iteration.
		log.info("bloom-rooms extension loaded");
	};

	return [bloomRoomsFactory];
}

async function main(): Promise<void> {
	log.info("starting pi-daemon", { maxSessions: MAX_SESSIONS, idleTimeoutMs: IDLE_TIMEOUT_MS });

	const registry = new RoomRegistry(REGISTRY_PATH);
	const extensionFactories = buildExtensionFactories();

	const pool = new SessionPool({
		registry,
		maxSessions: MAX_SESSIONS,
		idleTimeoutMs: IDLE_TIMEOUT_MS,
		sessionDir: SESSION_DIR,
		extensionFactories,
	});

	const listener = new MatrixListener({
		credentialsPath: matrixCredentialsPath(),
		storagePath: STORAGE_PATH,
		onMessage: (roomId, message) => {
			void handleMessage(roomId, message);
		},
	});

	// Track API key state — stop prompting if key is bad
	let apiKeyDisabled = false;

	// Forward session events to Matrix rooms
	pool.onEvent(async (roomId, event: AgentSessionEvent) => {
		if ("type" in event && event.type === "agent_end" && "messages" in event) {
			const text = extractResponseText((event as { messages: readonly unknown[] }).messages);
			if (text) {
				try {
					await listener.sendText(roomId, text);
				} catch (err) {
					log.error("failed to send response to Matrix", { roomId, error: String(err) });
				}
			}
		}
	});

	async function handleMessage(roomId: string, message: IncomingMessage): Promise<void> {
		if (apiKeyDisabled) {
			log.warn("ignoring message — API key disabled", { roomId });
			return;
		}

		try {
			const alias = await listener.getRoomAlias(roomId);
			const session = await pool.getOrCreate(roomId, alias);

			log.info("routing message to session", { roomId, sender: message.sender });
			await session.prompt(`[matrix: ${message.sender}] ${message.body}`);
		} catch (err) {
			const errStr = String(err);
			log.error("failed to handle message", { roomId, error: errStr });

			// Detect API key errors — stop prompting and notify
			if (errStr.includes("401") || errStr.includes("invalid_api_key") || errStr.includes("authentication")) {
				apiKeyDisabled = true;
				log.error("API key error detected, disabling prompting");
				try {
					await listener.sendText(roomId, "My API key needs attention. I'll stop responding until it's fixed.");
				} catch {
					/* best effort */
				}
				return;
			}

			try {
				await listener.sendText(roomId, `Sorry, I hit an error: ${errStr}`);
			} catch {
				// Best-effort error notification
			}
		}
	}

	// Graceful shutdown
	function shutdown(signal: string): void {
		log.info("shutting down", { signal });
		listener.stop();
		pool.disposeAll();
		registry.flushSync();
		process.exit(0);
	}

	process.on("SIGTERM", () => shutdown("SIGTERM"));
	process.on("SIGINT", () => shutdown("SIGINT"));

	// Start with retry
	let retryDelay = 5000;
	const maxDelay = 300_000;

	while (true) {
		try {
			await listener.start();
			log.info("pi-daemon running");
			break;
		} catch (err) {
			log.error("failed to start Matrix listener, retrying", {
				error: String(err),
				retryMs: retryDelay,
			});
			await new Promise((r) => setTimeout(r, retryDelay));
			retryDelay = Math.min(retryDelay * 3, maxDelay);
		}
	}
}

main().catch((err) => {
	log.error("fatal error", { error: String(err) });
	process.exit(1);
});
