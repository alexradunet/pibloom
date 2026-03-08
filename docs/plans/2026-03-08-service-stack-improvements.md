# Service Stack Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify the service stack: remove dufs auth (rely on NetBird), replace lemonade with direct llama.cpp + whisper.cpp, and add Signal as a second channel bridge.

**Architecture:** Three independent changes. (1) dufs drops auth since NetBird mesh already isolates it. (2) Lemonade (a wrapper) is replaced by two focused services — `bloom-llm` (llama.cpp server, OpenAI-compatible) and `bloom-stt` (whisper.cpp server, OpenAI-compatible) — each using upstream images directly. (3) A new `bloom-signal` bridge service connects Signal via `signal-cli` to bloom-channels using the same Unix socket JSON protocol as WhatsApp.

**Tech Stack:** Podman Quadlet, llama.cpp server (GGUF models), whisper.cpp server, signal-cli (Java), Node.js 22, TypeScript, Vitest

---

## Task 1: Remove dufs authentication

dufs currently uses `--auth "admin:$BLOOM_CHANNEL_TOKEN@/:rw"` with a generated token. Since dufs runs on host networking and is only reachable via the NetBird mesh, auth is unnecessary overhead. Remove it.

**Files:**
- Modify: `services/dufs/quadlet/bloom-dufs.container`
- Modify: `services/dufs/SKILL.md`

**Step 1: Simplify the quadlet file**

Replace the entire `services/dufs/quadlet/bloom-dufs.container` with:

```ini
[Unit]
Description=Bloom dufs — WebDAV file server for home directory
After=network-online.target
Wants=network-online.target

[Container]
Image=docker.io/sigoden/dufs:latest
ContainerName=bloom-dufs

# Host networking for NetBird mesh reachability
Network=host

# Serve the user's home directory (no SELinux relabel — use label=disable)
Volume=%h:/data

# No auth — protected by NetBird mesh isolation
Exec=/data -A -p 5000

PodmanArgs=--memory=128m
PodmanArgs=--security-opt label=disable
NoNewPrivileges=true
LogDriver=journald

[Service]
Restart=on-failure
RestartSec=10
TimeoutStartSec=60

[Install]
WantedBy=default.target
```

Changes: removed `sh -c` exec wrapper, removed `--auth` flag, removed `EnvironmentFile` line, updated comment.

**Step 2: Update SKILL.md**

Replace `services/dufs/SKILL.md` with:

```markdown
---
name: dufs
version: 0.1.0
description: Minimal WebDAV file server for home directory access over NetBird mesh
image: docker.io/sigoden/dufs:latest
---

# dufs Service

Lightweight WebDAV file server exposing your home directory. Accessible from any device on your NetBird mesh network. No authentication — access is restricted by NetBird mesh membership.

## Access

WebDAV endpoint: `http://<bloom-device>:5000`
- Requires NetBird mesh connectivity
- No username/password needed — NetBird provides the access control

## Client Setup

### Windows
Map network drive: `\\<bloom-device>@5000\DavWWWRoot`

### Linux
Mount: `sudo mount -t davfs http://<bloom-device>:5000 /mnt/bloom`
Or use your file manager's "Connect to Server" feature.

### Android
Use FolderSync, Solid Explorer, or any WebDAV-capable file manager.

### macOS
Finder > Go > Connect to Server > `http://<bloom-device>:5000`

## Service Control

```bash
systemctl --user start bloom-dufs.service
systemctl --user status bloom-dufs
journalctl --user -u bloom-dufs -f
```

## Notes

