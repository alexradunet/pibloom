# OVH NixOS Anywhere Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repo-native OVH VPS install path using `nixos-anywhere` + `disko` while preserving the existing `/srv/nixpi` and `/etc/nixos#nixos` day-2 workflow.

**Architecture:** Introduce a narrow OVH deployment lane: one new OVH host profile, one single-disk `disko` layout, one thin deploy wrapper, and operator docs that explain rescue-mode installation. Keep install-time tooling separate from steady-state operations by using `nixos-anywhere` only for provisioning and leaving `nixpi-rebuild` / `nixpi-rebuild-pull` unchanged for day-2 use.

**Tech Stack:** Nix flakes, NixOS modules, `nixos-anywhere`, `disko`, Bash, existing NixPI docs/tests, shellcheck, nix eval/build checks.

---

## File Structure

### Create

- `core/os/hosts/ovh-vps.nix` — OVH-oriented host profile layered on top of the current NixPI module set.
- `core/os/disko/ovh-single-disk.nix` — single-disk GPT/EFI/root disk layout for OVH VPS installs.
- `core/scripts/nixpi-deploy-ovh.sh` — thin `nixos-anywhere` wrapper for destructive fresh installs.
- `docs/operations/ovh-rescue-deploy.md` — operator runbook for OVH rescue-mode installation.

### Modify

- `flake.nix` — add `disko` and `nixos-anywhere` inputs, expose the OVH host config, and package/app-wrap the deploy script.
- `docs/install.md` — link to the OVH deployment path.
- `docs/operations/quick-deploy.md` — clarify bootstrap-on-existing-NixOS vs fresh OVH install.
- `tests/integration/standards-guard.test.ts` — guard new docs/script paths and prevent topology drift.

### Verify

- `bash -n core/scripts/nixpi-deploy-ovh.sh`
- `npm test -- --runInBand tests/integration/standards-guard.test.ts`
- `nix eval .#nixosConfigurations.ovh-vps.config.networking.hostName`
- `nix build .#packages.x86_64-linux.nixpi-deploy-ovh --no-link`

## Task 1: Add regression coverage and topology guards first

**Files:**
- Modify: `tests/integration/standards-guard.test.ts`
- Test: `tests/integration/standards-guard.test.ts`

- [ ] **Step 1: Write the failing test for the OVH deployment lane**

```ts
it("keeps the OVH deployment lane wired into the repo", () => {
  const flake = readFileSync("flake.nix", "utf8");

  expect(flake).toContain('disko.url = "github:nix-community/disko"');
  expect(flake).toContain('nixos-anywhere.url = "github:nix-community/nixos-anywhere"');
  expect(flake).toContain("nixosConfigurations.ovh-vps");
  expect(flake).toContain("./core/os/hosts/ovh-vps.nix");
  expect(flake).toContain("nixpi-deploy-ovh");

  expect(existsSync("core/os/hosts/ovh-vps.nix")).toBe(true);
  expect(existsSync("core/os/disko/ovh-single-disk.nix")).toBe(true);
  expect(existsSync("core/scripts/nixpi-deploy-ovh.sh")).toBe(true);
  expect(existsSync("docs/operations/ovh-rescue-deploy.md")).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --runInBand tests/integration/standards-guard.test.ts`
Expected: FAIL because the new flake inputs, files, and docs do not exist yet.

- [ ] **Step 3: Add a second failing assertion for the deploy script contract**

```ts
it("documents an explicit destructive deploy script contract", () => {
  const installDoc = readFileSync("docs/operations/ovh-rescue-deploy.md", "utf8");

  expect(installDoc).toContain("rescue mode");
  expect(installDoc).toContain("nix run .#nixpi-deploy-ovh --");
  expect(installDoc).toContain("--target-host");
  expect(installDoc).toContain("--disk");
  expect(installDoc).toContain("destructive");
});
```

- [ ] **Step 4: Re-run the focused test**

Run: `npm test -- --runInBand tests/integration/standards-guard.test.ts`
Expected: FAIL with missing-file / missing-string assertions for the new OVH lane.

- [ ] **Step 5: Commit the red test**

```bash
git add tests/integration/standards-guard.test.ts
git commit -m "Protect the OVH deployment lane with regression guards"
```

## Task 2: Wire flake inputs, host config, and disko layout

**Files:**
- Create: `core/os/hosts/ovh-vps.nix`
- Create: `core/os/disko/ovh-single-disk.nix`
- Modify: `flake.nix`
- Test: `tests/integration/standards-guard.test.ts`

- [ ] **Step 1: Implement the OVH host profile**

```nix
# core/os/hosts/ovh-vps.nix
{ lib, modulesPath, ... }:

{
  imports = [
    ./vps.nix
    (modulesPath + "/profiles/qemu-guest.nix")
  ];

  networking.hostName = lib.mkDefault "ovh-vps";

  boot.loader.systemd-boot.enable = lib.mkForce false;
  boot.loader.grub = {
    enable = true;
    efiSupport = true;
    efiInstallAsRemovable = true;
    device = "nodev";
  };

  services.qemuGuest.enable = true;
  fileSystems."/".device = lib.mkDefault "/dev/disk/by-label/nixos";
  fileSystems."/boot".device = lib.mkDefault "/dev/disk/by-label/boot";
}
```

