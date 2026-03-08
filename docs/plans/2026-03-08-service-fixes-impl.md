# Service Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three service bugs found during VM testing: STT entrypoint/port, WhatsApp 405 disconnect, Signal pairing flow.

**Architecture:** Three independent fixes — STT is a Quadlet config change, WhatsApp is a transport.ts config addition, Signal is a moderate rewrite of daemon startup + JSON-RPC pairing. Each can be committed separately.

**Tech Stack:** Podman Quadlet, TypeScript (ES2022/NodeNext), @whiskeysockets/baileys 7.0.0-rc.9, signal-cli 0.14.1 JSON-RPC

**Version Notes:**
- Baileys: Bump `@whiskeysockets/baileys` from `^6.7.16` to `7.0.0-rc.9`. All imports compatible (verified). Add `makeCacheableSignalKeyStore` for better key store perf. Use `fetchLatestBaileysVersion()` for dynamic version fetch.
- signal-cli: Bump `0.13.12` → `0.14.1` in Containerfile for better `startLink`/`finishLink` support.
- whisper.cpp: Already tracking `:main` rolling tag.
- pino, @hapi/boom, qrcode-terminal: Up to date or low-priority bumps.

---

### Task 1: Fix STT Quadlet entrypoint and port mapping

**Files:**
- Modify: `services/stt/quadlet/bloom-stt.container:13-27`

**Step 1: Fix the Quadlet**

The upstream image `ghcr.io/ggml-org/whisper.cpp:main` has `ENTRYPOINT ["bash", "-c"]` which mangles our `Exec=` arguments. Override the entrypoint and fix port mapping.

Replace lines 13-27 in `services/stt/quadlet/bloom-stt.container`:

```ini
# Expose API on localhost (8080 inside -> 8081 outside)
PublishPort=127.0.0.1:8081:8080

# Model storage persists across restarts
Volume=bloom-stt-models:/models

# Media files for transcription (read-only)
Volume=/var/lib/bloom/media:/media:ro

# Override bash entrypoint with actual binary
PodmanArgs=--entrypoint /app/build/bin/whisper-server

# Run whisper server with base model
Exec=--host 0.0.0.0 --port 8080 --model /models/ggml-base.en.bin --threads 4

PodmanArgs=--memory=1g
PodmanArgs=--security-opt label=disable
HealthCmd=curl -sf http://localhost:8080/health || exit 1
```

Key changes:
- `PublishPort=127.0.0.1:8081:8081` → `PublishPort=127.0.0.1:8081:8080`
- Added `PodmanArgs=--entrypoint /app/build/bin/whisper-server` before `Exec=`
- `Exec=` now has bare args (no binary path): `--host 0.0.0.0 --port 8080 ...`
- `HealthCmd` checks port 8080 (inside container)

**Step 2: Verify no other files reference the STT internal port**

Run: `rg "8081" services/stt/` — only the Quadlet and SKILL.md should match. SKILL.md references the *external* port 8081 which is unchanged.

**Step 3: Commit**

```bash
git add services/stt/quadlet/bloom-stt.container
git commit -m "fix(stt): override whisper.cpp entrypoint and fix port mapping

The upstream image uses ENTRYPOINT [\"bash\", \"-c\"] which mangles
Exec= arguments. Override entrypoint to the actual binary and use
port 8080 inside the container with 8081:8080 port mapping."
```

---

### Task 2: Bump Baileys to v7 RC + fix WhatsApp 405 disconnect

**Files:**
- Modify: `services/whatsapp/package.json` (bump Baileys to 7.0.0-rc.9)
- Modify: `services/whatsapp/src/transport.ts:5-13,90-100`

**Step 1: Bump Baileys version in package.json**

In `services/whatsapp/package.json`, change:
```json
"@whiskeysockets/baileys": "7.0.0-rc.9"
```

Then install: `cd services/whatsapp && npm install`

**Step 2: Update Baileys imports**

In `services/whatsapp/src/transport.ts`, change the import block to add `Browsers`, `fetchLatestBaileysVersion`, and `makeCacheableSignalKeyStore`:

```typescript
import makeWASocket, {
	Browsers,
	DisconnectReason,
	type DownloadableMessage,
	downloadContentFromMessage,
	fetchLatestBaileysVersion,
	getContentType,
	makeCacheableSignalKeyStore,
	type MediaType,
	useMultiFileAuthState,
} from "@whiskeysockets/baileys";
```

Also remove the `@hapi/boom` type-only import (line 5) — Baileys v7 bundles it. Instead import `Boom` from Baileys or cast inline:
```typescript
// Remove this line:
// import type { Boom } from "@hapi/boom";
```

