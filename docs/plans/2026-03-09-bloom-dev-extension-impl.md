# bloom-dev Extension Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a `bloom-dev` extension that provides on-device development tools — code-server, local OS rebuilds, contribution workflows, and community package installation — gated behind an opt-in sentinel.

**Architecture:** New extension `extensions/bloom-dev/` following the standard pattern (index.ts wiring, actions.ts logic, types.ts types). New service `services/code-server/` with Quadlet unit and catalog entry. Integrates with existing `bloom-repo` (git/PR), `bloom-os` (bootc), and `bloom-services` (service management) extensions via shared `lib/` utilities. Setup integration modifies the `contributing` step in `bloom-setup`.

**Tech Stack:** TypeScript (strict, ES2022, NodeNext), Vitest, Biome, Podman Quadlet, bootc, code-server container

**Design doc:** `docs/plans/2026-03-09-bloom-dev-extension-design.md`

---

### Task 1: Extension Skeleton — types.ts

**Files:**
- Create: `extensions/bloom-dev/types.ts`
- Test: `tests/extensions/bloom-dev.test.ts`

**Step 1: Write the failing test**

Create `tests/extensions/bloom-dev.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { DevStatus } from "../../extensions/bloom-dev/types.js";

describe("bloom-dev types", () => {
	it("DevStatus interface is importable and structurally correct", () => {
		const status: DevStatus = {
			enabled: false,
			repoConfigured: false,
			codeServerRunning: false,
			localBuildAvailable: false,
		};
		expect(status.enabled).toBe(false);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- --run tests/extensions/bloom-dev.test.ts`
Expected: FAIL — cannot resolve `../../extensions/bloom-dev/types.js`

**Step 3: Write minimal implementation**

Create `extensions/bloom-dev/types.ts`:

```typescript
export interface DevStatus {
	enabled: boolean;
	repoConfigured: boolean;
	codeServerRunning: boolean;
	localBuildAvailable: boolean;
	repoPath?: string;
	localImageTag?: string;
}

export interface DevBuildResult {
	success: boolean;
	imageTag: string;
	duration: number;
	size?: string;
	error?: string;
}

export interface DevTestResult {
	success: boolean;
	testsPassed: boolean;
	lintPassed: boolean;
	testOutput: string;
	lintOutput: string;
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- --run tests/extensions/bloom-dev.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add extensions/bloom-dev/types.ts tests/extensions/bloom-dev.test.ts
git commit -m "feat(bloom-dev): add type definitions for dev extension"
```

---

### Task 2: Sentinel Management — actions.ts (dev_enable, dev_disable, dev_status)

**Files:**
- Create: `extensions/bloom-dev/actions.ts`
- Read: `lib/shared.ts`, `lib/exec.ts`, `lib/filesystem.ts` (for patterns)
- Test: `tests/extensions/bloom-dev.test.ts`

**Step 1: Write the failing tests**

Append to `tests/extensions/bloom-dev.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleDevEnable, handleDevDisable, handleDevStatus } from "../../extensions/bloom-dev/actions.js";

describe("sentinel management", () => {
	let bloomRuntime: string;

	beforeEach(() => {
		bloomRuntime = join(tmpdir(), `bloom-dev-test-${Date.now()}`);
		mkdirSync(bloomRuntime, { recursive: true });
	});

	afterEach(() => {
		rmSync(bloomRuntime, { recursive: true, force: true });
	});

	it("dev_enable writes sentinel file", async () => {
		const result = await handleDevEnable(bloomRuntime);
		expect(result.isError).toBeFalsy();
		expect(existsSync(join(bloomRuntime, ".dev-enabled"))).toBe(true);
	});

	it("dev_disable removes sentinel file", async () => {
		await handleDevEnable(bloomRuntime);
		const result = await handleDevDisable(bloomRuntime);
		expect(result.isError).toBeFalsy();
		expect(existsSync(join(bloomRuntime, ".dev-enabled"))).toBe(false);
	});

	it("dev_status reports disabled when no sentinel", async () => {
		const result = await handleDevStatus(bloomRuntime);
		expect(result.isError).toBeFalsy();
		expect(result.details.enabled).toBe(false);
	});

	it("dev_status reports enabled when sentinel exists", async () => {
		await handleDevEnable(bloomRuntime);
		const result = await handleDevStatus(bloomRuntime);
		expect(result.details.enabled).toBe(true);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- --run tests/extensions/bloom-dev.test.ts`
Expected: FAIL — cannot resolve `../../extensions/bloom-dev/actions.js`

**Step 3: Write minimal implementation**

Create `extensions/bloom-dev/actions.ts`:

```typescript
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../lib/exec.js";
import { errorResult, createLogger, requireConfirmation } from "../../lib/shared.js";
import type { DevStatus, DevBuildResult, DevTestResult } from "./types.js";

const log = createLogger("bloom-dev");
const SENTINEL = ".dev-enabled";
const DEV_IMAGE_TAG = "localhost/bloom:dev";

function sentinelPath(bloomRuntime: string): string {
	return join(bloomRuntime, SENTINEL);
}

export function isDevEnabled(bloomRuntime: string): boolean {
	return existsSync(sentinelPath(bloomRuntime));
}

export async function handleDevEnable(bloomRuntime: string): Promise<ToolResult> {
	mkdirSync(bloomRuntime, { recursive: true });
	writeFileSync(sentinelPath(bloomRuntime), new Date().toISOString(), "utf-8");
	log.info("dev mode enabled");

	const lines = ["Dev mode enabled."];
	lines.push("Available tools: dev_code_server, dev_build, dev_switch, dev_rollback, dev_loop, dev_test, dev_submit_pr, dev_push_skill, dev_push_service, dev_push_extension, dev_install_package");
	lines.push("\nNext steps:");
	lines.push("1. Configure the repo: bloom_repo(action: 'configure')");
	lines.push("2. Start code-server: dev_code_server(action: 'start')");

	return {
		content: [{ type: "text" as const, text: lines.join("\n") }],
		details: { enabled: true },
	};
}

export async function handleDevDisable(bloomRuntime: string): Promise<ToolResult> {
	const path = sentinelPath(bloomRuntime);
	if (existsSync(path)) {
		unlinkSync(path);
	}
	log.info("dev mode disabled");

	return {
		content: [{ type: "text" as const, text: "Dev mode disabled. Dev tools are no longer available." }],
		details: { enabled: false },
	};
}

export async function handleDevStatus(bloomRuntime: string, signal?: AbortSignal): Promise<ToolResult> {
	const enabled = isDevEnabled(bloomRuntime);
	const repoDir = join(bloomRuntime, "pi-bloom");
	const repoCheck = existsSync(join(repoDir, ".git"));

	let codeServerRunning = false;
	if (enabled) {
		const cs = await run("systemctl", ["--user", "is-active", "bloom-code-server"], signal).catch(() => ({ exitCode: 1, stdout: "", stderr: "" }));
		codeServerRunning = cs.exitCode === 0;
	}

	let localBuildAvailable = false;
	let localImageTag: string | undefined;
	if (enabled) {
		const img = await run("podman", ["image", "exists", DEV_IMAGE_TAG], signal).catch(() => ({ exitCode: 1, stdout: "", stderr: "" }));
		localBuildAvailable = img.exitCode === 0;
		if (localBuildAvailable) localImageTag = DEV_IMAGE_TAG;
	}

	const status: DevStatus = {
		enabled,
		repoConfigured: repoCheck,
		codeServerRunning,
		localBuildAvailable,
		repoPath: repoCheck ? repoDir : undefined,
		localImageTag,
	};

	const lines = [
		`Dev mode: ${status.enabled ? "enabled" : "disabled"}`,
		`Repo configured: ${status.repoConfigured}${status.repoPath ? ` (${status.repoPath})` : ""}`,
	];
	if (enabled) {
		lines.push(`Code-server: ${status.codeServerRunning ? "running" : "stopped"}`);
		lines.push(`Local build: ${status.localBuildAvailable ? status.localImageTag : "none"}`);
	}

	return {
		content: [{ type: "text" as const, text: lines.join("\n") }],
		details: status,
	};
}

type ToolResult = {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
	isError?: boolean;
};
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- --run tests/extensions/bloom-dev.test.ts`
Expected: PASS

**Step 5: Run lint**

Run: `npm run check`
Expected: PASS (or fix any issues)

**Step 6: Commit**

```bash
git add extensions/bloom-dev/actions.ts tests/extensions/bloom-dev.test.ts
git commit -m "feat(bloom-dev): add sentinel management (enable/disable/status)"
```

---

### Task 3: Extension Registration — index.ts with Gating

**Files:**
- Create: `extensions/bloom-dev/index.ts`
- Read: `extensions/bloom-repo/index.ts` (registration pattern)
- Test: `tests/extensions/bloom-dev.test.ts`

**Step 1: Write the failing tests**

Append to test file:

```typescript
import { createMockExtensionAPI, type MockExtensionAPI } from "../helpers/mock-extension-api.js";

describe("bloom-dev registration", () => {
	let api: MockExtensionAPI;

	it("always registers dev_enable, dev_disable, dev_status", async () => {
		api = createMockExtensionAPI();
		const mod = await import("../../extensions/bloom-dev/index.js");
		mod.default(api as never);
		const toolNames = api._registeredTools.map((t) => t.name as string);
		expect(toolNames).toContain("dev_enable");
		expect(toolNames).toContain("dev_disable");
		expect(toolNames).toContain("dev_status");
	});

	it("each tool has name, label, description, parameters, execute", () => {
		api = createMockExtensionAPI();
		const mod = require("../../extensions/bloom-dev/index.js");
		mod.default(api as never);
		for (const tool of api._registeredTools) {
			expect(tool).toHaveProperty("name");
			expect(tool).toHaveProperty("label");
			expect(tool).toHaveProperty("description");
			expect(tool).toHaveProperty("parameters");
			expect(tool).toHaveProperty("execute");
			expect(typeof tool.execute).toBe("function");
		}
	});
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- --run tests/extensions/bloom-dev.test.ts`
Expected: FAIL — cannot resolve `../../extensions/bloom-dev/index.js`

**Step 3: Write implementation**

Create `extensions/bloom-dev/index.ts`:

