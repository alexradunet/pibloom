# NixOS VPS Provisioner Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the plain `nixos-anywhere` VPS provisioner into a top-level `nixos_vps_provisioner/` boundary, rename `ovh-base` to `ovh-vps-base`, and add a provisioner-local `AGENTS.md` rescue automation contract that starts from first SSH access.

**Architecture:** Treat `nixos_vps_provisioner/` as a future-extractable sibling surface to NixPI rather than a `core/` subsystem. Move scripts, package wrappers, preset/profile definitions, tests, and provisioner-facing guidance into that folder; update the root flake to export those paths; then add guard coverage so provisioning code does not drift back into `core/`.

**Tech Stack:** Nix flakes, `nixos-anywhere`, Bash wrappers, Vitest, NixOS evaluation checks, Markdown docs, AGENTS.md guidance

---

## File Structure

- Create: `nixos_vps_provisioner/AGENTS.md`
  Provisioner-local automation and safety contract for rescue-mode workflows.
- Create: `nixos_vps_provisioner/scripts/plain-host-deploy.sh`
  Public day-0 install wrapper, moved out of `core/`.
- Create: `nixos_vps_provisioner/scripts/plain-host-ovh-common.sh`
  Shared OVH helper logic for the provisioner.
- Create: `nixos_vps_provisioner/pkgs/plain-host-deploy/default.nix`
  Nix package wrapper for the provisioner command.
- Create: `nixos_vps_provisioner/presets/ovh-vps-base.nix`
  Renamed OVH provisioner preset/profile.
- Create: `nixos_vps_provisioner/presets/ovh-single-disk.nix`
  Provisioner-owned disk layout path for OVH single-disk installs.
- Create: `nixos_vps_provisioner/tests/plain-host-deploy.test.ts`
  Provisioner-owned integration coverage for the deploy wrapper.
- Create: `nixos_vps_provisioner/tests/ovh-vps-base-config.test.ts`
  Provisioner-owned integration coverage for the renamed preset.
- Modify: `flake.nix`
  Export packages/presets/apps from `nixos_vps_provisioner/` paths and rename `ovh-base` to `ovh-vps-base`.
- Modify: `README.md`
  Reframe the plain-host install story around the provisioner sibling boundary.
- Modify: `docs/install-plain-host.md`
  Point day-0 usage and naming at `nixos_vps_provisioner` + `ovh-vps-base`.
- Modify: `docs/install.md`
  Keep NixPI explicitly downstream of the provisioner.
- Modify: `docs/operations/quick-deploy.md`
  Rename the OVH preset references and explain provisioner ownership.
- Modify: `docs/operations/ovh-rescue-deploy.md`
  Rename command path/preset references and explain rescue automation expectations.
- Modify: `docs/reference/infrastructure.md`
  Keep only the NixPI-facing imperative helper explanation; reference the provisioner sibling surface.
- Modify: `reinstall-nixpi-command.txt`
  Update examples to the renamed preset and provisioner-owned command path.
- Modify: `tests/integration/standards-guard.test.ts`
  Guard the new top-level provisioner boundary and forbid provisioning code under `core/`.
- Delete: `core/scripts/plain-host-deploy.sh`
- Delete: `core/scripts/plain-host-ovh-common.sh`
- Delete: `core/os/pkgs/plain-host-deploy/default.nix`
- Delete: `core/os/hosts/ovh-base.nix`
- Delete: `core/os/disko/ovh-single-disk.nix`
- Delete: `tests/integration/plain-host-deploy.test.ts`
- Delete: `tests/integration/ovh-base-config.test.ts`

### Task 1: Extract the Provisioner Files into `nixos_vps_provisioner/`

**Files:**
- Create: `nixos_vps_provisioner/scripts/plain-host-deploy.sh`
- Create: `nixos_vps_provisioner/scripts/plain-host-ovh-common.sh`
- Create: `nixos_vps_provisioner/pkgs/plain-host-deploy/default.nix`
- Create: `nixos_vps_provisioner/presets/ovh-vps-base.nix`
- Create: `nixos_vps_provisioner/presets/ovh-single-disk.nix`
- Create: `nixos_vps_provisioner/tests/plain-host-deploy.test.ts`
- Create: `nixos_vps_provisioner/tests/ovh-vps-base-config.test.ts`
- Delete: `core/scripts/plain-host-deploy.sh`
- Delete: `core/scripts/plain-host-ovh-common.sh`
- Delete: `core/os/pkgs/plain-host-deploy/default.nix`
- Delete: `core/os/hosts/ovh-base.nix`
- Delete: `core/os/disko/ovh-single-disk.nix`
- Delete: `tests/integration/plain-host-deploy.test.ts`
- Delete: `tests/integration/ovh-base-config.test.ts`

