# Structural Cleanup Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove dead code (CLI ISO), eliminate duplication in `flake.nix` and `justfile`, and make the `firstboot.sh` → `setup-wizard.sh` dependency explicit via a shared library.

**Architecture:** Four independent mechanical changes tackled in sequence, each committed separately. No behaviour changes to the installed system or installer. Changes confined to `flake.nix`, `justfile`, and `core/scripts/`.

**Tech Stack:** Nix, Bash, just

**Spec:** `docs/superpowers/specs/2026-03-18-structural-cleanup-design.md`

---

## File Map

| File | Action | Change |
|---|---|---|
| `flake.nix` | Modify | Remove `iso` block; rename `iso-gui` → `iso`; add `mkDiskImage`; replace `qcow2`/`raw` blocks |
| `justfile` | Modify | Remove `iso` + `test-iso` (CLI); rename `iso-gui` → `iso`, `test-iso-gui` → `test-iso`; collapse vm recipes to one-liners |
| `core/scripts/run-qemu.sh` | Create | Shared QEMU disk setup + launch logic for all three VM modes |
| `core/scripts/setup-lib.sh` | Create | Shared shell function library extracted from `setup-wizard.sh` |
| `core/scripts/setup-wizard.sh` | Modify | Add `source setup-lib.sh` at top; remove the extracted functions |
| `core/scripts/firstboot.sh` | Modify | Replace wizard sourcing + guard with direct `setup-lib.sh` source |
| `core/os/pkgs/app/default.nix` | Modify | Add `setup-lib.sh` to install phase |

---

## Task 1: Remove CLI ISO, Rename iso-gui → iso

**Files:**
- Modify: `flake.nix:105-131`
- Modify: `justfile:22-38` and `justfile:168-241`

### Step 1.1 — Remove the `iso` package and rename `iso-gui` in `flake.nix`

In `flake.nix`, find and remove the entire `iso` block (lines 105-112, starts with `# Minimal installer ISO (CLI only...)`).

Then rename `iso-gui` → `iso`: change the key on the line that reads `iso-gui = (nixpkgs.lib.nixosSystem {` to `iso = (nixpkgs.lib.nixosSystem {`. Update the comment immediately above that line to read `# Graphical installer ISO (Calamares + GNOME)` — the exact current wording may differ, so read the file before editing rather than assuming.

- [ ] Make these edits to `flake.nix`

### Step 1.2 — Verify `flake.nix` evaluates

- [ ] Run:
  ```bash
  nix eval .#packages.x86_64-linux.iso --no-write-lock-file 2>&1 | head -5
  ```
  Expected: outputs a store path (no error). The old `iso` is gone; the new `iso` (former `iso-gui`) is the only ISO output.

- [ ] Run:
  ```bash
  nix eval .#packages.x86_64-linux --apply builtins.attrNames --no-write-lock-file
  ```
  Expected: output includes `"iso"` but NOT `"iso-gui"`. Also confirm `"qcow2"` and `"raw"` still present.

### Step 1.3 — Update `justfile`

Remove these two recipes entirely:
- `iso:` (lines 22-24, CLI minimal ISO)
- `test-iso:` (lines 169-196, CLI ISO QEMU test)

Rename:
- `iso-gui:` → `iso:` (lines 27-38)
- `test-iso-gui:` → `test-iso:` (lines 200-241)

Inside the (now renamed) `iso:` recipe, update the help text line that reads `just test-iso-gui` → `just test-iso`.

Inside the (now renamed) `test-iso:` recipe, update the error message that reads `Run 'just iso-gui' first` → `Run 'just iso' first`.

- [ ] Make these edits to `justfile`

### Step 1.4 — Verify justfile syntax

- [ ] Run:
  ```bash
  just --list
  ```
  Expected: `iso` and `test-iso` appear once each. No `iso-gui` or `test-iso-gui` entries.

### Step 1.5 — Commit

- [ ] Run:
  ```bash
  git add flake.nix justfile
  git commit -m "chore: remove CLI ISO, rename iso-gui → iso"
  ```

