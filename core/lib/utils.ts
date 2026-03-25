/**
 * Pure utility functions with no side effects.
 */

import { truncateHead } from "@mariozechner/pi-coding-agent";

export function truncate(text: string): string {
	return truncateHead(text, { maxLines: 2000, maxBytes: 50000 }).content;
}

export function errorResult(message: string) {
	return {
		content: [{ type: "text" as const, text: message }],
		details: {},
		isError: true,
	};
}

export function nowIso(): string {
	return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
