# First-Boot Setup Wizard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the bash setup wizard with an AI-guided first-boot experience powered by a bundled local LLM (Qwen3.5-4B), where Pi speaks first and walks the user through 14 setup steps.

**Architecture:** New `bloom-setup` extension with state machine + rewritten `first-boot` skill. OS image gains bundled llama.cpp + model + whisper.cpp. Bash wizard deleted. Login flow simplified to auto-login + `exec pi`.

**Tech Stack:** TypeScript (strict, ES2022, NodeNext), Biome formatting, Vitest, Pi SDK ExtensionAPI, TypeBox schemas, llama.cpp, whisper.cpp, systemd

---

### Task 1: Setup State Types and Pure Logic

Create the state management types and pure functions in `lib/setup.ts`. This is the foundation — all state logic is pure and testable without mocks.

**Files:**
- Create: `lib/setup.ts`
- Create: `tests/lib/setup.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/lib/setup.test.ts
import { describe, expect, it } from "vitest";
import {
	type SetupState,
	type StepName,
	type StepStatus,
	STEP_ORDER,
	createInitialState,
	getNextStep,
	advanceStep,
	isSetupComplete,
	getStepsSummary,
} from "../../lib/setup.js";

describe("createInitialState", () => {
	it("creates state with all steps pending", () => {
		const state = createInitialState();
		expect(state.version).toBe(1);
		expect(state.startedAt).toBeTruthy();
		expect(state.completedAt).toBeNull();
		for (const step of STEP_ORDER) {
			expect(state.steps[step].status).toBe("pending");
		}
	});

	it("has exactly 14 steps", () => {
		const state = createInitialState();
		expect(Object.keys(state.steps)).toHaveLength(14);
	});
});

describe("getNextStep", () => {
	it("returns 'welcome' for fresh state", () => {
		const state = createInitialState();
		expect(getNextStep(state)).toBe("welcome");
	});

	it("returns second step when first is completed", () => {
		const state = createInitialState();
		state.steps.welcome = { status: "completed", at: new Date().toISOString() };
		expect(getNextStep(state)).toBe("network");
	});

	it("skips completed and skipped steps", () => {
		const state = createInitialState();
		state.steps.welcome = { status: "completed", at: new Date().toISOString() };
		state.steps.network = { status: "skipped", at: new Date().toISOString(), reason: "has ethernet" };
		expect(getNextStep(state)).toBe("netbird");
	});

	it("returns null when all steps are done", () => {
		const state = createInitialState();
		for (const step of STEP_ORDER) {
			state.steps[step] = { status: "completed", at: new Date().toISOString() };
		}
		expect(getNextStep(state)).toBeNull();
	});
});

describe("advanceStep", () => {
	it("marks step as completed", () => {
		const state = createInitialState();
		const next = advanceStep(state, "welcome", "completed");
		expect(next.steps.welcome.status).toBe("completed");
		expect(next.steps.welcome.at).toBeTruthy();
	});

	it("marks step as skipped with reason", () => {
		const state = createInitialState();
		const next = advanceStep(state, "netbird", "skipped", "user declined");
		expect(next.steps.netbird.status).toBe("skipped");
		expect(next.steps.netbird.reason).toBe("user declined");
	});

	it("sets completedAt when last step is completed", () => {
		const state = createInitialState();
		for (const step of STEP_ORDER.slice(0, -1)) {
			state.steps[step] = { status: "completed", at: new Date().toISOString() };
		}
		const lastStep = STEP_ORDER[STEP_ORDER.length - 1];
		const next = advanceStep(state, lastStep, "completed");
		expect(next.completedAt).toBeTruthy();
	});

	it("does not mutate original state", () => {
		const state = createInitialState();
		const next = advanceStep(state, "welcome", "completed");
		expect(state.steps.welcome.status).toBe("pending");
		expect(next.steps.welcome.status).toBe("completed");
	});
});

describe("isSetupComplete", () => {
	it("returns false for fresh state", () => {
		expect(isSetupComplete(createInitialState())).toBe(false);
	});

	it("returns true when completedAt is set", () => {
		const state = createInitialState();
		state.completedAt = new Date().toISOString();
		expect(isSetupComplete(state)).toBe(true);
	});
});

describe("getStepsSummary", () => {
	it("returns summary of all steps", () => {
		const state = createInitialState();
		state.steps.welcome = { status: "completed", at: new Date().toISOString() };
		const summary = getStepsSummary(state);
		expect(summary).toHaveLength(14);
		expect(summary[0]).toEqual({ name: "welcome", status: "completed" });
		expect(summary[1]).toEqual({ name: "network", status: "pending" });
	});
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/lib/setup.test.ts`
Expected: FAIL — module `../../lib/setup.js` not found

