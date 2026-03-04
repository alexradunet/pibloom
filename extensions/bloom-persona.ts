import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
	{ pattern: /\brm\s+-rf\s+\//, label: "rm -rf /" },
	{ pattern: /mkfs/, label: "mkfs (filesystem format)" },
	{ pattern: /dd\b.*\bof=\/dev\//, label: "dd to device" },
	{ pattern: /:\(\)\s*\{/, label: "fork bomb" },
	{ pattern: /\bshutdown\b/, label: "shutdown" },
	{ pattern: /\breboot\b/, label: "reboot" },
];

function loadPersona(): string {
	const gardenDir = process.env._BLOOM_GARDEN_RESOLVED ?? process.env.BLOOM_GARDEN_DIR ?? join(homedir(), "Garden");
	const vaultDir = join(gardenDir, "Bloom", "Persona");
	const dir = existsSync(join(vaultDir, "SOUL.md")) ? vaultDir : join(fileURLToPath(import.meta.url), "../../persona");
	const layers: Array<[string, string]> = [
		["Soul", "SOUL.md"],
		["Body", "BODY.md"],
		["Faculty", "FACULTY.md"],
		["Skill", "SKILL.md"],
	];
	const sections = layers
		.map(([title, file]) => {
			const content = readFileSync(join(dir, file), "utf-8").trim();
			return `### ${title}\n\n${content}`;
		})
		.join("\n\n");
	return `## Bloom Persona\n\n${sections}`;
}

export default function (pi: ExtensionAPI) {
	let personaBlock: string | undefined;

	pi.on("session_start", () => {
		pi.setSessionName("Bloom");
	});

	pi.on("before_agent_start", async (event) => {
		if (personaBlock === undefined) {
			personaBlock = loadPersona();
		}
		const topicGuidance = [
			"",
			"## Topic Management",
			"",
			"You have topic management commands available:",
			"- `/topic new <name>` — Start a new conversation topic (e.g. `/topic new deploy-planning`)",
			"- `/topic close` — Close the current topic and summarize it",
			"- `/topic list` — Show all topics and their status",
			"- `/topic switch <name>` — Switch to an existing topic",
			"",
			"When you notice the conversation shifting to a distinctly different subject:",
			'- Suggest starting a new topic: "This seems like a new topic. You could use `/topic new <suggested-name>` to track it separately."',
			"- Do NOT auto-create topics — always suggest and let the user decide.",
			"- If the user ignores the suggestion, continue normally without repeating it.",
		].join("\n");
		return { systemPrompt: personaBlock + topicGuidance + "\n\n" + event.systemPrompt };
	});

	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash") return;
		const command: string = (event.input as { command?: string }).command ?? "";
		for (const { pattern, label } of DANGEROUS_PATTERNS) {
			if (pattern.test(command)) {
				return { block: true, reason: `Blocked dangerous command: ${label}` };
			}
		}
	});

	pi.on("session_before_compact", async (event) => {
		const { firstKeptEntryId, tokensBefore } = event.preparation;
		const summary = [
			"COMPACTION GUIDANCE — preserve the following across summarization:",
			"1. Bloom persona identity: values, voice, growth stage, and boundaries.",
			"2. Human context: name, preferences, recurring topics, and active projects.",
			"3. Task state: in-progress tasks, open threads, and decisions pending.",
			"4. PARA structure: known projects, areas, resources, and archive items.",
			`Tokens before compaction: ${tokensBefore}.`,
		].join("\n");
		return {
			compaction: { summary, firstKeptEntryId, tokensBefore },
		};
	});
}