- [ ] **Step 1: Write failing provisioner-owned tests for the new paths and renamed preset**

Create `nixos_vps_provisioner/tests/plain-host-deploy.test.ts` and `nixos_vps_provisioner/tests/ovh-vps-base-config.test.ts` based on the current integration tests, but target the new paths and preset name:

```ts
const deployScriptPath = path.join(repoRoot, "nixos_vps_provisioner/scripts/plain-host-deploy.sh");
```

```ts
describe("ovh-vps-base host configuration", () => {
	it("evaluates the plain ovh-vps-base install profile", async () => {
		const result = await run("nix", [
			"eval",
			"--impure",
			"--json",
			"--expr",
			`let flake = builtins.getFlake (toString ${JSON.stringify(repoRoot)}); config = flake.nixosConfigurations.ovh-vps-base.config; in { hostName = config.networking.hostName; }`,
		], undefined, repoRoot);

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({ hostName: "ovh-vps-base" });
	});
});
```

- [ ] **Step 2: Run the new tests to verify they fail before the move**

Run: `npx vitest run nixos_vps_provisioner/tests/plain-host-deploy.test.ts nixos_vps_provisioner/tests/ovh-vps-base-config.test.ts`

Expected: FAIL because the provisioner folder and renamed preset do not exist yet

- [ ] **Step 3: Move the scripts, package, preset, disk layout, and tests into `nixos_vps_provisioner/`**

Copy the current implementations into the new top-level boundary and rename `ovh-base` to `ovh-vps-base` in the moved files:

```bash
mkdir -p nixos_vps_provisioner/scripts nixos_vps_provisioner/pkgs/plain-host-deploy nixos_vps_provisioner/presets nixos_vps_provisioner/tests
```

Update the moved deploy wrapper default:

```bash
local hostname="ovh-vps-base"
local flake_ref="${NIXPI_REPO_ROOT:-.}#ovh-vps-base"
```

Update the moved OVH helper validation:

```bash
if [[ "$base_attr" != "ovh-vps-base" ]]; then
	log "Flake ref must target the ovh-vps-base nixosConfigurations profile (for example .#ovh-vps-base)"
	return 1
fi
```

Update the moved preset file:

```nix
# nixos_vps_provisioner/presets/ovh-vps-base.nix
{ lib, modulesPath, ... }:
{
  imports = [
    (modulesPath + "/profiles/qemu-guest.nix")
  ];

  system.stateVersion = "25.05";
  nix.settings.experimental-features = [ "nix-command" "flakes" ];
  networking.hostName = lib.mkOverride 900 "ovh-vps-base";
  networking.firewall.allowedTCPPorts = [ 22 ];
  services.openssh = {
    enable = true;
    settings = {
      PasswordAuthentication = false;
      PermitRootLogin = "prohibit-password";
      PubkeyAuthentication = "yes";
    };
  };
}
```

Remove the old `core/` and `tests/integration/` copies after the moved tests are passing.

- [ ] **Step 4: Run the moved provisioner tests**

Run: `npx vitest run nixos_vps_provisioner/tests/plain-host-deploy.test.ts nixos_vps_provisioner/tests/ovh-vps-base-config.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the boundary move**

```bash
git add nixos_vps_provisioner core/scripts/plain-host-deploy.sh core/scripts/plain-host-ovh-common.sh core/os/pkgs/plain-host-deploy/default.nix core/os/hosts/ovh-base.nix core/os/disko/ovh-single-disk.nix tests/integration/plain-host-deploy.test.ts tests/integration/ovh-base-config.test.ts
git commit -m "Extract the VPS provisioner into a top-level sibling boundary

Move plain-host provisioning code out of core/ into nixos_vps_provisioner/
and rename the OVH preset to ovh-vps-base to make the provisioner
future-extractable.

