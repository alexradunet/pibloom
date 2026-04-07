# Repo-Root QEMU Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the manual QEMU runtime from `.omx/qemu-lab` to a single repo-root `qemu-lab/` directory while keeping only `qemu-lab/README.md` tracked and all runtime artifacts ignored.

**Architecture:** Keep the executable logic in `tools/qemu/`, but make every default runtime path resolve from `${REPO_DIR}/qemu-lab`. Lock the migration with a Vitest integration test that exercises the installer launcher with stubbed QEMU binaries, then update the helper scripts, ignore rules, and operator-facing docs to point only at `qemu-lab/`.

**Tech Stack:** Bash, Vitest, Node.js child_process/fs/path, Git ignore rules, Markdown docs

---

## File Structure

- Modify: `tools/qemu/common.sh` — change the default lab root from `.omx/qemu-lab` to `qemu-lab`
- Modify: `.gitignore` — ignore all `qemu-lab/` runtime artifacts except the committed README
- Create: `qemu-lab/README.md` — document the canonical local runtime layout and operator expectations
- Modify: `tools/qemu/README.md` — replace all `.omx/qemu-lab` paths with `qemu-lab/`
- Modify: `docs/operations/live-testing.md` — describe `qemu-lab/` as the canonical local runtime area
- Create: `tests/integration/qemu-lab-paths.test.ts` — regression guard for launcher path behavior and tracked/ignored lab layout

### Task 1: Add the failing regression guard for the new lab root

**Files:**
- Create: `tests/integration/qemu-lab-paths.test.ts`
- Test: `tests/integration/qemu-lab-paths.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/qemu-lab-paths.test.ts` with this content:

```ts
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/integration/qemu-lab-paths.test.ts
```

Expected: FAIL because `tools/qemu/common.sh` still points at `.omx/qemu-lab` and `qemu-lab/README.md` does not exist yet.

- [ ] **Step 3: Commit the failing test**

Run:

```bash
git add tests/integration/qemu-lab-paths.test.ts
git commit -F - <<'EOF'
Prove the qemu-lab migration starts from a failing path guard

This adds an integration test that locks the expected installer ISO path
shape and the tracked-versus-ignored qemu-lab layout before the runtime
path migration changes any behavior.

Constraint: The migration must stay test-first
Constraint: The launcher test must not require a real QEMU installation
Rejected: Test the current repo root directly | risks mutating a developer's local qemu-lab state
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Keep the launcher regression exercising the shell script, not a reimplemented copy of its path logic
Tested: npx vitest run tests/integration/qemu-lab-paths.test.ts (expected fail)
Not-tested: Full QEMU runtime launch
EOF
```

### Task 2: Move the default lab root and commit the tracked lab directory

**Files:**
- Modify: `tools/qemu/common.sh`
- Modify: `.gitignore`
- Create: `qemu-lab/README.md`
- Test: `tests/integration/qemu-lab-paths.test.ts`

- [ ] **Step 1: Write the minimal implementation**

Update `tools/qemu/common.sh` so the default lab root is the repo-root `qemu-lab` directory:

```bash
REPO_DIR="$(resolve_repo_dir)"
LAB_DIR="${NIXPI_QEMU_DIR:-${REPO_DIR}/qemu-lab}"
DISK_DIR="${LAB_DIR}/disks"
LOG_DIR="${LAB_DIR}/logs"
SHARE_DIR="${REPO_DIR}"
SSH_PORT="${NIXPI_QEMU_SSH_PORT:-2222}"
HTTP_PORT="${NIXPI_QEMU_HTTP_PORT:-8081}"
HTTPS_PORT="${NIXPI_QEMU_HTTPS_PORT:-8444}"
MEMORY_MB="${NIXPI_QEMU_MEMORY_MB:-4096}"
CPUS="${NIXPI_QEMU_CPUS:-4}"
DISK_SIZE="${NIXPI_QEMU_DISK_SIZE:-40G}"
```

Append these ignore rules to `.gitignore`:

```gitignore
qemu-lab/*
!qemu-lab/README.md
```

Create `qemu-lab/README.md` with this content:

