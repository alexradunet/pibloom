/**
 * Submit PR handler for bloom-repo.
 */
import os from "node:os";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { run } from "../../lib/exec.js";
import { parseGithubSlugFromUrl, slugifyBranchPart } from "../../lib/git.js";
import { getRemoteUrl } from "../../lib/repo.js";
import { errorResult, requireConfirmation } from "../../lib/shared.js";
import { getRepoDir } from "./actions.js";

async function ensureRepoReady(repoDir: string, signal: AbortSignal | undefined) {
	const check = await run("git", ["-C", repoDir, "rev-parse", "--git-dir"], signal);
	return check.exitCode === 0
		? null
		: errorResult(`No repo clone found at ${repoDir}. Run bloom_repo action=configure first.`);
}

async function ensureGithubAuth(signal: AbortSignal | undefined) {
	const ghAuth = await run("gh", ["auth", "status"], signal);
	return ghAuth.exitCode === 0
		? null
		: errorResult(`GitHub auth is not ready. Run gh auth login first.\n${ghAuth.stderr || ghAuth.stdout}`);
}

async function resolveRemoteState(repoDir: string, signal: AbortSignal | undefined) {
	const upstreamUrl = await getRemoteUrl(repoDir, "upstream", signal);
	const originUrl = await getRemoteUrl(repoDir, "origin", signal);
	if (!upstreamUrl) return { error: errorResult("Missing upstream remote. Run bloom_repo action=configure first.") };
	if (!originUrl)
		return { error: errorResult("Missing origin remote. Run bloom_repo action=configure with fork_url first.") };
	const upstreamSlug = parseGithubSlugFromUrl(upstreamUrl);
	if (!upstreamSlug) return { error: errorResult(`Cannot parse upstream GitHub slug from ${upstreamUrl}`) };
	return { upstreamUrl, originUrl, upstreamSlug, originSlug: parseGithubSlugFromUrl(originUrl) };
}

async function resolveBranchState(
	repoDir: string,
	base: string,
	title: string,
	branch: string | undefined,
	signal: AbortSignal | undefined,
) {
	const currentBranch = await run("git", ["-C", repoDir, "branch", "--show-current"], signal);
	const nowBranch = currentBranch.stdout.trim() || "main";
	const defaultBranch = `node/${slugifyBranchPart(os.hostname())}/${slugifyBranchPart(title) || "fix"}`;
	return {
		nowBranch,
		targetBranch: (branch?.trim() || (nowBranch === base ? defaultBranch : nowBranch)).trim(),
	};
}

async function ensureSafeWorktree(repoDir: string, addAll: boolean, signal: AbortSignal | undefined) {
	if (addAll) return null;
	const dirty = await run("git", ["-C", repoDir, "status", "--short"], signal);
	const unstaged = dirty.stdout
		.split("\n")
		.map((line) => line.trimEnd())
		.filter(Boolean)
		.filter(
			(line) => !line.startsWith("A ") && !line.startsWith("M ") && !line.startsWith("R ") && !line.startsWith("C "),
		);
	if (unstaged.length === 0) return null;
	return errorResult(
		[
			"Refusing to auto-submit PR with unstaged or untracked changes.",
			"Stage only the intended files first, or retry with add_all=true.",
			"",
			unstaged.join("\n"),
		].join("\n"),
	);
}

async function ensureTargetBranch(
	repoDir: string,
	nowBranch: string,
	targetBranch: string,
	signal: AbortSignal | undefined,
) {
	if (nowBranch === targetBranch) return null;
	const checkout = await run("git", ["-C", repoDir, "checkout", "-B", targetBranch], signal);
	return checkout.exitCode === 0
		? null
		: errorResult(`Failed to switch to branch ${targetBranch}:\n${checkout.stderr || checkout.stdout}`);
}

async function stageChanges(repoDir: string, addAll: boolean, signal: AbortSignal | undefined) {
	if (!addAll) return null;
	const add = await run("git", ["-C", repoDir, "add", "-A"], signal);
	return add.exitCode === 0 ? null : errorResult(`Failed to stage changes:\n${add.stderr || add.stdout}`);
}

async function readStagedFiles(repoDir: string, signal: AbortSignal | undefined) {
	const staged = await run("git", ["-C", repoDir, "diff", "--cached", "--name-only"], signal);
	return staged.stdout.trim() ? staged : null;
}

async function commitAndPush(
	repoDir: string,
	commitMessage: string,
	targetBranch: string,
	signal: AbortSignal | undefined,
) {
	const commit = await run("git", ["-C", repoDir, "commit", "-m", commitMessage], signal);
	if (commit.exitCode !== 0)
		return { error: errorResult(`Failed to commit changes:\n${commit.stderr || commit.stdout}`) };
	const push = await run("git", ["-C", repoDir, "push", "--set-upstream", "origin", targetBranch], signal);
	return push.exitCode === 0
		? {}
		: { error: errorResult(`Failed to push branch ${targetBranch} to origin:\n${push.stderr || push.stdout}`) };
}

