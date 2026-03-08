import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createConnection, type Socket } from "node:net";
import { createInterface } from "node:readline";
import { isChannelMessage, mimeToExt } from "./utils.js";

// --- Configuration ---

const SIGNAL_CLI = process.env.SIGNAL_CLI_PATH ?? "signal-cli";
const SIGNAL_ACCOUNT = process.env.SIGNAL_ACCOUNT ?? "";
const SIGNAL_CONFIG_DIR = process.env.SIGNAL_CONFIG_DIR ?? "/data/signal";
const defaultSocketPath = `${process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 1000}`}/bloom/channels.sock`;
const CHANNELS_SOCKET = process.env.BLOOM_CHANNELS_SOCKET ?? defaultSocketPath;
const MEDIA_DIR = process.env.BLOOM_MEDIA_DIR ?? "/media/bloom";
const CHANNEL_TOKEN = process.env.BLOOM_CHANNEL_TOKEN ?? "";
const HEALTH_PORT = Number(process.env.BLOOM_HEALTH_PORT ?? "18802");

const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

// --- State ---

let channelSocket: Socket | null = null;
let tcpBuffer = "";
let tcpReconnectDelay = RECONNECT_BASE_MS;
let tcpReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let tcpConnecting = false;
let shuttingDown = false;
let signalConnected = false;
let signalProcess: ChildProcess | null = null;

// --- Helpers ---

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

const healthServer = createHttpServer((req, res) => {
	if (req.url === "/health") {
		const healthy = signalConnected && channelSocket?.writable === true;
		res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ signal: signalConnected, channel: channelSocket?.writable === true }));
	} else {
		res.writeHead(404);
		res.end();
	}
});

healthServer.listen(HEALTH_PORT, "0.0.0.0", () => {
	console.log(`[health] listening on :${HEALTH_PORT}`);
});

// --- signal-cli daemon ---

interface SignalEnvelope {
	envelope?: {
		source?: string;
		sourceNumber?: string;
		timestamp?: number;
		dataMessage?: {
			message?: string;
			attachments?: Array<{
				contentType?: string;
				filename?: string;
				id?: string;
				size?: number;
			}>;
		};
	};
}

let jsonRpcId = 1;

function sendSignalMessage(recipient: string, text: string): void {
	if (!signalProcess?.stdin?.writable) {
		console.warn("[signal] daemon stdin not writable — dropping message.");
		return;
	}
	const rpc = {
		jsonrpc: "2.0",
		method: "send",
		id: jsonRpcId++,
		params: {
			recipient: [recipient],
			message: text,
		},
	};
	signalProcess.stdin.write(`${JSON.stringify(rpc)}\n`);
	console.log(`[signal] sending to ${recipient}: ${text.slice(0, 80)}`);
}

function startSignalDaemon(): void {
	if (shuttingDown) return;

	if (!SIGNAL_ACCOUNT) {
		console.error("[signal] SIGNAL_ACCOUNT not set. Set it to your phone number (e.g. +1234567890).");
		process.exit(1);
	}

	console.log(`[signal] starting signal-cli daemon for ${SIGNAL_ACCOUNT}...`);

	const proc = spawn(
		SIGNAL_CLI,
		[
			"--config",
			SIGNAL_CONFIG_DIR,
			"--account",
			SIGNAL_ACCOUNT,
			"--output=json",
			"daemon",
			"--receive-mode=on-connection",
		],
		{
			stdio: ["pipe", "pipe", "pipe"],
		},
	);

	signalProcess = proc;

	proc.stderr?.on("data", (chunk: Buffer) => {
		const line = chunk.toString().trim();
		if (line) console.error(`[signal-cli] ${line}`);

		// Capture device linking URI
		const linkMatch = line.match(/(sgnl:\/\/linkdevice\?[^\s]+)/);
		if (linkMatch) {
			sendToChannels({ type: "pairing", channel: "signal", data: linkMatch[1] });
		}

		if (line.includes("Connected") || line.includes("Listening")) {
			signalConnected = true;
			tcpReconnectDelay = RECONNECT_BASE_MS;
			clearTcpReconnectTimer();
			resetChannelSocket();
			connectToChannels();
		}
	});

	if (proc.stdout) {
		const rl = createInterface({ input: proc.stdout });
		rl.on("line", (line: string) => {
			if (!line.trim()) return;
			try {
				const parsed = JSON.parse(line) as SignalEnvelope;
				handleSignalMessage(parsed);
			} catch (err) {
				console.error("[signal] parse error:", (err as Error).message, "| raw:", line.slice(0, 120));
			}
		});
	}

	proc.on("close", (code) => {
		signalConnected = false;
		signalProcess = null;
		console.log(`[signal] daemon exited with code ${code}.`);

		if (!shuttingDown) {
			console.log("[signal] restarting daemon in 5s...");
			setTimeout(startSignalDaemon, 5_000);
		}
	});
}

async function handleSignalMessage(parsed: SignalEnvelope): Promise<void> {
	const env = parsed.envelope;
	if (!env?.dataMessage) return;

	const from = env.sourceNumber ?? env.source ?? "";
	if (!from) return;

	const timestamp = env.timestamp ?? Math.floor(Date.now() / 1000);
	const text = env.dataMessage.message ?? "";
	const attachments = env.dataMessage.attachments ?? [];

	for (const att of attachments) {
		if (att.id && att.contentType) {
			try {
				const srcPath = `${SIGNAL_CONFIG_DIR}/attachments/${att.id}`;
				const ext = mimeToExt(att.contentType);
				const id = randomBytes(6).toString("hex");
				const filename = `${timestamp}-${id}.${ext}`;
				const filepath = `${MEDIA_DIR}/${filename}`;

				await mkdir(MEDIA_DIR, { recursive: true });
				const buffer = await readFile(srcPath);
				await writeFile(filepath, buffer);

				let kind = "unknown";
				if (att.contentType.startsWith("audio/")) kind = "audio";
				else if (att.contentType.startsWith("image/")) kind = "image";
				else if (att.contentType.startsWith("video/")) kind = "video";
				else if (att.contentType.startsWith("application/")) kind = "document";

				sendToChannels({
					type: "message",
					id: randomUUID(),
					channel: "signal",
					from,
					timestamp,
					media: {
						kind,
						mimetype: att.contentType,
						filepath,
						size: att.size ?? buffer.length,
					},
				});
			} catch (err) {
				console.error("[signal] attachment handling error:", (err as Error).message);
			}
		}
	}

	if (text) {
		console.log(`[signal] message from ${from}: ${text.slice(0, 80)}`);
		sendToChannels({
			type: "message",
			id: randomUUID(),
			channel: "signal",
			from,
			text,
			timestamp,
		});
	}
}

// --- TCP channel connection ---

function connectToChannels(): void {
	if (shuttingDown || !signalConnected) return;
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

		const registration: Record<string, string> = { type: "register", channel: "signal" };
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
		if (shuttingDown || !signalConnected) return;
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

// --- Incoming channel messages -> Signal ---

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
		sendSignalMessage(to, text);
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
	console.log(`[bloom-signal] received ${signal}, shutting down...`);

	healthServer.close();
	clearTcpReconnectTimer();
	resetChannelSocket();

	if (signalProcess) {
		signalProcess.kill("SIGTERM");
		signalProcess = null;
	}

	setTimeout(() => process.exit(0), 3_000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// --- Entry point ---

startSignalDaemon();
