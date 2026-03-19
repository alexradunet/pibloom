/**
 * garden — Garden directory bootstrap, status, and blueprint seeding.
 *
 * @tools garden_status
 * @commands /garden (init | status | update-blueprints)
 * @hooks session_start, resources_discover
 * @see {@link ../../AGENTS.md#garden} Extension reference
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { defineTool, type RegisteredExtensionTool, registerTools } from "../../../lib/extension-tools.js";
import { getGardenDir } from "../../../lib/filesystem.js";
import { discoverSkillPaths, ensureGarden, getPackageDir, handleGardenStatus } from "./actions.js";
import { handleUpdateBlueprints, readBlueprintVersions, seedBlueprints } from "./actions-blueprints.js";

type GardenCommandContext = Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1];

export default function (pi: ExtensionAPI) {
	const gardenDir = getGardenDir();
	const packageDir = getPackageDir();
	const tools: RegisteredExtensionTool[] = [
		defineTool({
			name: "garden_status",
			label: "Garden Status",
			description: "Show Garden directory location and blueprint state",
			parameters: Type.Object({}),
			async execute() {
				return handleGardenStatus(gardenDir);
			},
		}),
	];
	registerTools(pi, tools);

	pi.on("session_start", (_event, ctx) => {
		ensureGarden(gardenDir);
		seedBlueprints(gardenDir, packageDir);

		const versions = readBlueprintVersions(gardenDir);
		const updates = Object.keys(versions.updatesAvailable);
		if (ctx.hasUI) {
			if (updates.length > 0) {
				ctx.ui.setWidget("garden-updates", [
					`${updates.length} blueprint update(s) available — /garden update-blueprints`,
				]);
			}
			ctx.ui.setStatus("garden", `Garden: ${gardenDir}`);
		}
	});

	pi.registerCommand("garden", {
		description: "Garden directory management: /garden init | status | update-blueprints",
		handler: async (args: string, ctx) => handleGardenCommand(pi, gardenDir, packageDir, args, ctx),
	});

	pi.on("resources_discover", () => {
		const paths = discoverSkillPaths(gardenDir);
		if (paths) return { skillPaths: paths };
	});
}

async function handleGardenCommand(
	pi: ExtensionAPI,
	gardenDir: string,
	packageDir: string,
	args: string,
	ctx: GardenCommandContext,
): Promise<void> {
	const subcommand = args.trim().split(/\s+/)[0] ?? "";
	if (!subcommand) {
		ctx.ui.notify("Usage: /garden init | status | update-blueprints", "info");
		return;
	}

	switch (subcommand) {
		case "init":
			ensureGarden(gardenDir);
			seedBlueprints(gardenDir, packageDir);
			ctx.ui.notify("Garden initialized", "info");
			return;
		case "status":
			pi.sendUserMessage("Show garden status using the garden_status tool.", { deliverAs: "followUp" });
			return;
		case "update-blueprints": {
			const count = handleUpdateBlueprints(gardenDir, packageDir);
			ctx.ui.notify(count === 0 ? "All blueprints are up to date" : `Updated ${count} blueprint(s)`, "info");
			return;
		}
		default:
			ctx.ui.notify("Usage: /garden init | status | update-blueprints", "info");
	}
}
