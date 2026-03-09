/**
 * Lemonade-server model management helpers.
 *
 * Lemonade exposes `POST /api/v1/pull` to download models by name.
 * This module defines the model catalog and helpers for interacting with it.
 */

export interface LemonadeModel {
	name: string;
	type: "llm" | "stt" | "tts" | "image";
	description: string;
	required: boolean;
}

/** Models available for pull via lemonade-server. */
export const LEMONADE_MODELS: LemonadeModel[] = [
	{ name: "Qwen3-4B-GGUF", type: "llm", description: "Local LLM (4B params, fast reasoning)", required: true },
	{ name: "Whisper-Small", type: "stt", description: "Speech-to-text (English + multilingual)", required: false },
	{ name: "SD-Turbo", type: "image", description: "Fast image generation", required: false },
	{ name: "kokoro-v1", type: "tts", description: "Text-to-speech voice synthesis", required: false },
];

/** Build the JSON payload for `POST /api/v1/pull`. Returns null if model name is unknown. */
export function buildPullPayload(modelName: string): { model: string; stream: boolean } | null {
	const found = LEMONADE_MODELS.find((m) => m.name === modelName);
	if (!found) return null;
	return { model: modelName, stream: true };
}

/** Base URL for lemonade-server API (localhost, default port). */
export const LEMONADE_BASE_URL = "http://localhost:8000/api/v1";

/**
 * Pull a model by name via lemonade-server's HTTP API.
 * Streams progress and resolves when download completes.
 */
export async function pullModel(
	modelName: string,
	baseUrl = LEMONADE_BASE_URL,
	signal?: AbortSignal,
): Promise<{ ok: boolean; model: string; note?: string }> {
	const payload = buildPullPayload(modelName);
	if (!payload) {
		return { ok: false, model: modelName, note: `Unknown model: ${modelName}` };
	}

	try {
		const res = await fetch(`${baseUrl}/pull`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
			signal,
		});

		if (!res.ok) {
			const body = await res.text().catch(() => "");
			return { ok: false, model: modelName, note: `Pull failed (${res.status}): ${body}` };
		}

		// Consume the streaming response to completion
		if (res.body) {
			const reader = res.body.getReader();
			while (true) {
				const { done } = await reader.read();
				if (done) break;
			}
		}

		return { ok: true, model: modelName };
	} catch (err) {
		return { ok: false, model: modelName, note: `Pull error: ${(err as Error).message}` };
	}
}