---

## Task 2: Deduplicate qcow2 / raw in flake.nix

**Files:**
- Modify: `flake.nix:17-103`

### Step 2.1 — Add `mkDiskImage` to the `let` block

In `flake.nix`, find the top-level `let` block (starts around line 18). Add `mkDiskImage` as the last binding before `in`, after `bloomApp`:

```nix
mkDiskImage = format: (nixpkgs.lib.nixosSystem {
  inherit system specialArgs;
  modules = [
    ./core/os/hosts/x86_64.nix
    ({ config, pkgs, lib, ... }: {
      imports = [ "${nixpkgs}/nixos/modules/virtualisation/disk-image.nix" ];
      image.format = format;
      image.efiSupport = true;
      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;
      fileSystems."/" = {
        device = "/dev/disk/by-label/nixos";
        fsType = "ext4";
        autoResize = true;
      };
      fileSystems."/boot" = {
        device = "/dev/disk/by-label/ESP";
        fsType = "vfat";
      };
      boot.growPartition = true;
      boot.initrd.availableKernelModules = [ "virtio_net" "virtio_pci" "virtio_blk" "virtio_scsi" "9p" "9pnet_virtio" ];
      boot.kernelModules = [ "kvm-intel" "kvm-amd" ];
    })
  ];
}).config.system.build.image;
```

- [ ] Add `mkDiskImage` to the `let` block

### Step 2.2 — Replace the `qcow2` and `raw` package blocks

Replace the entire `qcow2 = (nixpkgs.lib.nixosSystem { ... }).config.system.build.image;` block (all ~35 lines) with:

```nix
# Disk images
qcow2 = mkDiskImage "qcow2";
raw   = mkDiskImage "raw";
```

Do the same for the `raw` block.

- [ ] Replace both blocks in `flake.nix`

### Step 2.3 — Verify both outputs still evaluate

- [ ] Run:
  ```bash
  nix eval .#packages.x86_64-linux.qcow2 --no-write-lock-file 2>&1 | head -3
  nix eval .#packages.x86_64-linux.raw --no-write-lock-file 2>&1 | head -3
  ```
  Expected: both output a store path, no errors.

### Step 2.4 — Commit

- [ ] Run:
  ```bash
  git add flake.nix
  git commit -m "refactor(flake): deduplicate qcow2/raw via mkDiskImage"
  ```

---

## Task 3: Extract run-qemu.sh

**Files:**
- Create: `core/scripts/run-qemu.sh`

This script centralises all QEMU disk setup and launch logic. It is called by the `vm`, `vm-gui`, `vm-daemon`, and `vm-run` justfile recipes.

### Step 3.1 — Create `core/scripts/run-qemu.sh`

The script takes two flags:
- `--mode headless|gui|daemon` (required)
- `--skip-setup` (optional, skips disk copy/resize/prefill — used by `vm-run`)

Disk and QEMU constants match the existing justfile values exactly:
- Disk path: `/tmp/bloom-vm-disk.qcow2`
- OVMF vars: `/tmp/bloom-ovmf-vars.fd`
- OVMF code: `/usr/share/edk2/ovmf/OVMF_CODE.fd`
- OVMF vars source: `/usr/share/edk2/ovmf/OVMF_VARS.fd`
- Disk resize target: `24G`
- RAM: `4096`
- CPUs: `2`

Port forwards (all modes): `tcp::2222-:22`, `tcp::5000-:5000`, `tcp::8080-:8080`, `tcp::8081-:8081`, `tcp::8888-:80`

Mode-specific QEMU flags:
- `headless`: `-nographic -serial mon:stdio`
- `gui`: `-vga virtio -display gtk`
- `daemon`: `-nographic -serial file:/tmp/bloom-vm.log` + run via `nohup`, then poll port 2222 up to 30s

