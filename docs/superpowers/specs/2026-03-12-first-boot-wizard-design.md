# First-Boot Wizard: Move Deterministic Setup Out of Pi

**Date**: 2026-03-12
**Status**: Draft
**Approach**: Shell script with step checkpointing (Approach B)

## Problem

Pi currently guides users through an 11-step first-boot wizard conversationally. Most steps are mechanical and deterministic — collecting a NetBird setup key, creating Matrix accounts, running `git config`. Using an LLM for these tasks is:

- **Unreliable** — LLM may hallucinate commands or skip steps
- **Slow** — each step requires a round-trip through the model
- **Offline-hostile** — requires a working LLM provider before basic OS config
- **Poor UX** — a chat interface is the wrong tool for collecting structured input

## Solution

Split first boot into two phases:

1. **Wizard** (`bloom-wizard.sh`) — a bash script that handles all deterministic, mechanical setup steps using `read -p` prompts
2. **Pi** — handles persona customization and welcome/orientation (the parts that benefit from conversation)

## Design Decisions

- **Setup key only for NetBird** — no URL auth flow. User comes prepared with a key from the NetBird dashboard. Simpler, fully scriptable, works headless.
- **Remove NetBird DNS/API token feature entirely** — the `*.bloom.mesh` subdomain routing, zone management, and API token storage are removed. Services are accessed by IP.
- **Matrix username prompt** — wizard asks the user to choose a Matrix username (creates `@<chosen>:bloom`). Matrix user IDs are immutable, so this is the one chance to get it right.
- **Services as y/n prompts** — dufs and Cinny are offered, not auto-installed. User might want a minimal setup.
- **Password change mandatory** — the OS image ships with a known default password.
- **Shell script with `read -p`** — zero dependencies, works on serial console, SSH, and VT. No TUI libraries.

## Wizard Flow

The wizard runs on first login, before Pi starts. It presents 7 steps:

### Step 1: Welcome

```
Welcome to Bloom OS.
Let's configure your device. This takes a few minutes.
Press Ctrl+C at any time to abort — you'll resume where you left off next login.
```

### Step 2: Password Change

```
First, let's change the default password.
```
Runs `passwd`. If the user Ctrl+C's or it fails, re-prompts. Marks done only on success.

### Step 3: Network Check

Tests connectivity with `ping -c1 -W5 1.1.1.1`.
- If online: prints "Network connected." and advances.
- If offline: prompts for WiFi SSID and password, connects with `nmcli device wifi connect <SSID> password <PSK>`, retries ping.

### Step 4: NetBird

```
NetBird creates a private mesh network so you can access this device from anywhere.
You'll need a setup key from your NetBird dashboard (app.netbird.io → Setup Keys).

Setup key:
```
Runs `sudo netbird up --setup-key <KEY>`. Verifies with:
- `netbird status | grep -q "Connected"` for connection state
- `netbird status | grep -oP 'NetBird IP:\s+\K[\d.]+'` for mesh IP extraction

On failure, prints the error and re-prompts. Stores the mesh IP in the checkpoint file for later display.

### Step 5: Matrix Accounts

This step is mostly automatic with one prompt:

```
Setting up Matrix messaging...

Choose a username for your Matrix account
(this cannot be changed later):
```

Then automatically:
1. Waits for `bloom-matrix.service` to be active (up to 30s)
2. Reads registration token from `/var/lib/continuwuity/registration_token`
3. Registers `@pi:bloom` bot account via Matrix `/_matrix/client/v3/register` API
4. Registers `@<username>:bloom` user account via same API
5. Stores credentials in `~/.pi/matrix-credentials.json`:
   ```json
   {
     "homeserver": "http://localhost:6167",
     "botUserId": "@pi:bloom",
     "botAccessToken": "<token>",
     "botPassword": "<generated>",
     "userUserId": "@<username>:bloom",
     "userPassword": "<generated>",
     "registrationToken": "<token>"
   }
   ```
6. Creates `#general:bloom` room, invites + joins the user
7. Prints: "Matrix ready. Your password: <password>"

Generated passwords use `openssl rand -base64url 24` (32 chars, base64url-safe — no `+` or `/` to cause shell quoting issues). Matches `lib/matrix.ts` which uses `randomBytes(24).toString("base64url")`.

#### Matrix UIA Registration Flow

Each account registration requires a two-step UIA (User-Interactive Authentication) flow (see `lib/matrix.ts` for the canonical TypeScript implementation):

**Step 1** — POST to `/_matrix/client/v3/register` with `{"username": "<name>", "password": "<pw>", "auth": {}, "inhibit_login": false}`. This returns HTTP 401 with a `session` ID.

