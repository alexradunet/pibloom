# Bootstrap Disable Safety Check — Design Spec

**Date:** 2026-04-10
**Status:** Approved

## Problem

When the pi coding agent edits `nixpi-host.nix` to set `nixpi.bootstrap.enable = false`, the system loses passwordless sudo and (if not explicitly retained) SSH access. This can lock the operator out with no recovery path short of physical/OVH console access.

There are no runtime guards preventing this — only a build-time NixOS assertion that SSH requires `allowedSourceCIDRs` when bootstrap SSH is enabled.

## Goal

When the agent sets `bootstrap.enable = false` in any `.nix` file, block the edit and guide the user to add the missing steady-state access config before proceeding.

## Scope

- **In scope:** Detecting and blocking unsafe bootstrap disable edits; generating a targeted warning message
- **Out of scope:** Build-time NixOS assertions (already exist), sudo path validation (broker is always present in steady-state), auto-fixing the config

## Design

### Where

A new `tool_call` hook added to the OS extension:
`core/pi/extensions/os/index.ts`

This is the right home — the OS extension already owns NixOS lifecycle (`nixos_update`), and bootstrap disable is an OS lifecycle concern.

### When It Fires

The hook activates on `edit` and `write` tool calls where:
1. The target file path matches `nixpi-host.nix` or any `/etc/nixos/*.nix` path
2. The **post-edit** file content contains `bootstrap.enable = false`

### Post-Edit Content Reconstruction

- **`write` tool:** New content is directly available in `event.input.content`
- **`edit` tool:** Read current file from disk, apply `old_string → new_string` replacement in memory to get post-edit content

### Safety Checks

Two regex checks run against the full post-edit content:

| Check | Passes if post-edit content matches |
|-------|-------------------------------------|
| SSH enabled | `services\.openssh\.enable\s*=\s*true` OR `bootstrap\.ssh\.enable\s*=\s*true` |
| CIDRs configured | `allowedSourceCIDRs\s*=\s*\[` followed by at least one non-whitespace token before `]` |

Note: Sudo access path is not checked — `nixpi-brokerctl` is always present and functional in steady-state.

### Block Behaviour

If either check fails, the edit is blocked and the agent receives a reason message:

```
⚠ Disabling bootstrap will remove passwordless sudo and may close SSH.

Before this edit can proceed, add the following to your config:

  services.openssh.enable = true;               ← only if SSH check failed
  nixpi.security.ssh.allowedSourceCIDRs = [ "YOUR_IP/32" ];  ← only if CIDRs check failed

Add these lines to nixpi-host.nix, then retry.
```

Only the failing checks are listed. If both pass, the edit proceeds normally.

## Key Files

| File | Change |
|------|--------|
| `core/pi/extensions/os/index.ts` | Add `tool_call` hook |
| `core/pi/extensions/os/actions.ts` | Add `checkBootstrapDisable(filePath, postEditContent)` helper |

## Out of Scope (Deliberately)

- Auto-patching the config — the user must make the change explicitly
- Checking sudo path — steady-state always has broker access
- NixOS build-time assertions — already exist in `network.nix`