```bash
#!/usr/bin/env bash
# run-qemu.sh — shared QEMU setup and launch helper for justfile vm recipes.
# Dev-only tool: NOT installed into the NixOS system.
#
# Usage:
#   run-qemu.sh --mode headless|gui|daemon [--skip-setup]
set -euo pipefail

DISK="/tmp/bloom-vm-disk.qcow2"
VARS="/tmp/bloom-ovmf-vars.fd"
OVMF_CODE="/usr/share/edk2/ovmf/OVMF_CODE.fd"
OVMF_VARS_SRC="/usr/share/edk2/ovmf/OVMF_VARS.fd"
OUTPUT="result"

mode=""
skip_setup=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --mode) mode="$2"; shift 2 ;;
        --skip-setup) skip_setup=1; shift ;;
        *) echo "Unknown flag: $1" >&2; exit 1 ;;
    esac
done

if [[ -z "$mode" ]]; then
    echo "Error: --mode is required (headless|gui|daemon)" >&2
    exit 1
fi

if [[ "$skip_setup" -eq 0 ]]; then
    rm -f "$VARS"
    qcow2_src=$(find -L "$OUTPUT" -name "*.qcow2" -type f | head -1)
    if [[ -z "$qcow2_src" ]]; then
        echo "Error: No qcow2 found in $OUTPUT. Run 'just qcow2' first." >&2
        exit 1
    fi
    echo "Found qcow2: $qcow2_src"
    echo "Copying disk image to $DISK..."
    cp -f "$qcow2_src" "$DISK"
    chmod 644 "$DISK"
    qemu-img resize "$DISK" 24G
    cp "$OVMF_VARS_SRC" "$VARS"
    if [[ -f "core/scripts/prefill.env" ]]; then
        mkdir -p "$HOME/.bloom"
        cp "core/scripts/prefill.env" "$HOME/.bloom/prefill.env"
        echo "Staged core/scripts/prefill.env → ~/.bloom/prefill.env"
    fi
else
    if [[ ! -f "$DISK" ]]; then
        echo "Error: No VM disk found at $DISK. Run 'just vm' first." >&2
        exit 1
    fi
    # Only copy fresh OVMF vars if they don't exist yet, to preserve any
    # UEFI state (boot order etc.) written by a previous VM run.
    if [[ ! -f "$VARS" ]]; then
        cp "$OVMF_VARS_SRC" "$VARS"
    fi
fi

QEMU_COMMON=(
    qemu-system-x86_64
    -machine q35
    -cpu host
    -enable-kvm
    -m 4096
    -smp 2
    -boot order=c,menu=on
    -drive "if=pflash,format=raw,readonly=on,file=${OVMF_CODE}"
    -drive "if=pflash,format=raw,file=${VARS}"
    -drive "file=${DISK},format=qcow2,if=virtio,cache=writeback"
    -netdev "user,id=net0,hostfwd=tcp::2222-:22,hostfwd=tcp::5000-:5000,hostfwd=tcp::8080-:8080,hostfwd=tcp::8081-:8081,hostfwd=tcp::8888-:80"
    -device virtio-net-pci,netdev=net0
    -virtfs "local,path=$HOME/.bloom,mount_tag=host-bloom,security_model=none,readonly=on"
)

case "$mode" in
    headless)
        echo "Starting VM... Press Ctrl+A X to exit"
        "${QEMU_COMMON[@]}" -nographic -serial mon:stdio
        echo ""
        echo "Hint: Use 'just vm-daemon' to run VM in background, then 'just vm-ssh' to connect"
        ;;
    gui)
        echo "Starting VM with GUI... Close window to exit"
        "${QEMU_COMMON[@]}" -vga virtio -display gtk
        ;;
    daemon)
        if pgrep -f "[q]emu-system-x86_64.*bloom-vm-disk" > /dev/null; then
            echo "VM already running. Use 'just vm-ssh' to connect or 'just vm-stop' to stop."
            exit 1
        fi
        echo "Starting VM in background..."
        echo "  - Log file: /tmp/bloom-vm.log"
        echo "  - Connect:  just vm-ssh"
        echo "  - Stop:     just vm-stop"
        nohup "${QEMU_COMMON[@]}" -nographic -serial file:/tmp/bloom-vm.log \
            > /dev/null 2>&1 &
        echo "Waiting for VM to boot..."
        for i in {1..30}; do
            if nc -z localhost 2222 2>/dev/null; then
                echo "VM is ready! SSH available on port 2222"
                exit 0
            fi
            sleep 1
        done
        echo "VM starting... try 'just vm-ssh' in a few seconds"
        ;;
    *)
        echo "Error: unknown mode '$mode'. Must be headless, gui, or daemon." >&2
        exit 1
        ;;
esac
```