**Step 3: Write the implementation**

```typescript
// lib/setup.ts

/** Step names in execution order. */
export const STEP_ORDER = [
	"welcome",
	"network",
	"netbird",
	"password",
	"connectivity",
	"webdav",
	"channels",
	"whisper",
	"llm_upgrade",
	"git_identity",
	"contributing",
	"persona",
	"test_message",
	"complete",
] as const;

export type StepName = (typeof STEP_ORDER)[number];

export type StepStatus = "pending" | "in_progress" | "completed" | "skipped";

export interface StepState {
	status: StepStatus;
	at?: string;
	reason?: string;
}

export interface SetupState {
	version: number;
	startedAt: string;
	completedAt: string | null;
	steps: Record<StepName, StepState>;
}

/** Create a fresh setup state with all steps pending. */
export function createInitialState(): SetupState {
	const steps = {} as Record<StepName, StepState>;
	for (const name of STEP_ORDER) {
		steps[name] = { status: "pending" };
	}
	return {
		version: 1,
		startedAt: new Date().toISOString(),
		completedAt: null,
		steps,
	};
}

/** Get the next pending step, or null if all done. */
export function getNextStep(state: SetupState): StepName | null {
	for (const name of STEP_ORDER) {
		if (state.steps[name].status === "pending" || state.steps[name].status === "in_progress") {
			return name;
		}
	}
	return null;
}

/** Return a new state with the given step advanced. Does not mutate input. */
export function advanceStep(
	state: SetupState,
	step: StepName,
	status: "completed" | "skipped",
	reason?: string,
): SetupState {
	const newSteps = { ...state.steps };
	newSteps[step] = {
		status,
		at: new Date().toISOString(),
		...(reason ? { reason } : {}),
	};

	const allDone = STEP_ORDER.every(
		(s) => newSteps[s].status === "completed" || newSteps[s].status === "skipped",
	);

	return {
		...state,
		steps: newSteps,
		completedAt: allDone ? new Date().toISOString() : null,
	};
}

/** Check if setup is complete. */
export function isSetupComplete(state: SetupState): boolean {
	return state.completedAt !== null;
}

/** Return a summary array of step name + status. */
export function getStepsSummary(state: SetupState): Array<{ name: StepName; status: StepStatus }> {
	return STEP_ORDER.map((name) => ({ name, status: state.steps[name].status }));
}
```

**Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/lib/setup.test.ts`
Expected: All 9 tests PASS

**Step 5: Commit**

```bash
git add lib/setup.ts tests/lib/setup.test.ts
git commit -m "feat(setup): add setup state types and pure logic"
```

---

### Task 2: Setup State Persistence (actions)

Create `extensions/bloom-setup/actions.ts` with state persistence (read/write `~/.bloom/setup-state.json`) and step guidance text.

**Files:**
- Create: `extensions/bloom-setup/types.ts`
- Create: `extensions/bloom-setup/actions.ts`
- Create: `tests/extensions/bloom-setup.test.ts`

**Step 1: Create types file**

```typescript
// extensions/bloom-setup/types.ts
// Extension-specific types — shared types live in lib/setup.ts
export type { SetupState, StepName, StepState, StepStatus } from "../../lib/setup.js";
```

**Step 2: Write the failing tests**

```typescript
// tests/extensions/bloom-setup.test.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockExtensionAPI, type MockExtensionAPI } from "../helpers/mock-extension-api.js";
import { createTempGarden, type TempGarden } from "../helpers/temp-garden.js";

let temp: TempGarden;
let api: MockExtensionAPI;

const EXPECTED_TOOL_NAMES = ["setup_status", "setup_advance", "setup_reset"];

beforeEach(async () => {
	temp = createTempGarden();
	api = createMockExtensionAPI();
});

afterEach(() => {
	temp.cleanup();
});

async function loadExtension() {
	const mod = await import("../../extensions/bloom-setup/index.js");
	mod.default(api as never);
}

