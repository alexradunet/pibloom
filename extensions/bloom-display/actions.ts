/**
 * Handler / business logic for bloom-display (Wayland / Sway).
 */

import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "../../lib/exec.js";
import { errorResult, truncate } from "../../lib/shared.js";
import type { SwayNode } from "./types.js";

const WAYLAND_DISPLAY = "wayland-1";
const XDG_RUNTIME_DIR = process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 1000}`;
const BLOOM_SCRIPTS_DIR = process.env.BLOOM_SCRIPTS_DIR ?? "/usr/local/share/bloom/os/scripts";

/** Discover the Sway IPC socket path from XDG_RUNTIME_DIR. */
function swaysock(): string {
	try {
		const entries = readdirSync(XDG_RUNTIME_DIR);
		const sock = entries.find((e) => e.startsWith("sway-ipc.") && e.endsWith(".sock"));
		if (sock) return join(XDG_RUNTIME_DIR, sock);
	} catch {
		/* directory missing or unreadable */
	}
	return process.env.SWAYSOCK ?? join(XDG_RUNTIME_DIR, "sway-ipc.sock");
}

/** Wayland environment variables passed to child processes. */
function waylandEnv(): Record<string, string> {
	return {
		WAYLAND_DISPLAY,
		XDG_RUNTIME_DIR,
		SWAYSOCK: swaysock(),
		DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS ?? `unix:path=${XDG_RUNTIME_DIR}/bus`,
	};
}

/** Run a command with Wayland env vars set via env passthrough (no global mutation). */
async function runDisplay(cmd: string, args: string[], signal?: AbortSignal): ReturnType<typeof run> {
	return run(cmd, args, signal, undefined, waylandEnv());
}

/** Take a screenshot, optionally of a region. */
export async function handleScreenshot(
	params: { region?: { x: number; y: number; w: number; h: number } },
	signal?: AbortSignal,
) {
	const outPath = "/tmp/bloom-screenshot.png";
	const args: string[] = [];
	if (params.region) {
		const { x, y, w, h } = params.region;
		args.push("-g", `${x},${y} ${w}x${h}`);
	}
	args.push(outPath);
	const result = await runDisplay("grim", args, signal);
	if (result.exitCode !== 0) {
		return errorResult(`Screenshot failed:\n${result.stderr}`);
	}
	const buf = await readFile(outPath);
	const base64 = buf.toString("base64");
	return {
		content: [{ type: "image" as const, data: base64, mimeType: "image/png" }],
		details: { path: outPath },
	};
}

/** Click at coordinates. */
export async function handleClick(params: { x?: number; y?: number; button?: number }, signal?: AbortSignal) {
	if (params.x === undefined || params.y === undefined) {
		return errorResult("click requires x and y coordinates.");
	}
	const btnMap: Record<number, string> = { 1: "left", 2: "middle", 3: "right" };
	const btnName = btnMap[params.button ?? 1] ?? "left";
	const moveResult = await runDisplay("wlrctl", ["pointer", "move", String(params.x), String(params.y)], signal);
	if (moveResult.exitCode !== 0) {
		return errorResult(`Click move failed:\n${moveResult.stderr}`);
	}
	const clickResult = await runDisplay("wlrctl", ["pointer", "click", btnName], signal);
	if (clickResult.exitCode !== 0) {
		return errorResult(`Click failed:\n${clickResult.stderr}`);
	}
	return {
		content: [{ type: "text" as const, text: `Clicked (${params.x}, ${params.y}) button ${btnName}.` }],
		details: { x: params.x, y: params.y, button: btnName },
	};
}

/** Type text. */
export async function handleType(params: { text?: string }, signal?: AbortSignal) {
	if (!params.text) {
		return errorResult("type requires text parameter.");
	}
	const result = await runDisplay("wlrctl", ["keyboard", "type", params.text], signal);
	if (result.exitCode !== 0) {
		return errorResult(`Type failed:\n${result.stderr}`);
	}
	return {
		content: [{ type: "text" as const, text: `Typed ${params.text.length} characters.` }],
		details: { length: params.text.length },
	};
}

/** Send key combo. */
export async function handleKey(params: { keys?: string }, signal?: AbortSignal) {
	if (!params.keys) {
		return errorResult("key requires keys parameter (e.g. 'ctrl+l', 'Return').");
	}
	const result = await runDisplay("wlrctl", ["keyboard", "key", params.keys], signal);
	if (result.exitCode !== 0) {
		return errorResult(`Key press failed:\n${result.stderr}`);
	}
	return {
		content: [{ type: "text" as const, text: `Sent key: ${params.keys}` }],
		details: { keys: params.keys },
	};
}

/** Move mouse. */
export async function handleMove(params: { x?: number; y?: number }, signal?: AbortSignal) {
	if (params.x === undefined || params.y === undefined) {
		return errorResult("move requires x and y coordinates.");
	}
	const result = await runDisplay("wlrctl", ["pointer", "move", String(params.x), String(params.y)], signal);
	if (result.exitCode !== 0) {
		return errorResult(`Mouse move failed:\n${result.stderr}`);
	}
	return {
		content: [{ type: "text" as const, text: `Moved mouse to (${params.x}, ${params.y}).` }],
		details: { x: params.x, y: params.y },
	};
}

/** Scroll at position. */
export async function handleScroll(
	params: { x?: number; y?: number; direction?: "up" | "down"; clicks?: number },
	signal?: AbortSignal,
) {
	if (params.x === undefined || params.y === undefined) {
		return errorResult("scroll requires x and y coordinates.");
	}
	if (!params.direction) {
		return errorResult("scroll requires direction ('up' or 'down').");
	}
	const n = params.clicks ?? 3;
	const amount = params.direction === "up" ? -n : n;
	const moveResult = await runDisplay("wlrctl", ["pointer", "move", String(params.x), String(params.y)], signal);
	if (moveResult.exitCode !== 0) {
		return errorResult(`Scroll move failed:\n${moveResult.stderr}`);
	}
	const scrollResult = await runDisplay("wlrctl", ["pointer", "scroll", String(amount)], signal);
	if (scrollResult.exitCode !== 0) {
		return errorResult(`Scroll failed:\n${scrollResult.stderr}`);
	}
	return {
		content: [
			{
				type: "text" as const,
				text: `Scrolled ${params.direction} ${n} clicks at (${params.x}, ${params.y}).`,
			},
		],
		details: { x: params.x, y: params.y, direction: params.direction, clicks: n },
	};
}

/** Read the AT-SPI2 accessibility tree. */
export async function handleUiTree(params: { app?: string }, signal?: AbortSignal) {
	const scriptPath = join(BLOOM_SCRIPTS_DIR, "ui-tree.py");
	const treeArgs = [scriptPath];
	if (params.app) {
		treeArgs.push("--app", params.app);
	}
	const result = await runDisplay("python3", treeArgs, signal);
	if (result.exitCode !== 0) {
		return errorResult(`AT-SPI2 tree failed:\n${result.stderr}`);
	}
	return {
		content: [{ type: "text" as const, text: truncate(result.stdout || "[]") }],
		details: { app: params.app ?? null },
	};
}

/** Recursively collect visible windows from the Sway tree. */
function collectWindows(node: SwayNode, out: Array<{ id: number; name: string; focused: boolean }>): void {
	if (node.type === "con" && node.name) {
		out.push({ id: node.id, name: node.name, focused: node.focused });
	}
	for (const child of node.nodes ?? []) {
		collectWindows(child, out);
	}
	for (const child of node.floating_nodes ?? []) {
		collectWindows(child, out);
	}
}

/** List windows via swaymsg. */
export async function handleWindows(signal?: AbortSignal) {
	const result = await runDisplay("swaymsg", ["-t", "get_tree"], signal);
	if (result.exitCode !== 0) {
		return errorResult(`Window list failed:\n${result.stderr}`);
	}
	let tree: SwayNode;
	try {
		tree = JSON.parse(result.stdout);
	} catch {
		return errorResult("Failed to parse swaymsg tree output.");
	}
	const windows: Array<{ id: number; name: string; focused: boolean }> = [];
	collectWindows(tree, windows);
	return {
		content: [{ type: "text" as const, text: JSON.stringify(windows, null, 2) }],
		details: { count: windows.length },
	};
}

/** Launch an app. */
export async function handleLaunch(params: { command?: string }, signal?: AbortSignal) {
	if (!params.command) {
		return errorResult("launch requires command parameter.");
	}
	const result = await runDisplay("bash", ["-c", `${params.command} &`], signal);
	if (result.exitCode !== 0) {
		return errorResult(`Launch failed:\n${result.stderr}`);
	}
	return {
		content: [{ type: "text" as const, text: `Launched: ${params.command}` }],
		details: { command: params.command },
	};
}

/** Focus a window by Sway con_id or title. */
export async function handleFocus(params: { target?: string }, signal?: AbortSignal) {
	if (!params.target) {
		return errorResult("focus requires target parameter (window title or ID).");
	}
	const isNumeric = /^\d+$/.test(params.target);
	const criteria = isNumeric ? `[con_id=${params.target}]` : `[title="${params.target}"]`;
	const result = await runDisplay("swaymsg", [`${criteria} focus`], signal);
	if (result.exitCode !== 0) {
		return errorResult(`Focus failed:\n${result.stderr}`);
	}
	return {
		content: [{ type: "text" as const, text: `Focused window: ${params.target}` }],
		details: { target: params.target },
	};
}