```typescript
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import {
	isDevEnabled,
	handleDevEnable,
	handleDevDisable,
	handleDevStatus,
	handleDevCodeServer,
	handleDevBuild,
	handleDevSwitch,
	handleDevRollback,
	handleDevLoop,
	handleDevTest,
	handleDevSubmitPr,
	handleDevPushSkill,
	handleDevPushService,
	handleDevPushExtension,
	handleDevInstallPackage,
} from "./actions.js";

type ExtensionAPI = Parameters<typeof registerExtension>[0];
function registerExtension(pi: ExtensionAPI) {
	const bloomRuntime = process.env.BLOOM_RUNTIME_DIR || `${process.env.HOME}/.bloom`;

	// --- Always registered (regardless of dev mode) ---

	pi.registerTool({
		name: "dev_enable",
		label: "Enable Dev Mode",
		description: "Enable developer tools for on-device development, OS rebuilds, and upstream contributions.",
		promptGuidelines: [
			"Use when user wants to contribute code, fix bugs, or develop on-device.",
			"After enabling, suggest configuring the repo with bloom_repo and starting code-server.",
		],
		parameters: Type.Object({}),
		async execute() {
			return await handleDevEnable(bloomRuntime);
		},
	});

	pi.registerTool({
		name: "dev_disable",
		label: "Disable Dev Mode",
		description: "Disable developer tools and stop code-server.",
		parameters: Type.Object({}),
		async execute() {
			return await handleDevDisable(bloomRuntime);
		},
	});

	pi.registerTool({
		name: "dev_status",
		label: "Dev Status",
		description: "Show developer environment state: enabled, repo configured, code-server running, local build available.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, signal) {
			return await handleDevStatus(bloomRuntime, signal);
		},
	});

	// --- Dev mode gated tools ---

	const devGate = () => isDevEnabled(bloomRuntime);
	const gatedDescription = (desc: string) => `${desc} Requires dev mode (dev_enable).`;

	pi.registerTool({
		name: "dev_code_server",
		label: "Code Server",
		description: gatedDescription("Start, stop, or restart the code-server web IDE."),
		parameters: Type.Object({
			action: StringEnum(["start", "stop", "restart", "status"] as const, { description: "Action to perform" }),
		}),
		async execute(_toolCallId, params, signal) {
			if (!devGate()) return gateError();
			return await handleDevCodeServer(params, signal);
		},
	});

	pi.registerTool({
		name: "dev_build",
		label: "Build OS Image",
		description: gatedDescription("Build the OS container image locally from the on-device repo."),
		parameters: Type.Object({
			tag: Type.Optional(Type.String({ description: "Image tag (default: localhost/bloom:dev)" })),
		}),
		async execute(_toolCallId, params, signal) {
			if (!devGate()) return gateError();
			return await handleDevBuild(params, signal);
		},
	});

	pi.registerTool({
		name: "dev_switch",
		label: "Switch OS Image",
		description: gatedDescription("Switch bootc to a locally-built image. Stages for next reboot."),
		parameters: Type.Object({
			tag: Type.Optional(Type.String({ description: "Image tag to switch to (default: localhost/bloom:dev)" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!devGate()) return gateError();
			return await handleDevSwitch(params, signal, ctx);
		},
	});

	pi.registerTool({
		name: "dev_rollback",
		label: "Rollback OS Image",
		description: gatedDescription("Rollback bootc to the previous OS image."),
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
			if (!devGate()) return gateError();
			return await handleDevRollback(signal, ctx);
		},
	});

	pi.registerTool({
		name: "dev_loop",
		label: "Dev Loop",
		description: gatedDescription("Full dev cycle: build OS image -> switch -> reboot -> health check -> report."),
		parameters: Type.Object({
			tag: Type.Optional(Type.String({ description: "Image tag (default: localhost/bloom:dev)" })),
			skip_reboot: Type.Optional(Type.Boolean({ description: "Stage without rebooting (default: false)" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!devGate()) return gateError();
			return await handleDevLoop(params, signal, ctx);
		},
	});

	pi.registerTool({
		name: "dev_test",
		label: "Run Tests",
		description: gatedDescription("Run tests and lint on the local repo."),
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, signal) {
			if (!devGate()) return gateError();
			return await handleDevTest(bloomRuntime, signal);
		},
	});

	pi.registerTool({
		name: "dev_submit_pr",
		label: "Submit PR",
		description: gatedDescription("Create branch, commit, push, and open PR with test results in the body."),
		parameters: Type.Object({
			title: Type.String({ description: "Pull request title" }),
			body: Type.Optional(Type.String({ description: "Additional PR body text" })),
			branch: Type.Optional(Type.String({ description: "Branch name (auto-generated if omitted)" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!devGate()) return gateError();
			return await handleDevSubmitPr(params, bloomRuntime, signal, ctx);
		},
	});

	pi.registerTool({
		name: "dev_push_skill",
		label: "Push Skill Upstream",
		description: gatedDescription("Copy a skill from ~/Bloom/Skills/ into the local repo and submit as PR."),
		parameters: Type.Object({
			skill_name: Type.String({ description: "Skill filename (e.g., 'my-skill' for my-skill/SKILL.md)" }),
			title: Type.Optional(Type.String({ description: "PR title (auto-generated if omitted)" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!devGate()) return gateError();
			return await handleDevPushSkill(params, bloomRuntime, signal, ctx);
		},
	});

	pi.registerTool({
		name: "dev_push_service",
		label: "Push Service Upstream",
		description: gatedDescription("Copy a service recipe into the local repo and submit as PR."),
		parameters: Type.Object({
			service_name: Type.String({ description: "Service name (e.g., 'my-service' for services/my-service/)" }),
			title: Type.Optional(Type.String({ description: "PR title (auto-generated if omitted)" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!devGate()) return gateError();
			return await handleDevPushService(params, bloomRuntime, signal, ctx);
		},
	});

	pi.registerTool({
		name: "dev_push_extension",
		label: "Push Extension Upstream",
		description: gatedDescription("Copy an extension into the local repo and submit as PR."),
		parameters: Type.Object({
			extension_name: Type.String({ description: "Extension directory name (e.g., 'bloom-foo' for extensions/bloom-foo/)" }),
			source_path: Type.Optional(Type.String({ description: "Source path (default: ~/Bloom/extensions/<name>)" })),
			title: Type.Optional(Type.String({ description: "PR title (auto-generated if omitted)" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!devGate()) return gateError();
			return await handleDevPushExtension(params, bloomRuntime, signal, ctx);
		},
	});

	pi.registerTool({
		name: "dev_install_package",
		label: "Install Pi Package",
		description: gatedDescription("Install a Pi package from npm, git, or local path."),
		promptGuidelines: [
			"Supports: npm:@scope/pkg, git:github.com/user/repo, https://github.com/user/repo, local paths",
			"Browse packages at shittycodingagent.ai/packages",
		],
		parameters: Type.Object({
			source: Type.String({ description: "Package source (e.g., 'npm:@foo/bar', 'git:github.com/user/repo', '/path/to/pkg')" }),
		}),
		async execute(_toolCallId, params, signal) {
			if (!devGate()) return gateError();
			return await handleDevInstallPackage(params, signal);
		},
	});
}

function gateError() {
	return {
		content: [{ type: "text" as const, text: "Dev mode is not enabled. Run dev_enable first." }],
		details: {},
		isError: true,
	};
}

export default registerExtension;
```

Note: This registers all tools but gated tools return an error if dev mode is disabled. This ensures Pi always knows the tools exist (for discoverability and guidance) but won't execute them without the sentinel.

**Step 4: Add stub exports to actions.ts**

For each handler not yet implemented, add a stub to `actions.ts`:

```typescript
export async function handleDevCodeServer(
	params: { action: string },
	signal?: AbortSignal,
): Promise<ToolResult> {
	return errorResult("Not yet implemented: dev_code_server");
}

export async function handleDevBuild(
	params: { tag?: string },
	signal?: AbortSignal,
): Promise<ToolResult> {
	return errorResult("Not yet implemented: dev_build");
}

export async function handleDevSwitch(
	params: { tag?: string },
	signal?: AbortSignal,
	ctx?: unknown,
): Promise<ToolResult> {
	return errorResult("Not yet implemented: dev_switch");
}

export async function handleDevRollback(
	signal?: AbortSignal,
	ctx?: unknown,
): Promise<ToolResult> {
	return errorResult("Not yet implemented: dev_rollback");
}

export async function handleDevLoop(
	params: { tag?: string; skip_reboot?: boolean },
	signal?: AbortSignal,
	ctx?: unknown,
): Promise<ToolResult> {
	return errorResult("Not yet implemented: dev_loop");
}

export async function handleDevTest(
	bloomRuntime: string,
	signal?: AbortSignal,
): Promise<ToolResult> {
	return errorResult("Not yet implemented: dev_test");
}

export async function handleDevSubmitPr(
	params: { title: string; body?: string; branch?: string },
	bloomRuntime: string,
	signal?: AbortSignal,
	ctx?: unknown,
): Promise<ToolResult> {
	return errorResult("Not yet implemented: dev_submit_pr");
}

export async function handleDevPushSkill(
	params: { skill_name: string; title?: string },
	bloomRuntime: string,
	signal?: AbortSignal,
	ctx?: unknown,
): Promise<ToolResult> {
	return errorResult("Not yet implemented: dev_push_skill");
}

export async function handleDevPushService(
	params: { service_name: string; title?: string },
	bloomRuntime: string,
	signal?: AbortSignal,
	ctx?: unknown,
): Promise<ToolResult> {
	return errorResult("Not yet implemented: dev_push_service");
}

export async function handleDevPushExtension(
	params: { extension_name: string; source_path?: string; title?: string },
	bloomRuntime: string,
	signal?: AbortSignal,
	ctx?: unknown,
): Promise<ToolResult> {
	return errorResult("Not yet implemented: dev_push_extension");
}

export async function handleDevInstallPackage(
	params: { source: string },
	signal?: AbortSignal,
): Promise<ToolResult> {
	return errorResult("Not yet implemented: dev_install_package");
}
```

**Step 5: Run tests to verify registration passes**

Run: `npm run test -- --run tests/extensions/bloom-dev.test.ts`
Expected: PASS

**Step 6: Run lint and build**

Run: `npm run check && npm run build`
Expected: PASS

**Step 7: Commit**

```bash
git add extensions/bloom-dev/index.ts extensions/bloom-dev/actions.ts
git commit -m "feat(bloom-dev): add extension registration with dev-mode gating"
```

---

### Task 4: code-server Service — Containerfile, Quadlet, Catalog

**Files:**
- Create: `services/code-server/Containerfile`
- Create: `services/code-server/quadlet/bloom-code-server.container`
- Modify: `services/catalog.yaml`

**Step 1: Create the Containerfile**

Create `services/code-server/Containerfile`:

```dockerfile
FROM codercom/code-server:4.96.4

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/*
USER coder

ENV PASSWORD=""
ENV DISABLE_TELEMETRY=true

EXPOSE 8443
ENTRYPOINT ["dumb-init", "code-server", "--bind-addr", "0.0.0.0:8443", "--auth", "none", "--disable-telemetry"]
```

Note: Check the latest stable code-server tag at the time of implementation. Pin it — no `latest`.

**Step 2: Create the Quadlet unit**

Create `services/code-server/quadlet/bloom-code-server.container`:

```ini
[Unit]
Description=Bloom code-server — web-based code editor
After=network-online.target
Wants=network-online.target

[Container]
Image=localhost/bloom-code-server:latest
ContainerName=bloom-code-server
Network=host
Volume=%h:/home/coder/project
Environment=DISABLE_TELEMETRY=true
PodmanArgs=--memory=512m
PodmanArgs=--security-opt label=disable
NoNewPrivileges=true
LogDriver=journald

HealthCmd=curl -f http://localhost:8443/healthz || exit 1
HealthInterval=30s
HealthRetries=3
HealthStartPeriod=10s

[Service]
Restart=on-failure
RestartSec=10
TimeoutStartSec=120

[Install]
WantedBy=default.target
```

**Step 3: Add catalog entry**

Read `services/catalog.yaml` and add the code-server entry. Append after the last service:

```yaml
  code-server:
    version: "0.1.0"
    category: development
    image: localhost/bloom-code-server:latest
    optional: true
    preflight:
      commands: [podman, systemctl]
```

**Step 4: Verify build (manual check)**

Run: `podman build -t bloom-code-server:latest services/code-server/`
Expected: Successful image build

**Step 5: Commit**

```bash
git add services/code-server/ services/catalog.yaml
git commit -m "feat(bloom-dev): add code-server service with Quadlet unit and catalog entry"
```

---

### Task 5: Implement dev_code_server Handler

**Files:**
- Modify: `extensions/bloom-dev/actions.ts`
- Test: `tests/extensions/bloom-dev.test.ts`

**Step 1: Write the failing test**

Append to test file:

```typescript
import { handleDevCodeServer } from "../../extensions/bloom-dev/actions.js";

describe("dev_code_server", () => {
	it("returns status info for status action", async () => {
		const result = await handleDevCodeServer({ action: "status" });
		expect(result.isError).toBeFalsy();
		expect(result.content[0].text).toContain("code-server");
	});
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- --run tests/extensions/bloom-dev.test.ts`
Expected: FAIL — "Not yet implemented"

**Step 3: Replace stub with implementation**

In `extensions/bloom-dev/actions.ts`, replace the `handleDevCodeServer` stub:

```typescript
export async function handleDevCodeServer(
	params: { action: string },
	signal?: AbortSignal,
): Promise<ToolResult> {
	const unit = "bloom-code-server";

	switch (params.action) {
		case "status": {
			const status = await run("systemctl", ["--user", "is-active", unit], signal).catch(() => ({
				exitCode: 1,
				stdout: "inactive",
				stderr: "",
			}));
			const active = status.exitCode === 0;
			return {
				content: [{ type: "text" as const, text: `code-server: ${active ? "running" : "stopped"}${active ? "\nAccess at http://<device-ip>:8443" : ""}` }],
				details: { running: active },
			};
		}
		case "start": {
			await run("systemctl", ["--user", "daemon-reload"], signal);
			const start = await run("systemctl", ["--user", "start", unit], signal);
			if (start.exitCode !== 0) {
				return errorResult(`Failed to start code-server:\n${start.stderr}`);
			}
			return {
				content: [{ type: "text" as const, text: "code-server started. Access at http://<device-ip>:8443" }],
				details: { running: true },
			};
		}
		case "stop": {
			const stop = await run("systemctl", ["--user", "stop", unit], signal);
			if (stop.exitCode !== 0) {
				return errorResult(`Failed to stop code-server:\n${stop.stderr}`);
			}
			return {
				content: [{ type: "text" as const, text: "code-server stopped." }],
				details: { running: false },
			};
		}
		case "restart": {
			await run("systemctl", ["--user", "daemon-reload"], signal);
			const restart = await run("systemctl", ["--user", "restart", unit], signal);
			if (restart.exitCode !== 0) {
				return errorResult(`Failed to restart code-server:\n${restart.stderr}`);
			}
			return {
				content: [{ type: "text" as const, text: "code-server restarted. Access at http://<device-ip>:8443" }],
				details: { running: true },
			};
		}
		default:
			return errorResult(`Unknown action: ${params.action}. Use start, stop, restart, or status.`);
	}
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- --run tests/extensions/bloom-dev.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add extensions/bloom-dev/actions.ts tests/extensions/bloom-dev.test.ts
git commit -m "feat(bloom-dev): implement dev_code_server handler"
```

---

### Task 6: Implement dev_build Handler

**Files:**
- Modify: `extensions/bloom-dev/actions.ts`
- Test: `tests/extensions/bloom-dev.test.ts`

**Step 1: Write the failing test**

```typescript
import { handleDevBuild } from "../../extensions/bloom-dev/actions.js";

describe("dev_build", () => {
	it("returns error when repo dir missing", async () => {
		const result = await handleDevBuild({ tag: undefined }, undefined, "/nonexistent/path");
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("not found");
	});
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- --run tests/extensions/bloom-dev.test.ts`
Expected: FAIL

**Step 3: Replace stub with implementation**

Update `handleDevBuild` signature to accept `repoDir` and implement:

```typescript
export async function handleDevBuild(
	params: { tag?: string },
	signal?: AbortSignal,
	repoDir?: string,
): Promise<ToolResult> {
	const dir = repoDir || `${process.env.HOME}/.bloom/pi-bloom`;
	const containerfile = join(dir, "os", "Containerfile");
	const tag = params.tag || DEV_IMAGE_TAG;

	if (!existsSync(containerfile)) {
		return errorResult(`Containerfile not found at ${containerfile}. Is the repo configured? Run bloom_repo(action: 'configure') first.`);
	}

	log.info(`building OS image: ${tag}`);
	const start = Date.now();
	const build = await run(
		"podman",
		["build", "-f", containerfile, "-t", tag, dir],
		signal,
	);
	const duration = Math.round((Date.now() - start) / 1000);

	if (build.exitCode !== 0) {
		return errorResult(`Build failed (${duration}s):\n${build.stderr}`);
	}

	// Get image size
	const inspect = await run("podman", ["image", "inspect", tag, "--format", "{{.Size}}"], signal).catch(() => ({
		exitCode: 1,
		stdout: "",
		stderr: "",
	}));
	const size = inspect.exitCode === 0 ? inspect.stdout.trim() : "unknown";

	const result: DevBuildResult = {
		success: true,
		imageTag: tag,
		duration,
		size,
	};

	return {
		content: [{ type: "text" as const, text: `Build succeeded in ${duration}s.\nImage: ${tag}\nSize: ${size}\n\nNext: dev_switch to stage it, or dev_loop for the full cycle.` }],
		details: result,
	};
}
```

Update the `index.ts` call to pass the repoDir:

```typescript
// In dev_build tool execute:
return await handleDevBuild(params, signal, `${bloomRuntime}/pi-bloom`);
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- --run tests/extensions/bloom-dev.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add extensions/bloom-dev/actions.ts extensions/bloom-dev/index.ts tests/extensions/bloom-dev.test.ts
git commit -m "feat(bloom-dev): implement dev_build handler"
```

---

### Task 7: Implement dev_switch and dev_rollback Handlers

**Files:**
- Modify: `extensions/bloom-dev/actions.ts`
- Read: `extensions/bloom-os/actions.ts` (bootc pattern)
- Test: `tests/extensions/bloom-dev.test.ts`

**Step 1: Write the failing tests**

```typescript
describe("dev_switch", () => {
	it("returns error without confirmation context", async () => {
		const result = await handleDevSwitch({}, undefined, undefined);
		// Without ctx, should still attempt (no confirmation required in test)
		expect(result.content[0].text).toBeDefined();
	});
});

describe("dev_rollback", () => {
	it("returns error without confirmation context", async () => {
		const result = await handleDevRollback(undefined, undefined);
		expect(result.content[0].text).toBeDefined();
	});
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- --run tests/extensions/bloom-dev.test.ts`
Expected: FAIL — "Not yet implemented"

**Step 3: Replace stubs with implementations**

```typescript
export async function handleDevSwitch(
	params: { tag?: string },
	signal?: AbortSignal,
	ctx?: ExtensionContext,
): Promise<ToolResult> {
	const tag = params.tag || DEV_IMAGE_TAG;

	// Verify image exists locally
	const exists = await run("podman", ["image", "exists", tag], signal);
	if (exists.exitCode !== 0) {
		return errorResult(`Image ${tag} not found. Run dev_build first.`);
	}

	if (ctx) {
		const denied = await requireConfirmation(ctx, `Switch OS to ${tag} (will take effect on next reboot)`);
		if (denied) return errorResult(denied);
	}

	const result = await run(
		"sudo",
		["bootc", "switch", "--transport", "containers-storage", tag],
		signal,
	);

	if (result.exitCode !== 0) {
		return errorResult(`bootc switch failed:\n${result.stderr}`);
	}

	return {
		content: [{ type: "text" as const, text: `Staged ${tag} for next boot.\nReboot to apply, or use dev_rollback to undo before rebooting.` }],
		details: { staged: tag },
	};
}

export async function handleDevRollback(
	signal?: AbortSignal,
	ctx?: ExtensionContext,
): Promise<ToolResult> {
	if (ctx) {
		const denied = await requireConfirmation(ctx, "Rollback OS to previous image");
		if (denied) return errorResult(denied);
	}

	const result = await run("sudo", ["bootc", "rollback"], signal);

	if (result.exitCode !== 0) {
		return errorResult(`bootc rollback failed:\n${result.stderr}`);
	}

	return {
		content: [{ type: "text" as const, text: `Rollback staged. Reboot to return to the previous OS image.` }],
		details: { rolledBack: true },
	};
}
```

