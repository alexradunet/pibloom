/**
 * Matrix client bridge for bloom-channels.
 * Manages direct Matrix client connection, message routing, and response correlation.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import type { AgentEndEvent, ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { AutojoinRoomsMixin, MatrixClient, SimpleFsStorageProvider } from "matrix-bot-sdk";
import { extractResponseText, type MatrixCredentials, matrixCredentialsPath } from "../../lib/matrix.js";
import { createLogger } from "../../lib/shared.js";

const log = createLogger("bloom-channels");
const HOMESERVER_URL = process.env.BLOOM_MATRIX_HOMESERVER ?? "http://localhost:6167";
const STORAGE_PATH = join(os.homedir(), ".pi", "matrix-bot-state.json");

interface PendingContext {
	roomId: string;
	sender: string;
	createdAt: number;
}

function loadCredentials(): MatrixCredentials | null {
	const path = matrixCredentialsPath();
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as MatrixCredentials;
	} catch {
		return null;
	}
}

/**
 * Register a new Matrix account via the UIA (User-Interactive Authentication) flow.
 * Uses a registration token to authorize the account creation.
 *
 * @param homeserver - Base URL of the Matrix homeserver
 * @param username - Desired localpart (no @domain)
 * @param password - Account password
 * @param registrationToken - Token permitting registration on this homeserver
 */
export async function registerMatrixAccount(
	homeserver: string,
	username: string,
	password: string,
	registrationToken: string,
): Promise<{ ok: true; userId: string; accessToken: string } | { ok: false; error: string }> {
	// UIA flow: POST register -> 401 with session -> POST with token auth
	const url = `${homeserver}/_matrix/client/v3/register`;
	const body = { username, password, auth: {}, inhibit_login: false };

	const step1 = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

	if (step1.ok) {
		const data = (await step1.json()) as { user_id: string; access_token: string };
		return { ok: true, userId: data.user_id, accessToken: data.access_token };
	}

	if (step1.status !== 401) {
		return parseRegistrationError(await step1.json(), step1.status);
	}

	const step1Body = (await step1.json()) as { session?: string };
	const session = step1Body.session;
	if (!session) return { ok: false, error: "No session ID in 401 response" };

	return registerStep2(url, username, password, registrationToken, session);
}

async function registerStep2(
	url: string,
	username: string,
	password: string,
	registrationToken: string,
	session: string,
): Promise<{ ok: true; userId: string; accessToken: string } | { ok: false; error: string }> {
	const step2Body = {
		username,
		password,
		inhibit_login: false,
		auth: { type: "m.login.registration_token", token: registrationToken, session },
	};

	const step2 = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(step2Body),
	});

	if (step2.ok) {
		const data = (await step2.json()) as { user_id: string; access_token: string };
		return { ok: true, userId: data.user_id, accessToken: data.access_token };
	}

	if (step2.status === 401) return { ok: false, error: "Invalid registration token" };
	return parseRegistrationError(await step2.json(), step2.status);
}

function parseRegistrationError(err: unknown, status: number): { ok: false; error: string } {
	const e = err as { errcode?: string; error?: string };
	if (e.errcode === "M_USER_IN_USE") return { ok: false, error: `Username is already taken.` };
	return { ok: false, error: e.error ?? `Registration failed (${status})` };
}

/**
 * Build a tagged prompt string for a Matrix message.
 * Tags with `[msgId:UUID]` for response correlation.
 */
function buildPrompt(messageId: string, sender: string, body: string): string {
	return `[msgId:${messageId}] [matrix: ${sender}] ${body}`;
}

/**
 * Extract the msgId correlation tag from a user message, if present.
 */
function extractMsgId(messages: readonly unknown[]): string | undefined {
	const userMessages = messages.filter(
		(m) => "role" in (m as object) && (m as Record<string, unknown>).role === "user",
	);
	for (const um of userMessages) {
		const content = (um as { role: "user"; content: unknown }).content;
		const text = typeof content === "string" ? content : "";
		const match = text.match(/\[msgId:([^\]]+)\]/);
		if (match) return match[1];
	}
	return undefined;
}

/**
 * Create the Matrix bridge factory, wiring Matrix room messages to Pi agent turns.
 *
 * Inbound Matrix messages are tagged with `[msgId:UUID]` and forwarded to Pi via
 * `pi.sendUserMessage()`. When the agent finishes, `handleAgentEnd` extracts the
 * response text and sends it back to the originating Matrix room.
 *
 * @param pi - The Pi extension API instance
 */