- [ ] **Step 2: Implement the explicit single-disk disko layout**

```nix
# core/os/disko/ovh-single-disk.nix
{ lib, disk ? "/dev/sda", ... }:

{
  disko.devices = {
    disk.main = {
      type = "disk";
      device = lib.mkDefault disk;
      content = {
        type = "gpt";
        partitions = {
          ESP = {
            priority = 1;
            start = "1MiB";
            end = "512MiB";
            type = "EF00";
            content = {
              type = "filesystem";
              format = "vfat";
              mountpoint = "/boot";
              mountOptions = [ "umask=0077" ];
              label = "boot";
            };
          };
          root = {
            end = "100%";
            content = {
              type = "filesystem";
              format = "ext4";
              mountpoint = "/";
              label = "nixos";
            };
          };
        };
      };
    };
  };
}
```

- [ ] **Step 3: Wire the new inputs and host config into `flake.nix`**

```nix
inputs = {
  nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  nixpkgs-stable.url = "github:NixOS/nixpkgs/nixos-25.11";
  disko.url = "github:nix-community/disko";
  nixos-anywhere.url = "github:nix-community/nixos-anywhere";
};
```

```nix
outputs = { self, nixpkgs, nixpkgs-stable, disko, nixos-anywhere, ... }:
```

```nix
nixosConfigurations = {
  vps = mkConfiguredSystem {
    inherit system;
    modules = [ ./core/os/hosts/vps.nix ];
  };

  ovh-vps = mkConfiguredStableSystem {
    inherit system;
    modules = [
      disko.nixosModules.disko
      ./core/os/hosts/ovh-vps.nix
      ./core/os/disko/ovh-single-disk.nix
    ];
  };

  installed-test = mkConfiguredSystem {
    inherit system;
    modules = [
      self.nixosModules.nixpi
      {
        nixpi.primaryUser = "alex";
        networking.hostName = "nixos";
        system.stateVersion = "25.05";
        boot.loader = {
          systemd-boot.enable = true;
          efi.canTouchEfiVariables = true;
        };
        fileSystems = {
          "/" = {
            device = "/dev/vda";
            fsType = "ext4";
          };
          "/boot" = {
            device = "/dev/vda1";
            fsType = "vfat";
          };
        };
      }
    ];
  };
};
```

- [ ] **Step 4: Re-run the focused guard test**

Run: `npm test -- --runInBand tests/integration/standards-guard.test.ts`
Expected: still FAIL because the deploy script and docs are not implemented yet, but the flake/host/disko assertions should now pass.

- [ ] **Step 5: Verify the host config evaluates**

Run: `nix eval .#nixosConfigurations.ovh-vps.config.networking.hostName`
Expected: returns `"ovh-vps"`.

- [ ] **Step 6: Commit the flake and host wiring**

```bash
git add flake.nix core/os/hosts/ovh-vps.nix core/os/disko/ovh-single-disk.nix tests/integration/standards-guard.test.ts
git commit -m "Make the OVH install target part of the flake"
```

## Task 3: Add the deploy wrapper and package/app entrypoints

**Files:**
- Create: `core/scripts/nixpi-deploy-ovh.sh`
- Modify: `flake.nix`
- Test: `tests/integration/standards-guard.test.ts`

- [ ] **Step 1: Implement the deploy wrapper script**

```bash
#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF_USAGE'
Usage: nixpi-deploy-ovh --target-host root@IP --disk /dev/sdX [--flake .#ovh-vps] [--generate-hardware-config nixos-facter ./facter.json]

Destructive fresh install for an OVH VPS in rescue mode.
EOF_USAGE
}

TARGET_HOST=""
DISK=""
FLAKE_REF=".#ovh-vps"
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-host)
      TARGET_HOST="${2:?missing target host}"
      shift 2
      ;;
    --disk)
      DISK="${2:?missing disk path}"
      shift 2
      ;;
    --flake)
      FLAKE_REF="${2:?missing flake ref}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ -z "$TARGET_HOST" || -z "$DISK" ]]; then
  usage >&2
  exit 1
fi

echo "[nixpi-deploy-ovh] WARNING: destructive install to $TARGET_HOST using disk $DISK" >&2
exec nix run github:nix-community/nixos-anywhere -- \
  --flake "$FLAKE_REF" \
  --target-host "$TARGET_HOST" \
  --disk "$DISK" \
  "${EXTRA_ARGS[@]}"
```

- [ ] **Step 2: Package the wrapper in `flake.nix`**

```nix
nixpi-deploy-ovh = pkgs.writeShellApplication {
  name = "nixpi-deploy-ovh";
  runtimeInputs = [ pkgs.bash pkgs.git pkgs.nix ];
  text = builtins.readFile ./core/scripts/nixpi-deploy-ovh.sh;
};
```

```nix
apps.${system}.nixpi-deploy-ovh = {
  type = "app";
  program = "${self.packages.${system}.nixpi-deploy-ovh}/bin/nixpi-deploy-ovh";
};
```