**Step 2** — POST again to the same endpoint with `{"username": "<name>", "password": "<pw>", "inhibit_login": false, "auth": {"type": "m.login.registration_token", "token": "<reg_token>", "session": "<session>"}}`. This returns 200 with `user_id` and `access_token`.

In bash, this is two `curl` calls per account. The wizard parses the session ID from the 401 JSON response using a simple `grep`/`sed` or lightweight JSON extraction.

#### Room Creation

The `@pi:bloom` bot creates the room via `POST /_matrix/client/v3/createRoom` with `{"room_alias_name": "general", "invite": ["@<username>:bloom"]}` using the bot's access token. The user then joins via `POST /_matrix/client/v3/join/%23general%3Abloom` using their access token.

### Step 6: Git Identity

```
Git identity (for commits and contributions):

Your name:
Email:
```
Runs `git config --global user.name` and `git config --global user.email`.

### Step 7: Services

```
Optional services:

Install dufs file server? (access files from any device via WebDAV) [y/N]:
Install Cinny Matrix client? (web-based Matrix chat) [y/N]:
```

For each "yes", the wizard replicates the install logic from `service-io.ts` `installServicePackage()`:

1. Copies Quadlet files from the service's `quadlet/` directory to their correct destinations:
   - `.container` files → `~/.config/containers/systemd/`
   - `.socket` files → `~/.config/systemd/user/` (different destination — matches TypeScript routing)
2. Copies config files (`.json`, `.toml`) to `~/.config/bloom/`
   - For `cinny-config.json`: templates the homeserver list to `["http://localhost:6167"]` (replaces default)
3. Creates empty env file at `~/.config/bloom/<name>.env` if missing
4. Copies SKILL.md to `~/Bloom/Skills/<name>/`
5. Removes stale socket units if the package no longer includes one
6. Runs `systemctl --user daemon-reload && systemctl --user enable --now bloom-<name>.service`

The source service packages are at `/usr/local/share/bloom/services/<name>/` (baked into the OS image).

### Finalization

After all steps:
1. Touch `~/.bloom/.setup-complete`
2. Run `loginctl enable-linger $USER`
3. Run `systemctl --user enable --now pi-daemon.service`
4. Print summary:
   ```
   Setup complete!

   Mesh IP: <ip> (access from any NetBird peer)
   Matrix user: @<username>:bloom (password shown above)
   Services: dufs, cinny (or "none")

   Starting Pi — your AI companion will help you personalize your experience.
   ```

## State Management

**Checkpoint directory**: `~/.bloom/wizard-state/`

Each completed step writes a marker file:
- `~/.bloom/wizard-state/welcome`
- `~/.bloom/wizard-state/password`
- `~/.bloom/wizard-state/network`
- `~/.bloom/wizard-state/netbird` (also stores mesh IP)
- `~/.bloom/wizard-state/matrix`
- `~/.bloom/wizard-state/git`
- `~/.bloom/wizard-state/services`

Marker files contain the completion timestamp. Some also store output data (e.g., netbird stores the mesh IP).

**Resume behavior**: On script start, check each marker. Skip completed steps, print "Resuming setup..." if any exist.

**Failure handling**: If a step fails, print the error and re-prompt. Ctrl+C aborts the wizard — next login resumes from the failed step.

## Integration

### `.bash_profile` Change

```bash
# Source .bashrc for env vars
[ -f ~/.bashrc ] && . ~/.bashrc

# First-boot wizard (runs once, before Pi — must run BEFORE Zellij since exec replaces shell)
if [ -t 0 ] && [ ! -f "$HOME/.bloom/.setup-complete" ]; then
  /usr/local/bin/bloom-wizard.sh
fi

# Auto-launch Zellij on interactive SSH login (only after setup is complete)
if [ -t 0 ] && [ -n "$SSH_CONNECTION" ] && [ -z "$ZELLIJ" ] && [ -z "$BLOOM_NO_ZELLIJ" ]; then
  if zellij list-sessions 2>/dev/null | grep -q '^bloom$'; then
    exec zellij attach bloom
  else
    exec zellij -s bloom -l bloom
  fi
fi

# Start Pi on interactive login
if [ -t 0 ] && [ -z "$PI_SESSION" ] && mkdir /tmp/.bloom-pi-session 2>/dev/null; then
  trap 'rmdir /tmp/.bloom-pi-session 2>/dev/null' EXIT
  export PI_SESSION=1
  /usr/local/bin/bloom-greeting.sh
  exec pi
fi
```

### Pi Handoff

After the wizard completes, Pi starts normally. The `bloom-setup` extension is simplified:

- Checks if `~/.bloom/.setup-complete` exists (wizard did this)
- Checks if `~/.bloom/wizard-state/persona-done` exists
- If setup complete but persona not done: injects persona customization skill into system prompt
- If both done: normal startup

Pi handles:
- **Persona customization** — conversational: "What should I call you?", formality, values, reasoning style
- **Welcome/orientation** — introduce what's available, how to reach Pi on Matrix, etc.

### bloom-setup Extension Simplification

The extension shrinks significantly:

**Steps reduced to**: `persona`, `complete` (2 steps, down from 11)

**Removed tools**: None — `setup_status`, `setup_advance`, `setup_reset` still work for the remaining steps.

**`lib/setup.ts`**: `STEP_ORDER` shrinks to `["persona", "complete"]`.

**`step-guidance.ts`**: Only persona and complete guidance remain.

**`actions.ts`**: `touchSetupComplete()` is simplified — it no longer needs to touch the sentinel file, enable linger, or start pi-daemon (the wizard already did all of that). It only marks the `persona-done` checkpoint file.

### Two State Systems

The wizard and the bloom-setup extension use **independent state systems**:

- **Wizard state**: `~/.bloom/wizard-state/` — bash checkpoint files, one per wizard step. Read only by the wizard for resume logic.
- **Extension state**: `~/.bloom/setup-state.json` — JSON file tracking persona + complete steps. Created by the bloom-setup extension when Pi first starts (not by the wizard).

The wizard does NOT write `setup-state.json`. The extension does NOT read `wizard-state/`. The only shared signal is `~/.bloom/.setup-complete` (written by wizard, read by extension and pi-daemon).

## Removals

### Files to Delete

- `lib/netbird.ts` — NetBird DNS zone/record management (feature removed entirely)
- `lib/service-routing.ts` — Orchestration layer built on `netbird.ts` (imports `ensureBloomZone`, `ensureServiceRecord`, etc.)
- `tests/lib/service-routing.test.ts` — Tests for the removed module

### Code to Remove

- All references to NetBird API token, `~/.config/bloom/netbird.env`, `~/.config/bloom/netbird-zone.json`
- DNS subdomain routing mentions in `skills/first-boot/SKILL.md`
- NetBird DNS references in `services/netbird/SKILL.md`
- Mechanical step guidance from `step-guidance.ts` (welcome, network, netbird, connectivity, webdav, matrix, git_identity, contributing, test_message)
- Corresponding step definitions from `lib/setup.ts`
- `ensureServiceRouting()` call from `extensions/bloom-services/actions-install.ts` (imports from deleted `lib/service-routing.ts`)

### Features Removed

- **NetBird DNS/API token management** — `*.bloom.mesh` subdomain routing. Services accessed by IP instead.
- **URL-based NetBird authentication** — setup key only.
- **Contributing/dev-tools step** — removed from first boot. User can enable later.
- **Test message step** — removed. Matrix setup is verified by the wizard.
- **Connectivity summary step** — folded into wizard's NetBird step output.

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `os/system_files/usr/local/bin/bloom-wizard.sh` | **Create** | The wizard script |
| `os/system_files/etc/skel/.bash_profile` | Modify | Add wizard gate before `exec pi` |
| `extensions/bloom-setup/index.ts` | Modify | Simplify to track persona only |
| `extensions/bloom-setup/actions.ts` | Modify | Remove mechanical steps |
| `extensions/bloom-setup/step-guidance.ts` | Modify | Keep only persona + complete guidance |
| `skills/first-boot/SKILL.md` | Rewrite | Cover only persona customization and welcome |
| `lib/setup.ts` | Modify | Shrink STEP_ORDER to persona + complete |
| `lib/netbird.ts` | **Delete** | DNS zone management removed |
| `lib/service-routing.ts` | **Delete** | Orchestration layer on netbird.ts — dead code |
| `tests/lib/service-routing.test.ts` | **Delete** | Tests for removed module |
| `extensions/bloom-services/actions-install.ts` | Modify | Remove `ensureServiceRouting()` import and call |
| `services/netbird/SKILL.md` | Modify | Update auth to setup-key only (remove URL auth) |
| `docs/pibloom-setup.md` | Modify | Reflect wizard + Pi split |
| Tests for removed code | Modify/Delete | Update test coverage |

## Testing

- **Wizard script**: Test in a VM with `just vm`. Run through full flow, test Ctrl+C resume, test each step in isolation.
- **bloom-setup extension**: Unit tests for simplified state machine (2 steps).
- **Integration**: Full first-boot test in QEMU — wizard runs, Pi starts, persona customization works.

## Open Questions

None — all decisions made during brainstorming.
