/**
 * localai — Register LocalAI as a Pi provider for local LLM inference.
 *
 * llama-server runs on every Garden OS instance at http://localhost:11435/v1.
 * The Qwen 3.5 4B Q4_K_M model is pre-seeded and available at boot.
 *
 * @see {@link ../../AGENTS.md#localai} Extension reference
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerProvider("localai", {
		baseUrl: "http://localhost:11435/v1",
		apiKey: "local",
		api: "openai-completions",
		models: [
			{
				id: "Qwen3.5-4B-Q4_K_M",
				name: "Qwen 3.5 4B",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 8192,
				maxTokens: 4096,
				compat: {
					supportsDeveloperRole: false,
					maxTokensField: "max_tokens",
				},
			},
		],
	});
}