And update the statusCode extraction (line ~121) to cast inline:
```typescript
const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
```

**Step 3: Add version fetching + cacheable key store to startWhatsApp()**

Replace the `startWhatsApp` function opening with:

```typescript
async function startWhatsApp(): Promise<void> {
	if (shuttingDown) return;

	console.log("[wa] starting Baileys client...");

	let version: [number, number, number] | undefined;
	try {
		const { version: fetched } = await fetchLatestBaileysVersion();
		version = fetched;
		console.log(`[wa] using WA Web version: ${version.join(".")}`);
	} catch (err) {
		version = [2, 3000, 1034074495];
		console.log(`[wa] version fetch failed, using fallback: ${version.join(".")} (${(err as Error).message})`);
	}

	const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

	const sock = makeWASocket({
		auth: {
			creds: state.creds,
			keys: makeCacheableSignalKeyStore(state.keys, logger),
		},
		logger,
		version,
		browser: Browsers.macOS("Desktop"),
		syncFullHistory: false,
	});
```

**Step 4: Remove @hapi/boom from package.json dependencies**

Since Baileys v7 bundles it and we no longer import it directly:
```json
"dependencies": {
    "@whiskeysockets/baileys": "7.0.0-rc.9",
    "pino": "^9.6.0",
    "qrcode-terminal": "^0.12.0"
}
```

Run: `cd services/whatsapp && npm install`

**Step 5: Build and test**

Run: `cd services/whatsapp && npx tsc --noEmit`
Expected: No errors

Run: `cd services/whatsapp && npx vitest run`
Expected: All 31 tests pass

**Step 6: Commit**

```bash
git add services/whatsapp/package.json services/whatsapp/package-lock.json services/whatsapp/src/transport.ts
git commit -m "fix(whatsapp): bump Baileys to v7 RC.9 + dynamic version fetch

Upgrade from Baileys 6.7.x to 7.0.0-rc.9. Fetch the latest WA Web
version dynamically to prevent 405 disconnect from stale hardcoded
version. Add makeCacheableSignalKeyStore for better key store perf.
Set browser to macOS Desktop for pairing compatibility."
```

---

### Task 3: Rewrite Signal transport for multi-account daemon + JSON-RPC linking

This is the largest task. The transport needs to:
- Start daemon without `-a ACCOUNT` (multi-account mode)
- Track JSON-RPC request/response pairs on stdout
- Handle `pair` messages from channel bridge via `startLink`/`finishLink`
- Multiplex stdout between JSON-RPC responses and Signal envelopes

**Files:**
- Modify: `services/signal/Containerfile:4` (bump signal-cli 0.13.12 → 0.14.1)
- Modify: `services/signal/src/transport.ts` (major rewrite of daemon + stdout handling)
- Modify: `services/signal/src/utils.ts` (add JSON-RPC type guard)
- Modify: `services/signal/tests/utils.test.ts` (add test for new type guard)

**Step 3-pre: Bump signal-cli version in Containerfile**

In `services/signal/Containerfile`, change line 4:
```dockerfile
ARG SIGNAL_CLI_VERSION=0.14.1
```

**Step 3a: Add JSON-RPC type guard to utils.ts**

Add to `services/signal/src/utils.ts`:

```typescript
export interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: number;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

export function isJsonRpcResponse(val: unknown): val is JsonRpcResponse {
	return (
		typeof val === "object" &&
		val !== null &&
		"jsonrpc" in val &&
		(val as Record<string, unknown>).jsonrpc === "2.0" &&
		"id" in val &&
		typeof (val as Record<string, unknown>).id === "number"
	);
}
```

**Step 3b: Add tests for JSON-RPC type guard**

Add to `services/signal/tests/utils.test.ts`:

```typescript
import { isJsonRpcResponse } from "../src/utils.js";

describe("isJsonRpcResponse", () => {
	it("returns true for success response", () => {
		expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1, result: { foo: "bar" } })).toBe(true);
	});

	it("returns true for error response", () => {
		expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 2, error: { code: -1, message: "fail" } })).toBe(true);
	});

	it("returns false for Signal envelope", () => {
		expect(isJsonRpcResponse({ envelope: { source: "+1234" } })).toBe(false);
	});

	it("returns false for non-object", () => {
		expect(isJsonRpcResponse(null)).toBe(false);
		expect(isJsonRpcResponse("string")).toBe(false);
	});

	it("returns false for wrong jsonrpc version", () => {
		expect(isJsonRpcResponse({ jsonrpc: "1.0", id: 1 })).toBe(false);
	});
});
```

Run: `cd services/signal && npx vitest run`
Expected: All tests pass (including 5 new ones)