- [ ] **Step 3: Run shell syntax verification**

Run: `bash -n core/scripts/nixpi-deploy-ovh.sh`
Expected: no output, exit code 0.

- [ ] **Step 4: Build the package wrapper**

Run: `nix build .#packages.x86_64-linux.nixpi-deploy-ovh --no-link`
Expected: successful build of the wrapper package.

- [ ] **Step 5: Re-run the focused guard test**

Run: `npm test -- --runInBand tests/integration/standards-guard.test.ts`
Expected: still FAIL only on documentation assertions if docs are not added yet.

- [ ] **Step 6: Commit the deploy wrapper**

```bash
git add core/scripts/nixpi-deploy-ovh.sh flake.nix tests/integration/standards-guard.test.ts
git commit -m "Add the destructive OVH deploy wrapper"
```

## Task 4: Document the OVH rescue-mode runbook and link it into existing docs

**Files:**
- Create: `docs/operations/ovh-rescue-deploy.md`
- Modify: `docs/install.md`
- Modify: `docs/operations/quick-deploy.md`
- Test: `tests/integration/standards-guard.test.ts`

- [ ] **Step 1: Write the dedicated OVH runbook**

```md
# OVH Rescue Deploy

> Fresh-install NixPI onto an OVH VPS from rescue mode using `nixos-anywhere`

## Before you start

This flow is **destructive**. It repartitions and reformats the target disk.

## 1. Boot the VPS into rescue mode

In the OVHcloud control panel, reboot the VPS into rescue mode and wait for the rescue SSH credentials.

## 2. Verify the target disk

```bash
ssh root@SERVER_IP
lsblk
```

Choose the install disk explicitly, for example `/dev/sda`.

## 3. Run the install from this repo

```bash
nix run .#nixpi-deploy-ovh -- \
  --target-host root@SERVER_IP \
  --disk /dev/sda \
  --flake .#ovh-vps
```

## 4. Reconnect after install

The machine will reboot into the installed system. Because this is a reinstall, your SSH host key will change.

```bash
ssh-keygen -R SERVER_IP
ssh root@SERVER_IP
```

## 5. Switch to the canonical workflow

```bash
cd /srv/nixpi
sudo nixpi-rebuild
sudo nixpi-rebuild-pull
```
```

- [ ] **Step 2: Link the new path from `docs/install.md`**

```md
## Install paths

- Fresh OVH VPS install from rescue mode: [OVH Rescue Deploy](./operations/ovh-rescue-deploy)
- Existing NixOS-capable machine bootstrap: use `nixpi-bootstrap-vps`
```

- [ ] **Step 3: Clarify `quick-deploy` to distinguish provisioning vs bootstrap**

```md
## Two supported deployment paths

1. **Fresh OVH install** — use the rescue-mode `nixos-anywhere` path documented in [OVH Rescue Deploy](./ovh-rescue-deploy)
2. **Already NixOS-capable machine** — run `nixpi-bootstrap-vps`
```

- [ ] **Step 4: Re-run the focused guard test**

Run: `npm test -- --runInBand tests/integration/standards-guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Build the docs site to catch navigation or markdown issues**

Run: `npm run docs:build`
Expected: VitePress build succeeds without broken imports or config failures.

- [ ] **Step 6: Commit the docs**

```bash
git add docs/operations/ovh-rescue-deploy.md docs/install.md docs/operations/quick-deploy.md tests/integration/standards-guard.test.ts
git commit -m "Document the OVH rescue-mode install path"
```

## Task 5: Run final verification and tighten any drift

**Files:**
- Modify if needed: `flake.nix`
- Modify if needed: `core/scripts/nixpi-deploy-ovh.sh`
- Modify if needed: `docs/operations/ovh-rescue-deploy.md`
- Test: repo verification commands below

- [ ] **Step 1: Run the focused JS regression test**

Run: `npm test -- --runInBand tests/integration/standards-guard.test.ts`
Expected: PASS.

- [ ] **Step 2: Re-run shell syntax verification**

Run: `bash -n core/scripts/nixpi-deploy-ovh.sh`
Expected: PASS.

- [ ] **Step 3: Re-run flake/package checks**

Run: `nix eval .#nixosConfigurations.ovh-vps.config.networking.hostName && nix build .#packages.x86_64-linux.nixpi-deploy-ovh --no-link`
Expected: evaluation prints `"ovh-vps"` and the package build succeeds.

- [ ] **Step 4: Re-run docs build**

Run: `npm run docs:build`
Expected: PASS.

- [ ] **Step 5: Review the final diff before reporting success**

```bash
git diff --stat HEAD~4..HEAD
git status --short
```

- [ ] **Step 6: Commit the final verification/tightening if any changes were needed**

```bash
git add flake.nix core/scripts/nixpi-deploy-ovh.sh docs/operations/ovh-rescue-deploy.md docs/install.md docs/operations/quick-deploy.md tests/integration/standards-guard.test.ts
git commit -m "Finish and verify the OVH deployment lane"
```
