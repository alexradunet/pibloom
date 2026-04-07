import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const oldLabPath = [".omx", "qemu-lab"].join("/");

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
			expect(result.stderr).not.toContain(oldLabPath);
		} finally {
			rmSync(tempRepoRoot, { recursive: true, force: true });
			rmSync(stubBinDir, { recursive: true, force: true });
		}
	});

	it("uses a discovered OVMF directory when the old libvirt path is absent", () => {
		const tempRepoRoot = mkdtempSync(path.join(os.tmpdir(), "nixpi-qemu-root-"));
		const stubBinDir = mkdtempSync(path.join(os.tmpdir(), "nixpi-qemu-bin-"));
		const tempOvmfDir = mkdtempSync(path.join(os.tmpdir(), "nixpi-qemu-ovmf-"));
		const labDir = path.join(tempRepoRoot, "qemu-lab");

		try {
			mkdirSync(labDir, { recursive: true });
			writeFileSync(path.join(labDir, "nixos-stable-installer.iso"), "fake iso", "utf8");
			writeFileSync(path.join(tempOvmfDir, "OVMF_CODE.fd"), "code", "utf8");
			writeFileSync(path.join(tempOvmfDir, "OVMF_VARS.fd"), "vars", "utf8");
			writeStubExecutable(stubBinDir, "qemu-system-x86_64");
			writeStubExecutable(stubBinDir, "qemu-img");

			const result = spawnSync(path.join(repoRoot, "tools/qemu/run-installer.sh"), [], {
				cwd: repoRoot,
				encoding: "utf8",
				env: {
					...process.env,
					PATH: `${stubBinDir}:${process.env.PATH ?? ""}`,
					NIXPI_QEMU_REPO_DIR: tempRepoRoot,
					NIXPI_QEMU_OVMF_DIR: tempOvmfDir,
				},
			});

			expect(result.status).toBe(0);
			expect(result.stdout).toContain(`file=${path.join(tempOvmfDir, "OVMF_CODE.fd")}`);
			expect(existsSync(path.join(labDir, "OVMF_VARS-installer.fd"))).toBe(true);
		} finally {
			rmSync(tempRepoRoot, { recursive: true, force: true });
			rmSync(stubBinDir, { recursive: true, force: true });
			rmSync(tempOvmfDir, { recursive: true, force: true });
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

	it("documents qemu-lab as the canonical operator-visible path", () => {
		const qemuReadme = readFileSync(path.join(repoRoot, "tools/qemu/README.md"), "utf8");
		const liveTesting = readFileSync(path.join(repoRoot, "docs/operations/live-testing.md"), "utf8");

		expect(qemuReadme).toContain("lab root: `qemu-lab/`");
		expect(qemuReadme).toContain("qemu-lab/nixos-stable-installer.iso");
		expect(qemuReadme).not.toContain(oldLabPath);
		expect(liveTesting).toContain("`qemu-lab/`");
		expect(liveTesting).not.toContain(oldLabPath);
	});
});