Add the `ExtensionContext` import at the top of `actions.ts` (from the Pi SDK peer dependency).

**Step 4: Run tests**

Run: `npm run test -- --run tests/extensions/bloom-dev.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add extensions/bloom-dev/actions.ts tests/extensions/bloom-dev.test.ts
git commit -m "feat(bloom-dev): implement dev_switch and dev_rollback handlers"
```

---

### Task 8: Implement dev_test Handler

**Files:**
- Modify: `extensions/bloom-dev/actions.ts`
- Test: `tests/extensions/bloom-dev.test.ts`

**Step 1: Write the failing test**

```typescript
describe("dev_test", () => {
	it("returns error when repo dir missing", async () => {
		const result = await handleDevTest("/nonexistent/path");
		expect(result.isError).toBe(true);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- --run tests/extensions/bloom-dev.test.ts`
Expected: FAIL — "Not yet implemented"

**Step 3: Replace stub with implementation**

```typescript
export async function handleDevTest(
	bloomRuntime: string,
	signal?: AbortSignal,
): Promise<ToolResult> {
	const repoDir = join(bloomRuntime, "pi-bloom");

	if (!existsSync(join(repoDir, "package.json"))) {
		return errorResult(`Repo not found at ${repoDir}. Run bloom_repo(action: 'configure') first.`);
	}

	log.info("running tests and lint");

	const testRun = await run("npm", ["run", "test", "--", "--run"], signal, repoDir);
	const lintRun = await run("npm", ["run", "check"], signal, repoDir);

	const result: DevTestResult = {
		success: testRun.exitCode === 0 && lintRun.exitCode === 0,
		testsPassed: testRun.exitCode === 0,
		lintPassed: lintRun.exitCode === 0,
		testOutput: truncate(testRun.stdout + testRun.stderr),
		lintOutput: truncate(lintRun.stdout + lintRun.stderr),
	};

	const lines = [
		`Tests: ${result.testsPassed ? "PASS" : "FAIL"}`,
		`Lint: ${result.lintPassed ? "PASS" : "FAIL"}`,
	];

	if (!result.testsPassed) {
		lines.push(`\nTest output:\n${result.testOutput}`);
	}
	if (!result.lintPassed) {
		lines.push(`\nLint output:\n${result.lintOutput}`);
	}

	return {
		content: [{ type: "text" as const, text: lines.join("\n") }],
		details: result,
		isError: !result.success,
	};
}
```

Add `truncate` to the import from `../../lib/shared.js`.

**Step 4: Run tests**

Run: `npm run test -- --run tests/extensions/bloom-dev.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add extensions/bloom-dev/actions.ts tests/extensions/bloom-dev.test.ts
git commit -m "feat(bloom-dev): implement dev_test handler"
```

---

### Task 9: Implement dev_loop Handler

**Files:**
- Modify: `extensions/bloom-dev/actions.ts`

**Step 1: Write the failing test**

```typescript
describe("dev_loop", () => {
	it("returns error when repo dir missing", async () => {
		const result = await handleDevLoop({ skip_reboot: true }, undefined, undefined, "/nonexistent");
		expect(result.isError).toBe(true);
	});
});
```

**Step 2: Run test to verify it fails**

**Step 3: Replace stub with implementation**

```typescript
export async function handleDevLoop(
	params: { tag?: string; skip_reboot?: boolean },
	signal?: AbortSignal,
	ctx?: ExtensionContext,
	repoDir?: string,
): Promise<ToolResult> {
	const dir = repoDir || `${process.env.HOME}/.bloom/pi-bloom`;
	const tag = params.tag || DEV_IMAGE_TAG;
	const steps: string[] = [];

	// Step 1: Build
	const buildResult = await handleDevBuild({ tag }, signal, dir);
	if (buildResult.isError) {
		return errorResult(`Dev loop failed at build step:\n${buildResult.content[0].text}`);
	}
	steps.push(`Build: OK (${(buildResult.details as DevBuildResult).duration}s)`);

	// Step 2: Switch
	const switchResult = await handleDevSwitch({ tag }, signal, ctx);
	if (switchResult.isError) {
		return errorResult(`Dev loop failed at switch step:\n${switchResult.content[0].text}`);
	}
	steps.push("Switch: OK (staged for next boot)");

	// Step 3: Reboot or skip
	if (params.skip_reboot) {
		steps.push("Reboot: skipped (--skip_reboot)");
		steps.push("\nImage staged. Reboot manually when ready.");
	} else {
		steps.push("Reboot: scheduling in 10 seconds...");
		steps.push("After reboot, run dev_status to verify the new image is active.");
		// Schedule reboot
		await run("sudo", ["shutdown", "-r", "+0", "bloom dev loop: applying new OS image"], signal);
	}

	return {
		content: [{ type: "text" as const, text: `Dev loop progress:\n${steps.join("\n")}` }],
		details: { steps, tag },
	};
}
```

Update `index.ts` to pass repoDir to `handleDevLoop`.

**Step 4: Run tests**

Run: `npm run test -- --run tests/extensions/bloom-dev.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add extensions/bloom-dev/actions.ts extensions/bloom-dev/index.ts tests/extensions/bloom-dev.test.ts
git commit -m "feat(bloom-dev): implement dev_loop handler"
```

---

### Task 10: Implement dev_submit_pr Handler

**Files:**
- Modify: `extensions/bloom-dev/actions.ts`
- Read: `extensions/bloom-repo/actions.ts` (PR submission pattern)

**Step 1: Write the failing test**

```typescript
describe("dev_submit_pr", () => {
	it("returns error when repo dir missing", async () => {
		const result = await handleDevSubmitPr(
			{ title: "test pr" },
			"/nonexistent",
		);
		expect(result.isError).toBe(true);
	});
});
```

**Step 2: Run test to verify it fails**

**Step 3: Replace stub with implementation**

