/**
 * Configure handler for bloom-repo.
 */
import { mkdirSync } from "node:fs";
import os from "node:os";
import { dirname } from "node:path";
import { run } from "../../lib/exec.js";
import { parseGithubSlugFromUrl } from "../../lib/git.js";
import { getRemoteUrl, inferRepoUrl } from "../../lib/repo.js";
import { errorResult } from "../../lib/shared.js";
import { getRepoDir } from "./actions.js";

async function ensureRepoClone(repoDir: string, upstreamUrl: string, signal: AbortSignal | undefined) {
	const repoCheck = await run("git", ["-C", repoDir, "rev-parse", "--git-dir"], signal);
	if (repoCheck.exitCode === 0) return { ok: true as const, cloned: false };
	const clone = await run("git", ["clone", upstreamUrl, repoDir], signal);
	if (clone.exitCode !== 0) {
		return {
			ok: false as const,
			error: errorResult(`Failed to clone ${upstreamUrl} into ${repoDir}:\n${clone.stderr}`),
		};
	}
	return { ok: true as const, cloned: true };
}

async function ensureRepoExists(repoDir: string, signal: AbortSignal | undefined) {
	const ensureRepo = await run("git", ["-C", repoDir, "rev-parse", "--git-dir"], signal);
	return ensureRepo.exitCode === 0
		? null
		: errorResult(`No repo clone found at ${repoDir}. Run first-boot setup to clone it.`);
}

async function syncRemote(
	repoDir: string,
	remote: string,
	url: string,
	signal: AbortSignal | undefined,
	changes: string[],
	label = remote,
) {
	const current = await getRemoteUrl(repoDir, remote, signal);
	if (!current) {
		const add = await run("git", ["-C", repoDir, "remote", "add", remote, url], signal);
		if (add.exitCode !== 0) return errorResult(`Failed to add ${label} remote:\n${add.stderr}`);
		changes.push(`remote ${remote} -> ${url}`);
		return null;
	}
	if (current === url) return null;
	const set = await run("git", ["-C", repoDir, "remote", "set-url", remote, url], signal);
	if (set.exitCode !== 0) return errorResult(`Failed to set ${label} remote:\n${set.stderr}`);
	changes.push(`updated ${remote}: ${current} -> ${url}`);
	return null;
}

async function maybeAutoCreateOrigin(
	_repoDir: string,
	upstreamUrl: string,
	signal: AbortSignal | undefined,
	changes: string[],
	notes: string[],
) {
	const upstreamSlug = parseGithubSlugFromUrl(upstreamUrl);
	const ghAuth = await run("gh", ["auth", "status"], signal);
	if (upstreamSlug && ghAuth.exitCode === 0) {
		const fork = await run(
			"gh",
			["repo", "fork", upstreamSlug, "--remote", "--remote-name", "origin", "--clone=false"],
			signal,
		);
		if (fork.exitCode === 0) {
			changes.push(`created/attached fork remote origin for ${upstreamSlug}`);
			return;
		}
		notes.push(`Could not auto-create fork with gh: ${fork.stderr.trim()}`);
		return;
	}
	notes.push("gh auth not available; skipping auto-fork creation.");
}

async function ensureOriginRemote(
	repoDir: string,
	upstreamUrl: string,
	forkUrl: string | undefined,
	signal: AbortSignal | undefined,
	changes: string[],
	notes: string[],
) {
	if (forkUrl?.trim()) {
		return syncRemote(repoDir, "origin", forkUrl.trim(), signal, changes, "origin");
	}

	const currentOrigin = await getRemoteUrl(repoDir, "origin", signal);
	if (currentOrigin) return null;
	await maybeAutoCreateOrigin(repoDir, upstreamUrl, signal, changes, notes);

	const originAfterFork = await getRemoteUrl(repoDir, "origin", signal);
	if (originAfterFork) return null;
	const fallback = await run("git", ["-C", repoDir, "remote", "add", "origin", upstreamUrl], signal);
	if (fallback.exitCode !== 0) return errorResult(`Failed to set fallback origin remote:\n${fallback.stderr}`);
	changes.push(`fallback origin -> ${upstreamUrl}`);
	notes.push("origin currently points to upstream. Set fork_url later for writable PR flow.");
	return null;
}

async function configureGitIdentity(
	repoDir: string,
	gitName: string,
	gitEmail: string,
	signal: AbortSignal | undefined,
	changes: string[],
) {
	const setName = await run("git", ["-C", repoDir, "config", "user.name", gitName], signal);
	if (setName.exitCode !== 0) return errorResult(`Failed to set git user.name:\n${setName.stderr}`);
	const setEmail = await run("git", ["-C", repoDir, "config", "user.email", gitEmail], signal);
	if (setEmail.exitCode !== 0) return errorResult(`Failed to set git user.email:\n${setEmail.stderr}`);
	changes.push(`git identity -> ${gitName} <${gitEmail}>`);
	return null;
}

export async function handleConfigure(
	params: {
		repo_url?: string;
		fork_url?: string;
		git_name?: string;
		git_email?: string;
	},
	signal: AbortSignal | undefined,
) {
	const repoDir = getRepoDir();
	mkdirSync(dirname(repoDir), { recursive: true });
	const changes: string[] = [];
	const notes: string[] = [];
	const upstreamUrl = (params.repo_url?.trim() || (await inferRepoUrl(repoDir, signal))).trim();

	const cloneResult = await ensureRepoClone(repoDir, upstreamUrl, signal);
	if (!cloneResult.ok) return cloneResult.error;
	if (cloneResult.cloned) {
		changes.push(`cloned ${upstreamUrl} -> ${repoDir}`);
	}

	const repoError = await ensureRepoExists(repoDir, signal);
	if (repoError) return repoError;
	const upstreamError = await syncRemote(repoDir, "upstream", upstreamUrl, signal, changes, "upstream");
	if (upstreamError) return upstreamError;
	const originError = await ensureOriginRemote(repoDir, upstreamUrl, params.fork_url, signal, changes, notes);
	if (originError) return originError;

	const hostname = os.hostname();
	const desiredName = params.git_name?.trim() || `Bloom (${hostname})`;
	const desiredEmail = params.git_email?.trim() || `bloom+${hostname}@localhost`;
	const identityError = await configureGitIdentity(repoDir, desiredName, desiredEmail, signal, changes);
	if (identityError) return identityError;

	const remotes = await run("git", ["-C", repoDir, "remote", "-v"], signal);
	const text = [
		`Repo path: ${repoDir}`,
		changes.length > 0 ? `\nChanges:\n- ${changes.join("\n- ")}` : "\nChanges:\n- (none)",
		`\nRemotes:\n${(remotes.stdout || remotes.stderr).trim() || "(none)"}`,
		notes.length > 0 ? `\nNotes:\n- ${notes.join("\n- ")}` : "",
	].join("\n");
	return { content: [{ type: "text" as const, text: text.trim() }], details: { path: repoDir } };
}
