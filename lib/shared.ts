import os from "node:os";
import path from "node:path";
import { truncateHead } from "@mariozechner/pi-coding-agent";

/** Result of parsing YAML frontmatter from a markdown string. */
export interface ParsedFrontmatter<T> {
	attributes: T;
	body: string;
	bodyBegin: number;
	frontmatter: string;
}

/** Resolve the Garden vault directory. Checks `_BLOOM_GARDEN_RESOLVED`, then `BLOOM_GARDEN_DIR`, then falls back to `~/Garden`. */
export function getGardenDir(): string {
	return process.env._BLOOM_GARDEN_RESOLVED ?? process.env.BLOOM_GARDEN_DIR ?? path.join(os.homedir(), "Garden");
}

/** Truncate text to 2000 lines / 50KB using Pi's truncateHead utility. */
export function truncate(text: string): string {
	return truncateHead(text, { maxLines: 2000, maxBytes: 50000 }).content;
}

/** Build a standardized Pi tool error response. */
export function errorResult(message: string) {
	return {
		content: [{ type: "text" as const, text: message }],
		details: {},
		isError: true,
	};
}

/** Return current time as ISO 8601 string without milliseconds (e.g., `2026-03-06T12:00:00Z`). */
export function nowIso(): string {
	return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Serialize a data object and markdown body into a frontmatter-delimited string. */
export function stringifyFrontmatter(data: Record<string, unknown>, content: string): string {
	const lines: string[] = ["---"];
	for (const [key, val] of Object.entries(data)) {
		if (Array.isArray(val)) {
			lines.push(`${key}: ${val.join(", ")}`);
		} else {
			lines.push(`${key}: ${val}`);
		}
	}
	lines.push("---");
	return `${lines.join("\n")}\n${content}`;
}

/** Parse YAML frontmatter from a markdown string. Returns attributes, body, and metadata. Supports comma-separated arrays and YAML-style list arrays. */
export function parseFrontmatter<T extends Record<string, unknown> = Record<string, unknown>>(
	str: string,
): ParsedFrontmatter<T> {
	if (!str.startsWith("---\n")) {
		return {
			attributes: {} as T,
			body: str,
			bodyBegin: 1,
			frontmatter: "",
		};
	}

	const end = str.indexOf("\n---\n", 4);
	if (end === -1) {
		return {
			attributes: {} as T,
			body: str,
			bodyBegin: 1,
			frontmatter: "",
		};
	}

	const frontmatter = str.slice(4, end);
	const body = str.slice(end + 5);
	const attributes: Record<string, unknown> = {};

	let currentArrayKey: string | null = null;
	let currentArrayValues: string[] = [];
	const flushArray = () => {
		if (currentArrayKey) {
			attributes[currentArrayKey] = currentArrayValues;
			currentArrayKey = null;
			currentArrayValues = [];
		}
	};

	for (const line of frontmatter.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		if (line.match(/^\s*-\s+/) && currentArrayKey) {
			const item = line.replace(/^\s*-\s+/, "").trim();
			if (item) currentArrayValues.push(item);
			continue;
		}

		flushArray();

		const colon = line.indexOf(":");
		if (colon === -1) continue;

		const key = line.slice(0, colon).trim();
		const val = line.slice(colon + 1).trim();
		if (!key) continue;

		if (val === "") {
			currentArrayKey = key;
			continue;
		}

		if (val.includes(",")) {
			attributes[key] = val
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
		} else {
			attributes[key] = val;
		}
	}

	flushArray();

	const bodyBegin = frontmatter.split("\n").length + 3;
	return {
		attributes: attributes as T,
		body,
		bodyBegin,
		frontmatter,
	};
}

/** The five PARA methodology directory names used in the Garden vault. */
export const PARA_DIRS = ["Inbox", "Projects", "Areas", "Resources", "Archive"];

type LogLevel = "debug" | "info" | "warn" | "error";

/** Create a structured JSON logger for a named component. Outputs to stdout/stderr with timestamp, level, component, and message. */
export function createLogger(component: string) {
	function log(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
		const entry: Record<string, unknown> = {
			ts: new Date().toISOString(),
			level,
			component,
			msg,
			...extra,
		};
		const line = JSON.stringify(entry);
		if (level === "error") {
			console.error(line);
		} else if (level === "warn") {
			console.warn(line);
		} else {
			console.log(line);
		}
	}

	return {
		debug: (msg: string, extra?: Record<string, unknown>) => log("debug", msg, extra),
		info: (msg: string, extra?: Record<string, unknown>) => log("info", msg, extra),
		warn: (msg: string, extra?: Record<string, unknown>) => log("warn", msg, extra),
		error: (msg: string, extra?: Record<string, unknown>) => log("error", msg, extra),
	};
}