- Only accessible via NetBird mesh — not exposed to the public internet
- Serves your entire home directory (read/write)
- Swappable with rclone (`rclone serve webdav`) or Syncthing
```

**Step 3: Commit**

```bash
git add services/dufs/quadlet/bloom-dufs.container services/dufs/SKILL.md
git commit -m "refactor: remove dufs auth, rely on NetBird mesh isolation"
```

---

## Task 2: Replace lemonade with bloom-llm (llama.cpp server)

Lemonade is a wrapper around llama.cpp. Replace it with the llama.cpp server directly. The llama.cpp server provides an OpenAI-compatible API out of the box (`/v1/chat/completions`, `/v1/models`, `/health`).

**Files:**
- Create: `services/llm/quadlet/bloom-llm.container`
- Create: `services/llm/quadlet/bloom-llm-models.volume`
- Create: `services/llm/SKILL.md`
- Delete: `services/lemonade/` (entire directory)
- Modify: `services/catalog.yaml` (replace lemonade entry with llm)

**Step 1: Create llm quadlet directory**

```bash
mkdir -p services/llm/quadlet
```

**Step 2: Create the container quadlet**

Write `services/llm/quadlet/bloom-llm.container`:

```ini
[Unit]
Description=Bloom LLM — Local language model (llama.cpp server, OpenAI-compatible)
After=network-online.target
Wants=network-online.target

[Container]
Image=ghcr.io/ggml-org/llama.cpp:server
ContainerName=bloom-llm

# Bridge network for isolation
Network=bloom.network

# Expose OpenAI-compatible API on localhost
PublishPort=127.0.0.1:8080:8080

# Model storage persists across restarts
Volume=bloom-llm-models:/models

# Run server with model (downloaded by first-boot skill)
Exec=--host 0.0.0.0 --port 8080 --model /models/default.gguf --ctx-size 2048 --threads 4

PodmanArgs=--memory=3g
PodmanArgs=--security-opt label=disable
HealthCmd=curl -sf http://localhost:8080/health || exit 1
HealthInterval=30s
HealthRetries=3
HealthTimeout=10s
HealthStartPeriod=2m
NoNewPrivileges=true
LogDriver=journald

[Service]
Restart=on-failure
RestartSec=10
TimeoutStartSec=300
TimeoutStopSec=30

[Install]
WantedBy=default.target
```

**Step 3: Create the volume definition**

Write `services/llm/quadlet/bloom-llm-models.volume`:

```ini
[Volume]
```

**Step 4: Create SKILL.md**

Write `services/llm/SKILL.md`:

```markdown
---
name: llm
version: 0.1.0
description: Local LLM inference via llama.cpp server (OpenAI-compatible API)
image: ghcr.io/ggml-org/llama.cpp:server
---

# LLM Service

Local language model server powered by llama.cpp. Provides an OpenAI-compatible API for chat completions. Runs on CPU.

## First-Time Setup

Before starting the service, download a model into the volume:

```bash
# Create a temporary container to access the volume
podman volume create bloom-llm-models

# Download a small model (Qwen2.5 0.5B, ~400MB, good for first boot)
podman run --rm -v bloom-llm-models:/models docker.io/curlimages/curl:latest \
  -L -o /models/default.gguf \
  "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf"
```

To use a different model, replace the URL and restart the service.

## API

OpenAI-compatible endpoint at `http://localhost:8080`.

### Chat Completion

```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "default", "messages": [{"role": "user", "content": "Hello"}]}'
```

### List Models

```bash
curl http://localhost:8080/v1/models
```

### Health Check

```bash
curl -sf http://localhost:8080/health
```

## Service Control

```bash
systemctl --user start bloom-llm.service
systemctl --user status bloom-llm
journalctl --user -u bloom-llm -f
```

## Notes

