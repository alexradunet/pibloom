import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");

function writeStubExecutable(binDir: string, name: string) {
	const stubPath = path.join(binDir, name);
	writeFileSync(stubPath, "#!/usr/bin/env sh\nexit 0\n", "utf8");
	chmodSync(stubPath, 0o755);
}

describe("QEMU lab path guards", () => {
	it("reports the missing installer ISO under qemu-lab by default", () => {
		const tempRepoRoot = mkdtempSync(path.join(os.tmpdir(), "nixpi-qemu-root-"));
		const stubBinDir = mkdtempSync(path.join(os.tmpdir(), "nixpi-qemu-bin-"));

		try {
			writeStubExecutable(stubBinDir, "qemu-system-x86_64");
			writeStubExecutable(stubBinDir, "qemu-img");

			const result = spawnSync(path.join(repoRoot, "tools/qemu/run-installer.sh"), [], {
				cwd: repoRoot,
				encoding: "utf8",
				env: {
					...process.env,
					PATH: `${stubBinDir}:${process.env.PATH ?? ""}`,
					NIXPI_QEMU_REPO_DIR: tempRepoRoot,
				},
			});

			expect(result.status).toBe(1);
			expect(result.stderr).toContain(
				`missing installer ISO: ${path.join(tempRepoRoot, "qemu-lab", "nixos-stable-installer.iso")}`,
			);
			expect(result.stderr).not.toContain(".omx/qemu-lab");
		} finally {
			rmSync(tempRepoRoot, { recursive: true, force: true });
			rmSync(stubBinDir, { recursive: true, force: true });
		}
	});

	it("keeps only the qemu-lab readme tracked in git", () => {
		const gitignore = readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
		const labReadme = readFileSync(path.join(repoRoot, "qemu-lab/README.md"), "utf8");

		expect(gitignore).toContain("qemu-lab/*");
		expect(gitignore).toContain("!qemu-lab/README.md");
		expect(labReadme).toContain("qemu-lab/nixos-stable-installer.iso");
		expect(labReadme).toContain("qemu-lab/disks/");
		expect(labReadme).toContain("qemu-lab/logs/");
	});
});