function toolNames(): string[] {
	return api._registeredTools.map((t) => t.name as string);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
describe("bloom-setup registration", () => {
	it("registers exactly 3 tools", async () => {
		await loadExtension();
		expect(api._registeredTools).toHaveLength(3);
	});

	it("registers all expected tool names", async () => {
		await loadExtension();
		expect(toolNames()).toEqual(EXPECTED_TOOL_NAMES);
	});

	it("has session_start event handler", async () => {
		await loadExtension();
		const events = [...api._eventHandlers.keys()];
		expect(events).toContain("session_start");
	});
});

// ---------------------------------------------------------------------------
// Tool structure validation
// ---------------------------------------------------------------------------
describe("bloom-setup tool structure", () => {
	it("each tool has name, label, description, parameters, and execute", async () => {
		await loadExtension();
		for (const tool of api._registeredTools) {
			expect(tool, `tool ${tool.name} missing 'name'`).toHaveProperty("name");
			expect(tool, `tool ${tool.name} missing 'label'`).toHaveProperty("label");
			expect(tool, `tool ${tool.name} missing 'description'`).toHaveProperty("description");
			expect(tool, `tool ${tool.name} missing 'parameters'`).toHaveProperty("parameters");
			expect(tool, `tool ${tool.name} missing 'execute'`).toHaveProperty("execute");
			expect(typeof tool.execute, `tool ${tool.name} execute is not a function`).toBe("function");
		}
	});

	it("each tool has a non-empty description and label", async () => {
		await loadExtension();
		for (const tool of api._registeredTools) {
			expect((tool.description as string).length).toBeGreaterThan(0);
			expect((tool.label as string).length).toBeGreaterThan(0);
		}
	});

	it("tool names are unique", async () => {
		await loadExtension();
		const names = toolNames();
		expect(new Set(names).size).toBe(names.length);
	});
});
```

**Step 3: Run tests to verify they fail**

Run: `npm run test -- tests/extensions/bloom-setup.test.ts`
Expected: FAIL — cannot find module

**Step 4: Write actions.ts**

```typescript
// extensions/bloom-setup/actions.ts
/**
 * Handler / business logic for bloom-setup.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import {
	type SetupState,
	type StepName,
	STEP_ORDER,
	advanceStep,
	createInitialState,
	getNextStep,
	getStepsSummary,
	isSetupComplete,
} from "../../lib/setup.js";
import { createLogger, errorResult } from "../../lib/shared.js";

const log = createLogger("bloom-setup");

const SETUP_STATE_PATH = join(os.homedir(), ".bloom", "setup-state.json");
const SETUP_COMPLETE_PATH = join(os.homedir(), ".bloom", ".setup-complete");

/** Step guidance — what Pi should say/do at each step. */
const STEP_GUIDANCE: Record<StepName, string> = {
	welcome:
		"Introduce Bloom to the user. Explain: Bloom is their personal AI companion OS. Pi (you) is the AI agent that lives here. Bloom can self-evolve — the user can teach you new skills, install services, and customize your persona. Keep it to 2-3 short messages, warm and conversational. Don't overwhelm.",
	network:
		"Check network connectivity by running: nmcli general status. If connected, confirm and move on. If not, scan for WiFi with: nmcli device wifi list, show the results, ask the user to pick a network, then connect with: nmcli device wifi connect <SSID> password <password>. Retry if it fails.",
	netbird:
		"Explain that NetBird creates a private mesh network so the user can access this device from anywhere. Ask for their NetBird setup key. Run: sudo netbird up --setup-key <KEY>. Check status with: netbird status. Show the assigned mesh IP.",
	password:
		"Now that remote access is being opened via NetBird, set a password for security. Run: sudo passwd pi. Ask the user to type their desired password. Confirm success.",
	connectivity:
		"Summarize how to connect: (1) Locally at localhost if sitting at the device, (2) Via NetBird mesh IP from any peer device. Show the mesh IP from: netbird status. Mention SSH: ssh pi@<mesh-ip>.",
	webdav:
		"Ask if the user wants a file server. Explain: dufs (WebDAV) lets you access your files from any device via a web browser or file manager. If yes, use service_install(name='dufs') to install it.",
	channels:
		"Ask: 'Would you like to connect a messaging channel? Options: WhatsApp, Signal, both, or skip for now.' For each chosen channel, use service_install(name='whatsapp'|'signal') then service_pair(name='whatsapp'|'signal') to get the QR code for pairing.",
	whisper:
		"Ask: 'Want voice message support? This lets you send voice messages on WhatsApp/Signal and I'll transcribe them.' If yes, use service_install(name='stt') to enable whisper.",
	llm_upgrade:
		"Explain: 'You're running on a local Qwen 3.5 4B model right now. Want to add a cloud AI provider for better reasoning? Options: (1) Use /login for OAuth sign-in to Anthropic/OpenAI/Google, (2) Set an API key manually, (3) Keep the local model only.' Guide based on their choice.",
	git_identity:
		"Ask for the user's name and email for git commits. Run: git config --global user.name '<name>' and git config --global user.email '<email>'. Confirm the settings.",
	contributing:
		"Explain how the user can contribute: (1) Create custom extensions in ~/Bloom/, (2) Build new services, (3) Submit PRs to the Bloom repo, (4) Share their personal bloom configuration. This is informational — no action needed.",
	persona:
		"Guide the user through personalizing their AI companion. Ask one question at a time: SOUL — 'What should I call you?', 'How formal or casual should I be?', 'Any values important to you?'. BODY — 'Short messages on mobile, longer on terminal?'. FACULTY — 'Step-by-step thinker or quick and direct?'. Update ~/Bloom/Persona/ files with their preferences. Fully skippable.",
	test_message:
		"If a messaging channel (WhatsApp/Signal) was set up, send a test message: 'Hi. Can you hear me?' using the channel. If no channel was set up, skip this step.",
	complete:
		"Congratulate the user! Setup is complete. Mention they can chat here on the terminal or on their connected messaging channel. Remind them they can revisit any setup step by asking.",
};

/** Load setup state from disk, or create initial state. */
export function loadState(): SetupState {
	if (existsSync(SETUP_STATE_PATH)) {
		try {
			const raw = readFileSync(SETUP_STATE_PATH, "utf-8");
			return JSON.parse(raw) as SetupState;
		} catch {
			log.warn("corrupt setup-state.json, creating fresh state");
		}
	}
	return createInitialState();
}

/** Save setup state to disk. */
export function saveState(state: SetupState): void {
	const dir = dirname(SETUP_STATE_PATH);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(SETUP_STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

/** Mark setup as complete by touching the sentinel file. */
export function touchSetupComplete(): void {
	const dir = dirname(SETUP_COMPLETE_PATH);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(SETUP_COMPLETE_PATH, new Date().toISOString(), "utf-8");
}

/** Check if setup is already complete (sentinel file exists). */
export function isSetupDone(): boolean {
	return existsSync(SETUP_COMPLETE_PATH);
}

/** Handle setup_status tool call. */
export function handleSetupStatus() {
	const state = loadState();
	const next = getNextStep(state);
	const summary = getStepsSummary(state);
	const complete = isSetupComplete(state);

	const lines: string[] = [];
	lines.push(complete ? "Setup is complete." : `Setup in progress. Next step: **${next}**`);
	lines.push("");
	for (const s of summary) {
		const icon = s.status === "completed" ? "[x]" : s.status === "skipped" ? "[-]" : "[ ]";
		lines.push(`${icon} ${s.name}`);
	}

	if (next && !complete) {
		lines.push("");
		lines.push(`## Guidance for "${next}"`);
		lines.push(STEP_GUIDANCE[next]);
	}

	return {
		content: [{ type: "text" as const, text: lines.join("\n") }],
		details: { nextStep: next, complete, summary },
	};
}

/** Handle setup_advance tool call. */
export function handleSetupAdvance(params: {
	step: string;
	result: string;
	reason?: string;
}) {
	const step = params.step as StepName;
	if (!STEP_ORDER.includes(step)) {
		return errorResult(`Unknown step: ${step}. Valid steps: ${STEP_ORDER.join(", ")}`);
	}

	const result = params.result as "completed" | "skipped";
	if (result !== "completed" && result !== "skipped") {
		return errorResult(`Result must be "completed" or "skipped", got: ${result}`);
	}

	let state = loadState();
	state = advanceStep(state, step, result, params.reason);
	saveState(state);

	if (isSetupComplete(state)) {
		touchSetupComplete();
		return {
			content: [{ type: "text" as const, text: "Setup complete! All steps finished. The setup wizard will not run on next login." }],
			details: { complete: true },
		};
	}

	const next = getNextStep(state);
	const lines: string[] = [];
	lines.push(`Step "${step}" marked as ${result}.`);
	if (next) {
		lines.push(`Next step: **${next}**`);
		lines.push("");
		lines.push(`## Guidance for "${next}"`);
		lines.push(STEP_GUIDANCE[next]);
	}

	return {
		content: [{ type: "text" as const, text: lines.join("\n") }],
		details: { nextStep: next, complete: false },
	};
}

/** Handle setup_reset tool call. */
export function handleSetupReset(params: { step?: string }) {
	if (params.step) {
		const step = params.step as StepName;
		if (!STEP_ORDER.includes(step)) {
			return errorResult(`Unknown step: ${step}. Valid steps: ${STEP_ORDER.join(", ")}`);
		}
		const state = loadState();
		state.steps[step] = { status: "pending" };
		state.completedAt = null;
		saveState(state);
		return {
			content: [{ type: "text" as const, text: `Step "${step}" reset to pending.` }],
			details: { step },
		};
	}

	// Full reset
	const state = createInitialState();
	saveState(state);
	return {
		content: [{ type: "text" as const, text: "Full setup reset. All steps are pending." }],
		details: { fullReset: true },
	};
}

/** Generate the system prompt injection for the first-boot skill. */
export function getSetupSystemPrompt(): string {
	const state = loadState();
	const next = getNextStep(state);
	if (!next) return "";

	const lines: string[] = [];
	lines.push("# First-Boot Setup Wizard");
	lines.push("");
	lines.push("You are guiding the user through first-time setup. This is their first experience with Bloom.");
	lines.push("Be warm, conversational, and guide one step at a time. Never overwhelm.");
	lines.push("The user can say 'skip' at any step.");
	lines.push("");
	lines.push("## Current Progress");
	for (const s of getStepsSummary(state)) {
		const icon = s.status === "completed" ? "[x]" : s.status === "skipped" ? "[-]" : "[ ]";
		lines.push(`${icon} ${s.name}`);
	}
	lines.push("");
	lines.push(`## Current Step: ${next}`);
	lines.push(STEP_GUIDANCE[next]);
	lines.push("");
	lines.push("After completing each step, call setup_advance(step, result) to record progress and get the next step.");
	lines.push("If the user wants to skip, call setup_advance(step, 'skipped', reason).");
	lines.push("Call setup_status() at any time to check progress.");

	return lines.join("\n");
}
```

**Step 5: Run tests to verify they fail**

Run: `npm run test -- tests/extensions/bloom-setup.test.ts`
Expected: FAIL — index.ts not yet created

**Step 6: Commit types and actions (tests still failing — index.ts needed)**

```bash
git add extensions/bloom-setup/types.ts extensions/bloom-setup/actions.ts tests/extensions/bloom-setup.test.ts
git commit -m "feat(setup): add actions, types, and registration tests for bloom-setup extension"
```

---

### Task 3: Extension Registration (index.ts)

Wire up the extension with tool registration and session_start hook.

**Files:**
- Create: `extensions/bloom-setup/index.ts`

**Step 1: Write the extension**

```typescript
// extensions/bloom-setup/index.ts
/**
 * bloom-setup — First-boot setup wizard: guides user through 14 setup steps.
 *
 * @tools setup_status, setup_advance, setup_reset
 * @hooks session_start
 */
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { STEP_ORDER } from "../../lib/setup.js";
import {
	getSetupSystemPrompt,
	handleSetupAdvance,
	handleSetupReset,
	handleSetupStatus,
	isSetupDone,
} from "./actions.js";

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "setup_status",
		label: "Setup Status",
		description:
			"Show current first-boot setup progress: which steps are complete, skipped, or pending, and guidance for the next step.",
		parameters: Type.Object({}),
		async execute() {
			return handleSetupStatus();
		},
	});

	pi.registerTool({
		name: "setup_advance",
		label: "Advance Setup Step",
		description:
			"Mark a setup step as completed or skipped, persist state, and return guidance for the next step.",
		parameters: Type.Object({
			step: StringEnum([...STEP_ORDER], {
				description: "The setup step to advance",
			}),
			result: StringEnum(["completed", "skipped"] as const, {
				description: "Whether the step was completed or skipped",
			}),
			reason: Type.Optional(
				Type.String({ description: "Reason for skipping (required when result is 'skipped')" }),
			),
		}),
		async execute(_toolCallId, params) {
			return handleSetupAdvance(params);
		},
	});

	pi.registerTool({
		name: "setup_reset",
		label: "Reset Setup Step",
		description:
			"Reset a specific setup step to pending, or reset the entire setup. Useful if the user wants to redo a step.",
		parameters: Type.Object({
			step: Type.Optional(
				StringEnum([...STEP_ORDER], {
					description: "Step to reset (omit for full reset)",
				}),
			),
		}),
		async execute(_toolCallId, params) {
			return handleSetupReset(params);
		},
	});

	// Inject first-boot skill into system prompt when setup is incomplete
	pi.on("session_start", async () => {
		if (isSetupDone()) return;

		const prompt = getSetupSystemPrompt();
		if (prompt) {
			return { systemPrompt: prompt };
		}
	});
}
```

**Step 2: Run tests to verify they pass**

Run: `npm run test -- tests/extensions/bloom-setup.test.ts`
Expected: All 6 tests PASS

**Step 3: Run full test suite**

Run: `npm run test`
Expected: All tests PASS (no regressions)

**Step 4: Run lint**

Run: `npm run check`
Expected: PASS

**Step 5: Commit**

```bash
git add extensions/bloom-setup/index.ts
git commit -m "feat(setup): wire bloom-setup extension with tool registration and session_start hook"
```

---

### Task 4: Rewrite First-Boot Skill

Replace the existing skill with one designed to work with the `bloom-setup` extension.

**Files:**
- Modify: `skills/first-boot/SKILL.md`

**Step 1: Read the current skill**

Run: Read `skills/first-boot/SKILL.md` to understand existing content.

**Step 2: Rewrite the skill**

```markdown
---
name: first-boot
description: Guided first-boot setup wizard — Pi walks the user through 14 steps to configure their Bloom device
---