export function createMatrixBridge(pi: ExtensionAPI) {
	let client: MatrixClient | null = null;
	const pendingContexts = new Map<string, PendingContext>();

	async function handleRoomMessage(
		matrixClient: MatrixClient,
		ctx: ExtensionContext,
		roomId: string,
		event: Record<string, unknown>,
	): Promise<void> {
		const sender = event.sender as string | undefined;
		if (!sender) return;

		// Ignore our own messages
		const userId = await matrixClient.getUserId();
		if (sender === userId) return;

		const content = event.content as Record<string, unknown> | undefined;
		if (!content) return;

		// Only handle text messages (m.text)
		if ((content.msgtype as string | undefined) !== "m.text") return;

		const body = content.body as string | undefined;
		if (!body) return;

		const eventId = (event.event_id as string | undefined) ?? randomUUID();
		const timestamp = (event.origin_server_ts as number | undefined) ?? Date.now();
		const messageId = randomUUID();

		pendingContexts.set(messageId, { roomId, sender, createdAt: Date.now() });

		const prompt = buildPrompt(messageId, sender, body);

		log.info("received Matrix message", { roomId, sender, eventId, timestamp });

		if (ctx.isIdle()) {
			pi.sendUserMessage(prompt);
		} else {
			pi.sendUserMessage(prompt, { deliverAs: "followUp" });
		}
	}

	function setupRoomListener(matrixClient: MatrixClient, ctx: ExtensionContext): void {
		matrixClient.on("room.message", (roomId: string, event: Record<string, unknown>) => {
			void handleRoomMessage(matrixClient, ctx, roomId, event);
		});
	}

	async function handleSessionStart(_event: unknown, ctx: ExtensionContext) {
		const creds = loadCredentials();
		if (!creds) {
			log.warn("no Matrix credentials found, bridge disabled", { path: matrixCredentialsPath() });
			return;
		}

		const homeserver = creds.homeserver ?? HOMESERVER_URL;

		// Ensure storage directory exists
		mkdirSync(dirname(STORAGE_PATH), { recursive: true });

		const storage = new SimpleFsStorageProvider(STORAGE_PATH);
		client = new MatrixClient(homeserver, creds.botAccessToken, storage);

		// Automatically join any rooms we're invited to
		AutojoinRoomsMixin.setupOnClient(client);

		setupRoomListener(client, ctx);

		try {
			await client.start();
			const userId = await client.getUserId();
			log.info("Matrix client started", { userId, homeserver });

			if (ctx.hasUI) {
				ctx.ui.setStatus("bloom-channels", `Matrix: ${userId}`);
			}
		} catch (err) {
			log.error("failed to start Matrix client", { error: String(err) });
			client = null;
		}
	}

	async function handleAgentEnd(event: AgentEndEvent, ctx: ExtensionContext) {
		if (pendingContexts.size === 0 || !client) return;

		// Find the message ID from the user prompt that triggered this agent turn
		const matchedId = extractMsgId(event.messages);

		// Fall back to most recent pending context if no ID match
		const contextId = matchedId ?? [...pendingContexts.keys()].pop();
		if (!contextId) return;

		const pendingCtx = pendingContexts.get(contextId);
		if (!pendingCtx) return;
		pendingContexts.delete(contextId);

		const responseText = extractResponseText(event.messages);
		if (!responseText) return;

		try {
			await client.sendText(pendingCtx.roomId, responseText);
			log.info("sent Matrix response", { roomId: pendingCtx.roomId, recipient: pendingCtx.sender });
		} catch (err) {
			log.error("failed to send Matrix response", { roomId: pendingCtx.roomId, error: String(err) });
		}

		if (ctx.hasUI) {
			ctx.ui.setStatus("bloom-channels", `Matrix: replied to ${pendingCtx.sender}`);
		}
	}

	async function handleSessionShutdown(_event: unknown, _ctx: ExtensionContext) {
		pendingContexts.clear();
		if (client) {
			try {
				client.stop();
				log.info("Matrix client stopped");
			} catch (err) {
				log.error("error stopping Matrix client", { error: String(err) });
			}
			client = null;
		}
	}

	async function sendToRoom(roomId: string, text: string, ctx: ExtensionContext): Promise<void> {
		if (!client) {
			if (ctx.hasUI) ctx.ui.notify("Matrix not connected", "warning");
			log.warn("matrix command called but client is not running");
			return;
		}
		await client.sendText(roomId, text);
		if (ctx.hasUI) ctx.ui.notify(`Sent to ${roomId}`, "info");
	}

	async function handleMatrixCommand(args: string, ctx: ExtensionContext) {
		if (!client) {
			if (ctx.hasUI) ctx.ui.notify("Matrix not connected", "warning");
			log.warn("matrix command called but client is not running");
			return;
		}

		// Use the most recently active room from pending contexts
		const lastPending = [...pendingContexts.values()].pop();
		if (lastPending) {
			await sendToRoom(lastPending.roomId, args, ctx);
			return;
		}

		// No active room context; fall back to first joined room
		const rooms = await client.getJoinedRooms();
		if (rooms.length === 0) {
			if (ctx.hasUI) ctx.ui.notify("No joined Matrix rooms", "warning");
			return;
		}
		await sendToRoom(rooms[0], args, ctx);
	}

	return {
		handleSessionStart,
		handleAgentEnd,
		handleSessionShutdown,
		handleMatrixCommand,
	};
}
