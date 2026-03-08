# First-Boot Setup Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all issues discovered during the first VM boot session: broken image builds, missing models, QR codes not visible in Pi TUI, broken NetBird greeting, and missing STT auto-dependency.

**Architecture:** Seven targeted fixes across the service lifecycle. The heaviest change is adding a `service_pair` tool + `pairing` channel protocol message so QR codes render inline in Pi's conversation. The rest are Containerfile fixes, catalog extensions, and install logic improvements.

**Tech Stack:** TypeScript (extensions), YAML (catalog), Shell (greeting), Containerfile (signal), Quadlet (stt)

---

### Task 1: Fix Signal Containerfile — switch Alpine to Debian for glibc

Signal-cli's native `libsignal_jni_amd64.so` requires glibc. The Alpine base (`eclipse-temurin:21-jre-alpine`) only has musl. Switch to `eclipse-temurin:21-jre` (Debian-based).

**Files:**
- Modify: `services/signal/Containerfile`

**Step 1: Update the Containerfile**

Replace the entire file with:

```dockerfile
FROM docker.io/library/eclipse-temurin:21-jre AS base

# Install signal-cli
ARG SIGNAL_CLI_VERSION=0.13.12
RUN apt-get update && apt-get install -y --no-install-recommends curl bash && \
    curl -L -o /tmp/signal-cli.tar.gz \
      "https://github.com/AsamK/signal-cli/releases/download/v${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}.tar.gz" && \
    tar xf /tmp/signal-cli.tar.gz -C /opt && \
    mv /opt/signal-cli-${SIGNAL_CLI_VERSION} /opt/signal-cli && \
    ln -s /opt/signal-cli/bin/signal-cli /usr/local/bin/signal-cli && \
    rm /tmp/signal-cli.tar.gz && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

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

Key changes: `eclipse-temurin:21-jre` (no `-alpine`), `apt-get` instead of `apk`, NodeSource for Node.js 22.

**Step 2: Verify it builds locally**

Run: `cd services/signal && podman build -t bloom-signal:test .`

This won't work in CI (no podman), so just verify the Containerfile syntax is valid and commit.

**Step 3: Commit**

```bash
git add services/signal/Containerfile
git commit -m "fix(signal): switch to glibc-based image for libsignal compatibility"
```

---

### Task 2: Fix STT quadlet entrypoint

The `ghcr.io/ggml-org/whisper.cpp:main` image doesn't use `whisper-server` as its default entrypoint. The quadlet `Exec=` line must specify the full binary path.

**Files:**
- Modify: `services/stt/quadlet/bloom-stt.container:23`

**Step 1: Fix the Exec line**

In `services/stt/quadlet/bloom-stt.container`, change line 23 from:

```
Exec=--host 0.0.0.0 --port 8081 --model /models/ggml-base.en.bin --threads 4
```

to:

```
Exec=/app/build/bin/whisper-server --host 0.0.0.0 --port 8081 --model /models/ggml-base.en.bin --threads 4
```

**Step 2: Commit**

```bash
git add services/stt/quadlet/bloom-stt.container
git commit -m "fix(stt): use full path to whisper-server in quadlet Exec"
```

---

### Task 3: Add `depends` and `models` fields to service catalog

Extend `services/catalog.yaml` with dependency declarations and model download metadata.

**Files:**
- Modify: `services/catalog.yaml`
- Modify: `lib/manifest.ts` (add `depends` and `models` to `ServiceCatalogEntry` interface)
- Test: `tests/lib/manifest.test.ts`

**Step 1: Write failing test for new catalog fields**

Add to `tests/lib/manifest.test.ts`:

```typescript
it("loads catalog with depends and models fields", () => {
	const catalogDir = join(tempDir, "services");
	mkdirSync(catalogDir, { recursive: true });
	writeFileSync(
		join(catalogDir, "catalog.yaml"),
		[
			"services:",
			"  whatsapp:",
			"    version: '0.3.0'",
			"    category: communication",
			"    image: localhost/bloom-whatsapp:latest",
			"    depends: [stt]",
			"  stt:",
			"    version: '0.1.0'",
			"    category: ai",
			"    image: ghcr.io/ggml-org/whisper.cpp:main",
			"    models:",
			"      - volume: bloom-stt-models",
			"        path: /models/ggml-base.en.bin",
			"        url: https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
		].join("\n"),
	);
	const catalog = loadServiceCatalog(tempDir);
	expect(catalog.whatsapp.depends).toEqual(["stt"]);
	expect(catalog.stt.models).toHaveLength(1);
	expect(catalog.stt.models![0].volume).toBe("bloom-stt-models");
	expect(catalog.stt.models![0].path).toBe("/models/ggml-base.en.bin");
	expect(catalog.stt.models![0].url).toContain("huggingface.co");
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/lib/manifest.test.ts`

Expected: FAIL — `depends` and `models` not on the interface yet.

**Step 3: Add fields to ServiceCatalogEntry interface**

In `lib/manifest.ts`, update the `ServiceCatalogEntry` interface (around line 61):

```typescript
export interface ServiceCatalogEntry {
	version?: string;
	category?: string;
	image?: string;
	optional?: boolean;
	depends?: string[];
	models?: Array<{
		volume: string;
		path: string;
		url: string;
	}>;
	preflight?: {
		commands?: string[];
		rootless_subids?: boolean;
	};
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/lib/manifest.test.ts`

Expected: PASS

**Step 5: Update the catalog YAML**

Replace `services/catalog.yaml` with:

```yaml
version: 1
source_repo: https://github.com/pibloom/pi-bloom
services:
  llm:
    version: "0.1.0"
    category: ai
    image: ghcr.io/ggml-org/llama.cpp:server
    optional: true
    preflight:
      commands: [podman, systemctl]
  stt:
    version: "0.1.0"
    category: ai
    image: ghcr.io/ggml-org/whisper.cpp:main
    optional: true
    models:
      - volume: bloom-stt-models
        path: /models/ggml-base.en.bin
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
    preflight:
      commands: [podman, systemctl]
  whatsapp:
    version: "0.3.0"
    category: communication
    image: localhost/bloom-whatsapp:latest
    optional: true
    depends: [stt]
    preflight:
      commands: [podman, systemctl]
  signal:
    version: "0.1.0"
    category: communication
    image: localhost/bloom-signal:latest
    optional: true
    depends: [stt]
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

Note: `llm` changed from `optional: false` to `optional: true` per user requirement that LLM is optional.

**Step 6: Commit**

```bash
git add lib/manifest.ts services/catalog.yaml tests/lib/manifest.test.ts
git commit -m "feat(catalog): add depends and models fields for service dependencies"
```

---

### Task 4: Auto-build local images and download models in service_install

When `service_install` installs a service whose image starts with `localhost/`, build it. When a service has `models` in the catalog, download them.

**Files:**
- Modify: `lib/manifest.ts` — add `buildLocalImage()` and `downloadServiceModels()` functions
- Modify: `extensions/bloom-services.ts` — call them from `service_install`
- Test: `tests/lib/manifest.test.ts`

**Step 1: Write failing test for buildLocalImage**

Add to `tests/lib/manifest.test.ts`:

```typescript
import { buildLocalImage, downloadServiceModels } from "../../lib/manifest.js";

describe("buildLocalImage", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "build-img-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns skip result when image does not start with localhost/", async () => {
		const result = await buildLocalImage("llm", "ghcr.io/ggml-org/llama.cpp:server", tempDir);
		expect(result.skipped).toBe(true);
	});

	it("returns error when service source dir is missing", async () => {
		const result = await buildLocalImage("signal", "localhost/bloom-signal:latest", "/tmp/__nonexistent__");
		expect(result.skipped).toBe(false);
		expect(result.ok).toBe(false);
		expect(result.note).toContain("not found");
	});
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/lib/manifest.test.ts`

Expected: FAIL — `buildLocalImage` not exported.

**Step 3: Implement buildLocalImage and downloadServiceModels**

Add to `lib/manifest.ts` after the `installServicePackage` function:

```typescript
/** Build a local container image if the image ref starts with localhost/. */
export async function buildLocalImage(
	name: string,
	image: string,
	repoDir: string,
	signal?: AbortSignal,
): Promise<{ ok: boolean; skipped: boolean; note?: string }> {
	if (!image.startsWith("localhost/")) {
		return { ok: true, skipped: true };
	}

	// Check if image already exists
	const exists = await run("podman", ["image", "exists", image], signal);
	if (exists.exitCode === 0) {
		return { ok: true, skipped: true, note: "image already exists" };
	}

	// Find service source directory
	const candidates = [
		join(repoDir, "services", name),
		`/usr/local/share/bloom/services/${name}`,
	];
	let serviceDir: string | null = null;
	for (const candidate of candidates) {
		if (existsSync(join(candidate, "Containerfile"))) {
			serviceDir = candidate;
			break;
		}
	}
	if (!serviceDir) {
		return { ok: false, skipped: false, note: `Service source with Containerfile not found for ${name}` };
	}

	// Build in a temp directory: npm install, npm run build, podman build
	const buildDir = mkdtempSync(join(os.tmpdir(), `bloom-build-${name}-`));
	try {
		// Copy source to build dir
		const cpResult = await run("cp", ["-a", `${serviceDir}/.`, buildDir], signal);
		if (cpResult.exitCode !== 0) {
			return { ok: false, skipped: false, note: `Failed to copy source: ${cpResult.stderr}` };
		}

		// npm install + build if package.json exists
		if (existsSync(join(buildDir, "package.json"))) {
			const npmInstall = await run("npm", ["install"], signal, buildDir);
			if (npmInstall.exitCode !== 0) {
				return { ok: false, skipped: false, note: `npm install failed: ${npmInstall.stderr}` };
			}
			const npmBuild = await run("npm", ["run", "build"], signal, buildDir);
			if (npmBuild.exitCode !== 0) {
				return { ok: false, skipped: false, note: `npm run build failed: ${npmBuild.stderr}` };
			}
		}

		// podman build
		const tag = image.replace(/^localhost\//, "");
		const podmanBuild = await run(
			"podman",
			["build", "-t", tag, "-f", "Containerfile", "."],
			signal,
			buildDir,
		);
		if (podmanBuild.exitCode !== 0) {
			return { ok: false, skipped: false, note: `podman build failed: ${podmanBuild.stderr}` };
		}

		return { ok: true, skipped: false };
	} finally {
		rmSync(buildDir, { recursive: true, force: true });
	}
}

/** Download required models for a service if not already present in volumes. */
export async function downloadServiceModels(
	models: Array<{ volume: string; path: string; url: string }>,
	signal?: AbortSignal,
): Promise<{ ok: boolean; downloaded: number; note?: string }> {
	let downloaded = 0;

	for (const model of models) {
		// Ensure volume exists
		const volCheck = await run("podman", ["volume", "inspect", model.volume], signal);
		if (volCheck.exitCode !== 0) {
			await run("podman", ["volume", "create", model.volume], signal);
		}

		// Check if model file already exists in volume
		const fileCheck = await run(
			"podman",
			["run", "--rm", "-v", `${model.volume}:/vol:ro`, "docker.io/library/busybox:latest", "test", "-f", `/vol${model.path.startsWith("/") ? model.path.slice(model.path.indexOf("/", 1)) : model.path}`],
			signal,
		);
		if (fileCheck.exitCode === 0) continue;

		// Download model into volume
		const filename = model.path.split("/").pop() ?? "model";
		const dlResult = await run(
			"podman",
			[
				"run", "--rm",
				"-v", `${model.volume}:/models`,
				"docker.io/curlimages/curl:latest",
				"-L", "-o", `/models/${filename}`,
				model.url,
			],
			signal,
		);
		if (dlResult.exitCode !== 0) {
			return { ok: false, downloaded, note: `Failed to download model ${filename}: ${dlResult.stderr}` };
		}
		downloaded++;
	}

	return { ok: true, downloaded };
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/lib/manifest.test.ts`

Expected: PASS

**Step 5: Wire into service_install in bloom-services.ts**

In `extensions/bloom-services.ts`, in the `service_install` execute function, after the `installServicePackage` call succeeds (around line 168) and before `daemon-reload`, add:

```typescript
// Build local image if needed (localhost/* images)
const catalogImage = catalogEntry?.image ?? meta.image ?? "";
const buildResult = await buildLocalImage(params.name, catalogImage, repoDir, signal);
if (!buildResult.ok) {
	return errorResult(buildResult.note ?? `Image build failed for ${params.name}`);
}

// Download required models
if (catalogEntry?.models && catalogEntry.models.length > 0) {
	const modelResult = await downloadServiceModels(catalogEntry.models, signal);
	if (!modelResult.ok) {
		return errorResult(modelResult.note ?? `Model download failed for ${params.name}`);
	}
}
```

Also add the imports at the top of `extensions/bloom-services.ts`:

```typescript
import {
	buildLocalImage,
	detectRunningServices,
	downloadServiceModels,
	installServicePackage,
	loadManifest,
	loadServiceCatalog,
	type Manifest,
	saveManifest,
	servicePreflightErrors,
} from "../lib/manifest.js";
```

**Step 6: Wire dependency auto-install into service_install**

Still in the `service_install` execute function, after the main install succeeds and manifest is updated (after line 193), add:

```typescript
// Auto-install dependencies (e.g., stt for whatsapp/signal)
const deps = catalogEntry?.depends ?? [];
for (const dep of deps) {
	const depUnit = join(os.homedir(), ".config", "containers", "systemd", `bloom-${dep}.container`);
	if (existsSync(depUnit)) continue; // already installed

	const depCatalog = catalog[dep];
	const depVersion = depCatalog?.version ?? "latest";
	const depPreflight = await servicePreflightErrors(dep, depCatalog, signal);
	if (depPreflight.length > 0) {
		log.warn("dependency preflight failed", { dep, errors: depPreflight });
		continue;
	}

	const depInstall = await installServicePackage(dep, depVersion, bloomDir, repoDir, depCatalog, signal);
	if (!depInstall.ok) {
		log.warn("dependency install failed", { dep, note: depInstall.note });
		continue;
	}

	const depImage = depCatalog?.image ?? "";
	const depBuild = await buildLocalImage(dep, depImage, repoDir, signal);
	if (!depBuild.ok) {
		log.warn("dependency image build failed", { dep, note: depBuild.note });
		continue;
	}

	if (depCatalog?.models && depCatalog.models.length > 0) {
		const depModelResult = await downloadServiceModels(depCatalog.models, signal);
		if (!depModelResult.ok) {
			log.warn("dependency model download failed", { dep, note: depModelResult.note });
		}
	}

	await run("systemctl", ["--user", "daemon-reload"], signal);
	await run("systemctl", ["--user", "start", `bloom-${dep}.service`], signal);

	const manifest = loadManifest(manifestPath);
	manifest.services[dep] = {
		image: depImage || "unknown",
		version: depVersion,
		enabled: true,
	};
	saveManifest(manifest, manifestPath);
}
```

**Step 7: Commit**

```bash
git add lib/manifest.ts extensions/bloom-services.ts tests/lib/manifest.test.ts
git commit -m "feat(services): auto-build local images, download models, install dependencies"
```

---

### Task 5: Add `pairing` message type to channel protocol

Transports send `{type: "pairing", data: "..."}` when QR/linking data is available. bloom-channels stores the latest pairing data per channel for the `service_pair` tool to read.

**Files:**
- Modify: `extensions/bloom-channels.ts` — handle `pairing` message type, expose pairing state
- Test: `tests/extensions/bloom-channels.test.ts`

**Step 1: Write failing test for pairing state**

Add to `tests/extensions/bloom-channels.test.ts`:

```typescript
import { getPairingData, setPairingData, clearPairingData } from "../../extensions/bloom-channels.js";

describe("pairing state", () => {
	it("returns null when no pairing data exists", () => {
		expect(getPairingData("whatsapp")).toBeNull();
	});

	it("stores and retrieves pairing data", () => {
		setPairingData("whatsapp", "2@ABC123");
		expect(getPairingData("whatsapp")).toBe("2@ABC123");
		clearPairingData("whatsapp");
	});

	it("overwrites previous pairing data", () => {
		setPairingData("signal", "sgnl://first");
		setPairingData("signal", "sgnl://second");
		expect(getPairingData("signal")).toBe("sgnl://second");
		clearPairingData("signal");
	});

	it("clearPairingData removes data", () => {
		setPairingData("whatsapp", "data");
		clearPairingData("whatsapp");
		expect(getPairingData("whatsapp")).toBeNull();
	});
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/extensions/bloom-channels.test.ts`

Expected: FAIL — functions not exported.

**Step 3: Add pairing state module exports and handle pairing messages**

In `extensions/bloom-channels.ts`, add after the constants (around line 76, before `loadToken`):

```typescript
// --- Pairing state (shared with service_pair tool) ---

const pairingState = new Map<string, string>();

export function getPairingData(channel: string): string | null {
	return pairingState.get(channel) ?? null;
}

export function setPairingData(channel: string, data: string): void {
	pairingState.set(channel, data);
}

export function clearPairingData(channel: string): void {
	pairingState.delete(channel);
}
```

In the `IncomingMessage` interface (line 52), add `"pairing"` to the type union:

```typescript
interface IncomingMessage {
	type: "register" | "message" | "pong" | "pairing";
	// ... rest unchanged
	data?: string;
}
```

In the `handleSocketData` function, add a handler for `pairing` type before the `message` handler (around line 242):

```typescript
if (msg.type === "pairing") {
	const channel = msg.channel;
	if (channel && msg.data) {
		setPairingData(channel, msg.data);
		log.info("received pairing data", { channel });
	}
	continue;
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/extensions/bloom-channels.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add extensions/bloom-channels.ts tests/extensions/bloom-channels.test.ts
git commit -m "feat(channels): add pairing message type and shared pairing state"
```

---

### Task 6: Transport changes — send pairing data over channel socket

Both transports already connect to the channel socket. Add a `pairing` message when QR/linking data is available.

**Files:**
- Modify: `services/whatsapp/src/transport.ts` — send pairing message on QR event
- Modify: `services/signal/src/transport.ts` — send pairing message on link URI

**Step 1: Update WhatsApp transport**

In `services/whatsapp/src/transport.ts`, in the `connection.update` handler (around line 106-109), after `qrcode.generate`, add:

```typescript
if (qr) {
	console.log("[wa] QR code — scan with WhatsApp mobile app (Settings > Linked Devices):");
	qrcode.generate(qr, { small: true });
	// Send QR data to channel bridge for service_pair tool
	sendToChannels({ type: "pairing", channel: "whatsapp", data: qr });
}
```

Note: `sendToChannels` may fail silently if the socket isn't connected yet (which is fine — `service_pair` will poll). The QR code is also stored in the channel socket server's pairing state, so even if the socket connects after the QR is generated, the next QR refresh (Baileys refreshes QR periodically) will send it.

**Step 2: Update Signal transport**

In `services/signal/src/transport.ts`, the signal-cli daemon outputs JSON to stdout. When in linking mode, the URI appears in stderr. We need to capture it.

In the `startSignalDaemon` function (around line 145-156), update the stderr handler:

```typescript
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
```

Note: Signal transports may not be connected to the channel socket during initial linking. This is handled by Task 7's `service_pair` tool which also tails journalctl as a fallback.

**Step 3: Commit**

```bash
git add services/whatsapp/src/transport.ts services/signal/src/transport.ts
git commit -m "feat(transports): send pairing data over channel socket"
```

---

### Task 7: Add `service_pair` tool to bloom-services

A new tool that Pi calls to get QR codes inline in the conversation.

**Files:**
- Modify: `extensions/bloom-services.ts` — add `service_pair` tool
- Add dependency: `qrcode` npm package to root `package.json`

**Step 1: Install qrcode dependency**

Run: `npm install qrcode @types/qrcode`

This provides `qrcode.toString(data, { type: "terminal" })` for ASCII QR rendering.

**Step 2: Add TypeScript type declaration if needed**

Check if `@types/qrcode` provides what we need. If not, add a minimal declaration. The key function is:

```typescript
import QRCode from "qrcode";
const ascii = await QRCode.toString(data, { type: "terminal", small: true });
```

**Step 3: Implement service_pair tool**

In `extensions/bloom-services.ts`, add after the `service_test` tool registration (around line 305):

```typescript
import QRCode from "qrcode";
import { getPairingData, clearPairingData } from "./bloom-channels.js";
```

(Add these imports at the top of the file.)

Then register the tool:

```typescript
pi.registerTool({
	name: "service_pair",
	label: "Pair Messaging Service",
	description:
		"Get a QR code for pairing WhatsApp or Signal. Returns ASCII QR art inline. For WhatsApp, scan with WhatsApp mobile app (Settings > Linked Devices). For Signal, scan with Signal app (Settings > Linked Devices > Link New Device).",
	parameters: Type.Object({
		name: StringEnum(["whatsapp", "signal"] as const, {
			description: "Service to pair",
		}),
		timeout_sec: Type.Optional(
			Type.Number({ description: "Max seconds to wait for QR data", default: 60 }),
		),
	}),
	async execute(_toolCallId, params, signal) {
		const serviceName = params.name;
		const timeoutSec = Math.max(10, Math.round(params.timeout_sec ?? 60));
		const unit = `bloom-${serviceName}.service`;

		// Check service is installed
		const systemdDir = join(os.homedir(), ".config", "containers", "systemd");
		if (!existsSync(join(systemdDir, `bloom-${serviceName}.container`))) {
			return errorResult(`${serviceName} is not installed. Run service_install(name="${serviceName}") first.`);
		}

		// Restart service to trigger fresh QR/linking
		await run("systemctl", ["--user", "restart", unit], signal);

		// Clear old pairing data
		clearPairingData(serviceName);

		// Poll for pairing data from channel bridge
		const deadline = Date.now() + timeoutSec * 1000;
		let pairingData: string | null = null;

		while (Date.now() < deadline) {
			pairingData = getPairingData(serviceName);
			if (pairingData) break;

			// Fallback: check journalctl for QR data
			if (!pairingData) {
				const logs = await run(
					"journalctl",
					["--user", "-u", unit, "-n", "50", "--no-pager", "--since", "30s ago"],
					signal,
				);
				if (serviceName === "signal") {
					const match = logs.stdout.match(/(sgnl:\/\/linkdevice\?[^\s]+)/);
					if (match) {
						pairingData = match[1];
						break;
					}
				}
				// WhatsApp raw QR data is harder to parse from logs, rely on channel socket
			}

			await sleep(2000);
		}

		if (!pairingData) {
			return errorResult(
				`No pairing data received within ${timeoutSec}s. Check service logs: journalctl --user -u ${unit} -n 100`,
			);
		}

		// Generate ASCII QR code
		try {
			const qrArt = await QRCode.toString(pairingData, { type: "terminal", small: true });
			const instructions =
				serviceName === "whatsapp"
					? "Scan this QR code with your WhatsApp mobile app:\nSettings > Linked Devices > Link a Device"
					: "Scan this QR code with your Signal mobile app:\nSettings > Linked Devices > Link New Device";

			return {
				content: [{ type: "text" as const, text: `${instructions}\n\n${qrArt}` }],
				details: { service: serviceName, paired: false },
			};
		} catch (err) {
			return errorResult(`Failed to generate QR code: ${(err as Error).message}`);
		}
	},
});
```

**Step 4: Run build to verify compilation**

Run: `npm run build`

Expected: Build succeeds.

**Step 5: Commit**

```bash
git add package.json package-lock.json extensions/bloom-services.ts
git commit -m "feat(services): add service_pair tool for inline QR code pairing"
```

---

### Task 8: Remove NetBird from greeting, update first-boot skill

**Files:**
- Modify: `os/sysconfig/bloom-greeting.sh` — remove NetBird section (lines 52-116)
- Modify: `skills/first-boot/SKILL.md` — make NetBird step 1

**Step 1: Strip NetBird from greeting script**

Replace `os/sysconfig/bloom-greeting.sh` with:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Bloom login script — ensures Pi settings include Bloom package and shows greeting.

BLOOM_PKG="/usr/local/share/bloom"
PI_SETTINGS="$HOME/.pi/agent/settings.json"

# Ensure Pi settings include the Bloom package (idempotent, runs every login)
if [ -d "$BLOOM_PKG" ]; then
    mkdir -p "$(dirname "$PI_SETTINGS")"
    if [ -f "$PI_SETTINGS" ]; then
        if command -v jq >/dev/null 2>&1; then
            if ! jq -e '.packages // [] | index("'"$BLOOM_PKG"'")' "$PI_SETTINGS" >/dev/null 2>&1; then
                jq '.packages = ((.packages // []) + ["'"$BLOOM_PKG"'"] | unique)' "$PI_SETTINGS" > "${PI_SETTINGS}.tmp" && \
                    mv "${PI_SETTINGS}.tmp" "$PI_SETTINGS"
            fi
        fi
    else
        cp "$BLOOM_PKG/.pi/agent/settings.json" "$PI_SETTINGS"
    fi
fi

# First-boot greeting
FIRST_RUN_MARKER="$HOME/.bloom/.initialized"

if [ ! -f "$FIRST_RUN_MARKER" ]; then
    echo ""
    echo "  Welcome to Bloom"
    echo ""
    echo "  Your personal AI companion is starting for the first time."
    echo "  Pi will guide you through setup — just chat naturally."
    echo ""

    mkdir -p "$(dirname "$FIRST_RUN_MARKER")"
    touch "$FIRST_RUN_MARKER"
else
    echo ""
    echo "  Bloom"
    echo ""
fi
```

**Step 2: Update first-boot skill**

Replace `skills/first-boot/SKILL.md` with:

```markdown
---
name: first-boot
description: Guides first-time setup of a Bloom OS installation
---

# First-Boot Setup

Use this skill on the first session after a fresh Bloom OS install.

## Prerequisite Check

If `~/.bloom/.setup-complete` exists, setup is already complete. Skip unless user asks to re-run specific steps.

## Setup Style

- Be conversational (one step at a time)
- Let user skip/defer steps
- Prefer Bloom tools over long shell copy-paste blocks
- Clarify tool-vs-shell: `service_install`, `bloom_repo`, etc. are Pi tools (not bash commands)
- On fresh Bloom OS, user `bloom` has passwordless `sudo` for bootstrap tasks.

## Setup Steps

### 1) NetBird Mesh Networking

Check connection status:

```bash
sudo netbird status
```

If not connected, ask the user for their NetBird setup key (from https://app.netbird.io → Setup Keys):

```bash
sudo netbird up --setup-key "<key>"
```

Poll until connected:

```bash
sudo netbird status
```

Look for "Connected" in the output. The user can skip this step and connect later with `sudo netbird up`.

### 2) Git Identity

Ask the user for their name and email, then set globally:

```bash
git config --global user.name "<name>"
git config --global user.email "<email>"
```

### 3) dufs Setup

- Install service package: `service_install(name="dufs", version="0.1.0")`
- Validate service: `service_test(name="dufs")`
- The WebDAV password is the channel token in `~/.config/bloom/channel-tokens/dufs.env` (BLOOM_CHANNEL_TOKEN)
- Direct user to `http://localhost:5000` (username: `admin`)
- dufs serves `$HOME` over WebDAV

If Bloom runs inside a VM, offer access paths:
- QEMU port forward: host `localhost:5000` → guest `5000`
- SSH tunnel: `ssh -L 5000:localhost:5000 -p 2222 bloom@localhost`

### 4) Optional Services

#### WhatsApp Bridge

- Install: `service_install(name="whatsapp")`
  - This auto-installs STT (whisper.cpp) as a dependency
- Pair: `service_pair(name="whatsapp")` — displays QR code inline, scan with WhatsApp mobile app
- Verify: `service_test(name="whatsapp")`

#### Signal Bridge

- Ask the user for their phone number (E.164 format, e.g. +40749588297)
- Create config: write `SIGNAL_ACCOUNT=+<number>` to `~/.config/bloom/signal.env`
- Install: `service_install(name="signal")`
  - This auto-installs STT (whisper.cpp) as a dependency
- Pair: `service_pair(name="signal")` — displays QR code inline, scan with Signal mobile app (Settings > Linked Devices > Link New Device)
- Verify: `service_test(name="signal")`

#### LLM (optional, local language model)

- Install: `service_install(name="llm", version="0.1.0")`
- Note: requires a GGUF model file in the `bloom-llm-models` volume
- API at `http://localhost:8080` (OpenAI-compatible)

### 5) Mark Setup Complete

```bash
touch ~/.bloom/.setup-complete
```

## Notes

- Revisit skipped steps on demand
- Confirm each critical step before moving on
```

**Step 3: Commit**

```bash
git add os/sysconfig/bloom-greeting.sh skills/first-boot/SKILL.md
git commit -m "refactor(first-boot): move NetBird to Pi-guided setup, add service_pair flow"
```

---

### Task 9: Update SKILL.md files for whatsapp and signal

Remove the manual journalctl QR instructions and point to `service_pair`.

**Files:**
- Modify: `services/whatsapp/SKILL.md`
- Modify: `services/signal/SKILL.md`

**Step 1: Update WhatsApp SKILL.md**

In `services/whatsapp/SKILL.md`, replace the Setup and Pairing sections:

```markdown
## Setup

1. Install the service package: `service_install(name="whatsapp")`
   - STT is auto-installed as a dependency
2. Pair: `service_pair(name="whatsapp")` — displays QR code inline
3. Scan the QR code with WhatsApp mobile app (Settings > Linked Devices > Link a Device)
4. Verify: `service_test(name="whatsapp")`

## Pairing

Use `service_pair(name="whatsapp")` to get a fresh QR code inline in conversation. Auth state persists in the `bloom-whatsapp-auth` volume — you only need to pair once.
```

**Step 2: Update Signal SKILL.md**

Replace the setup section in `services/signal/SKILL.md`:

```markdown
## Setup

### 1) Configure your Signal account

```bash
mkdir -p ~/.config/bloom
echo "SIGNAL_ACCOUNT=+1234567890" > ~/.config/bloom/signal.env
```

### 2) Install and start

Install the service package: `service_install(name="signal")`
- The container image is built automatically
- STT is auto-installed as a dependency

### 3) Pair with your Signal account

Run: `service_pair(name="signal")` — displays QR code inline.
Open Signal on your phone: Settings > Linked Devices > Link New Device > scan.

### 4) Verify

```bash
service_test(name="signal")
```
```

**Step 3: Commit**

```bash
git add services/whatsapp/SKILL.md services/signal/SKILL.md
git commit -m "docs(services): update SKILL.md to use service_pair for QR pairing"
```

---

### Task 10: Run full test suite and lint

**Step 1: Run build**

Run: `npm run build`

Expected: No errors.

**Step 2: Run tests**

Run: `npm run test`

Expected: All tests pass.

**Step 3: Run lint**

Run: `npm run check`

Expected: No new errors (existing cognitive-complexity warnings are OK).

**Step 4: Fix any issues found**

Address any compilation, test, or lint failures before final commit.

**Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "chore: fix lint and test issues from first-boot fixes"
```

Plan complete and saved to `docs/plans/2026-03-08-first-boot-fixes.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