- Model must be downloaded before first start (see setup above)
- Memory usage: ~1-3GB depending on model size (CPU mode)
- Default model: Qwen2.5 0.5B Instruct (Q4_K_M) — small, fast, good for basic tasks
- Upgrade to a larger model (3B, 7B) for better quality if hardware allows
- Swappable with Ollama or any OpenAI-compatible server on port 8080
```

**Step 5: Delete lemonade directory**

```bash
rm -rf services/lemonade/
```

**Step 6: Update catalog.yaml — replace lemonade with llm**

In `services/catalog.yaml`, replace the lemonade entry:

```yaml
version: 1
source_repo: https://github.com/pibloom/pi-bloom
services:
  llm:
    version: "0.1.0"
    category: ai
    image: ghcr.io/ggml-org/llama.cpp:server
    optional: false
    preflight:
      commands: [podman, systemctl]
  whatsapp:
    version: "0.3.0"
    category: communication
    image: localhost/bloom-whatsapp:latest
    optional: true
    preflight:
      commands: [podman, systemctl]
  dufs:
    version: "0.1.0"
    category: sync
    image: docker.io/sigoden/dufs:latest
    optional: false
    preflight:
      commands: [podman, systemctl]
```

**Step 7: Commit**

```bash
git add services/llm/ services/catalog.yaml
git rm -rf services/lemonade/
git commit -m "refactor: replace lemonade with bloom-llm (llama.cpp server direct)"
```

---

## Task 3: Add bloom-stt (whisper.cpp server)

Add a dedicated speech-to-text service using whisper.cpp server. This replaces the STT capability that was bundled in lemonade. It provides an OpenAI-compatible `/v1/audio/transcriptions` endpoint.

**Files:**
- Create: `services/stt/quadlet/bloom-stt.container`
- Create: `services/stt/quadlet/bloom-stt-models.volume`
- Create: `services/stt/SKILL.md`
- Modify: `services/catalog.yaml` (add stt entry)

**Step 1: Create stt quadlet directory**

```bash
mkdir -p services/stt/quadlet
```

**Step 2: Create the container quadlet**

Write `services/stt/quadlet/bloom-stt.container`:

```ini
[Unit]
Description=Bloom STT — Speech-to-text (whisper.cpp server, OpenAI-compatible)
After=network-online.target
Wants=network-online.target

[Container]
Image=ghcr.io/ggml-org/whisper.cpp:main
ContainerName=bloom-stt

# Bridge network for isolation
Network=bloom.network

# Expose API on localhost
PublishPort=127.0.0.1:8081:8081

# Model storage persists across restarts
Volume=bloom-stt-models:/models

# Media files for transcription (read-only)
Volume=/var/lib/bloom/media:/media:ro

# Run whisper server with base model
Exec=--host 0.0.0.0 --port 8081 --model /models/ggml-base.en.bin --threads 4

PodmanArgs=--memory=1g
PodmanArgs=--security-opt label=disable
HealthCmd=curl -sf http://localhost:8081/health || exit 1
HealthInterval=30s
HealthRetries=3
HealthTimeout=10s
HealthStartPeriod=2m
NoNewPrivileges=true
LogDriver=journald

[Service]
Restart=on-failure
RestartSec=10
TimeoutStartSec=300
TimeoutStopSec=30

[Install]
WantedBy=default.target
```

NOTE: The whisper.cpp server image and CLI flags should be verified at implementation time. The `ghcr.io/ggml-org/whisper.cpp:main` image may use a different entrypoint or flag names. Check `whisper.cpp` releases for the correct server image tag and flags. If no suitable upstream image exists, create a minimal `services/stt/Containerfile` that downloads whisper.cpp server binary into Alpine.

**Step 3: Create the volume definition**

Write `services/stt/quadlet/bloom-stt-models.volume`:

```ini
[Volume]
```

**Step 4: Create SKILL.md**

Write `services/stt/SKILL.md`:

```markdown
---
name: stt
version: 0.1.0
description: Speech-to-text via whisper.cpp server (OpenAI-compatible API)
image: ghcr.io/ggml-org/whisper.cpp:main
---

# STT Service

Local speech-to-text powered by whisper.cpp. Transcribes audio files (voice notes, recordings) via an OpenAI-compatible API. Runs on CPU.

## First-Time Setup

Download a whisper model into the volume:

```bash
podman volume create bloom-stt-models

# Download whisper base.en model (~150MB, good accuracy for English)
podman run --rm -v bloom-stt-models:/models docker.io/curlimages/curl:latest \
  -L -o /models/ggml-base.en.bin \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
```

For multilingual support, use `ggml-base.bin` instead.

## API

### Transcribe Audio

```bash
curl -X POST http://localhost:8081/inference \
  -F "file=@/path/to/audio.ogg" \
  -F "response_format=json"
```

Response:
```json
{"text": "transcribed content here"}
```

### Health Check

```bash
curl -sf http://localhost:8081/health
```

## Service Control

```bash
systemctl --user start bloom-stt.service
systemctl --user status bloom-stt
journalctl --user -u bloom-stt -f
```

## Notes

- Model must be downloaded before first start (see setup above)
- Memory usage: ~500MB-1GB (CPU mode)
- Default model: whisper base.en — fast, good for English
- Upgrade to `small` or `medium` for better accuracy if hardware allows
- Audio files from WhatsApp are at `/var/lib/bloom/media/`
```

**Step 5: Add stt to catalog.yaml**

Add after the `llm` entry in `services/catalog.yaml`:

```yaml
  stt:
    version: "0.1.0"
    category: ai
    image: ghcr.io/ggml-org/whisper.cpp:main
    optional: true
    preflight:
      commands: [podman, systemctl]
```

Note: STT is optional (unlike LLM) because it's only needed for voice note transcription.

**Step 6: Commit**

```bash
git add services/stt/ services/catalog.yaml
git commit -m "feat: add bloom-stt service (whisper.cpp server for speech-to-text)"
```

---

## Task 4: Create Signal channel bridge — project scaffold

Create the Signal bridge service structure. The bridge uses `signal-cli` in daemon mode (JSON-RPC) with a Node.js transport layer that connects to bloom-channels via Unix socket — same pattern as the WhatsApp bridge.

**Architecture:** Single container with Java (signal-cli) + Node.js (bridge). signal-cli runs as a child process in JSON-RPC daemon mode. The Node.js bridge reads incoming messages from signal-cli's stdout and forwards them to bloom-channels.

**Files:**
- Create: `services/signal/package.json`
- Create: `services/signal/tsconfig.json`
- Create: `services/signal/src/utils.ts`

**Step 1: Create directory structure**

```bash
mkdir -p services/signal/src services/signal/tests services/signal/quadlet
```

**Step 2: Create package.json**

Write `services/signal/package.json`:

```json
{
	"name": "bloom-signal-transport",
	"version": "0.1.0",
	"description": "Signal transport for Bloom via signal-cli",
	"type": "module",
	"main": "dist/transport.js",
	"scripts": {
		"build": "tsc",
		"test": "vitest run",
		"test:watch": "vitest",
		"test:coverage": "vitest run --coverage",
		"start": "node dist/transport.js"
	},
	"devDependencies": {
		"@types/node": "^22.0.0",
		"@vitest/coverage-v8": "^4.0.18",
		"typescript": "^5.7.0",
		"vitest": "^4.0.18"
	}
}
```

Note: No runtime deps besides Node.js stdlib — signal-cli is a child process, not an npm package.

**Step 3: Create tsconfig.json**

Write `services/signal/tsconfig.json`:

```json
{
	"compilerOptions": {
		"target": "ES2022",
		"module": "NodeNext",
		"moduleResolution": "NodeNext",
		"strict": true,
		"esModuleInterop": true,
		"skipLibCheck": true,
		"outDir": "dist",
		"rootDir": "src",
		"declaration": true
	},
	"include": ["src/**/*.ts"]
}
```

**Step 4: Write utils.ts**

Write `services/signal/src/utils.ts` — shared utilities matching WhatsApp's pattern:

```typescript
export interface ChannelMessage {
	type: string;
	to?: string;
	text?: string;
}