**Step 3c: Rewrite transport.ts**

Replace the full `services/signal/src/transport.ts`. Key changes from the current version:

1. **Config**: `SIGNAL_ACCOUNT` becomes optional (no `process.exit(1)`)
2. **New state**: `linkedAccount` stores the account number discovered during linking; `pendingRpcs` map for JSON-RPC tracking
3. **`sendRpc(method, params)`**: Writes JSON-RPC to daemon stdin, returns Promise resolved by stdout handler
4. **`startSignalDaemon()`**: Drops `--account` and `SIGNAL_ACCOUNT` args. Daemon starts in multi-account mode.
5. **stdout handler**: Checks `isJsonRpcResponse()` first — if true, resolves pending RPC; otherwise delegates to `handleSignalMessage()`
6. **`handleChannelMessage()`**: New `type === "pair"` handler that calls `startLink` → broadcasts URI → calls `finishLink`
7. **`sendSignalMessage()`**: Adds `account` field to JSON-RPC params when `linkedAccount` is set

Here is the complete new `transport.ts`:

```typescript
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createConnection, type Socket } from "node:net";
import { createInterface } from "node:readline";
import {
	type JsonRpcResponse,
	isChannelMessage,
	isJsonRpcResponse,
	isSenderAllowed,
	mimeToExt,
	parseAllowedSenders,
} from "./utils.js";

// --- Configuration ---

const SIGNAL_CLI = process.env.SIGNAL_CLI_PATH ?? "signal-cli";
const SIGNAL_ACCOUNT = process.env.SIGNAL_ACCOUNT ?? "";
const SIGNAL_CONFIG_DIR = process.env.SIGNAL_CONFIG_DIR ?? "/data/signal";
const defaultSocketPath = `${process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 1000}`}/bloom/channels.sock`;
const CHANNELS_SOCKET = process.env.BLOOM_CHANNELS_SOCKET ?? defaultSocketPath;
const MEDIA_DIR = process.env.BLOOM_MEDIA_DIR ?? "/media/bloom";
const CHANNEL_TOKEN = process.env.BLOOM_CHANNEL_TOKEN ?? "";
const HEALTH_PORT = Number(process.env.BLOOM_HEALTH_PORT ?? "18802");
const DEVICE_NAME = process.env.BLOOM_DEVICE_NAME ?? "Bloom";

// Sender allowlist: comma-separated phone numbers (E.164). Empty = allow all.
const ALLOWED_SENDERS = parseAllowedSenders(process.env.BLOOM_ALLOWED_SENDERS ?? "");

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
let linkedAccount = SIGNAL_ACCOUNT; // discovered during link or from env
let pairingInProgress = false;

// JSON-RPC tracking
let jsonRpcId = 1;
const pendingRpcs = new Map<number, { resolve: (val: unknown) => void; reject: (err: Error) => void }>();

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

// --- JSON-RPC ---

function sendRpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
	return new Promise((resolve, reject) => {
		if (!signalProcess?.stdin?.writable) {
			reject(new Error("daemon stdin not writable"));
			return;
		}
		const id = jsonRpcId++;
		pendingRpcs.set(id, { resolve, reject });
		const rpc = { jsonrpc: "2.0", method, id, params };
		signalProcess.stdin.write(`${JSON.stringify(rpc)}\n`);
	});
}

function handleRpcResponse(resp: JsonRpcResponse): void {
	const pending = pendingRpcs.get(resp.id);
	if (!pending) {
		console.warn(`[rpc] unexpected response for id=${resp.id}`);
		return;
	}
	pendingRpcs.delete(resp.id);
	if (resp.error) {
		pending.reject(new Error(`${resp.error.message} (code=${resp.error.code})`));
	} else {
		pending.resolve(resp.result);
	}
}

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

function sendSignalMessage(recipient: string, text: string): void {
	const params: Record<string, unknown> = {
		recipient: [recipient],
		message: text,
	};
	if (linkedAccount) {
		params.account = linkedAccount;
	}
	sendRpc("send", params).catch((err: unknown) => {
		console.error(`[signal] send error: ${(err as Error).message}`);
	});
	console.log(`[signal] sending to ${recipient}: ${text.slice(0, 80)}`);
}

