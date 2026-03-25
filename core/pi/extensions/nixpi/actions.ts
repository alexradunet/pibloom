/**
 * Handler / business logic for nixpi.
 * Package helpers, directory setup, and tool handlers.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../../../lib/exec.js";
import { textToolResult } from "../../../lib/extension-tools.js";
import { readPackageVersion, resolvePackageDir, safePath } from "../../../lib/filesystem.js";
import { stringifyFrontmatter } from "../../../lib/frontmatter.js";
import {
	generateAgentInstructionsMarkdown,
	type MatrixCredentials,
	matrixAgentCredentialsPath,
	matrixCredentialsPath,
	provisionMatrixAgentAccount,
} from "../../../lib/matrix.js";
import { errorResult, nowIso, truncate } from "../../../lib/utils.js";
import { readBlueprintVersions } from "./actions-blueprints.js";

const NIXPI_DIRS = ["Persona", "Skills", "Evolutions", "Objects", "Episodes", "Agents", "audit"];

// --- Package helpers ---

export function getPackageDir(): string {
	return resolvePackageDir(import.meta.url);
}

export function getPackageVersion(packageDir: string): string {
	return readPackageVersion(packageDir);
}

// --- Directory setup ---

export function ensureNixPi(nixPiDir: string): void {
	for (const dir of NIXPI_DIRS) {
		fs.mkdirSync(path.join(nixPiDir, dir), { recursive: true });
	}
}

// --- Tool handlers ---

export function handleNixPiStatus(nixPiDir: string) {
	const lines: string[] = [`NixPI: ${nixPiDir}`, ""];

	const versions = readBlueprintVersions(nixPiDir);
	lines.push(`Package version: ${versions.packageVersion}`);
	lines.push(`Seeded blueprints: ${Object.keys(versions.seeded).length}`);

	const updates = Object.keys(versions.updatesAvailable);
	if (updates.length > 0) {
		lines.push(`Updates available: ${updates.join(", ")}`);
	}

	return textToolResult(truncate(lines.join("\n")));
}

export function handleSkillCreate(workspaceDir: string, params: { name: string; description: string; content: string }) {
	let skillDir: string;
	try {
		skillDir = safePath(workspaceDir, "Skills", params.name);
	} catch {
		return errorResult("Path traversal blocked: invalid skill name");
	}
	const filepath = path.join(skillDir, "SKILL.md");

	if (fs.existsSync(filepath)) {
		return errorResult(`skill already exists: ${params.name}`);
	}

	fs.mkdirSync(skillDir, { recursive: true });
	const content = stringifyFrontmatter({ name: params.name, description: params.description }, `\n${params.content}\n`);
	fs.writeFileSync(filepath, content);

	return textToolResult(`created skill: ${params.name} at ${filepath}`);
}

export function handleSkillList(workspaceDir: string) {
	const skillsDir = path.join(workspaceDir, "Skills");
	if (!fs.existsSync(skillsDir)) {
		return textToolResult("No skills directory found.");
	}

	const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
	const skills: string[] = [];

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const skillFile = path.join(skillsDir, entry.name, "SKILL.md");
		if (!fs.existsSync(skillFile)) continue;
		const raw = fs.readFileSync(skillFile, "utf-8");
		const descMatch = raw.match(/^description:\s*(.+)$/m);
		const desc = descMatch ? descMatch[1] : "(no description)";
		skills.push(`${entry.name} — ${desc}`);
	}

	const text = skills.length > 0 ? skills.join("\n") : "No skills found in NixPI.";
	return textToolResult(text);
}

export interface AgentCreateParams {
	id: string;
	name: string;
	username?: string;
	description: string;
	role_prompt: string;
	model?: string;
	thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	respond_mode?: "host" | "mentioned" | "silent";
}

interface AgentCreateDeps {
	homeDir?: string;
	loadPrimaryMatrixConfig?: () => { homeserver: string; registrationToken: string };
	provision?: typeof provisionMatrixAgentAccount;
	restartDaemon?: () => Promise<{ ok: true } | { ok: false; error: string }>;
}

function loadPrimaryMatrixConfigFromDisk(homeDir = os.homedir()): { homeserver: string; registrationToken: string } {
	const pathToCreds =
		homeDir === os.homedir() ? matrixCredentialsPath() : path.join(homeDir, ".pi", "matrix-credentials.json");
	try {
		const raw = JSON.parse(fs.readFileSync(pathToCreds, "utf-8")) as MatrixCredentials;
		if (!raw.homeserver || !raw.registrationToken) {
			throw new Error("missing homeserver or registration token");
		}
		return { homeserver: raw.homeserver, registrationToken: raw.registrationToken };
	} catch {
		throw new Error(`No Matrix setup found at ${pathToCreds}`);
	}
}

export async function handleAgentCreate(workspaceDir: string, params: AgentCreateParams, deps: AgentCreateDeps = {}) {
	const target = validateAgentCreateTarget(workspaceDir, params);
	if ("error" in target) {
		return errorResult(target.error);
	}
	const { username, agentDir } = target;

	const instructionsPath = path.join(agentDir, "AGENTS.md");
	const credentialsPath = matrixAgentCredentialsPath(params.id, deps.homeDir ?? os.homedir());
	if (fs.existsSync(instructionsPath) || fs.existsSync(credentialsPath)) {
		return errorResult(`agent already exists: ${params.id}`);
	}

	let setup: { homeserver: string; registrationToken: string };
	try {
		setup = deps.loadPrimaryMatrixConfig
			? deps.loadPrimaryMatrixConfig()
			: loadPrimaryMatrixConfigFromDisk(deps.homeDir);
	} catch (err) {
		return errorResult(String(err));
	}

	const provision = deps.provision ?? provisionMatrixAgentAccount;
	const result = await provision({
		homeserver: setup.homeserver,
		username,
		registrationToken: setup.registrationToken,
	});
	if (!result.ok) return errorResult(result.error);

	fs.mkdirSync(agentDir, { recursive: true });
	fs.mkdirSync(path.dirname(credentialsPath), { recursive: true, mode: 0o700 });
	fs.writeFileSync(credentialsPath, JSON.stringify(result.credentials, null, 2), { mode: 0o600 });
	fs.writeFileSync(
		instructionsPath,
		generateAgentInstructionsMarkdown({
			id: params.id,
			name: params.name,
			username,
			description: params.description,
			rolePrompt: params.role_prompt,
			...(params.model ? { model: params.model } : {}),
			...(params.thinking ? { thinking: params.thinking } : {}),
			...(params.respond_mode ? { respondMode: params.respond_mode } : {}),
		}),
	);

	const restartDaemon = deps.restartDaemon ?? restartPiDaemon;
	const restartResult = await restartDaemon();
	const restartNote = restartResult.ok
		? "\nnixpi-daemon restarted to load the new agent."
		: `\nWarning: agent was created, but nixpi-daemon could not be restarted automatically.\n${truncate(restartResult.error)}`;

	return {
		content: [
			{
				type: "text" as const,
				text: `created agent: ${params.id}\nuser: ${result.credentials.userId}\ncredentials: ${credentialsPath}\ninstructions: ${instructionsPath}${restartNote}`,
			},
		],
		details: {
			agentId: params.id,
			userId: result.credentials.userId,
			credentialsPath,
			instructionsPath,
			daemonRestarted: restartResult.ok,
			...(restartResult.ok ? {} : { daemonRestartError: truncate(restartResult.error) }),
		},
	};
}

function validateAgentCreateTarget(
	workspaceDir: string,
	params: AgentCreateParams,
): { username: string; agentDir: string } | { error: string } {
	if (!/^[a-z0-9][a-z0-9-]*$/.test(params.id)) {
		return { error: `invalid agent id: ${params.id} (expected kebab-case)` };
	}

	const username = params.username ?? params.id;
	if (!/^[a-z0-9][a-z0-9-]*$/.test(username)) {
		return { error: `invalid username: ${username} (expected lowercase letters, numbers, hyphens)` };
	}

	try {
		return {
			username,
			agentDir: safePath(workspaceDir, "Agents", params.id),
		};
	} catch {
		return { error: "Path traversal blocked: invalid agent id" };
	}
}

async function restartPiDaemon(): Promise<{ ok: true } | { ok: false; error: string }> {
	const result = await run("nixpi-brokerctl", ["systemd", "restart", "nixpi-daemon.service"]);
	return result.exitCode === 0 ? { ok: true } : { ok: false, error: result.stderr || result.stdout };
}

export function handlePersonaEvolve(
	workspaceDir: string,
	params: { layer: string; slug: string; title: string; proposal: string },
) {
	const validLayers = ["SOUL", "BODY", "FACULTY", "SKILL"];
	if (!validLayers.includes(params.layer.toUpperCase())) {
		return errorResult(`invalid layer: ${params.layer} (expected: ${validLayers.join(", ")})`);
	}

	const evoDir = path.join(workspaceDir, "Evolutions");
	fs.mkdirSync(evoDir, { recursive: true });

	const filepath = path.join(evoDir, `${params.slug}.pi.md`);
	if (fs.existsSync(filepath)) {
		return errorResult(`evolution already exists: ${params.slug}`);
	}

	const data: Record<string, unknown> = {
		type: "evolution",
		slug: params.slug,
		title: params.title,
		layer: params.layer.toUpperCase(),
		status: "proposed",
		risk: "low",
		area: "persona",
		created: nowIso(),
	};

	fs.writeFileSync(filepath, stringifyFrontmatter(data, `\n${params.proposal}\n`));

	return textToolResult(
		`proposed persona evolution: ${params.slug}\nlayer: ${params.layer.toUpperCase()}\nstatus: proposed\n\nThe user must approve this evolution before it can be applied.`,
	);
}

/** Discover skill paths for dynamic loading. */
export function discoverSkillPaths(workspaceDir: string): string[] | undefined {
	const skillsDir = path.join(workspaceDir, "Skills");
	if (!fs.existsSync(skillsDir)) return undefined;
	return [skillsDir];
}