# First-Boot Setup

## Prerequisite

If `~/.bloom/.setup-complete` exists, setup is done. Skip this skill entirely. You can still help the user reconfigure individual steps if they ask — use `setup_reset(step)` to re-enable a step.

## How This Works

You are paired with the `bloom-setup` extension which tracks state in `~/.bloom/setup-state.json`. Your role is conversational guidance; the extension handles state.

1. Call `setup_status()` to see where you are
2. Follow the guidance for the current step
3. After completing a step, call `setup_advance(step, "completed")`
4. If the user says "skip", call `setup_advance(step, "skipped", "reason")`
5. Repeat until all steps are done

## Conversation Style

- **Warm and natural** — this is the user's first experience with their AI companion
- **One thing at a time** — never dump a list of steps
- **Pi speaks first** — on first boot, start with the welcome without waiting for user input
- **Respect "skip"** — any step can be deferred, no pressure
- **Show, don't tell** — when running commands, show the user what's happening

## Step-Specific Notes

### welcome
Start by calling `setup_status()`, then introduce yourself. Keep it to 2-3 short paragraphs. Cover:
- What Bloom is (personal AI companion OS)
- What you (Pi) can do (run commands, manage services, remember things)
- That Bloom grows with them (self-evolution, extensions, persona)

### network
Run `nmcli general status` first. If `connected` appears, just confirm: "You're online via [device]." and advance. Only scan for WiFi if there's no connection.

