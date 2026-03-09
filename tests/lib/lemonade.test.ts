import { describe, expect, it } from "vitest";
import { buildPullPayload, LEMONADE_MODELS } from "../../lib/lemonade.js";

describe("LEMONADE_MODELS", () => {
	it("contains all four model entries", () => {
		expect(LEMONADE_MODELS).toHaveLength(4);
		const names = LEMONADE_MODELS.map((m) => m.name);
		expect(names).toContain("Qwen3-4B-GGUF");
		expect(names).toContain("Whisper-Small");
		expect(names).toContain("SD-Turbo");
		expect(names).toContain("kokoro-v1");
	});

	it("each model has a type field", () => {
		for (const m of LEMONADE_MODELS) {
			expect(["llm", "stt", "tts", "image"]).toContain(m.type);
		}
	});
});

describe("buildPullPayload", () => {
	it("returns correct payload for a known model name", () => {
		const payload = buildPullPayload("Qwen3-4B-GGUF");
		expect(payload).toEqual({ model: "Qwen3-4B-GGUF", stream: true });
	});

	it("returns null for unknown model", () => {
		const payload = buildPullPayload("Unknown-Model-XYZ");
		expect(payload).toBeNull();
	});
});