- [ ] Create `core/scripts/run-qemu.sh` with the content above

### Step 3.2 — Make it executable

- [ ] Run:
  ```bash
  chmod +x core/scripts/run-qemu.sh
  ```

### Step 3.3 — Syntax check

- [ ] Run:
  ```bash
  bash -n core/scripts/run-qemu.sh
  ```
  Expected: no output (no syntax errors).

### Step 3.4 — Commit

- [ ] Run:
  ```bash
  git add core/scripts/run-qemu.sh
  git commit -m "feat(scripts): add run-qemu.sh shared VM launch helper"
  ```

---

## Task 4: Collapse justfile vm recipes to thin wrappers

**Files:**
- Modify: `justfile:52-166` and `justfile:246-306`

### Step 4.1 — Replace `vm` recipe

Replace the entire `vm: qcow2` recipe body (the `#!/usr/bin/env bash ... echo "Hint: ..."` block) with a one-liner:

```just
# Build qcow2 and run VM (fresh build from current codebase)
vm: qcow2
    core/scripts/run-qemu.sh --mode headless
```

### Step 4.2 — Replace `vm-gui` recipe

Replace the entire `vm-gui: qcow2` recipe body with:

```just
# Run VM with GUI display
vm-gui: qcow2
    core/scripts/run-qemu.sh --mode gui
```

### Step 4.3 — Replace `vm-run` recipe

Replace the `vm-run:` recipe body with:

```just
# Run VM with existing qcow2 (no rebuild)
vm-run:
    core/scripts/run-qemu.sh --mode headless --skip-setup
```

### Step 4.4 — Replace `vm-daemon` recipe

Replace the entire `vm-daemon: qcow2` recipe body with:

```just
# Run VM in background daemon mode (detached, no terminal attached)
# Use this when you want to run the VM and still use your shell
# Then connect with: just vm-ssh
vm-daemon: qcow2
    core/scripts/run-qemu.sh --mode daemon
```

- [ ] Make all four recipe replacements in `justfile`

### Step 4.5 — Verify justfile syntax

- [ ] Run:
  ```bash
  just --list
  ```
  Expected: `vm`, `vm-gui`, `vm-run`, `vm-daemon` all appear. No errors.

- [ ] Run:
  ```bash
  just --dry-run vm 2>&1 | head -10
  ```
  Expected: shows `nix build` + `core/scripts/run-qemu.sh --mode headless` — no errors.

### Step 4.6 — Commit

- [ ] Run:
  ```bash
  git add justfile
  git commit -m "refactor(justfile): collapse vm recipes to run-qemu.sh wrappers"
  ```

---

## Task 5: Create setup-lib.sh

**Files:**
- Create: `core/scripts/setup-lib.sh`

### Step 5.1 — Identify functions to extract

Read `core/scripts/setup-wizard.sh` and locate the following functions. They will be cut from wizard and placed in setup-lib.sh. Find their exact line ranges:

| Function(s) | Section in wizard.sh |
|---|---|
| `mark_done`, `mark_done_with`, `read_checkpoint_data` | `# --- Checkpoint helpers ---` (~lines 36-50) — **`step_done` stays in wizard** (firstboot defines its own copy at line 38; do not move to lib) |
| `netbird_status_json`, `netbird_fqdn` | (~lines 52-61) — **Note:** `netbird_ip` stays in wizard |
| `matrix_state_get`, `matrix_state_set`, `matrix_state_clear` | `# --- Matrix state helpers ---` (~lines 70-83) |
| `generate_password`, `json_field` | `# --- Matrix helpers ---` (~lines 87-96) |
| `matrix_register`, `matrix_login` | (~lines 98-158) |
| `load_existing_matrix_credentials` | (~lines 160-185) |
| `write_service_home_runtime` | (large function with embedded HTML, search for `write_service_home_runtime()`) |
| `install_home_infrastructure` | (search for `install_home_infrastructure()`) |
| `install_service` | (search for `install_service()`) |
| `step_matrix` | (search for `step_matrix()`) |

- [ ] Read `setup-wizard.sh` to confirm all line ranges before proceeding

### Step 5.2 — Create `core/scripts/setup-lib.sh`

Create the file with this header, then paste in the functions found above (in the order listed in Step 5.1):

```bash
#!/usr/bin/env bash
# setup-lib.sh — Shared function library for setup-wizard.sh and firstboot.sh.
# Source this file; do not execute directly.
#
# Provides: checkpoint management, NetBird utilities, Matrix API/state,
#           service management, and step_matrix.
#
# Required env vars (callers must set before sourcing):
#   WIZARD_STATE        — path to checkpoint directory (e.g. ~/.bloom/wizard-state)
#   MATRIX_STATE_DIR    — path to matrix state directory
#   MATRIX_HOMESERVER   — Matrix homeserver URL (e.g. http://localhost:6167)
#   PI_DIR              — path to Pi config dir (e.g. ~/.pi)
#   BLOOM_CONFIG        — path to Bloom config dir (e.g. ~/.config/bloom)
#   BLOOM_SERVICES      — path to installed services dir
#   BLOOM_DIR           — path to Bloom home dir
#   SYSTEMD_USER_DIR    — path to systemd user dir
```

Then paste all the extracted functions after the header.

- [ ] Create `core/scripts/setup-lib.sh` with the header + all extracted functions

### Step 5.3 — Syntax check

- [ ] Run:
  ```bash
  bash -n core/scripts/setup-lib.sh
  ```
  Expected: no output.

### Step 5.4 — Commit

- [ ] Run:
  ```bash
  git add core/scripts/setup-lib.sh
  git commit -m "feat(scripts): add setup-lib.sh shared function library"
  ```

---

## Task 6: Update setup-wizard.sh to source setup-lib.sh

**Files:**
- Modify: `core/scripts/setup-wizard.sh`

### Step 6.1 — Add setup-lib.sh sourcing at the top of wizard

After the shebang and existing comment block (after the prefill sourcing block, around line 30), add:

```bash
# Load shared function library.
BLOOM_LIB="$(dirname "$0")/setup-lib.sh"
if [[ ! -f "$BLOOM_LIB" ]]; then
    BLOOM_LIB="/run/current-system/sw/bin/setup-lib.sh"
fi
# shellcheck source=setup-lib.sh
source "$BLOOM_LIB"
```

- [ ] Add the sourcing block to `setup-wizard.sh`

### Step 6.2 — Remove extracted functions from wizard

Delete from `setup-wizard.sh` the function bodies that were moved to `setup-lib.sh` in Task 5. These are:
- `mark_done`, `mark_done_with`, `read_checkpoint_data` (keep `step_done` — wizard needs it and firstboot defines its own)
- `netbird_status_json`, `netbird_fqdn` (keep `netbird_ip` — it is wizard-only)
- The `# --- Matrix state helpers ---` section and its three functions
- The `# --- Matrix helpers ---` comment and `generate_password`, `json_field`
- `matrix_register`, `matrix_login`
- `load_existing_matrix_credentials`
- `write_service_home_runtime`
- `install_home_infrastructure`
- `install_service`
- `step_matrix`

**Do NOT remove:** `step_done`, `netbird_ip`, or any of the interactive step functions (`step_welcome`, `step_password`, `step_network`, `step_git`, `step_ai`, `step_services`, `step_netbird`) or `main()`.

