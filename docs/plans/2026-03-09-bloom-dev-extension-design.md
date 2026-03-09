# bloom-dev Extension Design

**Date**: 2026-03-09
**Status**: Approved

## Problem

Bloom runs on mini-PCs as an immutable Fedora bootc image. When issues arise on a live device, there's no streamlined way to fix code, rebuild the OS locally, test it, and contribute the fix upstream. The existing `bloom-repo` and `bloom-os` extensions provide primitives (git sync, bootc upgrade), but there's no unified developer workflow that ties them together.

## Goals

- Enable on-device development via SSH, Pi, Claude Code, or a web-based code editor
- Support fast local OS iteration (build + switch + rollback) without waiting for CI
- Allow contributors to push skills, services, and extensions upstream via PRs
- Support installing community Pi packages from the registry
- Gate dev tools behind an opt-in so casual users aren't overwhelmed
- Design for open-source contributors, even though it's single-user for now

## Non-Goals

- Replacing CI as the final validation gate (CI still required before merge)
- Auto-merging PRs or bypassing review
- Running dev tools as root or outside the user session

## Design

### Activation Gate

Dev mode is **opt-in**, controlled by a sentinel file `~/.bloom/.dev-enabled`.

- During first-boot setup, the `contributing` step (step 11) asks the user if they want to enable dev tools
- If accepted: sentinel is written, code-server service is installed, repo is configured via `bloom_repo`
- If declined: only `dev_enable` and `dev_status` tools are registered, user can activate later
- `dev_disable` removes the sentinel and stops code-server

Dev mode is **orthogonal to self-evolution**. Persona evolution, skill creation, and service installs remain always available. Dev mode gates the "push upstream" and "rebuild OS" capabilities.

### Extension Structure

```
extensions/bloom-dev/
  index.ts          # Register tools, gate on sentinel
  actions.ts        # Tool handler implementations
  types.ts          # Type definitions
```

Follows the standard extension pattern: `export default function(pi: ExtensionAPI) { ... }`.

### Tools

#### Always Registered (regardless of dev mode)

| Tool | Purpose |
|------|---------|
| `dev_enable` | Write sentinel, install code-server, configure repo |
| `dev_disable` | Remove sentinel, stop code-server |
| `dev_status` | Show dev environment state (enabled? repo configured? code-server running? local build?) |

#### Dev Mode Only

| Tool | Purpose |
|------|---------|
| `dev_code_server` | Start/stop/restart the code-server service |
| `dev_build` | Local OS image build (`podman build` on-device from local repo) |
| `dev_switch` | `bootc switch` to locally-built image (stages for reboot) |
| `dev_rollback` | `bootc rollback` to previous image |
| `dev_loop` | Full cycle: build -> switch -> reboot -> health check -> report |
| `dev_test` | Run `npm run test` + `npm run check` on local repo |
| `dev_submit_pr` | Create branch, commit, push, open PR with test results in body |
| `dev_push_skill` | Copy skill from `~/Bloom/Skills/` into local repo `skills/`, submit as PR |
| `dev_push_service` | Copy service recipe (Containerfile + quadlet + catalog entry) into local repo, submit as PR |
| `dev_push_extension` | Copy extension from local dev into local repo `extensions/`, submit as PR |
| `dev_install_package` | Install Pi package from community registry or git/local source |

### New Service: bloom-code-server

```
services/code-server/
  Containerfile               # FROM codercom/code-server, no auth (NetBird perimeter)
  quadlet/
    bloom-code-server.container
```

**Catalog entry** in `services/catalog.yaml`:
- **Image**: codercom/code-server (pinned tag, no `latest`)
- **Port**: 8443
- **Auth**: None (NetBird mesh VPN is the access perimeter)
- **Volume**: User home directory as workspace
- **Network**: `bloom.network`
- **Health check**: HTTP GET on port 8443

### Data Flows

#### Local OS Iteration

```
dev_build
  -> podman build -f ~/.bloom/pi-bloom/os/Containerfile -t localhost/bloom:dev
  -> reports success/failure + image size

dev_switch
  -> sudo bootc switch --transport containers-storage localhost/bloom:dev
  -> stages update for next reboot

reboot -> boot into new image -> health check

dev_rollback (if broken)
  -> sudo bootc rollback
  -> reboot to previous known-good image
```

#### Contribution Flow (skills, services, extensions)

```
dev_push_skill / dev_push_service / dev_push_extension
  -> copies artifact from ~/Bloom/ or local dev path
  -> into ~/.bloom/pi-bloom/ at the correct conventional path
  -> dev_test validates build + lint pass
  -> dev_submit_pr opens PR with auto-populated description + test output
  -> CI validates on GitHub
  -> maintainer reviews and merges
  -> other devices pull via bootc upgrade
```

#### Community Package Installation

```
dev_install_package(source: "npm:@scope/package")
  -> wraps `pi install npm:@scope/package`
  -> supports all Pi source formats: npm:, git:, https://, local paths
  -> verifies package loaded via pi config
```

### Setup Integration

The `contributing` step (step 11) in `bloom-setup` changes from informational text to an interactive prompt:

1. Pi explains what dev tools enable (web editor, local OS builds, upstream contributions)
2. Asks: "Would you like to enable developer tools?"
3. If yes -> calls `dev_enable` which writes sentinel, installs code-server, runs `bloom_repo(action: "configure")`
4. If no -> skips, user can run `dev_enable` later

### Integration with Existing Extensions

- **bloom-repo**: `dev_submit_pr` delegates to `bloom_repo_submit_pr`, adding test results and build status metadata
- **bloom-os**: `dev_build` and `dev_switch` use the same bootc primitives as `bloom-os` actions
- **bloom-services**: code-server service follows the same Quadlet pattern, added to catalog
- **bloom-garden**: `dev_push_skill` reads from the same `~/Bloom/Skills/` that `skill_create` writes to

### Availability Diagram

```
Always available (all users):
  persona_evolve       — modify persona layers
  skill_create         — create local skills
  skill_list           — list skills
  service_install      — install services from catalog
  manifest_apply       — sync manifest
  dev_enable           — opt into dev mode
  dev_status           — check dev state

Dev mode only (contributors):
  dev_code_server      — web editor
  dev_build            — local OS build
  dev_switch           — switch to local image
  dev_rollback         — revert to previous image
  dev_loop             — full rebuild cycle
  dev_test             — run tests + lint
  dev_push_skill       — contribute skill upstream
  dev_push_service     — contribute service upstream
  dev_push_extension   — contribute extension upstream
  dev_install_package  — install community packages
  dev_submit_pr        — open PR with test results
```

## Security Considerations

- code-server has **no password auth** — relies entirely on NetBird mesh VPN for access control
- `dev_build` and `dev_switch` require sudo (bootc operations) — gated by dev mode opt-in
- `dev_submit_pr` never pushes to main — always creates feature branches
- Community packages from `pi install` run with full system access — same trust model as Pi itself
- Guardrails (guardrails.yaml) still apply within dev mode — no force pushes, no destructive operations

## Testing Strategy

- Unit tests for action handlers (build command generation, sentinel file management, artifact copying)
- Integration: code-server Quadlet starts and responds on 8443
- Integration: `dev_build` produces a valid container image
- Integration: `dev_push_skill` correctly stages a skill file and creates a PR
- Setup flow: contributing step correctly gates on user choice
