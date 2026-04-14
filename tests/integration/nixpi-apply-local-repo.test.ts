import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../core/lib/exec.js";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const scriptPath = path.join(repoRoot, "core/scripts/nixpi-apply-local-repo.sh");

function createHarness() {
	const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "nixpi-apply-local-repo-test-"));
	const repoDir = path.join(rootDir, "repo");
	const systemFlakeDir = path.join(rootDir, "etc/nixos");
	const rebuildArgsPath = path.join(rootDir, "nixpi-rebuild.args");
	const sudoArgsPath = path.join(rootDir, "sudo.args");
	const rebuildStubPath = path.join(rootDir, "fake-nixpi-rebuild.sh");
	const sudoStubPath = path.join(rootDir, "fake-sudo.sh");

	fs.mkdirSync(path.join(repoDir, ".git"), { recursive: true });
	fs.mkdirSync(systemFlakeDir, { recursive: true });
	fs.writeFileSync(path.join(systemFlakeDir, "flake.nix"), "{ }");
	fs.writeFileSync(
		rebuildStubPath,
		`#!/usr/bin/env bash
set -euo pipefail
printf '%s\\0' "$@" > "$NIXPI_TEST_REBUILD_ARGS_FILE"
`,
	);
	fs.chmodSync(rebuildStubPath, 0o755);
	fs.writeFileSync(
		sudoStubPath,
		`#!/usr/bin/env bash
set -euo pipefail
printf '%s\\0' "$@" > "$NIXPI_TEST_SUDO_ARGS_FILE"
if [[ "$1" == "-n" ]]; then
  shift
fi
export NIXPI_UID_OVERRIDE=0
exec "$@"
`,
	);
	fs.chmodSync(sudoStubPath, 0o755);

	return {
		rootDir,
		repoDir,
		systemFlakeDir,
		rebuildArgsPath,
		sudoArgsPath,
		rebuildStubPath,
		sudoStubPath,
		cleanup() {
			fs.rmSync(rootDir, { recursive: true, force: true });
		},
	};
}

async function runScript(harness: ReturnType<typeof createHarness>, uid: number, args: string[] = [harness.repoDir]) {
	const result = await run("bash", [scriptPath, ...args], undefined, repoRoot, {
		NIXPI_UID_OVERRIDE: String(uid),
		NIXPI_SYSTEM_FLAKE_DIR: harness.systemFlakeDir,
		NIXPI_REBUILD_BIN: harness.rebuildStubPath,
		NIXPI_SUDO_BIN: harness.sudoStubPath,
		NIXPI_TEST_REBUILD_ARGS_FILE: harness.rebuildArgsPath,
		NIXPI_TEST_SUDO_ARGS_FILE: harness.sudoArgsPath,
	});

	return {
		...result,
		rebuildArgs() {
			if (!fs.existsSync(harness.rebuildArgsPath)) return [];
			return fs.readFileSync(harness.rebuildArgsPath, "utf8").split("\0").filter(Boolean);
		},
		sudoArgs() {
			if (!fs.existsSync(harness.sudoArgsPath)) return [];
			return fs.readFileSync(harness.sudoArgsPath, "utf8").split("\0").filter(Boolean);
		},
	};
}

describe("nixpi-apply-local-repo.sh", () => {
	it("rebuilds the installed host flake with a local nixpi override when already root", async () => {
		const harness = createHarness();
		const result = await runScript(harness, 0);

		try {
			expect(result.exitCode).toBe(0);
			expect(result.rebuildArgs()).toEqual(["--override-input", "nixpi", `path:${harness.repoDir}`]);
			expect(result.sudoArgs()).toEqual([]);
		} finally {
			harness.cleanup();
		}
	});

	it("re-execs itself through sudo -n before rebuilding when run as a non-root operator", async () => {
		const harness = createHarness();
		const result = await runScript(harness, 1000);

		try {
			expect(result.exitCode).toBe(0);
			expect(result.sudoArgs()).toEqual(["-n", scriptPath, harness.repoDir]);
			expect(result.rebuildArgs()).toEqual(["--override-input", "nixpi", `path:${harness.repoDir}`]);
		} finally {
			harness.cleanup();
		}
	});

	it("fails early when the local repo is missing or not a git clone", async () => {
		const harness = createHarness();
		fs.rmSync(path.join(harness.repoDir, ".git"), { recursive: true, force: true });
		const result = await runScript(harness, 0);

		try {
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("Local NixPI repo is not initialized");
			expect(result.rebuildArgs()).toEqual([]);
		} finally {
			harness.cleanup();
		}
	});
});
