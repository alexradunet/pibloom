/**
 * Scaffold handler for bloom-services — generates new service packages.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { validatePinnedImage, validateServiceName } from "../../lib/services-validation.js";
import { errorResult } from "../../lib/shared.js";

/** Walk up from ctx.cwd to find the repo dir containing services/ and package.json. */
function resolveRepoDir(ctx: ExtensionContext): string {
	let current = ctx.cwd;
	for (let i = 0; i < 6; i++) {
		if (existsSync(join(current, "services")) && existsSync(join(current, "package.json"))) {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	const preferred = join(os.homedir(), ".bloom", "pi-bloom");
	if (existsSync(join(preferred, "services"))) return preferred;
	return ctx.cwd;
}

export async function handleScaffold(
	params: {
		name: string;
		description: string;
		image: string;
		version?: string;
		category?: string;
		port?: number;
		container_port?: number;
		network?: string;
		memory?: string;
		socket_activated?: boolean;
		overwrite?: boolean;
	},
	ctx: ExtensionContext,
) {
	const guard = validateServiceName(params.name);
	if (guard) return errorResult(guard);
	const imageGuard = validatePinnedImage(params.image);
	if (imageGuard) return errorResult(imageGuard);

	const scaffoldRepoDir = resolveRepoDir(ctx);
	const serviceDir = join(scaffoldRepoDir, "services", params.name);
	const quadletDir = join(serviceDir, "quadlet");
	const skillPath = join(serviceDir, "SKILL.md");
	const containerPath = join(quadletDir, `bloom-${params.name}.container`);
	const socketPath = join(quadletDir, `bloom-${params.name}.socket`);

	const overwrite = params.overwrite ?? false;
	const existingError = ensureScaffoldTargetAvailable(serviceDir, overwrite);
	if (existingError) return existingError;

	mkdirSync(quadletDir, { recursive: true });
	const scaffoldDefaults = {
		version: params.version ?? "0.1.0",
		network: params.network ?? "host",
		memory: params.memory ?? "256m",
		enableSocket: params.socket_activated ?? false,
	};
	writeFileSync(
		containerPath,
		buildContainerUnit(params, scaffoldDefaults.network, scaffoldDefaults.memory, scaffoldDefaults.enableSocket),
	);
	if (scaffoldDefaults.enableSocket && params.port) {
		writeFileSync(socketPath, buildSocketUnit(params.name, params.port));
	}
	writeFileSync(skillPath, buildSkillTemplate(params.name, params.description, params.image, scaffoldDefaults.version));

	const created = [containerPath, skillPath];
	if (existsSync(socketPath)) created.push(socketPath);

	return {
		content: [{ type: "text" as const, text: `Service scaffold created:\n${created.map((f) => `- ${f}`).join("\n")}` }],
		details: {
			repoDir: scaffoldRepoDir,
			service: params.name,
			category: params.category ?? null,
			files: created,
		},
	};
}

function ensureScaffoldTargetAvailable(serviceDir: string, overwrite: boolean) {
	return existsSync(serviceDir) && !overwrite
		? errorResult(`Service directory already exists: ${serviceDir}. Use overwrite=true to replace files.`)
		: null;
}

function buildContainerUnit(
	params: { name: string; description: string; image: string },
	network: string,
	memory: string,
	enableSocket: boolean,
) {
	const maybeSocketArgs = enableSocket ? "PodmanArgs=--preserve-fds=1\n" : "";
	const installBlock = enableSocket ? "" : "\n[Install]\nWantedBy=default.target\n";
	return `[Unit]\nDescription=Bloom ${params.name} — ${params.description}\nAfter=network-online.target\nWants=network-online.target\n${enableSocket ? "StopWhenUnneeded=true\n" : ""}\n[Container]\nImage=${params.image}\nContainerName=bloom-${params.name}\nNetwork=${network}\n${maybeSocketArgs}PodmanArgs=--memory=${memory}\nNoNewPrivileges=true\nLogDriver=journald\n\n[Service]\nRestart=on-failure\nRestartSec=10\nTimeoutStartSec=300\n${installBlock}`;
}

function buildSocketUnit(name: string, port: number) {
	return `[Unit]\nDescription=Bloom ${name} — Socket activation listener\n\n[Socket]\nListenStream=${Math.round(port)}\nAccept=no\nService=bloom-${name}.service\nSocketMode=0660\n\n[Install]\nWantedBy=sockets.target\n`;
}

function buildSkillTemplate(name: string, description: string, image: string, version: string) {
	return `---\nname: ${name}\nversion: ${version}\ndescription: ${description}\nimage: ${image}\n---\n\n# ${name}\n\nDescribe how to use this service.\n\n## API\n\nDocument endpoints, commands, and examples here.\n\n## Operations\n\n- Install: \`systemctl --user start bloom-${name}\`\n- Logs: \`journalctl --user -u bloom-${name} -n 100\`\n`;
}
