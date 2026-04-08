---
title: Zellij as the Declarative Default Terminal UI
date: 2026-04-08
status: approved-in-chat
---

# Zellij as the Declarative Default Terminal UI

## Goal

Make Zellij the default operator-facing terminal interface in NixPI while keeping the system clean, declarative, recoverable, and aligned with NixOS conventions.

The default experience should apply to both SSH and local tty sessions, open a guided Pi-oriented Zellij workspace, and preserve an explicit plain-shell bypass for recovery.

## Key decisions

- Zellij should become the **default terminal UI** for the primary operator account.
- The default policy should apply to **both SSH and local tty** interactive sessions.
- The implementation should remain **pure NixOS-native** inside this repository, with **no Home Manager dependency**.
- Recovery must remain easy and explicit via a **plain-shell bypass**.
- Pi integration should be **guided**, not heavily branded: Zellij is the frame, Pi is the main pane/tab.
- NixPI should **not** depend on the external `zellij-nix` flake.
- NixPI should treat `zellij-nix` as a **reference implementation** only and replicate the useful package ideas natively in-repo when needed.
- The default package source should be **`pkgs.zellij`**, with an optional **NixPI-native rebuilt/patched Zellij package** for advanced mode later.

## Why this change

NixPI already presents itself as a shell-first system:

- SSH and local login shells are the supported operator entrypoints.
- `pi` is the primary interactive command.
- the current runtime is wired through `core/os/modules/shell.nix`, `core/os/modules/app.nix`, and the host profile tty/getty setup.

That shape is already close to a Zellij-based workflow. The missing piece is a first-class declarative terminal-interface layer that can:

- install the desired terminal multiplexer package,
- generate stable layouts and config,
- auto-enter the interface only when appropriate,
- preserve recovery behavior.

The external `a-kenji/zellij-nix` repository is useful as a packaging reference because it shows how to:

1. build Zellij from source,
2. build bundled plugins from source,
3. patch generated plugin `.wasm` artifacts into the final Zellij package.

However, that repository does **not** provide a NixOS module, Home Manager module, or product-level session policy. NixPI should own those concerns itself.

## Product boundary

### Supported

- Zellij as the default interactive terminal UI for the primary operator user
- declarative configuration generated from NixPI options
- automatic entry from SSH and local tty interactive sessions
- explicit bypass to retain a normal shell when needed
- Pi-oriented default workspace layout
- optional future NixPI-native rebuilt/patched Zellij package inspired by `zellij-nix`

### Not part of the initial scope

- importing or depending on the `zellij-nix` flake
- Home Manager-based user session management
- replacing the primary user shell with an unconditional hard wrapper
- deep branding or a highly customized NixPI appliance UI
- large multi-pane operational dashboards without validated need

## Architecture

### 1. Add a first-class terminal UI module

Add a new NixPI-owned module, for example:

- `core/os/modules/terminal-ui.nix`

This module should own terminal-interface policy and generated Zellij configuration.

Its responsibilities:

- enable/disable the terminal UI feature,
- select the interface mode,
- select the Zellij package mode,
- define autostart policy,
- define bypass behavior,
- define Pi integration and generated layouts,
- install the selected package and expose any wrapper commands.

This keeps `shell.nix` focused on shell/session mechanics instead of turning it into a large feature module.

### 2. Split package sourcing from session policy

Keep two concerns separate:

#### Package source

- default: `pkgs.zellij`
- future advanced mode: NixPI-native rebuilt/patched Zellij package

#### Session policy

- whether Zellij is enabled,
- when it autostarts,
- when it attaches to an existing session,
- what layout/config gets written,
- how bypass/recovery works.

This mirrors standard NixOS structure: packages are derivations; behavior is expressed through module options.

### 3. Generate Zellij config declaratively

NixPI should generate the effective Zellij configuration from Nix options rather than relying on mutable, hand-managed files.

Generated outputs should include:

- `config.kdl`
- one or more layout files
- optionally themes later if needed