### netbird
NetBird is pre-installed in the OS image. The user needs to provide a setup key from their NetBird dashboard. Run `sudo netbird up --setup-key <KEY>`. Check `netbird status` for the mesh IP.

### password
Triggered because NetBird opens remote access. Use `sudo passwd pi`. The password prompt is interactive — tell the user to type their password when prompted.

### channels
For each chosen service, the flow is:
1. `service_install(name="whatsapp"|"signal")`
2. Wait for service to be ready
3. `service_pair(name="whatsapp"|"signal")` — shows QR code
4. Ask user to scan with their phone app
5. `service_test(name="whatsapp"|"signal")` — verify it works

### llm_upgrade
Three paths:
1. **OAuth**: Tell user to run `/login` and pick their provider
2. **API key**: Ask for the key, help them set it as an environment variable in `~/.bashrc`
3. **Keep local**: Just advance, the bundled Qwen 3.5 4B keeps running

### persona
Ask one question, wait for answer, update the file, ask next question. Files to update:
- `~/Bloom/Persona/SOUL.md` — name, formality, values
- `~/Bloom/Persona/BODY.md` — channel preferences
- `~/Bloom/Persona/FACULTY.md` — reasoning style

### test_message
Only if channels step was completed (not skipped). Check setup state to see if channels was completed before attempting.
```

**Step 3: Commit**

```bash
git add skills/first-boot/SKILL.md
git commit -m "feat(setup): rewrite first-boot skill for extension-backed wizard"
```

---

### Task 5: OS Image — Branding Changes

Update the Containerfile and sysconfig for Bloom branding: hostname, /etc/issue, simplified login flow.

**Files:**
- Modify: `os/Containerfile`
- Modify: `os/sysconfig/bloom-bash_profile`
- Modify: `os/sysconfig/bloom-greeting.sh`

**Step 1: Update Containerfile — hostname and branding**

In `os/Containerfile`, make these changes:

1. Change hostname from `pibloom` to `bloom`:
```
# Before:
RUN echo "pibloom" > /etc/hostname