async function createOrFindPr(
	upstreamSlug: string,
	headRef: string,
	base: string,
	title: string,
	body: string,
	draft: boolean | undefined,
	signal: AbortSignal | undefined,
) {
	const prArgs = [
		"pr",
		"create",
		"--repo",
		upstreamSlug,
		"--base",
		base,
		"--head",
		headRef,
		"--title",
		title,
		"--body",
		body,
	];
	if (draft) prArgs.push("--draft");

	const pr = await run("gh", prArgs, signal);
	if (pr.exitCode === 0) return { prUrl: pr.stdout.trim() };

	const existing = await run(
		"gh",
		["pr", "list", "--repo", upstreamSlug, "--state", "open", "--head", headRef, "--json", "url", "-q", ".[0].url"],
		signal,
	);
	if (existing.exitCode === 0 && existing.stdout.trim()) {
		return { prUrl: existing.stdout.trim() };
	}
	return { error: errorResult(`Failed to create PR:\n${pr.stderr || pr.stdout}`) };
}

async function preparePrSubmission(
	repoDir: string,
	params: {
		title: string;
		branch?: string;
		base?: string;
		add_all?: boolean;
	},
	signal: AbortSignal | undefined,
) {
	const repoError = await ensureRepoReady(repoDir, signal);
	if (repoError) return { error: repoError };
	const authError = await ensureGithubAuth(signal);
	if (authError) return { error: authError };
	const remotes = await resolveRemoteState(repoDir, signal);
	if ("error" in remotes) return { error: remotes.error };

	const base = (params.base ?? "main").trim() || "main";
	const { nowBranch, targetBranch } = await resolveBranchState(repoDir, base, params.title, params.branch, signal);
	const worktreeError = await ensureSafeWorktree(repoDir, params.add_all ?? false, signal);
	if (worktreeError) return { error: worktreeError };
	const branchError = await ensureTargetBranch(repoDir, nowBranch, targetBranch, signal);
	if (branchError) return { error: branchError };
	const stageError = await stageChanges(repoDir, params.add_all ?? false, signal);
	if (stageError) return { error: stageError };
	const staged = await readStagedFiles(repoDir, signal);
	if (!staged)
		return { error: errorResult("No staged changes found. Make edits first, then retry bloom_repo_submit_pr.") };

	return { base, remotes, targetBranch, staged };
}

function buildPrBody(title: string, body: string | undefined) {
	return (
		body?.trim() || ["## Summary", title, "", "## Source", `Submitted from Bloom device: ${os.hostname()}`].join("\n")
	);
}

function buildHeadRef(originSlug: string | null | undefined, upstreamSlug: string, targetBranch: string) {
	const originOwner = originSlug?.split("/")[0] ?? null;
	return originOwner && originSlug !== upstreamSlug ? `${originOwner}:${targetBranch}` : targetBranch;
}

function buildSubmittedFiles(stagedOutput: string) {
	return stagedOutput
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((f) => `- ${f}`)
		.join("\n");
}

export async function handleSubmitPr(
	params: {
		title: string;
		body?: string;
		commit_message?: string;
		branch?: string;
		base?: string;
		draft?: boolean;
		add_all?: boolean;
	},
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
) {
	const repoDir = getRepoDir();
	const denied = await requireConfirmation(ctx, `Create pull request "${params.title}" from local Bloom repo changes`, {
		requireUi: false,
	});
	if (denied) return errorResult(denied);

	const prepared = await preparePrSubmission(repoDir, params, signal);
	if ("error" in prepared) return prepared.error;

	const commitMessage = (params.commit_message?.trim() || `fix: ${params.title}`).trim();
	const publishResult = await commitAndPush(repoDir, commitMessage, prepared.targetBranch, signal);
	if (publishResult.error) return publishResult.error;

	const headRef = buildHeadRef(prepared.remotes.originSlug, prepared.remotes.upstreamSlug, prepared.targetBranch);
	const body = buildPrBody(params.title, params.body);
	const prResult = await createOrFindPr(
		prepared.remotes.upstreamSlug,
		headRef,
		prepared.base,
		params.title,
		body,
		params.draft,
		signal,
	);
	if (prResult.error) return prResult.error;
	const prUrl = prResult.prUrl;

	const files = buildSubmittedFiles(prepared.staged.stdout);

	const text = [
		`PR ready: ${prUrl || "(URL unavailable)"}`,
		`Branch: ${prepared.targetBranch}`,
		`Base: ${prepared.base}`,
		"",
		"Files:",
		files || "- (unknown)",
	].join("\n");

	return {
		content: [{ type: "text" as const, text }],
		details: { path: repoDir, branch: prepared.targetBranch, base: prepared.base, pr_url: prUrl || null },
	};
}
