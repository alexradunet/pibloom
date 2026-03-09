# First-Boot Setup Wizard Design

**Date**: 2026-03-09
**Status**: Approved

## Overview

Replace the bash setup wizard (`bloom-setup.sh`) with a fully AI-guided first-boot experience. Pi guides the user through everything from first boot, powered by a bundled local LLM (Qwen3.5-4B). No API key, no bash wizard, no manual steps — plug in, boot, Pi speaks first.

**Target hardware**: Beelink EQ14 — Intel N150, 16GB RAM, 500GB SSD, x86_64.

## OS Image Changes

### Bundled AI Models

- **llama.cpp** binary compiled for x86_64, installed to `/usr/local/bin/`
- **Qwen3.5-4B GGUF** (`unsloth/Qwen3.5-4B-GGUF`, Q4_0 or IQ4_XS, ~2.5GB) at `/usr/local/share/bloom/models/`
- **whisper.cpp** binary + whisper-small model (~150MB) at `/usr/local/share/bloom/models/`
- Total image size: ~4.7GB (base ~2GB + models ~2.7GB)

### Systemd Services

- `bloom-llm-local.service` — system-level oneshot/simple service
  - Starts llama.cpp server on `127.0.0.1:8080`
  - Runs as dedicated `llm` user (not root)
  - `Before=getty@tty1.service` — ready before auto-login
  - Can be stopped to free RAM when user switches to cloud provider
- `bloom-whisper-local.service` — same pattern, started on demand during setup

### Branding

- `/etc/issue`: `Bloom OS\n` (no Fedora, no kernel info)
- `/etc/hostname`: `bloom` (NetBird peer name, SSH prompt: `pi@bloom`)
- `/etc/motd`: Empty (greeting happens inside Pi)
- Login prompt shows: `bloom login:`

### Login Flow

- Auto-login enabled on VT1 from the start (no password phase)
- `.bash_profile` sets env vars and runs `exec pi`
- No greeting script logic — Pi handles everything

### Removed

- `os/sysconfig/bloom-setup.sh` — deleted entirely
- `bloom-setup.service` — deleted entirely
- All bash wizard functionality moves into Pi

## Extension: `bloom-setup`

### Structure

```
extensions/bloom-setup/
  index.ts    — registers tools, injects first-boot skill when setup incomplete
  actions.ts  — tool handlers, state management
  types.ts    — step definitions, state schema
```

### State File

`~/.bloom/setup-state.json`:

```json
{
  "version": 1,
  "startedAt": "2026-03-09T...",
  "completedAt": null,
  "steps": {
    "welcome":      { "status": "pending" },
    "network":      { "status": "pending" },
    "netbird":      { "status": "pending" },
    "password":     { "status": "pending" },
    "connectivity": { "status": "pending" },
    "webdav":       { "status": "pending" },
    "channels":     { "status": "pending" },
    "whisper":      { "status": "pending" },
    "llm_upgrade":  { "status": "pending" },
    "git_identity": { "status": "pending" },
    "contributing": { "status": "pending" },
    "persona":      { "status": "pending" },
    "test_message": { "status": "pending" },
    "complete":     { "status": "pending" }
  }
}
```

Step statuses: `pending`, `in_progress`, `completed`, `skipped`.

### Tools

| Tool | Purpose |
|------|---------|
| `setup_status()` | Returns current state, which step is next |
| `setup_advance(step, result)` | Marks step completed/skipped, returns next step instructions |
| `setup_reset(step?)` | Re-run a specific step or full reset |

### Behavior

1. On Pi startup, extension checks for `~/.bloom/.setup-complete`
2. If missing, loads/creates `setup-state.json`, injects first-boot skill into system prompt
3. Registers `bloom-local` provider pointing to local llama.cpp server
4. Pi calls `setup_status()` to know where to start/resume
5. After each step, Pi calls `setup_advance()` which persists state and returns next step guidance
6. On final step, extension touches `~/.bloom/.setup-complete` and stops injecting the skill

### Local Model Registration