```md
# QEMU Lab

This directory is the canonical local runtime area for the manual NixPI QEMU workflows.

Only this README is committed. All other files in `qemu-lab/` are local runtime artifacts and stay gitignored.

## Canonical local paths

- installer ISO: `qemu-lab/nixos-stable-installer.iso`
- installer scratch disk: `qemu-lab/disks/installer-scratch.qcow2`
- reusable preinstalled stable disk: `qemu-lab/disks/preinstalled-stable.qcow2`
- serial logs: `qemu-lab/logs/`
- local firmware vars: `qemu-lab/OVMF_VARS-*.fd`

## Expected workflow

1. Put a stable NixOS installer ISO at `qemu-lab/nixos-stable-installer.iso`.
2. Run `nix run .#qemu-installer`.
3. If you want the reusable base image path, run `nix run .#qemu-prepare-preinstalled-stable`.
4. Reuse the installed disk with `nix run .#qemu-preinstalled-stable`.

## Notes

- The helper scripts still support `NIXPI_QEMU_DIR` as an explicit override.
- This repo does not auto-migrate older local state from `.omx/qemu-lab` or `iso/`.
```

- [ ] **Step 2: Run the targeted test to verify it passes**

Run:

```bash
npx vitest run tests/integration/qemu-lab-paths.test.ts
```

Expected: PASS with both tests green.

- [ ] **Step 3: Run shell syntax checks for the shared helper layer**

Run:

```bash
bash -n tools/qemu/common.sh
```

Expected: no output, exit 0.

- [ ] **Step 4: Commit the lab-root implementation**

Run:

```bash
git add tools/qemu/common.sh .gitignore qemu-lab/README.md
git commit -F - <<'EOF'
Make qemu-lab the canonical local runtime root

This moves the default manual QEMU runtime out of .omx and into a
repo-root qemu-lab directory, while keeping only the lab README tracked
and leaving runtime artifacts ignored.

Constraint: The default path must be singular and operator-facing
Constraint: Existing NIXPI_QEMU_DIR overrides must continue to work
Rejected: Keep .omx/qemu-lab as a fallback default | preserves two canonical locations
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Keep generated lab state out of tools/ and out of git; only the README should stay tracked
Tested: npx vitest run tests/integration/qemu-lab-paths.test.ts
Tested: bash -n tools/qemu/common.sh
Not-tested: Full QEMU runtime launch
EOF
```

### Task 3: Update operator docs and lock the public path references

**Files:**
- Modify: `tests/integration/qemu-lab-paths.test.ts`
- Modify: `tools/qemu/README.md`
- Modify: `docs/operations/live-testing.md`
- Test: `tests/integration/qemu-lab-paths.test.ts`

- [ ] **Step 1: Extend the test with failing doc assertions**

Append this test to `tests/integration/qemu-lab-paths.test.ts`:

```ts
	it("documents qemu-lab as the canonical operator-visible path", () => {
		const qemuReadme = readFileSync(path.join(repoRoot, "tools/qemu/README.md"), "utf8");
		const liveTesting = readFileSync(path.join(repoRoot, "docs/operations/live-testing.md"), "utf8");

		expect(qemuReadme).toContain("lab root: `qemu-lab/`");
		expect(qemuReadme).toContain("qemu-lab/nixos-stable-installer.iso");
		expect(qemuReadme).not.toContain(".omx/qemu-lab");
		expect(liveTesting).toContain("`qemu-lab/`");
		expect(liveTesting).not.toContain(".omx/qemu-lab");
	});