# After:
RUN echo "bloom" > /etc/hostname
```

2. Add `/etc/issue` branding (add before the hostname line):
```dockerfile
# Login branding — clean Bloom identity
RUN printf 'Bloom OS\n\n' > /etc/issue && \
    printf '' > /etc/motd
```

3. Remove bash wizard lines (delete these 4 lines):
```dockerfile
# First-boot setup wizard (runs once on VT1, creates password, configures WiFi/NetBird)
COPY os/sysconfig/bloom-setup.sh /usr/local/bin/bloom-setup.sh
RUN chmod +x /usr/local/bin/bloom-setup.sh
COPY os/sysconfig/bloom-setup.service /usr/lib/systemd/system/bloom-setup.service
RUN systemctl enable bloom-setup.service
```

4. Add auto-login from the start (add after SSH enable):
```dockerfile
# Auto-login on VT1 — Pi handles authentication via setup wizard
RUN mkdir -p /usr/lib/systemd/system/getty@tty1.service.d
COPY os/sysconfig/getty-autologin.conf /usr/lib/systemd/system/getty@tty1.service.d/autologin.conf
```

**Step 2: Simplify bloom-bash_profile**

```bash
# Start Pi on interactive login
if [ -t 0 ] && [ -z "$PI_SESSION" ]; then
  export PI_SESSION=1
  /usr/local/bin/bloom-greeting.sh
  exec pi