Constraint: The provisioner must remain runnable from the root flake during the staged extraction
Rejected: Keep provisioning under core/ and only rename outputs | leaves the future extraction boundary muddy
Confidence: high
Scope-risk: moderate
Directive: Do not add new day-0 provisioning code back under core/
Tested: npx vitest run nixos_vps_provisioner/tests/plain-host-deploy.test.ts nixos_vps_provisioner/tests/ovh-vps-base-config.test.ts
Not-tested: Full repo suite
"
```

### Task 2: Rewire the Root Flake to Export the Provisioner Surface

**Files:**
- Modify: `flake.nix`
- Test: `nixos_vps_provisioner/tests/plain-host-deploy.test.ts`
- Test: `nixos_vps_provisioner/tests/ovh-vps-base-config.test.ts`

- [ ] **Step 1: Write failing flake-facing assertions for the new paths and preset name**

Update `tests/integration/standards-guard.test.ts` expectations to require:

```ts
expect(flake).toContain("plain-host-deploy = pkgs.callPackage ./nixos_vps_provisioner/pkgs/plain-host-deploy");
expect(flake).toContain("ovh-vps-base = mkConfiguredStableSystem");
expect(flake).toContain("./nixos_vps_provisioner/presets/ovh-vps-base.nix");
expect(flake).not.toContain("./core/os/hosts/ovh-base.nix");
```

- [ ] **Step 2: Run the guard test to verify it fails before flake rewiring**

Run: `npx vitest run tests/integration/standards-guard.test.ts`

Expected: FAIL on old `core/` paths and `ovh-base` references

- [ ] **Step 3: Rewire `flake.nix` to point at provisioner-owned paths**

Update package wiring:

```nix
plain-host-deploy = pkgs.callPackage ./nixos_vps_provisioner/pkgs/plain-host-deploy {
  nixosAnywherePackage = nixos-anywhere.packages.${system}.nixos-anywhere;
};
```

Update the preset output:

```nix
ovh-vps-base = mkConfiguredStableSystem {
  inherit system;
  modules = [
    disko.nixosModules.disko
    ./nixos_vps_provisioner/presets/ovh-single-disk.nix
    ./nixos_vps_provisioner/presets/ovh-vps-base.nix
  ];
};
```

Keep the app export name stable unless and until a later plan explicitly renames the public command again:

```nix
plain-host-deploy = {
  type = "app";
  program = "${self.packages.${system}.plain-host-deploy}/bin/plain-host-deploy";
};
```

- [ ] **Step 4: Run the guard and provisioner tests**

Run: `npx vitest run tests/integration/standards-guard.test.ts nixos_vps_provisioner/tests/plain-host-deploy.test.ts nixos_vps_provisioner/tests/ovh-vps-base-config.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the flake rewiring**

```bash
git add flake.nix tests/integration/standards-guard.test.ts
git commit -m "Export the VPS provisioner from top-level flake paths

Point the root flake at nixos_vps_provisioner-owned package and preset
paths so provisioning is visibly a sibling surface to NixPI.

Constraint: Root-flake consumers still need one stable surface during the staged extraction
Rejected: Add a second temporary duplicate flake output set | unnecessary transitional complexity
Confidence: high
Scope-risk: moderate
Directive: New provisioner exports should come from nixos_vps_provisioner/, not core/
Tested: npx vitest run tests/integration/standards-guard.test.ts nixos_vps_provisioner/tests/plain-host-deploy.test.ts nixos_vps_provisioner/tests/ovh-vps-base-config.test.ts
Not-tested: Nix build of full repo checks
"
```

### Task 3: Add `nixos_vps_provisioner/AGENTS.md` Rescue Automation Contract

**Files:**
- Create: `nixos_vps_provisioner/AGENTS.md`
- Test: `tests/integration/standards-guard.test.ts`

- [ ] **Step 1: Write the failing guard expectation for the provisioner-local `AGENTS.md`**

Add standards-guard assertions:

```ts
const provisionerAgentsPath = path.join(repoRoot, "nixos_vps_provisioner/AGENTS.md");

expect(existsSync(provisionerAgentsPath)).toBe(true);
expect(readUtf8(provisionerAgentsPath)).toContain("Automation begins at first SSH access, not at the web-panel step.");
expect(readUtf8(provisionerAgentsPath)).toContain("never auto-select a destructive target disk");
expect(readUtf8(provisionerAgentsPath)).toContain("stop and ask for the human to perform OVH panel actions");
```

- [ ] **Step 2: Run the guard test to verify it fails before the file exists**

Run: `npx vitest run tests/integration/standards-guard.test.ts`