These can be written through declarative file generation for the primary user’s config path or another clearly owned system-managed location that the launch wrapper points at.

### 4. Keep the shell bridge thin

`core/os/modules/shell.nix` should remain a narrow bridge.

It should only:

- export the normal NixPI environment,
- detect whether the session is eligible for Zellij autostart,
- hand off to a generated wrapper/launcher,
- otherwise leave the shell alone.

It should **not** own package build logic, layout definitions, or large policy branches.

### 5. Keep Pi integration at the layout level

Pi should remain a normal packaged command.

Zellij becomes the default frame around it by providing a generated default layout such as:

- Tab 1: Pi
- Tab 2: Shell

This makes the default UX guided and useful without coupling Pi too tightly to the terminal multiplexer internals.

## Component breakdown

### `core/os/modules/options/terminal-ui.nix`

Add a dedicated option declaration file for typed terminal-interface options.

Suggested option families:

- `nixpi.terminal.enable`
- `nixpi.terminal.interface`
- `nixpi.terminal.zellij.enable`
- `nixpi.terminal.zellij.packageMode = "nixpkgs" | "native-patched"`
- `nixpi.terminal.zellij.autoStartOn = [ "ssh" "tty" ]`
- `nixpi.terminal.zellij.attachExistingSession`
- `nixpi.terminal.zellij.exitShellOnExit`
- `nixpi.terminal.zellij.bypassEnvVar`
- `nixpi.terminal.zellij.piLayout.enable`
- `nixpi.terminal.zellij.piLayout.name`

The exact names can change, but the design should preserve the split between enablement, package selection, launch policy, and layout policy.

### `core/os/modules/terminal-ui.nix`

The main implementation module should:

- read the terminal UI options,
- choose the Zellij package,
- install the package,
- generate config/layout files,
- generate a small launch wrapper,
- expose the wrapper to the shell bridge.

### `core/os/pkgs/zellij/`

This package directory should be reserved for the optional advanced mode.

Suggested shape:

- `core/os/pkgs/zellij/default.nix`
- `core/os/pkgs/zellij/plugins.nix`
- optional helper files later if source selection or patch tables become large

Purpose:

- replicate the useful packaging ideas from `zellij-nix` natively in NixPI,
- build plugins from source when advanced mode is requested,
- patch plugin outputs into the final package,
- keep this complexity out of the NixOS module layer.

The initial rollout does **not** require building this package path immediately if `pkgs.zellij` is sufficient to land the declarative session model first.

## Runtime flow

### Normal login flow

For SSH and local tty sessions:

1. the primary user logs in through the normal shell entrypoint,
2. shell init reaches the NixPI terminal-ui bridge,
3. the bridge checks whether the session is eligible,
4. if eligible, it `exec`s Zellij via a NixPI-generated launcher,
5. Zellij starts using the generated config/layout,
6. the default layout opens Pi and a normal shell workspace.

This preserves the shell-first model while upgrading the visible operator interface.

### Bypass / recovery flow

If recovery or debugging is needed:

1. the operator sets a bypass env var, for example `NIXPI_NO_ZELLIJ=1`,
2. the shell bridge detects the bypass,
3. autostart is skipped,
4. the operator remains in a plain shell.

This must remain a first-class supported path.

### Advanced package flow

If `packageMode = "native-patched"`:

1. NixPI builds its own Zellij derivation,
2. plugin artifacts are built as derivations,
3. the final Zellij package is patched to include the desired plugin assets,
4. the terminal UI module switches to that package transparently.

This is fully declarative and reproducible, but should remain an optional advanced path until the base integration is stable.

## Default UX recommendation

The initial default workspace should stay intentionally simple.

### Recommended layout

- **Tab 1: Pi**
  - main pane launches `pi`
- **Tab 2: Shell**
  - normal interactive shell

This gives operators an immediate guided entrypoint while preserving a familiar shell context.

### Recommended session behavior

