/**
 * bloom-garden — Bloom directory management, blueprint seeding, skill creation, persona evolution.
 *
 * @tools garden_status, skill_create, skill_list, persona_evolve
 * @commands /bloom (init | status | update-blueprints)
 * @hooks session_start, resources_discover
 * @see {@link ../../AGENTS.md#bloom-garden} Extension reference
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getBloomDir } from "../../lib/filesystem.js";
import {
	discoverSkillPaths,
	ensureBloom,
	getPackageDir,
	handleGardenStatus,
	handlePersonaEvolve,
	handleSkillCreate,
	handleSkillList,
	handleUpdateBlueprints,
	readBlueprintVersions,
	seedBlueprints,
} from "./actions.js";

export default function (pi: ExtensionAPI) {
	const bloomDir = getBloomDir();
	const packageDir = getPackageDir();

	pi.on("session_start", (_event, ctx) => {
		ensureBloom(bloomDir);
		seedBlueprints(bloomDir, packageDir);
		process.env._BLOOM_DIR_RESOLVED = bloomDir;

		const versions = readBlueprintVersions(bloomDir);
		const updates = Object.keys(versions.updatesAvailable);
		if (ctx.hasUI) {
			if (updates.length > 0) {
				ctx.ui.setWidget("bloom-updates", [
					`${updates.length} blueprint update(s) available — /bloom update-blueprints`,
				]);
			}
			ctx.ui.setStatus("bloom-garden", `Bloom: ${bloomDir}`);
		}
	});

	pi.registerTool({
		name: "garden_status",
		label: "Bloom Status",
		description: "Show Bloom directory location and blueprint state",
		parameters: Type.Object({}),
		async execute() {
			return handleGardenStatus(bloomDir);
		},
	});

	pi.registerCommand("bloom", {
		description: "Bloom directory management: /bloom init | status | update-blueprints",
		handler: async (args: string, ctx) => {
			const sub = args.trim().split(/\s+/)[0] ?? "";

			switch (sub) {
				case "init": {
					ensureBloom(bloomDir);
					seedBlueprints(bloomDir, packageDir);
					ctx.ui.notify("Bloom initialized", "info");
					break;
				}
				case "status": {
					pi.sendUserMessage("Show bloom status using the garden_status tool.", { deliverAs: "followUp" });
					break;
				}
				case "update-blueprints": {
					const count = handleUpdateBlueprints(bloomDir, packageDir);
					if (count === 0) {
						ctx.ui.notify("All blueprints are up to date", "info");
					} else {
						ctx.ui.notify(`Updated ${count} blueprint(s)`, "info");
					}
					break;
				}
				default: {
					ctx.ui.notify("Usage: /bloom init | status | update-blueprints", "info");
					break;
				}
			}
		},
	});

	pi.on("resources_discover", () => {
		const paths = discoverSkillPaths(bloomDir);
		if (paths) return { skillPaths: paths };
	});

	pi.registerTool({
		name: "skill_create",
		label: "Create Skill",
		description: "Create a new skill markdown file in the Bloom directory",
		parameters: Type.Object({
			name: Type.String({ description: "Skill name (kebab-case, e.g. meal-planning)" }),
			description: Type.String({ description: "One-line skill description" }),
			content: Type.String({ description: "Skill body in markdown (instructions, guidelines, examples)" }),
		}),
		async execute(_toolCallId, params) {
			return handleSkillCreate(bloomDir, params);
		},
	});

	pi.registerTool({
		name: "skill_list",
		label: "List Skills",
		description: "List all skills in the Bloom directory",
		parameters: Type.Object({}),
		async execute() {
			return handleSkillList(bloomDir);
		},
	});

	pi.registerTool({
		name: "persona_evolve",
		label: "Propose Persona Change",
		description: "Propose a change to a persona layer, tracked as an evolution object",
		promptGuidelines: ["Changes require explicit user approval before applying."],
		parameters: Type.Object({
			layer: Type.String({ description: "Persona layer to change: SOUL, BODY, FACULTY, or SKILL" }),
			slug: Type.String({ description: "Evolution slug (e.g. add-health-awareness)" }),
			title: Type.String({ description: "Short description of the proposed change" }),
			proposal: Type.String({ description: "Detailed description of what to change and why" }),
		}),
		async execute(_toolCallId, params) {
			return handlePersonaEvolve(bloomDir, params);
		},
	});
}
