# ownloom Agent Contract

This document defines what an AI agent adapter must provide to participate in ownloom. PI is the only implemented adapter today; future adapters should satisfy the same contract without changing the shared ownloom core.

## Goals

- Keep ownloom capabilities independent of any one agent harness.
- Put operational behavior in CLIs, not in agent-specific SDK code.
- Make a future agent adapter a small NixOS module plus prompt/hook files.
- Preserve PI as the default and only shipped agent for now.
- Keep scope NixOS-native for now. WSL, nix-darwin/macOS, standalone Home Manager, native Windows, and repo split are deferred.

## Shared core surface

The shared ownloom surface is CLI-first. An agent must be able to call these commands from its normal shell/tool environment:

- `ownloom-context --format markdown|json [--health]` — print live ownloom context for prompt injection.
- `ownloom-wiki` — search, inspect, ingest, lint, and update the Markdown wiki.
- `ownloom-planner` — manage live tasks, reminders, and calendar items through CalDAV/iCalendar.
- Standard Nix/Git/systemd tools — `git`, `nix flake check`, `nixos-rebuild`, and `systemctl` for repository, validation, deployment, and service work.

Operational workflows that used to be wrapper CLIs now live as skills under `os/skills/` (`ownloom-config`, `ownloom-svc`, `ownloom-reboot`, `ownloom-evolution`, and `ownloom-audit`). Safety and allowlist behavior belongs in the underlying NixOS config, sudo policy, systemd units, and shared CLIs. Agent adapters may add extra hooks, but must not be the only enforcement point.

## Context requirements

At session start, every agent should receive equivalent ownloom context:

- Current host identity and known fleet hosts.
- Canonical ownloom flake path.
- CLI tool contract and safety guidance.
- Wiki operating rules and tool usage guidance.
- Technical wiki digest.
- Memory/profile files and their editable paths.
- Planner infrastructure policy.
- Canonical Ownloom design-system policy: `DESIGN.md` / Digital Scoarță / Pixel Loom Minimalism.
- Upcoming planner digest.
- Any restored session/compaction context when the harness supports it.

The canonical dynamic context source is:

```bash
ownloom-context --format markdown
```

Adapters that support structured context may use:

```bash
ownloom-context --format json
```

## Tool behavior

Agents should prefer shared commands and skills over harness-specific tools:

- Use `ownloom-planner` for live tasks/reminders/events.
- Use `ownloom-wiki` for wiki operations rather than direct Markdown edits when structured mutation is available.
- Use `os/skills/ownloom-config/SKILL.md`, `ownloom-svc`, and `ownloom-reboot` skill workflows for privileged or allowlisted operations.
- Use raw shell for ordinary repository inspection, development commands, and the standard Nix/Git/systemd commands described by those skills.

PI currently keeps registered tools for the two UX-heavy domains where the TUI/tool-call experience still pays for itself:

- wiki tools, backed by the shared `ownloom-wiki` manifest/API.
- `ownloom_planner`, a thin wrapper over `ownloom-planner`.

All other PI operational tools were removed. Their replacements are standard shell workflows documented by `ownloom-context` and the skills in `os/skills/`.

## Guardrails

Agent adapters should enforce, where the harness supports it:

- Ask for explicit user confirmation before privileged actions, rebuilds, rollbacks, reboot scheduling, commit, push, or apply.
- Run `nix flake check --accept-flake-config` before `nixos-rebuild switch`.
- Use `git status --short` and `git diff --stat` before summarizing or changing repo/config state.
- Use `systemctl status <unit>` before service mutations.
- Block or redirect direct writes to protected wiki areas such as `raw/` and `meta/proposals/`.
- Prefer read-only diagnosis before mutation.
- Preserve the current host identity; never assume a different fleet host unless the user names it.
- For UI work, follow the canonical `DESIGN.md` system: Pico-first static UI, self-hosted assets, Digital Scoarță palette/typography, 4px rhythm, flat tonal layers, structural borders, and pixel-stitch motifs.

The shared CLIs must enforce critical allowlists so weaker future agents still inherit safety.

## Adapter checklist

A new agent adapter is viable when it can do the following without changing shared ownloom CLIs:

1. Install or reference the agent through a NixOS module.
2. Inject `ownloom-context --format markdown` or equivalent JSON-rendered context at session start.
3. Provide shell access to the shared `ownloom-*` CLIs and the standard Nix/Git/systemd commands used by the skills.
4. Preserve current host identity from context.
5. Respect planner policy: live tasks/reminders/events go through `ownloom-planner`, not wiki task pages.
6. Respect wiki policy: use `ownloom-wiki` for structured wiki writes and avoid protected paths.
7. Require explicit approval before privileged/destructive actions.
8. Provide a minimal session-end or maintenance path for wiki metadata rebuilds when the harness does not support hooks.
9. Add only adapter glue under an agent-specific path; do not fork shared behavior into the adapter.
10. Pass the relevant Nix flake checks and, if it drives PI-like tool calls, an end-to-end planner/wiki smoke test.

## Lifecycle mapping

A capable adapter should map these concepts to the host harness:

| ownloom concept | PI today | Future adapter examples |
|---|---|---|
| Session context | `before_agent_start` runs `ownloom-context` | Session-start hook, generated instruction file, system-prompt file |
| Tool/write guard | `tool_call` hook for wiki protected paths | Pre-tool hook, sandbox/permission profile, CLI enforcement |
| Memory update notice | `tool_result` hook | Post-tool hook, optional notification |
| Wiki metadata rebuild | `agent_end` hook | Session-end hook or explicit `ownloom-wiki mutate wiki_rebuild` maintenance |
| Compaction capture | `session_before_compact` hook | Pre/Post compact hook if available |
| Slash command | `registerCommand` | Skill, command file, or plain instruction |
| Rich tool UX | PI registered wiki/planner tools | Optional harness-native wrappers over CLIs/manifests |

Adapters are allowed to be asymmetric. Exact UI parity is less important than shared capability and shared safety.

## Adapter implementation rule

Adding a new agent should primarily add files under an agent-specific module/package directory and should not require changes to the core CLIs.

Current adapter package:

```text
os/pkgs/pi-adapter/
```

For now, the only active adapter is PI.