export function isChannelMessage(val: unknown): val is ChannelMessage {
	return (
		typeof val === "object" &&
		val !== null &&
		"type" in val &&
		typeof (val as Record<string, unknown>).type === "string"
	);
}

export function mimeToExt(mime: string): string {
	const map: Record<string, string> = {
		"audio/ogg": "ogg",
		"audio/ogg; codecs=opus": "ogg",
		"audio/mpeg": "mp3",
		"audio/mp4": "m4a",
		"audio/aac": "aac",
		"image/jpeg": "jpg",
		"image/png": "png",
		"image/webp": "webp",
		"image/gif": "gif",
		"video/mp4": "mp4",
		"application/pdf": "pdf",
		"application/octet-stream": "bin",
	};
	return map[mime] ?? mime.split("/").pop() ?? "bin";
}
```

**Step 5: Commit**

```bash
git add services/signal/
git commit -m "feat(signal): scaffold signal bridge project"
```

---

## Task 5: Signal bridge — utils tests

**Files:**
- Create: `services/signal/tests/utils.test.ts`

**Step 1: Write the tests**

Write `services/signal/tests/utils.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { isChannelMessage, mimeToExt } from "../src/utils.js";

describe("mimeToExt", () => {
	it.each([
		["audio/ogg", "ogg"],
		["audio/ogg; codecs=opus", "ogg"],
		["audio/mpeg", "mp3"],
		["audio/mp4", "m4a"],
		["audio/aac", "aac"],
		["image/jpeg", "jpg"],
		["image/png", "png"],
		["image/webp", "webp"],
		["image/gif", "gif"],
		["video/mp4", "mp4"],
		["application/pdf", "pdf"],
		["application/octet-stream", "bin"],
	])("maps %s → %s", (mime, ext) => {
		expect(mimeToExt(mime)).toBe(ext);
	});

	it("falls back to subtype for unknown mime", () => {
		expect(mimeToExt("text/plain")).toBe("plain");
	});

	it("returns empty string for empty mime", () => {
		expect(mimeToExt("")).toBe("");
	});
});

describe("isChannelMessage", () => {
	it("returns true for valid object with type string", () => {
		expect(isChannelMessage({ type: "response", to: "+1234", text: "hi" })).toBe(true);
	});

	it("returns true for minimal valid object", () => {
		expect(isChannelMessage({ type: "ping" })).toBe(true);
	});

	it("returns false for null", () => {
		expect(isChannelMessage(null)).toBe(false);
	});

	it("returns false for non-object", () => {
		expect(isChannelMessage("string")).toBe(false);
		expect(isChannelMessage(42)).toBe(false);
	});

	it("returns false for missing type", () => {
		expect(isChannelMessage({ to: "+1234" })).toBe(false);
	});

	it("returns false for non-string type", () => {
		expect(isChannelMessage({ type: 123 })).toBe(false);
	});
});
```

**Step 2: Run tests to verify they pass**

```bash
cd services/signal && npm install && npm test
```

Expected: all pass.

**Step 3: Commit**

```bash
git add services/signal/tests/
git commit -m "test(signal): add utils tests"
```

---

## Task 6: Signal bridge — transport implementation

The core bridge: spawns signal-cli daemon, connects to bloom-channels Unix socket, routes messages between them.

**Files:**
- Create: `services/signal/src/transport.ts`

**Step 1: Write transport.ts**

Write `services/signal/src/transport.ts`:

```typescript
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
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

