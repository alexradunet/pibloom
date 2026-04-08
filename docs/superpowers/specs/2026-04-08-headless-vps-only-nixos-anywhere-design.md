---
title: Headless VPS Only + Canonical NixOS Anywhere Install
date: 2026-04-08
status: approved-in-chat
---

# Headless VPS Only + Canonical NixOS Anywhere Install

## Goal

Narrow NixPI to a single supported product story:

- target: **headless VPS only**
- install method: **`nixos-anywhere` only**
- post-install operations: **`/srv/nixpi` + `nixpi-rebuild` / `nixpi-rebuild-pull`**

This removes competing install narratives and machine categories from the repository so a new operator sees one canonical way to provision and run the system.

## Why this change

The current repository still exposes multiple historical installation and machine stories:

- bootstrap-first installation onto an already NixOS-capable machine
- QEMU installer and preinstalled-disk lab flows
- mini PC / desktop / monitor-attached fallback language
- legacy Pi-oriented framing in install surfaces

Those paths make the product boundary unclear and compete with the newer OVH + `nixos-anywhere` deployment lane. The result is documentation drift, duplicated testing surfaces, and operator confusion.

The desired product boundary is narrower and simpler: this repo provisions and manages a headless VPS. Installation is destructive and remote; operations are shell-first and happen on the installed host.

## Product boundary

### Supported

- headless VPS deployment
- remote rescue-mode provisioning
- `nixos-anywhere` as the canonical installation mechanism
- provider-specific host profiles where needed (OVH first)
- `disko`-managed single-disk VPS layouts
- post-install management from `/srv/nixpi`
- rebuild/update/rollback using the existing day-2 commands

### Not supported

- mini PC deployment
- desktop deployment
- Raspberry Pi installation stories (including typo variants in docs/search guards)
- local ISO installer workflows
- QEMU installer or preinstalled-disk workflows as supported install paths
- bootstrapping onto an already NixOS-capable machine as a first-class installation method

## Canonical lifecycle

### Phase 1: installation

1. Boot the VPS into provider rescue mode.
2. SSH into the rescue environment.
3. Run the repo-native deploy wrapper, which shells out to `nixos-anywhere`.
4. Apply the repo's `disko` layout and VPS host configuration.
5. Reboot into the installed NixOS system.

Characteristics:

- remote and destructive
- provider/operator oriented
- implemented with `nixos-anywhere` and `disko`

### Phase 2: day-2 operations

1. Log into the installed system.
2. Treat `/srv/nixpi` as the canonical checkout.
3. Use `sudo nixpi-rebuild` and `sudo nixpi-rebuild-pull` for changes.
4. Use `sudo nixos-rebuild switch --rollback` for rollback.

Characteristics:

- host-local and iterative
- independent of `nixos-anywhere`
- unchanged from the desired long-term operator workflow

## Repository structure after cleanup

### Keep as first-class surfaces

- `flake.nix`
  - keep `disko` and `nixos-anywhere` inputs
  - keep VPS `nixosConfigurations`
  - keep packages/apps for:
    - deploy wrapper (`nixpi-deploy-ovh`, or a future generic VPS deploy wrapper)
    - `nixpi-rebuild`
    - `nixpi-rebuild-pull`
- `core/os/hosts/vps.nix`
- `core/os/hosts/ovh-vps.nix` (or renamed provider-specific equivalent)
- `core/os/disko/ovh-single-disk.nix`
- `docs/install.md`
- `docs/operations/ovh-rescue-deploy.md`
- day-2 operations docs rooted in `/srv/nixpi`
- integration checks that validate the headless VPS install/operate lifecycle

### Remove as supported concepts and implementation surfaces

- bootstrap-as-install package and docs surface
  - `core/os/pkgs/bootstrap/`
  - `nixpi-bootstrap-vps` package/app exposure
  - bootstrap-first installation language in docs
  - bootstrap-install tests/checks
- local installer/QEMU lab surfaces
  - `qemu-lab/`
  - `tools/qemu/`
  - QEMU app entries and wrappers
  - installer ISO references and tests
  - preinstalled image workflows
- machine-category broadening language and aliases
  - mini PC
  - desktop
  - Raspberry Pi references (including typo variants)
  - “already NixOS-capable machine” as a peer install path

## Naming and documentation rules

User-facing docs should consistently say:

- **headless VPS**
- **`nixos-anywhere` installation**
- **OVH rescue-mode deployment** (for the provider-specific runbook)
- **`/srv/nixpi` day-2 operations**

Docs should no longer imply:

- a desktop edition exists
- a mini-PC edition exists
- a Raspberry Pi installation path exists
- bootstrap is the preferred or equivalent installation mechanism

“Bootstrap” may remain only if repurposed to describe a post-install setup step, not whole-machine installation.

## Flake and package shape

The flake should converge on one installation story.

### Expected outputs to keep

- VPS-oriented `nixosConfigurations`
- the deploy wrapper package for `nixos-anywhere`
- rebuild/update packages for steady-state operations
- checks that validate:
  - VPS config evaluation/build
  - `disko` evaluation/build
  - deploy wrapper CLI behavior
  - installed system rebuild workflow

### Expected outputs to remove

- bootstrap install packages and harnesses
- QEMU installer/preinstalled helper apps
- checks whose only purpose is validating removed install paths

## Testing strategy after narrowing scope

### Keep

- evaluation/build checks for `ovh-vps` and other retained VPS configs
- `disko` build/eval checks
- integration test coverage for deploy-wrapper contract
- tests that confirm the installed system still supports `/srv/nixpi` day-2 rebuilds
- documentation guard tests for the canonical headless VPS story

### Remove

- bootstrap fresh-install tests
- external bootstrap install harnesses
- QEMU installer path tests
- preinstalled stable image prep/run tests
- tests that assert mini-PC or desktop-oriented behavior

## Migration rules

Apply a strict retention rule during implementation:

- if a file, package, app, test, or doc exists only to support a removed install path or removed machine category, delete it
- if it supports the installed headless VPS lifecycle, keep or adapt it

The cleanup should favor deletion over compatibility shims unless a retained day-2 workflow depends on the artifact.

## Risks and tradeoffs

### Accepted tradeoffs

- some historical workflows will stop working
- some existing tests and helper commands will be removed
- users who relied on local VM or already-NixOS bootstrap flows will need to adopt the VPS/rescue-mode `nixos-anywhere` path

### Why this is acceptable

The goal is a smaller, clearer product boundary. The repository should optimize for one high-confidence install and operation model rather than carrying multiple partially overlapping narratives.

## Implementation guidance

Implementation should proceed as a cleanup-and-convergence pass, not as a new feature expansion.

Priorities:

1. remove conflicting install surfaces
2. simplify docs to one canonical install story
3. preserve day-2 `/srv/nixpi` operations
4. retain only tests that protect the new boundary
5. verify that the retained deploy wrapper and VPS config still build

## Success criteria

A new reader should conclude, without ambiguity:

- this repo is for **headless VPS deployment**
- installation is done with **`nixos-anywhere`**
- OVH rescue mode is the documented first provider flow
- ongoing management happens from **`/srv/nixpi`**

A maintainer should also be able to verify that:

- no second first-class install path remains in the docs or flake outputs
- removed lab/bootstrap surfaces no longer appear in checks/apps/packages
- the retained VPS deployment path still evaluates and builds
