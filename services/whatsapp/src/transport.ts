import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createConnection, type Socket } from "node:net";
import type WAWebJS from "whatsapp-web.js";
import pkg from "whatsapp-web.js";
import { isChannelMessage, mimeToExt } from "./utils.js";

const { Client, LocalAuth } = pkg;

const AUTH_DIR = process.env.BLOOM_AUTH_DIR ?? "/data/auth";
const defaultSocketPath = `${process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 1000}`}/bloom/channels.sock`;
const CHANNELS_SOCKET = process.env.BLOOM_CHANNELS_SOCKET ?? defaultSocketPath;
const MEDIA_DIR = process.env.BLOOM_MEDIA_DIR ?? "/media/bloom";
const CHANNEL_TOKEN = process.env.BLOOM_CHANNEL_TOKEN ?? "";

const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

// TCP state
let channelSocket: Socket | null = null;
let tcpBuffer = "";
let tcpReconnectDelay = RECONNECT_BASE_MS;
let tcpReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let tcpConnecting = false;
let shuttingDown = false;
let waConnected = false;

// Track WhatsApp client
let waClient: InstanceType<typeof Client> | null = null;

function clearTcpReconnectTimer(): void {
	if (tcpReconnectTimer) {
		clearTimeout(tcpReconnectTimer);
		tcpReconnectTimer = null;
	}
}

function resetChannelSocket(): void {
	const sock = channelSocket;
	channelSocket = null;
	tcpConnecting = false;
	if (sock && !sock.destroyed) sock.destroy();
}

function scheduleTcpReconnect(): void {
	if (shuttingDown || tcpReconnectTimer) return;
	const delay = tcpReconnectDelay;
	console.log(`[tcp] disconnected. Reconnecting in ${delay}ms...`);
	tcpReconnectDelay = Math.min(tcpReconnectDelay * 2, RECONNECT_MAX_MS);
	tcpReconnectTimer = setTimeout(() => {
		tcpReconnectTimer = null;
		connectToChannels();
	}, delay);
}

// --- Health check HTTP server ---

const HEALTH_PORT = Number(process.env.BLOOM_HEALTH_PORT ?? "18801");

const healthServer = createHttpServer((req, res) => {
	if (req.url === "/health") {
		const healthy = waConnected && channelSocket?.writable === true;
		res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ wa: waConnected, channel: channelSocket?.writable === true }));
	} else {
		res.writeHead(404);
		res.end();
	}
});

healthServer.listen(HEALTH_PORT, "0.0.0.0", () => {
	console.log(`[health] listening on :${HEALTH_PORT}`);
});

// --- WhatsApp via whatsapp-web.js ---

async function startWhatsApp(): Promise<void> {
	if (shuttingDown) return;

	console.log("[wa] starting whatsapp-web.js client...");

	const client = new Client({
		authStrategy: new LocalAuth({ dataPath: AUTH_DIR }),
		puppeteer: {
			headless: false,
			args: [
				"--no-sandbox",
				"--disable-setuid-sandbox",
				"--ozone-platform=wayland",
				"--enable-features=UseOzonePlatform",
			],
		},
	});

	waClient = client;

	client.on("qr", (qr: string) => {
		console.log("[wa] QR code displayed in browser window. Scan with WhatsApp mobile app.");
		console.log(`[wa] QR data: ${qr.slice(0, 40)}...`);
	});

	client.on("ready", () => {
		console.log("[wa] connected.");
		waConnected = true;
		tcpReconnectDelay = RECONNECT_BASE_MS;
		clearTcpReconnectTimer();
		resetChannelSocket();
		connectToChannels();
	});

	client.on("disconnected", (reason: string) => {
		waConnected = false;
		clearTcpReconnectTimer();
		resetChannelSocket();
		console.log(`[wa] disconnected: ${reason}`);

		if (!shuttingDown) {
			console.log("[wa] reinitializing in 5s...");
			setTimeout(startWhatsApp, 5_000);
		}
	});

	client.on("message", async (msg: WAWebJS.Message) => {
		if (msg.fromMe) return;

		const from = msg.from;
		const timestamp = msg.timestamp;

		if (msg.hasMedia) {
			try {
				const media = await msg.downloadMedia();
				if (media) {
					await handleMediaMessage(from, timestamp, media, msg.body);
					return;
				}
			} catch (err) {
				console.error("[wa] media download error:", (err as Error).message);
			}
		}

		if (msg.body) {
			console.log(`[wa] message from ${from}: ${msg.body.slice(0, 80)}`);
			sendToChannels({
				type: "message",
				id: randomUUID(),
				channel: "whatsapp",
				from,
				text: msg.body,
				timestamp,
			});
		}
	});

	await client.initialize();
}

async function handleMediaMessage(
	from: string,
	timestamp: number,
	media: WAWebJS.MessageMedia,
	caption?: string,
): Promise<void> {
	const mimetype = media.mimetype ?? "application/octet-stream";
	const ext = mimeToExt(mimetype);
	const id = randomBytes(6).toString("hex");
	const filename = `${timestamp}-${id}.${ext}`;
	const filepath = `${MEDIA_DIR}/${filename}`;

	await mkdir(MEDIA_DIR, { recursive: true });
	const buffer = Buffer.from(media.data, "base64");
	await writeFile(filepath, buffer);
	const size = buffer.length;
	console.log(`[wa] saved media from ${from}: ${filepath} (${size} bytes)`);

	let kind = "unknown";
	if (mimetype.startsWith("audio/")) kind = "audio";
	else if (mimetype.startsWith("image/")) kind = "image";
	else if (mimetype.startsWith("video/")) kind = "video";
	else if (mimetype.startsWith("application/")) kind = "document";

	sendToChannels({
		type: "message",
		id: randomUUID(),
		channel: "whatsapp",
		from,
		timestamp,
		media: {
			kind,
			mimetype,
			filepath,
			size,
			caption: caption || undefined,
		},
	});
}

// --- TCP channel connection ---

function connectToChannels(): void {
	if (shuttingDown || !waConnected) return;
	if (tcpConnecting) return;
	if (channelSocket?.writable) return;

	clearTcpReconnectTimer();
	tcpConnecting = true;
	tcpBuffer = "";

	console.log(`[tcp] connecting to ${CHANNELS_SOCKET}...`);

	const sock = createConnection({ path: CHANNELS_SOCKET });
	channelSocket = sock;
	sock.setEncoding("utf8");

	sock.on("connect", () => {
		if (channelSocket !== sock) return;
		tcpConnecting = false;
		tcpReconnectDelay = RECONNECT_BASE_MS;
		console.log("[tcp] connected to bloom-channels.");

		const registration: Record<string, string> = { type: "register", channel: "whatsapp" };
		if (CHANNEL_TOKEN) registration.token = CHANNEL_TOKEN;
		sock.write(`${JSON.stringify(registration)}\n`);
	});

	sock.on("data", (data: string) => {
		if (channelSocket !== sock) return;

		tcpBuffer += data;
		const lines = tcpBuffer.split("\n");
		tcpBuffer = lines.pop() ?? "";

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				const msg = JSON.parse(trimmed) as unknown;
				handleChannelMessage(msg);
			} catch (err) {
				console.error("[tcp] parse error:", (err as Error).message, "| raw:", trimmed.slice(0, 120));
			}
		}
	});

	sock.on("error", (err) => {
		if (channelSocket !== sock) return;
		console.error("[tcp] error:", err.message);
	});

	sock.on("close", () => {
		if (channelSocket !== sock) return;
		channelSocket = null;
		tcpConnecting = false;
		if (shuttingDown || !waConnected) return;
		scheduleTcpReconnect();
	});
}

function sendToChannels(msg: Record<string, unknown>): void {
	if (channelSocket?.writable) {
		channelSocket.write(`${JSON.stringify(msg)}\n`);
	} else {
		console.warn("[tcp] channel socket not writable, dropping message:", msg);
	}
}

// --- Incoming channel messages -> WhatsApp ---

function handleChannelMessage(raw: unknown): void {
	if (!isChannelMessage(raw)) {
		console.warn("[tcp] unexpected message shape:", raw);
		return;
	}

	const { type, to, text } = raw;

	if (type === "response" || type === "send") {
		if (!to) {
			console.warn(`[tcp] "${type}" message missing "to" field — dropping.`);
			return;
		}
		if (!text) {
			console.warn(`[tcp] "${type}" message missing "text" field — dropping.`);
			return;
		}
		if (!waClient) {
			console.warn("[tcp] WhatsApp client not ready — dropping message.");
			return;
		}
		console.log(`[wa] sending to ${to}: ${text.slice(0, 80)}`);
		waClient.sendMessage(to, text).catch((err: unknown) => {
			console.error("[wa] sendMessage error:", (err as Error).message);
		});
		return;
	}

	if (type === "ping") {
		if (channelSocket?.writable) {
			channelSocket.write(`${JSON.stringify({ type: "pong" })}\n`);
		}
		return;
	}

	if (type === "registered" || type === "pong" || type === "status") {
		return;
	}

	console.warn("[tcp] unhandled message type:", type);
}

// --- Graceful shutdown ---

function shutdown(signal: string): void {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`[bloom-whatsapp] received ${signal}, shutting down...`);

	healthServer.close();
	clearTcpReconnectTimer();
	resetChannelSocket();

	if (waClient) {
		waClient.destroy().catch(() => {});
		waClient = null;
	}

	setTimeout(() => process.exit(0), 1_500);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// --- Entry point ---

startWhatsApp().catch((err: unknown) => {
	console.error("[bloom-whatsapp] fatal startup error:", (err as Error).message);
	process.exit(1);
});