```typescript
export async function handleDevSubmitPr(
	params: { title: string; body?: string; branch?: string },
	bloomRuntime: string,
	signal?: AbortSignal,
	ctx?: ExtensionContext,
): Promise<ToolResult> {
	const repoDir = join(bloomRuntime, "pi-bloom");

	if (!existsSync(join(repoDir, ".git"))) {
		return errorResult(`Repo not found at ${repoDir}. Run bloom_repo(action: 'configure') first.`);
	}

	if (ctx) {
		const denied = await requireConfirmation(ctx, `Create PR: "${params.title}"`);
		if (denied) return errorResult(denied);
	}

	// Run tests first and include results
	const testResult = await handleDevTest(bloomRuntime, signal);
	const testSummary = testResult.isError
		? `Tests: FAIL\n${testResult.content[0].text}`
		: "Tests: PASS";

	// Generate branch name
	const branch = params.branch || `dev/${params.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50)}`;

	// Create branch
	const checkout = await run("git", ["-C", repoDir, "checkout", "-b", branch], signal);
	if (checkout.exitCode !== 0) {
		return errorResult(`Failed to create branch ${branch}:\n${checkout.stderr}`);
	}

	// Stage all changes
	const add = await run("git", ["-C", repoDir, "add", "-A"], signal);
	if (add.exitCode !== 0) {
		return errorResult(`Failed to stage changes:\n${add.stderr}`);
	}

	// Commit
	const commit = await run("git", ["-C", repoDir, "commit", "-m", params.title], signal);
	if (commit.exitCode !== 0) {
		return errorResult(`Failed to commit:\n${commit.stderr}`);
	}

	// Push
	const push = await run("git", ["-C", repoDir, "push", "-u", "origin", branch], signal);
	if (push.exitCode !== 0) {
		return errorResult(`Failed to push:\n${push.stderr}`);
	}

	// Create PR
	const prBody = [
		params.body || "",
		"",
		"## Test Results",
		"```",
		testSummary,
		"```",
		"",
		"---",
		"Submitted from device via `dev_submit_pr`",
	].join("\n");

	const pr = await run("gh", ["pr", "create", "--title", params.title, "--body", prBody], signal, repoDir);
	if (pr.exitCode !== 0) {
		return errorResult(`Failed to create PR (branch pushed to ${branch}):\n${pr.stderr}`);
	}

	const prUrl = pr.stdout.trim();

	return {
		content: [{ type: "text" as const, text: `PR created: ${prUrl}\nBranch: ${branch}\n${testSummary}` }],
		details: { prUrl, branch, testsPassed: !testResult.isError },
	};
}
```

**Step 4: Run tests**

Run: `npm run test -- --run tests/extensions/bloom-dev.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add extensions/bloom-dev/actions.ts tests/extensions/bloom-dev.test.ts
git commit -m "feat(bloom-dev): implement dev_submit_pr handler with auto test results"
```

---

### Task 11: Implement dev_push_skill, dev_push_service, dev_push_extension Handlers

**Files:**
- Modify: `extensions/bloom-dev/actions.ts`
- Read: `lib/filesystem.ts` (for getBloomDir, safePath)

**Step 1: Write failing tests**

```typescript
describe("dev_push_skill", () => {
	let bloomRuntime: string;

	beforeEach(() => {
		bloomRuntime = join(tmpdir(), `bloom-dev-push-${Date.now()}`);
		// Create fake repo structure
		mkdirSync(join(bloomRuntime, "pi-bloom", "skills"), { recursive: true });
		mkdirSync(join(bloomRuntime, "pi-bloom", ".git"), { recursive: true });
	});

	afterEach(() => {
		rmSync(bloomRuntime, { recursive: true, force: true });
	});

	it("returns error when skill not found", async () => {
		const result = await handleDevPushSkill(
			{ skill_name: "nonexistent" },
			bloomRuntime,
		);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("not found");
	});
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement all three push handlers**

```typescript
export async function handleDevPushSkill(
	params: { skill_name: string; title?: string },
	bloomRuntime: string,
	signal?: AbortSignal,
	ctx?: ExtensionContext,
): Promise<ToolResult> {
	const bloomDir = getBloomDir();
	const skillSource = join(bloomDir, "Skills", params.skill_name);
	const repoDir = join(bloomRuntime, "pi-bloom");
	const skillDest = join(repoDir, "skills", params.skill_name);

	if (!existsSync(skillSource)) {
		return errorResult(`Skill not found at ${skillSource}. Create it first with skill_create.`);
	}

	if (!existsSync(join(repoDir, ".git"))) {
		return errorResult(`Repo not found at ${repoDir}. Run bloom_repo(action: 'configure') first.`);
	}

	// Copy skill to repo
	await run("cp", ["-r", skillSource, skillDest], signal);

	const title = params.title || `feat(skills): add ${params.skill_name} skill`;

	return await handleDevSubmitPr({ title }, bloomRuntime, signal, ctx);
}

export async function handleDevPushService(
	params: { service_name: string; title?: string },
	bloomRuntime: string,
	signal?: AbortSignal,
	ctx?: ExtensionContext,
): Promise<ToolResult> {
	const repoDir = join(bloomRuntime, "pi-bloom");
	// Service source could be in ~/Bloom/ or in a local dev path
	const possibleSources = [
		join(getBloomDir(), "services", params.service_name),
		join(repoDir, "services", params.service_name),
	];
	const serviceSource = possibleSources.find((s) => existsSync(s));

	if (!serviceSource) {
		return errorResult(`Service ${params.service_name} not found in ~/Bloom/services/ or repo. Scaffold it first with service_scaffold.`);
	}

	if (!existsSync(join(repoDir, ".git"))) {
		return errorResult(`Repo not found at ${repoDir}. Run bloom_repo(action: 'configure') first.`);
	}

	const serviceDest = join(repoDir, "services", params.service_name);
	if (serviceSource !== serviceDest) {
		await run("cp", ["-r", serviceSource, serviceDest], signal);
	}

	const title = params.title || `feat(services): add ${params.service_name} service`;

	return await handleDevSubmitPr({ title }, bloomRuntime, signal, ctx);
}

export async function handleDevPushExtension(
	params: { extension_name: string; source_path?: string; title?: string },
	bloomRuntime: string,
	signal?: AbortSignal,
	ctx?: ExtensionContext,
): Promise<ToolResult> {
	const repoDir = join(bloomRuntime, "pi-bloom");
	const extSource = params.source_path
		|| join(getBloomDir(), "extensions", params.extension_name);

	if (!existsSync(extSource)) {
		return errorResult(`Extension not found at ${extSource}. Provide a source_path or create it in ~/Bloom/extensions/.`);
	}

	if (!existsSync(join(repoDir, ".git"))) {
		return errorResult(`Repo not found at ${repoDir}. Run bloom_repo(action: 'configure') first.`);
	}

	const extDest = join(repoDir, "extensions", params.extension_name);
	await run("cp", ["-r", extSource, extDest], signal);

	const title = params.title || `feat(extensions): add ${params.extension_name} extension`;

	return await handleDevSubmitPr({ title }, bloomRuntime, signal, ctx);
}
```

Add `getBloomDir` to imports from `../../lib/filesystem.js`.

**Step 4: Run tests**

Run: `npm run test -- --run tests/extensions/bloom-dev.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add extensions/bloom-dev/actions.ts tests/extensions/bloom-dev.test.ts
git commit -m "feat(bloom-dev): implement push handlers for skills, services, and extensions"
```

---

### Task 12: Implement dev_install_package Handler

**Files:**
- Modify: `extensions/bloom-dev/actions.ts`

**Step 1: Write the failing test**

```typescript
describe("dev_install_package", () => {
	it("returns error for empty source", async () => {
		const result = await handleDevInstallPackage({ source: "" });
		expect(result.isError).toBe(true);
	});
});
```

**Step 2: Run test to verify it fails**

**Step 3: Replace stub with implementation**

```typescript
export async function handleDevInstallPackage(
	params: { source: string },
	signal?: AbortSignal,
): Promise<ToolResult> {
	if (!params.source.trim()) {
		return errorResult("Package source is required. Examples: npm:@foo/bar, git:github.com/user/repo, /local/path");
	}

	log.info(`installing package: ${params.source}`);

	const install = await run("pi", ["install", params.source], signal);

	if (install.exitCode !== 0) {
		return errorResult(`Failed to install ${params.source}:\n${install.stderr}`);
	}

	const output = (install.stdout + install.stderr).trim();

	return {
		content: [{ type: "text" as const, text: `Package installed: ${params.source}\n${output}\n\nRestart Pi to load new extensions/skills.` }],
		details: { source: params.source, output },
	};
}
```

**Step 4: Run tests**

Run: `npm run test -- --run tests/extensions/bloom-dev.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add extensions/bloom-dev/actions.ts tests/extensions/bloom-dev.test.ts
git commit -m "feat(bloom-dev): implement dev_install_package handler"
```

---

### Task 13: Modify bloom-setup Contributing Step

**Files:**
- Modify: `extensions/bloom-setup/actions.ts` (contributing step guidance)

**Step 1: Read current contributing step**

Read `extensions/bloom-setup/actions.ts` and find the `STEP_GUIDANCE["contributing"]` entry.

**Step 2: Update the guidance text**

Change the contributing step from informational-only to an interactive prompt. The guidance should instruct Pi to:

1. Explain what dev tools enable (code-server web editor, local OS rebuilds, upstream contributions)
2. Ask: "Would you like to enable developer tools?"
3. If yes: call `dev_enable`
4. If no: explain they can run `dev_enable` later

Update the `STEP_GUIDANCE["contributing"]` string to something like:

```typescript
contributing: `Developer tools let you contribute to Bloom from this device:
- **code-server**: Edit code in a web browser
- **Local OS builds**: Rebuild and test the OS image without waiting for CI
- **Upstream contributions**: Push skills, services, and extensions as PRs

Ask the user: "Would you like to enable developer tools? You can always enable them later with dev_enable."

If yes: Call dev_enable to activate dev mode, then guide through bloom_repo(action: 'configure') if not already done.
If no: Acknowledge and move on. Mention they can run dev_enable anytime.`,
```

**Step 3: Run tests**

Run: `npm run test -- --run`
Expected: PASS (existing setup tests should still pass)

**Step 4: Commit**

```bash
git add extensions/bloom-setup/actions.ts
git commit -m "feat(bloom-dev): update contributing step to offer dev tools opt-in"
```

---

### Task 14: Final Integration — Build, Lint, Full Test Suite

**Step 1: Run full build**

Run: `npm run build`
Expected: PASS — no TypeScript errors

**Step 2: Run full lint**

Run: `npm run check`
Expected: PASS — no Biome issues

**Step 3: Run full test suite**

Run: `npm run test -- --run`
Expected: PASS — all tests including new bloom-dev tests

**Step 4: Run coverage**

Run: `npm run test:coverage`
Expected: PASS — coverage thresholds met (lib/ 60%, extensions/ 20%)

**Step 5: Fix any issues found**

If build/lint/test failures, fix them before proceeding.

**Step 6: Final commit**

```bash
git add -A
git commit -m "chore(bloom-dev): fix lint and build issues"
```

---

### Task 15: Commit Design Doc and Create PR

**Step 1: Stage and commit the design doc** (if not already committed)

```bash
git add docs/plans/2026-03-09-bloom-dev-extension-design.md docs/plans/2026-03-09-bloom-dev-extension-impl.md
git commit -m "docs: add bloom-dev extension design and implementation plan"
```

**Step 2: Create PR**

```bash
gh pr create --title "feat: add bloom-dev extension for on-device development" --body "$(cat <<'EOF'
## Summary

- New `bloom-dev` extension with dev-mode gating (sentinel file)
- New `bloom-code-server` service (Quadlet, catalog entry)
- Tools: dev_enable/disable/status, dev_code_server, dev_build/switch/rollback/loop, dev_test, dev_submit_pr, dev_push_skill/service/extension, dev_install_package
- Updated contributing step in bloom-setup to offer dev tools opt-in
- Full TDD with unit tests for all handlers

## Design doc
See `docs/plans/2026-03-09-bloom-dev-extension-design.md`

## Test plan
- [ ] Unit tests pass for sentinel management
- [ ] Unit tests pass for all tool handlers
- [ ] Extension registration test passes
- [ ] code-server Quadlet builds and starts
- [ ] Full test suite + lint + coverage pass
- [ ] First-boot contributing step offers dev mode opt-in
EOF
)"
```