- [ ] Remove the extracted function bodies from `setup-wizard.sh`

### Step 6.2b — Verify wizard retained functions

Confirm that functions which must stay in `setup-wizard.sh` are still present after the removal:

- [ ] Run:
  ```bash
  WIZARD_STATE=/tmp MATRIX_STATE_DIR=/tmp MATRIX_HOMESERVER=x PI_DIR=/tmp \
    BLOOM_CONFIG=/tmp BLOOM_SERVICES=/tmp BLOOM_DIR=/tmp SYSTEMD_USER_DIR=/tmp \
    bash -c 'source core/scripts/setup-wizard.sh 2>/dev/null
             type step_done
             type netbird_ip
             type step_welcome
             type step_password'
  ```
  Expected: all four print `is a function`. If any print `not found`, a function was accidentally removed.

### Step 6.3 — Syntax check

- [ ] Run:
  ```bash
  bash -n core/scripts/setup-wizard.sh
  ```
  Expected: no output.

### Step 6.4 — Smoke test (verify function availability)

Since wizard now depends on setup-lib.sh, simulate sourcing:

- [ ] Run:
  ```bash
  WIZARD_STATE=/tmp MATRIX_STATE_DIR=/tmp MATRIX_HOMESERVER=x PI_DIR=/tmp \
    BLOOM_CONFIG=/tmp BLOOM_SERVICES=/tmp BLOOM_DIR=/tmp SYSTEMD_USER_DIR=/tmp \
    bash -c 'source core/scripts/setup-lib.sh && type matrix_register && type mark_done && type step_matrix'
  ```
  Expected: outputs `matrix_register is a function`, `mark_done is a function`, `step_matrix is a function`.

### Step 6.5 — Commit

- [ ] Run:
  ```bash
  git add core/scripts/setup-wizard.sh
  git commit -m "refactor(wizard): source setup-lib.sh, remove extracted functions"
  ```

---

## Task 7: Update firstboot.sh to source setup-lib.sh directly

**Files:**
- Modify: `core/scripts/firstboot.sh:25-36`

### Step 7.1 — Replace wizard sourcing with bloom-lib sourcing

Find the existing sourcing block in `firstboot.sh` (lines 25-36):

```bash
# Re-use all helper functions from setup-wizard.sh to avoid duplication.
# When running from the Nix store (via bloom-firstboot.service), dirname "$0" is a store
# path without setup-wizard.sh. Fall back to the system PATH install location.
# shellcheck source=setup-wizard.sh
WIZARD_SCRIPT="$(dirname "$0")/setup-wizard.sh"
if [[ ! -f "$WIZARD_SCRIPT" ]]; then
    WIZARD_SCRIPT="/run/current-system/sw/bin/setup-wizard.sh"
fi
# Source only the function definitions (skip main() execution) by setting a guard.
BLOOM_FIRSTBOOT_SOURCING=1
source "$WIZARD_SCRIPT"
unset BLOOM_FIRSTBOOT_SOURCING
```

Replace it with:

```bash
# Load shared function library.
# firstboot.sh is run directly from the Nix source tree (not via app),
# so $(dirname "$0") points into the source store, not app's $out/bin/.
# The dirname probe is kept for pattern consistency but will always fall through
# to the /run/current-system/sw/bin fallback at runtime.
BLOOM_LIB="$(dirname "$0")/setup-lib.sh"
if [[ ! -f "$BLOOM_LIB" ]]; then
    BLOOM_LIB="/run/current-system/sw/bin/setup-lib.sh"
fi
# shellcheck source=setup-lib.sh
source "$BLOOM_LIB"
```

- [ ] Make this replacement in `firstboot.sh`

### Step 7.2 — Syntax check

- [ ] Run:
  ```bash
  bash -n core/scripts/firstboot.sh
  ```
  Expected: no output.

### Step 7.3 — Smoke test (verify function availability)

Confirm that `firstboot.sh` can source `setup-lib.sh` and that the key shared functions are available:

- [ ] Run:
  ```bash
  WIZARD_STATE=/tmp MATRIX_STATE_DIR=/tmp MATRIX_HOMESERVER=x PI_DIR=/tmp \
    BLOOM_CONFIG=/tmp BLOOM_SERVICES=/tmp BLOOM_DIR=/tmp SYSTEMD_USER_DIR=/tmp \
    bash -c 'source core/scripts/setup-lib.sh
             type mark_done
             type step_matrix
             type install_service'
  ```
  Expected: all three print `is a function`. This confirms `setup-lib.sh` loaded correctly and all functions firstboot depends on are available.

### Step 7.4 — Commit

- [ ] Run:
  ```bash
  git add core/scripts/firstboot.sh
  git commit -m "refactor(firstboot): source setup-lib.sh directly, remove wizard dependency"
  ```

---

## Task 8: Install setup-lib.sh via app

**Files:**
- Modify: `core/os/pkgs/app/default.nix:40-42`

### Step 8.1 — Add setup-lib.sh to the install phase

In `app/default.nix`, find the install phase lines that install `setup-wizard.sh` and `login-greeting.sh`:

```nix
mkdir -p $out/bin
install -m 755 ${../../../scripts/setup-wizard.sh} $out/bin/setup-wizard.sh
install -m 755 ${../../../scripts/login-greeting.sh} $out/bin/login-greeting.sh
```

Add one line for `setup-lib.sh` alongside them:

```nix
mkdir -p $out/bin
install -m 755 ${../../../scripts/setup-lib.sh} $out/bin/setup-lib.sh
install -m 755 ${../../../scripts/setup-wizard.sh} $out/bin/setup-wizard.sh
install -m 755 ${../../../scripts/login-greeting.sh} $out/bin/login-greeting.sh
```

Use the store-path interpolation form `${../../../scripts/setup-lib.sh}` — this bypasses the `cleanSourceWith` filter. Do NOT use a plain `cp core/scripts/setup-lib.sh`.

- [ ] Add the `setup-lib.sh` install line to `app/default.nix`

### Step 8.2 — Verify app builds

- [ ] Run:
  ```bash
  nix build .#app --no-link 2>&1 | tail -5
  ```
  Expected: build succeeds (or is cached). No "file not found" errors.

### Step 8.3 — Commit

- [ ] Run:
  ```bash
  git add core/os/pkgs/app/default.nix
  git commit -m "feat(app): install setup-lib.sh alongside wizard and greeting scripts"
  ```

---

## Task 9: Final Validation

### Step 9.1 — Full NixOS config evaluation

- [ ] Run:
  ```bash
  nix eval .#nixosConfigurations.bloom-x86_64.config.system.stateVersion
  ```
  Expected: `"25.05"` (no errors).

### Step 9.2 — All package outputs evaluate

- [ ] Run:
  ```bash
  nix eval .#packages.x86_64-linux --apply builtins.attrNames --no-write-lock-file
  ```
  Expected: `[ "app" "iso" "qcow2" "raw" ]` — four outputs, no `iso-gui`, no `iso` duplicate.

### Step 9.3 — app builds cleanly

- [ ] Run:
  ```bash
  nix build .#app --no-link 2>&1 | tail -5
  ```
  Expected: exits 0, `setup-lib.sh` is present in the output.

### Step 9.4 — Checks pass (fast config check)

- [ ] Run:
  ```bash
  just check-config
  ```
  Expected: exits 0.

### Step 9.5 — justfile looks clean

- [ ] Run:
  ```bash
  just --list
  ```
  Confirm: `iso`, `test-iso`, `vm`, `vm-gui`, `vm-daemon`, `vm-run` all present. No `iso-gui`, `test-iso-gui`.

### Step 9.6 — All scripts pass syntax check

- [ ] Run:
  ```bash
  bash -n core/scripts/setup-lib.sh
  bash -n core/scripts/setup-wizard.sh
  bash -n core/scripts/firstboot.sh
  bash -n core/scripts/run-qemu.sh
  ```
  Expected: all silent (no syntax errors).