```typescript
pi.registerProvider("bloom-local", {
  baseUrl: "http://localhost:8080/v1",
  apiKey: "local",
  api: "openai-completions",
  models: [{
    id: "qwen3.5-4b",
    name: "Qwen 3.5 4B (local)",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131072,
    maxTokens: 8192
  }]
});
```

## Skill: `skills/first-boot/SKILL.md`

Rewritten to work with the `bloom-setup` extension. The skill tells Pi *how* to talk to the user; the extension tells Pi *what* step is next.

### Setup Flow (15 Steps)

| # | Step | Pi says/does | Tools used |
|---|------|-------------|------------|
| 1 | **welcome** | Introduces Bloom, Pi, self-evolution. 2-3 short messages, not a wall of text. | `setup_advance` |
| 2 | **network** | Checks `nmcli` for connectivity. If no network, scans WiFi, asks user to pick. | Bash: `nmcli` |
| 3 | **netbird** | Explains mesh networking, asks for setup key, runs `netbird up`. | Bash: `netbird` |
| 4 | **password** | "Before we open remote access, let's set a password." Runs `passwd`. | Bash: `passwd` |
| 5 | **connectivity** | Shows mesh IP, explains localhost vs remote access. | `setup_advance` |
| 6 | **webdav** | "Want a file server? WebDAV lets you access files from any device." | `service_install`, `manifest_set_service` |
| 7 | **channels** | "WhatsApp, Signal, both, or neither?" Installs chosen, QR pairing. | `service_install`, `service_pair` |
| 8 | **whisper** | "Want voice message support on your channels?" Enables whisper service. | `service_install` |
| 9 | **llm_upgrade** | "Want to add a cloud provider?" Options: API key, `/login` OAuth, or keep local. | `/login` or config write |
| 10 | **git_identity** | Asks name + email, runs `git config`. | Bash: `git config` |
| 11 | **contributing** | Explains how to contribute extensions/services, share your bloom. Informational. | `setup_advance` |
| 12 | **persona** | Conversational SOUL/BODY/FACULTY customization. Natural Q&A, one question at a time. | File edits to `~/Bloom/Persona/` |
| 13 | **test_message** | Sends "Hi. Can you hear me?" on connected channel. | `channel_send` |
| 14 | **complete** | "You're all set!" Touches sentinel. | `setup_advance` |

### Persona Customization Details

- **SOUL**: "What should I call you?", formality, values/principles
- **BODY**: Channel adaptation preferences (short on mobile, long on terminal)
- **FACULTY**: Reasoning style (step-by-step vs quick and direct)
- **SKILL**: Skipped — populated as user installs skills over time
- Fully skippable, revisitable anytime

### Step Behavior

- User can say "skip" at any step
- If interrupted (reboot, ctrl+c), state persists, resumes on next login
- Tone: warm, conversational, one thing at a time, never overwhelming

## Bash Wizard Migration

| Current bash wizard | New location | Notes |
|---|---|---|
| WiFi scanner + connect | Pi calls `nmcli` via bash tool | Conversational, not TUI menu |
| Password creation | Pi calls `passwd` via sudo | At NetBird step, not upfront |
| NetBird setup | Pi calls `netbird up` via sudo | Same commands, conversational |
| Firewall hardening | `bloom-setup` extension, automatic | `firewall-cmd` after NetBird, no user interaction |
| SSH config | Baked into OS image | `sshd_config` hardening in Containerfile |
| Sentinel file | `~/.bloom/.setup-complete` | Managed by extension |
| Auto-login drop-in | Baked into OS image | Always on, no password phase |

## Escape Hatch

If Pi fails to start (broken model, out of RAM):
- User is still auto-logged in
- `ctrl+c` drops to shell
- Can manually run `nmcli`, `netbird`, `passwd`, etc.
- Can set API key env var and restart Pi

## LLM Lifecycle

- First boot: local Qwen3.5-4B serves Pi via `bloom-llm-local.service`
- During setup: user can add cloud provider (API key or OAuth)
- After switch: Pi offers to stop local model to free RAM
- Local model can be restarted anytime if cloud becomes unavailable