- `attachExistingSession = true`
- `exitShellOnExit = false`
- autostart on `ssh` and `tty`
- explicit bypass env var enabled
- fallback to plain shell if launch fails

This combination favors continuity and safety over aggressive appliance behavior.

## Error handling and safety

### Autostart guards

Only launch Zellij when all of the following are true:

- the session is interactive,
- Zellij is enabled,
- the interface is configured as default,
- the shell is not already inside Zellij,
- the bypass env var is not set,
- the session type matches the configured policy (`ssh`, `tty`, or both).

Additional conservative checks are acceptable if needed for terminal capability or environment sanity.

### Failure fallback

If Zellij fails to start:

- print a short operator-facing warning,
- remain in a plain shell,
- do not loop,
- do not lock the user out of recovery.

### Recovery-first rule

Do **not** make Zellij the only possible shell path by replacing the user shell with an unconditional hard wrapper. Prefer a conditional exec from shell/session init or another similarly recoverable bridge.

## Testing strategy

### 1. Package validation

For the optional advanced package mode:

- verify `pkgs.zellij` mode builds and resolves,
- verify the native-patched package builds when enabled,
- verify `zellij --version` works,
- verify expected plugin assets exist in outputs if patching is enabled.

### 2. Module evaluation checks

Add checks that confirm:

- the terminal UI module evaluates in the retained host configurations,
- selected package modes resolve correctly,
- generated config/layout artifacts are present when enabled,
- shell bridge wiring is absent when the feature is disabled.

### 3. Runtime / integration tests

Add focused NixOS tests for:

- default login path reaches the Zellij policy path,
- bypass path yields a plain shell,
- generated layout contains the Pi launch command,
- launch failure falls back to a usable shell.

The first iteration should stay structural and focused. Full TUI automation is not required to validate the design.

## Rollout strategy

Implement in phases:

### Phase 1: declarative terminal UI foundation

- add terminal UI option declarations,
- add the main terminal UI module,
- use `pkgs.zellij`,
- generate config/layout declaratively,
- add the shell/session bridge,
- add bypass/fallback tests.

### Phase 2: guided Pi integration hardening

- refine the default Pi-oriented layout,
- add stable session naming if useful,
- improve docs and operator guidance,
- extend tests.

### Phase 3: optional native-patched package mode

- add `core/os/pkgs/zellij/` packaging,
- replicate the useful `zellij-nix` source-build/patch concepts,
- expose `packageMode = "native-patched"`,
- verify plugin asset integrity in checks.

This sequence keeps the product benefit available quickly without forcing custom packaging work onto the first implementation step.

## Success criteria

A maintainer should be able to verify that:

- NixPI has a first-class declarative terminal UI module,
- Zellij is the default operator-facing terminal interface,
- both SSH and local tty sessions follow the same policy by default,
- Pi opens as part of the default guided workspace,
- a plain-shell bypass remains available and documented,
- the implementation does not depend on Home Manager,
- the implementation does not depend on the `zellij-nix` flake,
- optional advanced packaging can be added natively later without redesigning the module boundary.

## References used for this design

- Local NixPI runtime/session files:
  - `core/os/modules/shell.nix`
  - `core/os/modules/app.nix`
  - `core/os/modules/module-sets.nix`
  - `core/os/hosts/vps.nix`
  - `docs/reference/daemon-architecture.md`
  - `docs/reference/service-architecture.md`
- External reference repository:
  - `https://github.com/a-kenji/zellij-nix`
  - `https://raw.githubusercontent.com/a-kenji/zellij-nix/main/flake.nix`
  - `https://raw.githubusercontent.com/a-kenji/zellij-nix/main/default-plugins.nix`
  - `https://raw.githubusercontent.com/a-kenji/zellij-nix/main/external-plugins.nix`
- Home Manager Zellij module used only as declarative config inspiration:
  - `https://raw.githubusercontent.com/nix-community/home-manager/master/modules/programs/zellij.nix`