fi
```

This stays the same — the greeting script is simplified in the next step.

**Step 3: Simplify bloom-greeting.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Bloom login script — ensures Pi settings include Bloom package.

BLOOM_PKG="/usr/local/share/bloom"
PI_SETTINGS="$HOME/.pi/agent/settings.json"

# Ensure Pi settings include the Bloom package (idempotent)
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
```

Remove the first-boot greeting banner (Pi handles that now) and the `.initialized` marker logic.

**Step 4: Commit**

```bash
git add os/Containerfile os/sysconfig/bloom-bash_profile os/sysconfig/bloom-greeting.sh
git commit -m "feat(setup): update OS branding, remove bash wizard, add auto-login"
```

---

### Task 6: OS Image — llama.cpp and Model Bundling

Add llama.cpp binary, Qwen3.5-4B GGUF model, and systemd service to the Containerfile.

**Files:**
- Modify: `os/Containerfile`
- Create: `os/sysconfig/bloom-llm-local.service`

**Step 1: Create the llama.cpp systemd service**

```ini
# os/sysconfig/bloom-llm-local.service
[Unit]
Description=Bloom Local LLM (llama.cpp + Qwen3.5-4B)
After=network.target
Before=getty@tty1.service

[Service]
Type=simple
User=llm
Group=llm
ExecStart=/usr/local/bin/llama-server \
    --model /usr/local/share/bloom/models/qwen3.5-4b.gguf \
    --host 127.0.0.1 \
    --port 8080 \
    --ctx-size 8192 \
    --threads 4 \
    --no-mmap
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**Step 2: Add Containerfile instructions**

Add after the NetBird section in `os/Containerfile`:

```dockerfile
# Create dedicated llm user for local model server
RUN useradd -r -s /sbin/nologin llm

# Install llama.cpp server binary (pre-built release)
# TODO: Pin to specific release version and verify checksum
ARG LLAMA_CPP_VERSION=latest
RUN curl -L "https://github.com/ggerganov/llama.cpp/releases/download/${LLAMA_CPP_VERSION}/llama-server-linux-x86_64.tar.gz" \
    | tar -xz -C /usr/local/bin/ llama-server && \
    chmod +x /usr/local/bin/llama-server

# Download Qwen3.5-4B GGUF model
RUN mkdir -p /usr/local/share/bloom/models && \
    curl -L "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_0.gguf" \
    -o /usr/local/share/bloom/models/qwen3.5-4b.gguf && \
    chown llm:llm /usr/local/share/bloom/models/qwen3.5-4b.gguf

# Local LLM service (starts before login, stopped when user switches to cloud)
COPY os/sysconfig/bloom-llm-local.service /usr/lib/systemd/system/bloom-llm-local.service
RUN systemctl enable bloom-llm-local.service
```

Note: The exact download URLs and release tags need to be verified at build time. The `LLAMA_CPP_VERSION` arg should be pinned to a specific release (e.g., `b5220`). The GGUF filename should be confirmed from the HuggingFace repo.

**Step 3: Commit**

```bash
git add os/sysconfig/bloom-llm-local.service os/Containerfile
git commit -m "feat(setup): add llama.cpp + Qwen3.5-4B to OS image with systemd service"
```

---

### Task 7: OS Image — whisper.cpp Bundling

Add whisper.cpp binary, whisper-small model, and systemd service.

**Files:**
- Modify: `os/Containerfile`
- Create: `os/sysconfig/bloom-whisper-local.service`

**Step 1: Create the whisper.cpp systemd service**

```ini
# os/sysconfig/bloom-whisper-local.service
[Unit]
Description=Bloom Local Whisper (whisper.cpp + whisper-small)
After=network.target

[Service]
Type=simple
User=llm
Group=llm
ExecStart=/usr/local/bin/whisper-server \
    --model /usr/local/share/bloom/models/whisper-small.bin \
    --host 127.0.0.1 \
    --port 8081 \
    --threads 2
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Note: whisper.cpp service is NOT enabled by default. It gets started during the setup wizard when the user opts in.

**Step 2: Add Containerfile instructions**

Add after the llama.cpp section:

```dockerfile
# Install whisper.cpp server binary (pre-built release)
# TODO: Pin to specific release version and verify checksum
ARG WHISPER_CPP_VERSION=latest
RUN curl -L "https://github.com/ggerganov/whisper.cpp/releases/download/${WHISPER_CPP_VERSION}/whisper-server-linux-x86_64.tar.gz" \
    | tar -xz -C /usr/local/bin/ whisper-server && \
    chmod +x /usr/local/bin/whisper-server

# Download whisper-small model
RUN curl -L "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin" \
    -o /usr/local/share/bloom/models/whisper-small.bin && \
    chown llm:llm /usr/local/share/bloom/models/whisper-small.bin

# Whisper service (not enabled by default — started during setup if user opts in)
COPY os/sysconfig/bloom-whisper-local.service /usr/lib/systemd/system/bloom-whisper-local.service
```