function startSignalDaemon(): void {
	if (shuttingDown) return;

	const args = ["--config", SIGNAL_CONFIG_DIR, "--output=json", "daemon", "--receive-mode=on-connection"];

	console.log("[signal] starting signal-cli daemon (multi-account)...");

	const proc = spawn(SIGNAL_CLI, args, { stdio: ["pipe", "pipe", "pipe"] });

	signalProcess = proc;

	proc.stderr?.on("data", (chunk: Buffer) => {
		const line = chunk.toString().trim();
		if (line) console.error(`[signal-cli] ${line}`);

		if (line.includes("Listening")) {
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
				const parsed = JSON.parse(line) as unknown;
				if (isJsonRpcResponse(parsed)) {
					handleRpcResponse(parsed);
				} else {
					handleSignalMessage(parsed as SignalEnvelope);
				}
			} catch (err) {
				console.error("[signal] parse error:", (err as Error).message, "| raw:", line.slice(0, 120));
			}
		});
	}

	proc.on("close", (code) => {
		signalConnected = false;
		signalProcess = null;
		// Reject any pending RPCs
		for (const [id, pending] of pendingRpcs) {
			pending.reject(new Error("daemon exited"));
			pendingRpcs.delete(id);
		}
		console.log(`[signal] daemon exited with code ${code}.`);

		if (!shuttingDown) {
			console.log("[signal] restarting daemon in 5s...");
			setTimeout(startSignalDaemon, 5_000);
		}
	});
}

async function handlePairRequest(): Promise<void> {
	if (pairingInProgress) {
		console.warn("[signal] pairing already in progress");
		sendToChannels({ type: "error", channel: "signal", error: "Pairing already in progress" });
		return;
	}
	pairingInProgress = true;
	try {
		console.log("[signal] starting device link...");
		const startResult = (await sendRpc("startLink")) as { deviceLinkUri?: string } | undefined;
		const uri = startResult?.deviceLinkUri;
		if (!uri) {
			throw new Error("startLink did not return deviceLinkUri");
		}
		console.log(`[signal] link URI: ${uri.slice(0, 40)}...`);
		sendToChannels({ type: "pairing", channel: "signal", data: uri });

		console.log("[signal] waiting for phone to confirm link...");
		const finishResult = (await sendRpc("finishLink", { deviceLinkUri: uri, deviceName: DEVICE_NAME })) as
			| { number?: string }
			| undefined;
		const account = finishResult?.number;
		if (account) {
			linkedAccount = account;
			console.log(`[signal] linked as ${account}`);
		} else {
			console.log("[signal] linked (account number not returned)");
		}
		sendToChannels({ type: "paired", channel: "signal", account: linkedAccount });
	} catch (err) {
		console.error(`[signal] pairing failed: ${(err as Error).message}`);
		sendToChannels({ type: "error", channel: "signal", error: (err as Error).message });
	} finally {
		pairingInProgress = false;
	}
}

async function handleSignalMessage(parsed: SignalEnvelope): Promise<void> {
	const env = parsed.envelope;
	if (!env?.dataMessage) return;

	const from = env.sourceNumber ?? env.source ?? "";
	if (!from) return;
	if (!isSenderAllowed(from, ALLOWED_SENDERS)) {
		console.log(`[signal] filtered message from ${from} (not in BLOOM_ALLOWED_SENDERS)`);
		return;
	}

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

	if (type === "pair") {
		handlePairRequest().catch((err: unknown) => {
			console.error("[signal] pair handler error:", (err as Error).message);
		});
		return;
	}

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

	// Reject pending RPCs
	for (const [id, pending] of pendingRpcs) {
		pending.reject(new Error("shutting down"));
		pendingRpcs.delete(id);
	}

	setTimeout(() => process.exit(0), 3_000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// --- Entry point ---

startSignalDaemon();
```

**Step 3d: Build and run tests**

Run: `cd services/signal && npx tsc --noEmit`
Expected: No errors

Run: `cd services/signal && npx vitest run`
Expected: All tests pass (existing + 5 new)

**Step 3e: Run biome check**

Run: `npm run check`
Expected: Only pre-existing cognitive complexity warnings

**Step 3f: Commit**

```bash
git add services/signal/Containerfile services/signal/src/transport.ts services/signal/src/utils.ts services/signal/tests/utils.test.ts
git commit -m "fix(signal): multi-account daemon + JSON-RPC pairing flow

Start signal-cli in multi-account daemon mode (no -a flag) so it
works without a pre-linked account. Add JSON-RPC startLink/finishLink
for pairing via channel bridge. Multiplex stdout between RPC responses
and Signal envelopes."
```

---

### Task 4: Build verification and final check

**Step 1: Run all root tests**

Run: `npm run test`
Expected: 263+ tests pass

**Step 2: Run all service tests**

Run: `cd services/whatsapp && npx vitest run && cd ../signal && npx vitest run`
Expected: All pass

**Step 3: Run biome**

Run: `npm run check`
Expected: Only pre-existing warnings, no new errors

**Step 4: Build root project**

Run: `npm run build`
Expected: Clean build
