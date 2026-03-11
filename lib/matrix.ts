/**
 * Pure Matrix utility functions.
 * No side effects — all I/O is handled by callers.
 */
import { randomBytes } from "node:crypto";
import os from "node:os";
import { join } from "node:path";

/** Path to stored Matrix credentials. */
export function matrixCredentialsPath(): string {
	return join(os.homedir(), ".pi", "matrix-credentials.json");
}

/** Generate a secure random password (base64url, 24 bytes = 32 chars). */
export function generatePassword(bytes = 24): string {
	return randomBytes(bytes).toString("base64url");
}

/**
 * Extract text from the last assistant message in a conversation.
 * Handles multimodal responses (concatenates text parts, skips tool_use),
 * empty responses (tool-only turns), and post-compaction message arrays.
 */
// biome-ignore lint/suspicious/noExplicitAny: accepts SDK AgentMessage[] without coupling to SDK types
export function extractResponseText(messages: readonly any[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i] as Record<string, unknown>;
		if (!("role" in msg) || msg.role !== "assistant") continue;

		const content = (msg as { role: "assistant"; content: unknown }).content;

		// Handle string content (post-compaction summaries)
		if (typeof content === "string") return content;

		// Handle array content blocks
		if (Array.isArray(content)) {
			const textParts = (content as Array<{ type: string; text?: string }>)
				.filter((c) => c.type === "text" && c.text)
				.map((c) => c.text as string);
			if (textParts.length > 0) return textParts.join("\n\n");
		}
	}
	return "";
}

/** Matrix credentials structure stored on disk. */
export interface MatrixCredentials {
	homeserver: string;
	botUserId: string;
	botAccessToken: string;
	botPassword: string;
	userUserId?: string;
	userPassword?: string;
	registrationToken: string;
}