**Step 3: Commit**

```bash
git add os/sysconfig/bloom-whisper-local.service os/Containerfile
git commit -m "feat(setup): add whisper.cpp + whisper-small to OS image"
```

---

### Task 8: Local Model Provider Registration

Add provider registration to the bloom-setup extension so Pi auto-selects the local model on first boot.

**Files:**
- Modify: `extensions/bloom-setup/index.ts`
- Modify: `tests/extensions/bloom-setup.test.ts`

**Step 1: Update test to check for provider registration**

Add to `tests/extensions/bloom-setup.test.ts`:

```typescript
describe("bloom-setup provider registration", () => {
	it("calls registerProvider when setup is not done", async () => {
		// Note: registerProvider may not be in mock yet — add it
		(api as any).registerProvider = vi.fn();
		await loadExtension();
		expect((api as any).registerProvider).toHaveBeenCalledWith(
			"bloom-local",
			expect.objectContaining({
				baseUrl: "http://localhost:8080/v1",
				api: "openai-completions",
			}),
		);
	});
});
```

Add `vi` to the vitest import at the top of the test file.

**Step 2: Update mock-extension-api.ts**

Add `registerProvider` to the mock:

```typescript
registerProvider: vi.fn(),
```

Add to the `MockExtensionAPI` interface:

```typescript
registerProvider: ReturnType<typeof vi.fn>;
```

**Step 3: Update index.ts**

Add provider registration at the top of the `export default function`:

```typescript
// Register local LLM provider if setup is not yet complete
if (!isSetupDone()) {
    (pi as any).registerProvider?.("bloom-local", {
        baseUrl: "http://localhost:8080/v1",
        apiKey: "local",
        api: "openai-completions",
        models: [{
            id: "qwen3.5-4b",
            name: "Qwen 3.5 4B (local)",
            reasoning: true,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 131072,
            maxTokens: 8192,
        }],
    });
}
```

Note: Using `(pi as any).registerProvider?.()` because `registerProvider` may not exist in all Pi SDK versions. If the SDK types include it, use it directly.

**Step 4: Run tests**

Run: `npm run test -- tests/extensions/bloom-setup.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add extensions/bloom-setup/index.ts tests/extensions/bloom-setup.test.ts tests/helpers/mock-extension-api.ts
git commit -m "feat(setup): register local LLM provider on first boot"
```

---

### Task 9: Clean Up Deleted Files

Remove the bash wizard files that are no longer needed.

**Files:**
- Delete: `os/sysconfig/bloom-setup.sh`
- Delete: `os/sysconfig/bloom-setup.service`

**Step 1: Remove files**

```bash
git rm os/sysconfig/bloom-setup.sh os/sysconfig/bloom-setup.service
```

**Step 2: Verify Containerfile no longer references them**

Run: `grep -n "bloom-setup" os/Containerfile`
Expected: No matches (removed in Task 5)

**Step 3: Commit**

```bash
git commit -m "chore(setup): remove bash wizard (bloom-setup.sh, bloom-setup.service)"
```

---

### Task 10: Integration Test — Build and Verify

Build the OS image and verify the changes work end-to-end.

**Step 1: Run lint**

Run: `npm run check`
Expected: PASS

**Step 2: Run all tests**

Run: `npm run test`
Expected: All tests PASS

**Step 3: Build TypeScript**

Run: `npm run build`
Expected: PASS, no type errors

**Step 4: Build OS image**

Run: `just build`
Expected: Image builds successfully. Note: This will take a while as it downloads the LLM and whisper models during build. If running in a limited environment, verify the Containerfile syntax is correct and defer the full build.

**Step 5: Commit any fixes**

If any step above fails, fix the issue and commit:

```bash
git add -A
git commit -m "fix(setup): address build issues from integration test"
```

---

## Task Dependency Graph

```
Task 1 (lib/setup.ts)
  └─→ Task 2 (actions.ts)
       └─→ Task 3 (index.ts)
            ├─→ Task 4 (SKILL.md) — independent after Task 3
            ├─→ Task 8 (provider registration)
            └─→ Task 9 (delete old files) — independent after Task 5

Task 5 (OS branding) — independent of Task 1-3
Task 6 (llama.cpp) — independent, depends on Task 5 for Containerfile context
Task 7 (whisper.cpp) — depends on Task 6 for Containerfile context
Task 10 (integration) — depends on all tasks
```

**Parallelizable**: Tasks 4, 5, 8, 9 can run in parallel after Task 3 completes. Tasks 6 and 7 can run in parallel with Tasks 1-3.