/** Parsed envelope from signal-cli JSON output. */
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

	const proc = spawn(SIGNAL_CLI, [
		"--config", SIGNAL_CONFIG_DIR,
		"--account", SIGNAL_ACCOUNT,
		"--output=json",
		"daemon",
		"--receive-mode=on-connection",
	], {
		stdio: ["pipe", "pipe", "pipe"],
	});

	signalProcess = proc;

	proc.stderr?.on("data", (chunk: Buffer) => {
		const line = chunk.toString().trim();
		if (line) console.error(`[signal-cli] ${line}`);

		// Detect readiness from stderr output
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

	// Handle attachments as media
	for (const att of attachments) {
		if (att.id && att.contentType) {
			try {
				// signal-cli saves attachments to config dir
				const srcPath = `${SIGNAL_CONFIG_DIR}/attachments/${att.id}`;
				const ext = mimeToExt(att.contentType);
				const id = randomBytes(6).toString("hex");
				const filename = `${timestamp}-${id}.${ext}`;
				const filepath = `${MEDIA_DIR}/${filename}`;

				await mkdir(MEDIA_DIR, { recursive: true });
				// Copy from signal-cli attachment dir to shared media dir
				const { readFile } = await import("node:fs/promises");
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

	// Handle text message
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
```

**Step 2: Verify build**

```bash
cd services/signal && npm run build
```

Expected: clean compile, `dist/transport.js` produced.

**Step 3: Commit**

```bash
git add services/signal/src/transport.ts
git commit -m "feat(signal): implement transport bridge (signal-cli daemon + bloom-channels)"
```

---

## Task 7: Signal bridge — Containerfile and quadlet

**Files:**
- Create: `services/signal/Containerfile`
- Create: `services/signal/quadlet/bloom-signal.container`
- Create: `services/signal/quadlet/bloom-signal-data.volume`

**Step 1: Create Containerfile**

Write `services/signal/Containerfile`:

```dockerfile
FROM docker.io/library/eclipse-temurin:21-jre-alpine AS base

# Install signal-cli
ARG SIGNAL_CLI_VERSION=0.13.12
RUN apk add --no-cache curl bash && \
    curl -L -o /tmp/signal-cli.tar.gz \
      "https://github.com/AsamK/signal-cli/releases/download/v${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}.tar.gz" && \
    tar xf /tmp/signal-cli.tar.gz -C /opt && \
    mv /opt/signal-cli-${SIGNAL_CLI_VERSION} /opt/signal-cli && \
    ln -s /opt/signal-cli/bin/signal-cli /usr/local/bin/signal-cli && \
    rm /tmp/signal-cli.tar.gz

# Install Node.js
RUN apk add --no-cache nodejs npm

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY dist/ dist/

ENV NODE_ENV=production
ENV SIGNAL_CLI_PATH=/usr/local/bin/signal-cli
ENV SIGNAL_CONFIG_DIR=/data/signal
ENV BLOOM_MEDIA_DIR=/media/bloom
ENV BLOOM_HEALTH_PORT=18802

RUN mkdir -p /data/signal /media/bloom

EXPOSE 18802

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD wget -qO- http://localhost:18802/health || exit 1

CMD ["node", "dist/transport.js"]
```

NOTE: Pin `SIGNAL_CLI_VERSION` to the latest stable release at implementation time. Check https://github.com/AsamK/signal-cli/releases.

**Step 2: Create container quadlet**

Write `services/signal/quadlet/bloom-signal.container`:

```ini
[Unit]
Description=Bloom Signal Bridge (signal-cli)
After=network-online.target
Wants=network-online.target

[Container]
Image=localhost/bloom-signal:latest
ContainerName=bloom-signal

# Bridge network for isolation
Network=bloom.network

# Health check endpoint on localhost
PublishPort=127.0.0.1:18802:18802

# Signal state persists across restarts
Volume=bloom-signal-data:/data/signal

# Media files shared with host
Volume=/var/lib/bloom/media:/media/bloom

# Channel bridge Unix socket
Volume=%t/bloom:/run/bloom

Environment=BLOOM_CHANNELS_SOCKET=/run/bloom/channels.sock
Environment=NODE_ENV=production

# Signal account phone number (set during setup)
EnvironmentFile=%h/.config/bloom/signal.env

# Auth credentials (generated by service_install)
EnvironmentFile=%h/.config/bloom/channel-tokens/signal.env

PodmanArgs=--memory=512m
PodmanArgs=--security-opt label=disable
HealthCmd=wget -qO- http://localhost:18802/health || exit 1
HealthInterval=30s
HealthRetries=3
HealthTimeout=10s
HealthStartPeriod=120s
NoNewPrivileges=true
LogDriver=journald

[Service]
Restart=on-failure
RestartSec=10
TimeoutStartSec=300
TimeoutStopSec=30

[Install]
WantedBy=default.target
```

**Step 3: Create volume definition**

Write `services/signal/quadlet/bloom-signal-data.volume`:

```ini
[Volume]
```

**Step 4: Commit**

```bash
git add services/signal/Containerfile services/signal/quadlet/
git commit -m "feat(signal): add Containerfile and quadlet units"
```

---

## Task 8: Signal bridge — SKILL.md and catalog entry

**Files:**
- Create: `services/signal/SKILL.md`
- Modify: `services/catalog.yaml` (add signal entry)

**Step 1: Create SKILL.md**

Write `services/signal/SKILL.md`:

```markdown
---
name: signal
version: 0.1.0
description: Signal messaging bridge via signal-cli (containerized)
image: localhost/bloom-signal:latest
---

# Signal Bridge

Bridges Signal messages to Pi via the bloom-channels Unix socket protocol. Uses signal-cli for the Signal protocol.

## Setup

### 1) Build the container image

```bash
cd services/signal
npm install && npm run build
podman build -t bloom-signal:latest .
```

### 2) Configure your Signal account

```bash
mkdir -p ~/.config/bloom
echo "SIGNAL_ACCOUNT=+1234567890" > ~/.config/bloom/signal.env
```

### 3) Install and start

```bash
service_install(name="signal")
systemctl --user start bloom-signal.service
```

### 4) Link to your Signal account

Watch logs for the device linking URI:

```bash
journalctl --user -u bloom-signal -f
```

When you see a `tsdevice://` URI, open Signal on your phone:
Settings > Linked Devices > Link New Device > scan the QR code (or paste the URI).

### 5) Verify

```bash
service_test(name="signal")
```

## Sending Messages

Use the `/signal` command in Pi to send a message:

```
/signal +1234567890 Hello from Bloom!
```

## Service Control

```bash
systemctl --user start bloom-signal.service
systemctl --user status bloom-signal
systemctl --user stop bloom-signal.service
journalctl --user -u bloom-signal -f
```

## Notes

- Signal requires a phone number for registration
- Device linking persists in the `bloom-signal-data` volume
- Media files (images, voice notes) are saved to `/var/lib/bloom/media/`
- Memory usage: ~512MB (Java runtime + Node.js bridge)
- The bridge reconnects automatically if bloom-channels restarts
```

**Step 2: Add signal to catalog.yaml**

Add after the `stt` entry in `services/catalog.yaml`:

```yaml
  signal:
    version: "0.1.0"
    category: communication
    image: localhost/bloom-signal:latest
    optional: true
    preflight:
      commands: [podman, systemctl]
```

**Step 3: Commit**

```bash
git add services/signal/SKILL.md services/catalog.yaml
git commit -m "feat(signal): add SKILL.md and catalog entry"
```

---

## Task 9: Register `/signal` command in bloom-channels

Add a `/signal` command parallel to the existing `/wa` command.

**Files:**
- Modify: `extensions/bloom-channels.ts`

**Step 1: Add the command registration**

In `extensions/bloom-channels.ts`, after the existing `/wa` command registration (line 429-440), add:

```typescript
	pi.registerCommand("signal", {
		description: "Send a message to Signal",
		handler: async (args: string, ctx) => {
			const signalChannel = channels.get("signal");
			if (!signalChannel) {
				ctx.ui.notify("Signal not connected", "warning");
				return;
			}
			const msg = `${JSON.stringify({ type: "send", channel: "signal", text: args })}\n`;
			signalChannel.socket.write(msg);
			ctx.ui.notify("Sent to Signal", "info");
		},
	});
```

**Step 2: Update the JSDoc comment at the top of the file**

Change line 4 from:
```typescript
 * @commands /wa (send message to WhatsApp channel)
```
to:
```typescript
 * @commands /wa (send message to WhatsApp), /signal (send message to Signal)
```

**Step 3: Build and run tests**

```bash
npm run build && npm test
```

Expected: all pass.

**Step 4: Commit**

```bash
git add extensions/bloom-channels.ts
git commit -m "feat: register /signal command in bloom-channels"
```

---

## Task 10: Update documentation

Update all docs that reference lemonade or the service table to reflect the new stack.

**Files:**
- Modify: `docs/service-architecture.md`
- Modify: `docs/channel-protocol.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `skills/first-boot/SKILL.md`
- Modify: `services/README.md`

**Step 1: Update service-architecture.md**

Key changes:
- Replace all `lemonade` / `bloom-lemonade` references with `bloom-llm` and `bloom-stt`
- Update the system overview mermaid diagram: replace `lemonade[bloom-lemonade<br/>Lemonade :8000]` with `llm[bloom-llm<br/>llama.cpp :8080]` and add `stt[bloom-stt<br/>whisper.cpp :8081]`
- Add `signal[bloom-signal<br/>Signal Bridge]` to the service containers
- Update the "When to Use What" table: replace `Lemonade (local LLM)` with `LLM (llama.cpp), STT (whisper.cpp)`
- Update the media pipeline diagram: replace `Lemonade` references with `bloom-stt`
- Update the available services table
- Update the container volumes section: replace `bloom-lemonade-models` with `bloom-llm-models` and add `bloom-stt-models`
- Update the unit name table to show llm, stt, signal

**Step 2: Update channel-protocol.md**

In the "Current Bridges" section (line 134-136), add Signal:

```markdown
## 📦 Current Bridges

- **WhatsApp (Baileys)** — channel `whatsapp`, deployed as a Podman Quadlet service
- **Signal (signal-cli)** — channel `signal`, deployed as a Podman Quadlet service
```

**Step 3: Update AGENTS.md**

- Update the services table (around line 200) to replace bloom-lemonade with bloom-llm and bloom-stt, add bloom-signal
- Update any lemonade references in tool descriptions

**Step 4: Update CLAUDE.md**

- In the services line, change `lemonade` to `llm, stt`
- Add `signal` to the services list

**Step 5: Update README.md**

- Update the services table if present

**Step 6: Update first-boot SKILL.md**

- Replace `service_install(name="lemonade")` with `service_install(name="llm")`
- Replace `service_test(name="lemonade")` with `service_test(name="llm")`
- Add llm model download step
- Add stt service install as optional step
- Add signal bridge as optional alternative to WhatsApp
- Update port references (8000 → 8080 for LLM, 8081 for STT)

**Step 7: Update services/README.md**

- Update the service listing to include llm, stt, signal and remove lemonade

**Step 8: Commit**

```bash
git add docs/ AGENTS.md CLAUDE.md README.md skills/first-boot/SKILL.md services/README.md
git commit -m "docs: update all references for llm/stt/signal service stack"
```

---

## Task 11: Final verification

**Step 1: Build and test**

```bash
npm run build && npm test && npm run check
```

Expected: clean build, all tests pass, no lint errors.

**Step 2: Search for stale references**

```bash
grep -rn "lemonade" --include="*.ts" --include="*.md" --include="*.yaml" --include="*.ini" . | grep -v node_modules | grep -v docs/plans/
```

Expected: zero matches outside historical plan documents.

**Step 3: Verify catalog matches service directories**

```bash
ls services/*/SKILL.md
# Should show: llm, stt, whatsapp, signal, dufs
# Should NOT show: lemonade
```

**Step 4: Commit any remaining fixes**

```bash
git add -A && git commit -m "chore: final verification cleanup"
```
