import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../../core/lib/exec.js";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const reinstallScriptPath = path.join(repoRoot, "core/scripts/nixpi-reinstall-ovh.sh");

function createReinstallHarness() {
	const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "nixpi-reinstall-ovh-test-"));
	const argsPath = path.join(rootDir, "nixos-anywhere.args");
	const flakeCopyPath = path.join(rootDir, "generated-flake.nix");
	const extraFilesCopyPath = path.join(rootDir, "extra-files");
	const stubPath = path.join(rootDir, "fake-nixos-anywhere.sh");

	fs.writeFileSync(
		stubPath,
		`#!/usr/bin/env bash
set -euo pipefail

printf '%s\\0' "$@" > "$NIXPI_TEST_ARGS_FILE"

flake_ref=""
extra_files=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --flake)
      flake_ref="$2"
      shift 2
      ;;
    --extra-files)
      extra_files="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

cp "\${flake_ref%%#*}/flake.nix" "$NIXPI_TEST_FLAKE_COPY"
if [[ -n "$extra_files" ]]; then
  cp -R "$extra_files" "$NIXPI_TEST_EXTRA_FILES_COPY"
fi
`,
	);
	fs.chmodSync(stubPath, 0o755);

	return {
		rootDir,
		argsPath,
		flakeCopyPath,
		extraFilesCopyPath,
		stubPath,
		cleanup() {
			fs.rmSync(rootDir, { recursive: true, force: true });
		},
	};
}

async function runReinstall(
	args: string[],
	overrides?: {
		cwd?: string;
		env?: Record<string, string>;
	},
) {
	const harness = createReinstallHarness();
	const result = await run("bash", [reinstallScriptPath, ...args], undefined, overrides?.cwd ?? repoRoot, {
		NIXPI_NIXOS_ANYWHERE: harness.stubPath,
		NIXPI_TEST_ARGS_FILE: harness.argsPath,
		NIXPI_TEST_FLAKE_COPY: harness.flakeCopyPath,
		NIXPI_TEST_EXTRA_FILES_COPY: harness.extraFilesCopyPath,
		TMPDIR: harness.rootDir,
		...overrides?.env,
	});

	return {
		...result,
		harness,
		readArgs() {
			if (!fs.existsSync(harness.argsPath)) return [];
			return fs.readFileSync(harness.argsPath, "utf8").split("\0").filter(Boolean);
		},
		readGeneratedFlake() {
			return fs.readFileSync(harness.flakeCopyPath, "utf8");
		},
		readStagedNetbirdSetupKey() {
			return fs.readFileSync(
				path.join(harness.extraFilesCopyPath, "var/lib/nixpi/bootstrap/netbird-setup-key"),
				"utf8",
			);
		},
	};
}

afterEach(() => {
	delete process.env.NIXPI_REPO_ROOT;
});

describe("nixpi-reinstall-ovh.sh", () => {
	it("shows usage and exits non-zero when required arguments are missing", async () => {
		const result = await run("bash", [reinstallScriptPath], undefined, repoRoot);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Usage: nixpi-reinstall-ovh");
	});

	it("rejects a missing bootstrap secrets file", async () => {
		const result = await runReinstall([
			"--target-host",
			"root@198.51.100.10",
			"--disk",
			"/dev/sda",
			"--bootstrap-secrets-file",
			"./does-not-exist.json",
		]);

		try {
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("--bootstrap-secrets-file must point to an existing local file");
		} finally {
			result.harness.cleanup();
		}
	});

	it("rejects bootstrap secrets files that are missing required fields", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nixpi-reinstall-secrets-"));
		const secretsPath = path.join(tempDir, "bootstrap-secrets.json");
		fs.writeFileSync(secretsPath, JSON.stringify({ bootstrapUser: "alex" }));

		const result = await runReinstall([
			"--target-host",
			"root@198.51.100.10",
			"--disk",
			"/dev/sda",
			"--bootstrap-secrets-file",
			secretsPath,
		]);

		try {
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("bootstrap-secrets-file must define bootstrapUser, bootstrapPasswordHash, and netbirdSetupKey");
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
			result.harness.cleanup();
		}
	});

	it("builds the OVH reinstall flow from a local bootstrap secrets file", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nixpi-reinstall-secrets-"));
		const secretsPath = path.join(tempDir, "bootstrap-secrets.json");
		fs.writeFileSync(
			secretsPath,
			JSON.stringify({
				bootstrapUser: "alex",
				bootstrapPasswordHash: '$6$abc"def',
				netbirdSetupKey: "NB-SETUP-KEY",
			}),
		);

		const result = await runReinstall([
			"--target-host",
			"root@198.51.100.10",
			"--disk",
			"/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_drive-scsi0-0-0-1",
			"--hostname",
			"bloom-eu-1",
			"--bootstrap-secrets-file",
			secretsPath,
			"--debug",
		]);

		try {
			expect(result.exitCode).toBe(0);

			const args = result.readArgs();
			expect(args).toEqual([
				"--flake",
				expect.stringMatching(/#deploy$/),
				"--target-host",
				"root@198.51.100.10",
				"--extra-files",
				expect.any(String),
				"--debug",
			]);

			const generatedFlake = result.readGeneratedFlake();
			expect(generatedFlake).toContain('networking.hostName = lib.mkForce "bloom-eu-1";');
			expect(generatedFlake).toContain(
				'disko.devices.disk.main.device = lib.mkForce "/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_drive-scsi0-0-0-1";',
			);
			expect(generatedFlake).toContain('nixpi.primaryUser = lib.mkForce "alex";');
			expect(generatedFlake).toContain('users.users."alex".initialHashedPassword = lib.mkForce "\\$6\\$abc\\"def";');
			expect(generatedFlake).toContain(
				'nixpi.netbird.setupKeyFile = lib.mkForce "/var/lib/nixpi/bootstrap/netbird-setup-key";',
			);

			expect(result.readStagedNetbirdSetupKey()).toBe("NB-SETUP-KEY");
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
			result.harness.cleanup();
		}
	});
});