Expected: FAIL because `nixos_vps_provisioner/AGENTS.md` does not exist yet

- [ ] **Step 3: Write `nixos_vps_provisioner/AGENTS.md`**

Create:

```md
# NixOS VPS Provisioner Guidance

This subtree owns day-0 plain VPS provisioning. It starts after the operator has already switched the provider into rescue mode and obtained the rescue SSH credentials.

Automation begins at first SSH access, not at the web-panel step.

## Required workflow

1. Verify SSH reachability to the rescue host.
2. Inspect disks with `lsblk`, `fdisk -l`, and `/dev/disk/by-id`.
3. Prefer persistent disk IDs over transient `/dev/sdX` names.
4. Never auto-select a destructive target disk when multiple plausible disks exist.
5. Stop and ask for confirmation before destructive execution if no explicit target disk was supplied.
6. Run the provisioner command for the selected preset.
7. If kexec or disk remapping fails, fall back to staged `nixos-anywhere` phases.
8. Stop and ask for the human to perform OVH panel actions such as switching back from rescue mode to disk boot.

## Inputs

- target IP
- rescue username
- password or SSH key path
- optional hostname
- optional explicit disk ID/path
- optional continue-into-NixPI-bootstrap flag
```

- [ ] **Step 4: Run the guard test**

Run: `npx vitest run tests/integration/standards-guard.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the provisioner-local automation contract**

```bash
git add nixos_vps_provisioner/AGENTS.md tests/integration/standards-guard.test.ts
git commit -m "Define rescue automation rules for the VPS provisioner

Add a provisioner-local AGENTS.md that starts automation at first SSH
access and encodes the destructive-safety rules for rescue-mode installs.

Constraint: The workflow must not pretend it can automate OVH panel actions
Rejected: Put the rescue automation contract in the repo-root AGENTS.md only | weakens extraction readiness
Confidence: high
Scope-risk: narrow
Directive: Provisioner automation must always require explicit destructive disk confirmation
Tested: npx vitest run tests/integration/standards-guard.test.ts
Not-tested: Live rescue-mode automation
"
```

### Task 4: Rewrite Docs and Examples to the Provisioner Boundary

**Files:**
- Modify: `README.md`
- Modify: `docs/install-plain-host.md`
- Modify: `docs/install.md`
- Modify: `docs/operations/quick-deploy.md`
- Modify: `docs/operations/ovh-rescue-deploy.md`
- Modify: `docs/reference/infrastructure.md`
- Modify: `reinstall-nixpi-command.txt`
- Modify: `tests/integration/standards-guard.test.ts`

- [ ] **Step 1: Write the failing doc guard expectations for `nixos_vps_provisioner` and `ovh-vps-base`**

Update guard expectations:

```ts
contains: ["nixos_vps_provisioner", "plain-host-deploy", "ovh-vps-base"]
absent: ["./core/os/hosts/ovh-base.nix", "ovh-base"]
```

Apply those only where the new wording is actually required.

- [ ] **Step 2: Run the guard test to verify it fails before doc rewrites**

Run: `npx vitest run tests/integration/standards-guard.test.ts`

Expected: FAIL on `ovh-base` and `core/`-owned path expectations

- [ ] **Step 3: Rewrite the docs and examples**

Update `docs/install-plain-host.md` command text:

```md
2. run `nix run .#plain-host-deploy -- --target-host root@SERVER_IP --disk /dev/disk/by-id/PERSISTENT_TARGET_DISK_ID`
3. let `nixos-anywhere` install the plain `ovh-vps-base` system
```

Update `docs/operations/ovh-rescue-deploy.md` explanation:

```md
- uses the repo's `ovh-vps-base` provisioner preset as the base system
- runs `nixos-anywhere` against the OVH rescue host
- leaves NixPI bootstrapping for after the machine reboots into the installed system
```

Update `README.md` and `docs/install.md` to describe the plain-host install surface as coming from the `nixos_vps_provisioner` sibling boundary.

Update `reinstall-nixpi-command.txt` comments so the first command is clearly the provisioner-owned day-0 step.

- [ ] **Step 4: Run the guard and targeted doc-adjacent tests**

Run: `npx vitest run tests/integration/standards-guard.test.ts nixos_vps_provisioner/tests/plain-host-deploy.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the doc boundary rewrite**

