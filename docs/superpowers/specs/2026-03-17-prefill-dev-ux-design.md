# Prefill Dev UX Design

**Date:** 2026-03-17
**Status:** Approved

## Problem

`just vm` always boots from a fresh qcow2, so any `prefill.env` placed inside the VM is wiped on every run. The existing fallback reads from `~/.bloom/prefill.env` on the host (shared via 9p virtfs), but developers without Bloom installed locally have no reason for `~/.bloom/` to exist.

## Goal

Let developers place `prefill.env` in the repo (gitignored, co-located with the example) and have `just vm` automatically use it — no manual host setup required.

## Design

### Approach

Option A — justfile pre-stage. Before launching QEMU, the VM targets copy `core/scripts/prefill.env` to `~/.bloom/prefill.env` if the project file exists. The existing virtfs already shares `~/.bloom/` into the VM, so the wizard picks it up through the current fallback path. No changes to the wizard or NixOS config.

### Files Changed

**`.gitignore`**
Add `core/scripts/prefill.env`.

Note: `core/scripts/prefill.env` is currently tracked by git. The gitignore entry alone will not untrack it — `git rm --cached core/scripts/prefill.env` must be run as part of the implementation to remove it from the index before committing.

**`justfile`**
In `vm`, `vm-gui`, and `vm-daemon` targets, insert a staging block immediately before the `qemu-system-x86_64` call:

```bash
# Stage project prefill into host-bloom share if present
if [[ -f "core/scripts/prefill.env" ]]; then
  mkdir -p "$HOME/.bloom"
  cp "core/scripts/prefill.env" "$HOME/.bloom/prefill.env"
  echo "Staged core/scripts/prefill.env → ~/.bloom/prefill.env"
fi
```

The project file always wins (overwrite) when present — it is the dev source of truth for VM runs. If a developer has a hand-crafted `~/.bloom/prefill.env` with different values, `just vm` will silently replace it; this is intentional but worth noting.

`vm-run` is not modified. It reuses an existing disk, so the wizard typically does not run again. Additionally, since `vm-run` still mounts `~/.bloom/` via the same virtfs, any file staged by a prior `just vm` call remains accessible — no re-staging is needed.

Note: all four VM targets (`vm`, `vm-gui`, `vm-daemon`, `vm-run`) pass `-virtfs local,path="$HOME/.bloom"` to QEMU. If `~/.bloom/` does not exist at launch time, QEMU will fail. This staging block creates the directory when `core/scripts/prefill.env` is present. Developers who have neither file will still hit this pre-existing failure if `~/.bloom/` does not exist — that is out of scope for this change.

**`core/scripts/prefill.env.example`**
Replace the current header:
```
# Bloom wizard prefill — copy to ~/.bloom/prefill.env on your VM to skip prompts.
```
With:
```
# Bloom wizard prefill — copy to core/scripts/prefill.env and fill in values.
# just vm will stage it automatically; any variable left unset will still prompt.
```

### Developer Workflow

```
cp core/scripts/prefill.env.example core/scripts/prefill.env
# fill in values
just vm
```

### What Is Not Changed

- `setup-wizard.sh` — no changes; it already has the `/mnt/host-bloom/prefill.env` fallback
- `core/os/hosts/x86_64.nix` — no new virtfs mounts needed
- `vm-run` — not modified (see reasoning above)

## Trade-offs Considered

| Option | Pros | Cons |
|--------|------|------|
| A (chosen) | Minimal diff, no NixOS rebuild | Writes outside the repo (`~/.bloom/prefill.env`); silently clobbers any existing `~/.bloom/prefill.env` on the host |
| Second virtfs mount | No host mutation | Requires NixOS rebuild + wizard change + 4 justfile targets |
| Symlink instead of copy | Edits reflected immediately | Slightly surprising across virtfs boundary |
