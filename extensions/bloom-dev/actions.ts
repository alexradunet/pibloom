/**
 * Handler / business logic for bloom-dev.
 */
import { cpSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { run } from "../../lib/exec.js";
import { getBloomDir } from "../../lib/filesystem.js";
import { errorResult, requireConfirmation, truncate } from "../../lib/shared.js";
import { slugifyBranchPart } from "../../lib/git.js";
import type { DevBuildResult, DevTestResult } from "./types.js";

const DEV_IMAGE_TAG = "localhost/bloom:dev";

const SENTINEL = ".dev-enabled";

/** Resolve the sentinel file path within the bloom runtime directory. */
function sentinelPath(bloomRuntime: string): string {
	return join(bloomRuntime, SENTINEL);
}

/** Check whether dev mode is enabled by testing for the sentinel file. */
export function isDevEnabled(bloomRuntime: string): boolean {
	return existsSync(sentinelPath(bloomRuntime));
}

/** Enable dev mode by writing the sentinel file. */
export async function handleDevEnable(bloomRuntime: string) {
	mkdirSync(bloomRuntime, { recursive: true });
	writeFileSync(sentinelPath(bloomRuntime), new Date().toISOString(), "utf-8");
	return {
		content: [{ type: "text" as const, text: "Dev mode enabled." }],
		details: { enabled: true },
	};
}

/** Disable dev mode by removing the sentinel file. */
export async function handleDevDisable(bloomRuntime: string) {
	try {
		unlinkSync(sentinelPath(bloomRuntime));
	} catch {
		// Already absent — that's fine
	}
	return {
		content: [{ type: "text" as const, text: "Dev mode disabled." }],
		details: { enabled: false },
	};
}

/** Report current dev environment status. */
export async function handleDevStatus(bloomRuntime: string, signal?: AbortSignal) {
	const enabled = isDevEnabled(bloomRuntime);
	const repoDir = join(bloomRuntime, "pi-bloom");

	const repoCheck = await run("git", ["-C", repoDir, "rev-parse", "--git-dir"], signal);
	const repoConfigured = repoCheck.exitCode === 0;

	const csCheck = await run("systemctl", ["--user", "is-active", "bloom-code-server.service"], signal);
	const codeServerRunning = csCheck.exitCode === 0 && csCheck.stdout.trim() === "active";

	const imgCheck = await run("podman", ["image", "exists", "localhost/bloom:dev"], signal);
	const localBuildAvailable = imgCheck.exitCode === 0;

	const lines: string[] = [
		`Dev mode: ${enabled ? "enabled" : "disabled"}`,
		`Repo configured: ${repoConfigured}`,
		`code-server: ${codeServerRunning ? "running" : "not running"}`,
		`Local build: ${localBuildAvailable ? "available" : "none"}`,
	];

	if (repoConfigured) lines.push(`Repo path: ${repoDir}`);
	if (localBuildAvailable) lines.push("Image tag: localhost/bloom:dev");

	return {
		content: [{ type: "text" as const, text: lines.join("\n") }],
		details: {
			enabled,
			repoConfigured,
			codeServerRunning,
			localBuildAvailable,
			repoPath: repoConfigured ? repoDir : undefined,
			localImageTag: localBuildAvailable ? "localhost/bloom:dev" : undefined,
		},
	};
}

// ---------------------------------------------------------------------------
// Handler implementations
// ---------------------------------------------------------------------------

/** Start, stop, restart, or check status of the code-server development environment. */
export async function handleDevCodeServer(
	_bloomRuntime: string,
	action: "start" | "stop" | "restart" | "status",
	signal?: AbortSignal,
) {
	const unit = "bloom-code-server";

	if (action === "status") {
		const result = await run("systemctl", ["--user", "is-active", unit], signal);
		const active = result.exitCode === 0 && result.stdout.trim() === "active";
		return {
			content: [{ type: "text" as const, text: `code-server is ${active ? "running" : "stopped"}.` }],
			details: { running: active },
		};
	}

	if (action === "start" || action === "restart") {
		const reload = await run("systemctl", ["--user", "daemon-reload"], signal);
		if (reload.exitCode !== 0) {
			return errorResult(`daemon-reload failed: ${reload.stderr}`);
		}
	}

	const result = await run("systemctl", ["--user", action, unit], signal);
	if (result.exitCode !== 0) {
		return errorResult(`systemctl ${action} ${unit} failed: ${result.stderr}`);
	}

	return {
		content: [{ type: "text" as const, text: `code-server ${action} succeeded.` }],
		details: { action },
	};
}

/** Build a local container image from the repo. */
export async function handleDevBuild(repoDir: string, signal?: AbortSignal, tag?: string) {
	const imageTag = tag ?? DEV_IMAGE_TAG;
	const containerfile = join(repoDir, "os", "Containerfile");

	if (!existsSync(containerfile)) {
		return errorResult(`Containerfile not found at ${containerfile}. Is the repo cloned?`);
	}

	const start = Date.now();
	const result = await run("podman", ["build", "-f", containerfile, "-t", imageTag, repoDir], signal);
	const duration = Math.round((Date.now() - start) / 1000);

	if (result.exitCode !== 0) {
		const buildResult: DevBuildResult = { success: false, imageTag, duration, error: result.stderr };
		return {
			content: [{ type: "text" as const, text: `Build failed after ${duration}s:\n${truncate(result.stderr)}` }],
			details: buildResult,
			isError: true,
		};
	}

	const inspect = await run("podman", ["image", "inspect", imageTag, "--format", "{{.Size}}"], signal);
	const size = inspect.exitCode === 0 ? inspect.stdout.trim() : undefined;

	const buildResult: DevBuildResult = { success: true, imageTag, duration, size };
	return {
		content: [
			{
				type: "text" as const,
				text: `Build succeeded in ${duration}s. Image: ${imageTag}${size ? ` (${size} bytes)` : ""}`,
			},
		],
		details: buildResult,
	};
}

/** Switch the running OS to a local or remote image. */
export async function handleDevSwitch(
	_bloomRuntime: string,
	imageRef: string | undefined,
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
) {
	const tag = imageRef ?? DEV_IMAGE_TAG;

	if (tag.startsWith("-")) {
		return errorResult("Invalid image reference: must not start with '-'");
	}

	const exists = await run("podman", ["image", "exists", tag], signal);
	if (exists.exitCode !== 0) {
		return errorResult(`Image ${tag} not found. Run dev_build first.`);
	}

	const denied = await requireConfirmation(ctx, `Switch OS to image ${tag}`);
	if (denied) return errorResult(denied);

	const result = await run("sudo", ["bootc", "switch", "--transport", "containers-storage", tag], signal);
	if (result.exitCode !== 0) {
		return errorResult(`bootc switch failed: ${result.stderr}`);
	}

	return {
		content: [{ type: "text" as const, text: `Switched to ${tag}. Reboot to apply.` }],
		details: { imageRef: tag, switched: true },
	};
}

/** Rollback to the previous OS deployment. */
export async function handleDevRollback(_bloomRuntime: string, signal: AbortSignal | undefined, ctx: ExtensionContext) {
	const denied = await requireConfirmation(ctx, "Rollback OS to previous deployment");
	if (denied) return errorResult(denied);

	const result = await run("sudo", ["bootc", "rollback"], signal);
	if (result.exitCode !== 0) {
		return errorResult(`bootc rollback failed: ${result.stderr}`);
	}

	return {
		content: [{ type: "text" as const, text: "Rollback staged. Reboot to apply." }],
		details: { rolledBack: true },
	};
}

/** Run the edit-build-switch development loop: build → switch → reboot. */
export async function handleDevLoop(
	params: { tag?: string; skip_reboot?: boolean },
	signal?: AbortSignal,
	ctx?: ExtensionContext,
	repoDir?: string,
) {
	if (!repoDir) return errorResult("Repo directory not configured.");

	const steps: string[] = [];

	// Step 1: Build
	const buildResult = await handleDevBuild(repoDir, signal, params.tag);
	if ("isError" in buildResult && buildResult.isError) return buildResult;
	steps.push(`Build: ${buildResult.content[0].text}`);

	// Step 2: Switch (if ctx is undefined, skip confirmation inside handleDevSwitch)
	if (!ctx) {
		return errorResult("Cannot perform dev loop without an extension context for confirmation.");
	}
	const switchResult = await handleDevSwitch("", params.tag, signal, ctx);
	if ("isError" in switchResult && switchResult.isError) return switchResult;
	steps.push(`Switch: ${switchResult.content[0].text}`);

	// Step 3: Reboot or report
	if (params.skip_reboot) {
		steps.push("Reboot skipped — run `sudo reboot` when ready.");
	} else {
		const reboot = await run("sudo", ["shutdown", "-r", "+0", "bloom dev loop"], signal);
		if (reboot.exitCode !== 0) {
			steps.push(`Reboot failed: ${reboot.stderr}`);
		} else {
			steps.push("Reboot initiated.");
		}
	}

	return {
		content: [{ type: "text" as const, text: steps.join("\n") }],
		details: { steps },
	};
}

/** Run tests and linting against the local repo. */
export async function handleDevTest(repoDir: string, signal?: AbortSignal) {
	const packageJson = join(repoDir, "package.json");
	if (!existsSync(packageJson)) {
		return errorResult(`package.json not found at ${packageJson}. Is the repo cloned?`);
	}

	const testResult = await run("npm", ["run", "test", "--", "--run"], signal, repoDir);
	const testsPassed = testResult.exitCode === 0;
	const testOutput = truncate(testResult.stdout + (testResult.stderr ? `\n${testResult.stderr}` : ""));

	const lintResult = await run("npm", ["run", "check"], signal, repoDir);
	const lintPassed = lintResult.exitCode === 0;
	const lintOutput = truncate(lintResult.stdout + (lintResult.stderr ? `\n${lintResult.stderr}` : ""));

	const success = testsPassed && lintPassed;
	const lines: string[] = [];
	lines.push(`Tests: ${testsPassed ? "PASSED" : "FAILED"}`);
	lines.push(`Lint: ${lintPassed ? "PASSED" : "FAILED"}`);
	if (!testsPassed) lines.push(`\n--- Test output ---\n${testOutput}`);
	if (!lintPassed) lines.push(`\n--- Lint output ---\n${lintOutput}`);

	const details: DevTestResult = { success, testsPassed, lintPassed, testOutput, lintOutput };
	return {
		content: [{ type: "text" as const, text: lines.join("\n") }],
		details,
		...(success ? {} : { isError: true }),
	};
}

/** Submit a pull request from local changes, including test results in the body. */
export async function handleDevSubmitPr(
	params: { title: string; body?: string; branch?: string },
	repoDir: string,
	signal?: AbortSignal,
	ctx?: ExtensionContext,
) {
	const gitDir = join(repoDir, ".git");
	if (!existsSync(gitDir)) {
		return errorResult(`No .git directory found at ${repoDir}. Is the repo cloned?`);
	}

	if (ctx) {
		const denied = await requireConfirmation(ctx, `Create PR "${params.title}" (will stage ALL changes in repo)`, {
			requireUi: false,
		});
		if (denied) return errorResult(denied);
	}

	// Run tests for PR body
	const testResult = await handleDevTest(repoDir, signal);
	const testSummary =
		"isError" in testResult && testResult.isError ? `Tests: FAILED\n${testResult.content[0].text}` : `Tests: PASSED`;

	// Branch
	const branch = params.branch || `dev/${slugifyBranchPart(params.title) || "patch"}`;
	const checkout = await run("git", ["-C", repoDir, "checkout", "-b", branch], signal);
	if (checkout.exitCode !== 0) {
		return errorResult(`Failed to create branch ${branch}: ${checkout.stderr}`);
	}

	// Stage and commit
	const add = await run("git", ["-C", repoDir, "add", "-A"], signal);
	if (add.exitCode !== 0) {
		return errorResult(`Failed to stage changes: ${add.stderr}`);
	}

	const commit = await run("git", ["-C", repoDir, "commit", "-m", params.title], signal);
	if (commit.exitCode !== 0) {
		return errorResult(`Failed to commit: ${commit.stderr}`);
	}

	// Push
	const push = await run("git", ["-C", repoDir, "push", "-u", "origin", branch], signal);
	if (push.exitCode !== 0) {
		return errorResult(`Failed to push branch ${branch}: ${push.stderr}`);
	}

	// Create PR
	const body = [params.body || `## Summary\n${params.title}`, "", "## Test Results", testSummary].join("\n");

	const pr = await run("gh", ["pr", "create", "--title", params.title, "--body", body], signal, repoDir);
	if (pr.exitCode !== 0) {
		return errorResult(`Failed to create PR: ${pr.stderr}`);
	}

	const prUrl = pr.stdout.trim();
	return {
		content: [{ type: "text" as const, text: `PR created: ${prUrl}\nBranch: ${branch}` }],
		details: { prUrl, branch },
	};
}

/** Push a skill from ~/Bloom/Skills/ into the repo and submit a PR. */
export async function handleDevPushSkill(
	params: { skill_name: string; title?: string },
	repoDir: string,
	signal?: AbortSignal,
	ctx?: ExtensionContext,
) {
	const bloomDir = getBloomDir();
	const skillSrc = join(bloomDir, "Skills", params.skill_name);
	if (!existsSync(skillSrc)) {
		return errorResult(`Skill not found at ${skillSrc}`);
	}

	const skillDest = join(repoDir, "skills", params.skill_name);
	mkdirSync(skillDest, { recursive: true });
	cpSync(skillSrc, skillDest, { recursive: true });

	const title = params.title || `feat(skills): add ${params.skill_name}`;
	return handleDevSubmitPr({ title }, repoDir, signal, ctx);
}

/** Push a service into the repo and submit a PR. */
export async function handleDevPushService(
	params: { service_name: string; title?: string },
	repoDir: string,
	signal?: AbortSignal,
	ctx?: ExtensionContext,
) {
	const bloomDir = getBloomDir();
	const candidates = [join(bloomDir, "services", params.service_name), join(repoDir, "services", params.service_name)];
	const serviceSrc = candidates.find((p) => existsSync(p));
	if (!serviceSrc) {
		return errorResult(`Service ${params.service_name} not found in ~/Bloom/services/ or repo services/`);
	}

	const serviceDest = join(repoDir, "services", params.service_name);
	if (serviceSrc !== serviceDest) {
		mkdirSync(serviceDest, { recursive: true });
		cpSync(serviceSrc, serviceDest, { recursive: true });
	}

	const title = params.title || `feat(services): add ${params.service_name}`;
	return handleDevSubmitPr({ title }, repoDir, signal, ctx);
}

/** Push an extension into the repo and submit a PR. */
export async function handleDevPushExtension(
	params: { extension_name: string; source_path?: string; title?: string },
	repoDir: string,
	signal?: AbortSignal,
	ctx?: ExtensionContext,
) {
	const bloomDir = getBloomDir();
	const candidates = [params.source_path, join(bloomDir, "extensions", params.extension_name)].filter(
		Boolean,
	) as string[];
	const extSrc = candidates.find((p) => existsSync(p));
	if (!extSrc) {
		return errorResult(`Extension ${params.extension_name} not found`);
	}

	const extDest = join(repoDir, "extensions", params.extension_name);
	mkdirSync(extDest, { recursive: true });
	cpSync(extSrc, extDest, { recursive: true });

	const title = params.title || `feat(extensions): add ${params.extension_name}`;
	return handleDevSubmitPr({ title }, repoDir, signal, ctx);
}

/** Install a Pi package from a local path or URL. */
export async function handleDevInstallPackage(params: { source: string }, signal?: AbortSignal) {
	if (!params.source.trim()) {
		return errorResult("source must be a non-empty path or URL.");
	}

	const result = await run("pi", ["install", params.source], signal);
	if (result.exitCode !== 0) {
		return errorResult(`pi install failed: ${truncate(result.stderr || result.stdout)}`);
	}

	return {
		content: [{ type: "text" as const, text: `Package installed from ${params.source}.\n${truncate(result.stdout)}` }],
		details: { source: params.source, success: true },
	};
}