```bash
git add README.md docs/install-plain-host.md docs/install.md docs/operations/quick-deploy.md docs/operations/ovh-rescue-deploy.md docs/reference/infrastructure.md reinstall-nixpi-command.txt tests/integration/standards-guard.test.ts
git commit -m "Document the VPS provisioner as a sibling surface

Rewrite the plain-host and rescue docs so provisioning is clearly owned
by nixos_vps_provisioner and uses the ovh-vps-base preset name.

Constraint: NixPI docs must stay downstream of the provisioner
Rejected: Keep docs path-stable but conceptually vague | hurts future repo extraction
Confidence: high
Scope-risk: moderate
Directive: Provisioner docs should describe NixPI bootstrap as optional second-stage work
Tested: npx vitest run tests/integration/standards-guard.test.ts nixos_vps_provisioner/tests/plain-host-deploy.test.ts
Not-tested: Rendered docs site
"
```

### Task 5: Final Verification for the Extraction Stage

**Files:**
- Verify: `flake.nix`
- Verify: `nixos_vps_provisioner/AGENTS.md`
- Verify: `nixos_vps_provisioner/tests/plain-host-deploy.test.ts`
- Verify: `nixos_vps_provisioner/tests/ovh-vps-base-config.test.ts`
- Verify: `tests/integration/standards-guard.test.ts`

- [ ] **Step 1: Run targeted provisioner verification**

Run: `npx vitest run nixos_vps_provisioner/tests/plain-host-deploy.test.ts nixos_vps_provisioner/tests/ovh-vps-base-config.test.ts tests/integration/standards-guard.test.ts`

Expected: PASS

- [ ] **Step 2: Run repo static checks**

Run: `npm run check`

Expected: PASS

- [ ] **Step 3: Run provisioner flake checks**

Run: `nix eval .#nixosConfigurations.ovh-vps-base.config.networking.hostName --json`

Expected: `"ovh-vps-base"`

Run: `nix build .#packages.x86_64-linux.plain-host-deploy --no-link`

Expected: PASS

- [ ] **Step 4: Run the full test suite if the worktree is otherwise clean**

Run: `npm test`

Expected: PASS

If unrelated unstaged work remains in the tree and breaks full-suite stability, record that precisely in the final verification note instead of pretending the full suite passed.

- [ ] **Step 5: Commit the verification pass**

```bash
git add flake.nix nixos_vps_provisioner tests/integration/standards-guard.test.ts README.md docs/install-plain-host.md docs/install.md docs/operations/quick-deploy.md docs/operations/ovh-rescue-deploy.md docs/reference/infrastructure.md reinstall-nixpi-command.txt
git commit -m "Verify the nixos_vps_provisioner extraction stage

Run the provisioner-focused verification set and confirm the root flake,
tests, docs, and AGENTS contract all align with the new sibling boundary.

Constraint: Extraction is only real if paths, names, docs, and guards all agree
Rejected: End after path moves alone | leaves the future extraction boundary unreliable
Confidence: medium
Scope-risk: narrow
Directive: Keep future provisioner changes inside nixos_vps_provisioner unless they are true shared runtime concerns
Tested: npx vitest run nixos_vps_provisioner/tests/plain-host-deploy.test.ts nixos_vps_provisioner/tests/ovh-vps-base-config.test.ts tests/integration/standards-guard.test.ts; npm run check; nix eval .#nixosConfigurations.ovh-vps-base.config.networking.hostName --json; nix build .#packages.x86_64-linux.plain-host-deploy --no-link
Not-tested: Full npm test suite if blocked by unrelated local work
"
```

## Self-Review

### Spec coverage

- Top-level extraction to `nixos_vps_provisioner/`: covered by Task 1 and Task 2.
- Rename `ovh-base` to `ovh-vps-base`: covered by Task 1, Task 2, and Task 4.
- Provisioner-local `AGENTS.md`: covered by Task 3.
- NixPI as downstream consumer: covered by Task 4.
- Guard against provisioner code drifting back into `core/`: covered by Task 2 and Task 4.

No spec gaps found.

### Placeholder scan

- No `TODO`, `TBD`, or “similar to Task N” placeholders remain.
- Each task has explicit file paths, commands, and concrete snippets.

### Type consistency

- The plan consistently uses `nixos_vps_provisioner` for the folder boundary.
- The OVH preset name is consistently `ovh-vps-base`.
- The public command remains `plain-host-deploy`.

No naming inconsistencies found.