interface AgentInfo {
	id: string;
	name: string;
	userId: string;
	description?: string;
}

/** Load agent definitions from AGENTS.md files. */
export function loadAgentInfos(workspaceDir: string): AgentInfo[] {
	const agentsDir = path.join(workspaceDir, "Agents");
	if (!fs.existsSync(agentsDir)) return [];

	const agents: AgentInfo[] = [];
	const entries = fs.readdirSync(agentsDir, { withFileTypes: true });

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const agentFile = path.join(agentsDir, entry.name, "AGENTS.md");
		if (!fs.existsSync(agentFile)) continue;

		try {
			const raw = fs.readFileSync(agentFile, "utf-8");
			// Parse simple frontmatter
			const idMatch = raw.match(/^id:\s*(.+)$/m);
			const nameMatch = raw.match(/^name:\s*(.+)$/m);
			const usernameMatch = raw.match(/username:\s*(.+)$/m);
			const descMatch = raw.match(/^description:\s*(.+)$/m);

			if (idMatch && nameMatch && usernameMatch) {
				const id = idMatch[1].trim();
				const username = usernameMatch[1].trim();
				const serverName = process.env.NIXPI_SERVER_NAME ?? "nixpi";
				agents.push({
					id,
					name: nameMatch[1].trim(),
					userId: `@${username}:${serverName}`,
					...(descMatch ? { description: descMatch[1].trim() } : {}),
				});
			}
		} catch {
			// Skip malformed agent files
		}
	}

	return agents;
}

/** Format a message that mentions another agent. */
export function handleMentionAgent(
	workspaceDir: string,
	params: { agent_id: string; message: string },
): { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown>; isError?: boolean } {
	const agents = loadAgentInfos(workspaceDir);
	const target = agents.find((a) => a.id === params.agent_id);

	if (!target) {
		const available = agents.map((a) => `- ${a.id} (${a.name})`).join("\n");
		return {
			content: [
				{
					type: "text" as const,
					text: `Unknown agent: ${params.agent_id}\n\nAvailable agents:\n${available || "(none)"}`,
				},
			],
			details: { availableAgents: agents.map((a) => a.id) },
			isError: true,
		};
	}

	const formattedMessage = `${target.userId} ${params.message}`;
	return {
		content: [
			{
				type: "text" as const,
				text: formattedMessage,
			},
		],
		details: {
			agentId: target.id,
			agentName: target.name,
			userId: target.userId,
			formattedMessage,
		},
	};
}