```

- [ ] **Step 2: Run the test to verify it fails on stale docs**

Run:

```bash
npx vitest run tests/integration/qemu-lab-paths.test.ts
```

Expected: FAIL because `tools/qemu/README.md` and `docs/operations/live-testing.md` still reference `.omx/qemu-lab` or do not mention `qemu-lab/`.

- [ ] **Step 3: Update the docs with the new canonical path**

Replace `tools/qemu/README.md` with:

````md
# Manual QEMU Lab

## Paths

- lab root: `qemu-lab/`
- installer ISO: `qemu-lab/nixos-stable-installer.iso`
- installer scratch disk: `qemu-lab/disks/installer-scratch.qcow2`
- preinstalled stable disk: `qemu-lab/disks/preinstalled-stable.qcow2`
- serial logs: `qemu-lab/logs/`

## Installer flow

1. Put a stable NixOS installer ISO at `qemu-lab/nixos-stable-installer.iso`.
2. Run `tools/qemu/run-installer.sh`.
3. In the guest, install NixOS manually onto `qemu-lab/disks/installer-scratch.qcow2`.
4. Reboot, log in, and validate the base install.

## Preinstalled-stable flow

1. Run `tools/qemu/prepare-preinstalled-stable.sh` to create the reusable target disk.
2. Boot the installer flow with `tools/qemu/run-installer.sh` and install stable NixOS onto `qemu-lab/disks/installer-scratch.qcow2`.
3. After shutdown, clone the installed scratch disk into the reusable image:

```bash
qemu-img convert -f qcow2 -O qcow2 \
  qemu-lab/disks/installer-scratch.qcow2 \
  qemu-lab/disks/preinstalled-stable.qcow2
```

4. Boot the reusable image with `tools/qemu/run-preinstalled-stable.sh`.

## Shared repo mount

The repo is exposed to the guest as a 9p share with mount tag `nixpi-repo`.
Mount it manually in the guest when needed.
````

Update the Manual QEMU Lab section in `docs/operations/live-testing.md` to:

````md
### Manual QEMU Lab

Scratch installer lab:

```bash
nix run .#qemu-installer
```

Reusable preinstalled stable disk:

```bash
nix run .#qemu-prepare-preinstalled-stable
nix run .#qemu-preinstalled-stable
```

These commands standardize the host-side QEMU environment only. Local runtime
artifacts live under `qemu-lab/`. Install, bootstrap, reboot, and service
validation remain manual inside the guest. See `tools/qemu/README.md` for the
exact disk paths and scratch-to-reusable image flow.
````

- [ ] **Step 4: Run the targeted checks and the path sweep**

Run:

```bash
npx vitest run tests/integration/qemu-lab-paths.test.ts
bash -n tools/qemu/run-installer.sh
bash -n tools/qemu/run-preinstalled-stable.sh
bash -n tools/qemu/prepare-preinstalled-stable.sh
tools/qemu/run-installer.sh
rg -n '\.omx/qemu-lab' tools/qemu/README.md docs/operations/live-testing.md tests/integration/qemu-lab-paths.test.ts
```

Expected:

- Vitest PASS
- all `bash -n` commands exit 0 with no output
- `tools/qemu/run-installer.sh` exits 1 and prints `missing installer ISO: .../qemu-lab/nixos-stable-installer.iso`
- `rg` returns no matches

- [ ] **Step 5: Commit the public path migration**

Run:

```bash
git add tests/integration/qemu-lab-paths.test.ts tools/qemu/README.md docs/operations/live-testing.md
git commit -F - <<'EOF'
Point the manual QEMU workflow at qemu-lab only

This updates the public docs and regression guards so the operator-facing
manual QEMU workflow refers only to qemu-lab and no longer teaches .omx as
the runtime location.

Constraint: Operator-facing docs must have one canonical path
Constraint: The launcher should fail with the qemu-lab missing-ISO path before any runtime work
Rejected: Leave internal docs to imply both paths are valid | creates operator ambiguity
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Keep path sweeps focused on operator-visible docs and launcher behavior; do not reintroduce .omx in user guidance
Tested: npx vitest run tests/integration/qemu-lab-paths.test.ts
Tested: bash -n tools/qemu/run-installer.sh
Tested: bash -n tools/qemu/run-preinstalled-stable.sh
Tested: bash -n tools/qemu/prepare-preinstalled-stable.sh
Tested: tools/qemu/run-installer.sh (expected missing-ISO failure)
Tested: rg -n '\.omx/qemu-lab' tools/qemu/README.md docs/operations/live-testing.md tests/integration/qemu-lab-paths.test.ts
Not-tested: End-to-end installer boot with a real ISO
EOF
```
