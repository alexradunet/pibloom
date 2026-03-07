# Native NetBird + First-Boot Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Install NetBird as a native RPM system service (not a rootless container), convert WhatsApp to a native systemd user service, fix dufs/lemonade quadlet bugs, and update the first-boot flow so NetBird auth happens before Pi launches.

**Architecture:** NetBird moves from a rootless Podman container (which fundamentally cannot create WireGuard interfaces) to a system-level RPM service with real CAP_NET_ADMIN. WhatsApp moves from a custom GHCR container image (which doesn't exist publicly) to a native Node.js systemd user service, since Node.js and Chromium are already in the OS image. The boot flow changes: greetd -> sway -> foot terminal -> bloom-greeting.sh checks NetBird and prompts auth -> then `exec pi` for the rest of first-boot.

**Tech Stack:** Fedora bootc 42, systemd, NetBird RPM, Podman Quadlet, Node.js, whatsapp-web.js, Bash

**bootc conventions:**
- `/usr/` is the immutable layer — RPMs, systemd units, static config go here
- `/etc/` is for machine-local config, subject to 3-way merge on OS updates
- `/var/` is writable runtime state (logs, databases, user data)
- Prefer drop-in directories over modifying core configs
- Clean package manager caches after every `dnf install`
- `bootc container lint` validates the final image

---

### Task 1: Install NetBird RPM on OS Image

**Files:**
- Modify: `os/Containerfile:46-50` (add NetBird repo + install after VS Code block)

**Step 1: Add NetBird repo and install package**

In `os/Containerfile`, add a new block after the VS Code install block (after line 50). Follow the same pattern as VS Code (repo file + dnf install + cache cleanup):

```dockerfile
# Install NetBird (system-level mesh networking — needs real CAP_NET_ADMIN)
RUN printf '[netbird]\nname=netbird\nbaseurl=https://pkgs.netbird.io/yum/\nenabled=1\ngpgcheck=0\nrepo_gpgcheck=1\ngpgkey=https://pkgs.netbird.io/yum/repodata/repomd.xml.key\n' > /etc/yum.repos.d/netbird.repo && \
    dnf install -y netbird && \
    dnf clean all && \
    rm -rf /var/cache/libdnf5 /var/lib/dnf /var/log/dnf5.log /var/log/dnf.log /var/cache/ldconfig/aux-cache
RUN systemctl enable netbird
```

**Step 2: Build image to verify NetBird installs**

Run: `just build 2>&1 | tail -30`
Expected: Image builds successfully, `netbird` package installs from the YUM repo, `bootc container lint` passes.

**Step 3: Commit**

```bash
git add os/Containerfile
git commit -m "feat: install NetBird as native RPM system service

NetBird requires real CAP_NET_ADMIN for WireGuard interfaces.
Running as a rootless container caused 'operation not permitted'
errors for link/route creation. Installing as a system service
gives it proper kernel-level networking privileges."
```

---

### Task 2: Update Boot Flow for Pre-Pi NetBird Auth

**Files:**
- Modify: `os/sysconfig/bloom-greeting.sh` (add NetBird status check + auth prompt)

**Step 1: Update bloom-greeting.sh**

Replace the entire file with this version. Key changes:
- After the greeting message, check `netbird status`
- If not connected, run `sudo netbird up` and wait for auth
- Remove "NetBird mesh networking" from the setup items list (it's handled here now)
- Only then proceed to `exec pi` (which happens in `.bash_profile`)

```bash
#!/usr/bin/env bash
set -euo pipefail

# Bloom login script — ensures Pi settings include Bloom package, shows greeting,
# and handles NetBird authentication before Pi launches.

BLOOM_PKG="/usr/local/share/bloom"
PI_SETTINGS="$HOME/.pi/agent/settings.json"

# Ensure Pi settings include the Bloom package (idempotent, runs every login)
if [ -d "$BLOOM_PKG" ]; then
    mkdir -p "$(dirname "$PI_SETTINGS")"
    if [ -f "$PI_SETTINGS" ]; then
        if command -v jq >/dev/null 2>&1; then
            if ! jq -e '.packages // [] | index("'"$BLOOM_PKG"'")' "$PI_SETTINGS" >/dev/null 2>&1; then
                jq '.packages = ((.packages // []) + ["'"$BLOOM_PKG"'"] | unique)' "$PI_SETTINGS" > "${PI_SETTINGS}.tmp" && \
                    mv "${PI_SETTINGS}.tmp" "$PI_SETTINGS"
            fi
        fi
    else
        cp "$BLOOM_PKG/.pi/agent/settings.json" "$PI_SETTINGS"
    fi
fi

# First-boot greeting
FIRST_RUN_MARKER="$HOME/.bloom/.initialized"

if [ ! -f "$FIRST_RUN_MARKER" ]; then
    echo ""
    echo "  Welcome to Bloom"
    echo ""
    echo "  Your personal AI companion is starting for the first time."
    echo "  Pi will guide you through setup — just chat naturally."
    echo ""
    echo "  What Pi will help you configure:"
    echo "    - Git identity (name and email)"
    echo "    - dufs (home directory WebDAV access)"
    echo "    - Optional services:"
    echo "      - WhatsApp bridge"
    echo "      - Lemonade (local LLM + speech-to-text)"
    echo "    - Your preferences and name"
    echo ""

    mkdir -p "$(dirname "$FIRST_RUN_MARKER")"
    touch "$FIRST_RUN_MARKER"
else
    echo ""
    echo "  Bloom"
    echo ""
fi

# --- NetBird authentication (runs every login until connected) ---
if command -v netbird >/dev/null 2>&1; then
    # Check if NetBird is already connected
    if ! sudo netbird status 2>/dev/null | grep -q "Connected"; then
        echo "  NetBird mesh networking is not connected."
        echo "  This provides secure remote access to your Bloom device."
        echo ""
        echo "  Starting NetBird authentication..."
        echo ""
        # netbird up prints the auth URL for the user to visit
        sudo netbird up 2>&1 || true
        echo ""
        # Wait for connection (poll every 3s, timeout after 5 minutes)
        echo "  Waiting for NetBird to connect (open the URL above in a browser)..."
        for i in $(seq 1 100); do
            if sudo netbird status 2>/dev/null | grep -q "Connected"; then
                echo "  NetBird connected successfully!"
                echo ""
                break
            fi
            sleep 3
        done
        if ! sudo netbird status 2>/dev/null | grep -q "Connected"; then
            echo "  NetBird not yet connected. You can retry later with: sudo netbird up"
            echo ""
        fi
    fi
fi
```

**Step 2: Verify the script is syntactically valid**

Run: `bash -n os/sysconfig/bloom-greeting.sh && echo OK`
Expected: `OK`

**Step 3: Commit**

```bash
git add os/sysconfig/bloom-greeting.sh
git commit -m "feat: handle NetBird auth in greeting script before Pi launches

Check netbird status on every login. If not connected, run
sudo netbird up and wait for the user to authenticate via browser.
This ensures mesh networking is available before Pi starts."
```

---

### Task 3: Fix dufs Quadlet Issues

**Files:**
- Modify: `services/dufs/quadlet/bloom-dufs.container`

**Step 1: Fix the quadlet**

Three fixes:
1. Remove `:Z` from home directory mount — SELinux relabeling the entire home dir is wrong. Use `SecurityLabelDisable=true` instead.
2. Use `BLOOM_CHANNEL_TOKEN` as the WebDAV password — `service_install` already generates this token. No need for a separate `BLOOM_WEBDAV_PASSWORD`.
3. Remove curl-based health check — the dufs container is a minimal Rust binary without curl. Just remove it; `Restart=on-failure` is sufficient.

Replace the full file content:

```ini
[Unit]
Description=Bloom dufs — WebDAV file server for home directory
After=network-online.target
Wants=network-online.target

[Container]
Image=docker.io/sigoden/dufs:latest
ContainerName=bloom-dufs

# Host networking for NetBird mesh reachability
Network=host

# Serve the user's home directory (no SELinux relabel — use label=disable)
Volume=%h:/data

# WebDAV with full access, auth via channel token
Exec=/data -A -p 5000 --auth admin:${BLOOM_CHANNEL_TOKEN}@/:rw

# Auth credentials (generated by service_install)
EnvironmentFile=%h/.config/bloom/channel-tokens/dufs.env

PodmanArgs=--memory=128m
PodmanArgs=--security-opt label=disable
NoNewPrivileges=true
LogDriver=journald

[Service]
Restart=on-failure
RestartSec=10
TimeoutStartSec=60

[Install]
WantedBy=default.target
```

**Step 2: Commit**

```bash
git add services/dufs/quadlet/bloom-dufs.container
git commit -m "fix: dufs quadlet — remove :Z, use channel token, drop curl healthcheck

- Remove :Z from home mount (SELinux relabels entire homedir)
- Use SecurityLabelDisable=true instead
- Use BLOOM_CHANNEL_TOKEN as WebDAV password (already generated)
- Remove curl-based health check (curl not in dufs image)"
```

---

### Task 4: Fix Lemonade Quadlet Issues

**Files:**
- Modify: `services/lemonade/quadlet/bloom-lemonade.container`
- Modify: `os/sysconfig/bloom-tmpfiles.conf`

**Step 1: Fix lemonade quadlet**

Two fixes:
1. Remove `:Z` from media mount — use plain `ro` flag.
2. Remove `:Z` from model cache volume — named volumes don't need SELinux relabeling with label=disable.

Replace full file content:

```ini
[Unit]
Description=Bloom Lemonade — Local LLM + speech-to-text (OpenAI-compatible API)
After=network-online.target
Wants=network-online.target

[Container]
Image=ghcr.io/lemonade-sdk/lemonade-server:latest
ContainerName=bloom-lemonade

# Bridge network for isolation
Network=bloom.network

# Expose OpenAI-compatible API on localhost
PublishPort=127.0.0.1:8000:8000

# Model cache persists across restarts
Volume=bloom-lemonade-models:/root/.cache/huggingface

# Media files for transcription (read-only)
Volume=/var/lib/bloom/media:/media:ro

Environment=LEMONADE_LLAMACPP_BACKEND=cpu
PodmanArgs=--memory=4g
PodmanArgs=--security-opt label=disable
HealthCmd=curl -sf http://localhost:8000/health || exit 1
HealthInterval=30s
HealthRetries=3
HealthTimeout=10s
NoNewPrivileges=true
LogDriver=journald

[Service]
Restart=on-failure
RestartSec=10
TimeoutStartSec=600
TimeoutStopSec=30

[Install]
WantedBy=default.target
```

**Step 2: Add /var/lib/bloom/media to tmpfiles.d**

In `os/sysconfig/bloom-tmpfiles.conf`, add a line after the `/run/bloom` entry:

```
d /run/bloom 0770 root root -
d /var/lib/bloom 0755 root root -
d /var/lib/bloom/media 0755 root root -
```

This ensures the media directory exists at boot (created by systemd-tmpfiles, per bootc convention for `/var` content).

**Step 3: Commit**

```bash
git add services/lemonade/quadlet/bloom-lemonade.container os/sysconfig/bloom-tmpfiles.conf
git commit -m "fix: lemonade quadlet — remove :Z flags, add media dir to tmpfiles.d

- Remove :Z from media and model volume mounts
- Add SecurityLabelDisable=true
- Add /var/lib/bloom/media to tmpfiles.d (created at boot)"
```

---

### Task 5: Convert WhatsApp to Native Systemd Service

**Files:**
- Modify: `os/Containerfile` (add WhatsApp deps install + build step)
- Create: `os/sysconfig/bloom-whatsapp.service` (systemd user unit)
- Modify: `services/whatsapp/quadlet/bloom-whatsapp.container` (remove — no longer needed)

**Step 1: Add WhatsApp build step to Containerfile**

After the existing Bloom package build step (line 75), add:

```dockerfile
# Build WhatsApp transport (native service — no container image needed)
RUN cd /usr/local/share/bloom/services/whatsapp && \
    HOME=/tmp npm install --cache /tmp/npm-cache && \
    npm run build && \
    npm prune --omit=dev && \
    rm -rf /tmp/npm-cache /var/roothome/.npm /root/.npm
```

**Step 2: Create systemd user service unit**

Create `os/sysconfig/bloom-whatsapp.service`:

```ini
[Unit]
Description=Bloom WhatsApp Bridge (whatsapp-web.js)
After=graphical-session.target

[Service]
Type=simple
ExecStart=/usr/bin/node /usr/local/share/bloom/services/whatsapp/dist/transport.js

# Wayland display passthrough for Chromium
Environment=WAYLAND_DISPLAY=wayland-1
Environment=PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
Environment=PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
Environment=NODE_ENV=production

# Bloom service environment
Environment=BLOOM_AUTH_DIR=%h/.local/share/bloom-whatsapp
Environment=BLOOM_CHANNELS_SOCKET=/run/bloom/channels.sock
Environment=BLOOM_MEDIA_DIR=/var/lib/bloom/media

# Channel authentication token
EnvironmentFile=%h/.config/bloom/channel-tokens/whatsapp.env

Restart=on-failure
RestartSec=10
TimeoutStartSec=300

[Install]
WantedBy=default.target
```

**Step 3: Install the unit file in Containerfile**

Add to the Containerfile (after the bloom-greeting.sh section, around line 104):

```dockerfile
# WhatsApp bridge runs natively (Node.js + Chromium already in image)
COPY os/sysconfig/bloom-whatsapp.service /usr/lib/systemd/user/bloom-whatsapp.service
```

Note: the unit is installed but NOT enabled — the user enables it during first-boot setup if they want WhatsApp.

**Step 4: Delete container-only files**

Remove the files that are only needed for the container approach:

```bash
rm services/whatsapp/Containerfile
rm services/whatsapp/quadlet/bloom-whatsapp.container
rm services/whatsapp/quadlet/bloom-whatsapp-auth.volume
```

Keep `services/whatsapp/src/`, `services/whatsapp/package.json`, `services/whatsapp/SKILL.md` — these are still used for the native service.

**Step 5: Verify Chromium binary path**

The Containerfile installs `chromium` via DNF. Check the actual binary path:

Run: `rpm -ql chromium 2>/dev/null | grep bin/ || echo "check in VM"`

The binary is likely `/usr/bin/chromium-browser` or `/usr/bin/chromium`. Update `PUPPETEER_EXECUTABLE_PATH` in the service unit accordingly. On Fedora it is typically `/usr/bin/chromium-browser`.

**Step 6: Commit**

```bash
git add os/Containerfile os/sysconfig/bloom-whatsapp.service
git rm services/whatsapp/Containerfile services/whatsapp/quadlet/bloom-whatsapp.container services/whatsapp/quadlet/bloom-whatsapp-auth.volume
git commit -m "feat: convert WhatsApp to native systemd user service

Node.js and Chromium are already in the OS image. No need for a
custom container image (ghcr.io/pibloom/bloom-whatsapp didn't
exist publicly, causing 403 on first boot).

WhatsApp service unit installed to /usr/lib/systemd/user/ but
not enabled by default — user enables during first-boot setup."
```

---

### Task 6: Remove NetBird from Service Catalog and Quadlet Files

**Files:**
- Modify: `services/catalog.yaml` (remove netbird entry)
- Delete: `services/netbird/quadlet/bloom-netbird.container`
- Delete: `services/netbird/quadlet/bloom-netbird-state.volume`
- Modify: `services/netbird/SKILL.md` (update for native service)

**Step 1: Remove netbird from catalog.yaml**

Edit `services/catalog.yaml` to remove the entire `netbird:` block (lines 21-28).

**Step 2: Delete quadlet files**

```bash
rm services/netbird/quadlet/bloom-netbird.container
rm services/netbird/quadlet/bloom-netbird-state.volume
rmdir services/netbird/quadlet
```

**Step 3: Update NetBird SKILL.md for native service**

Replace `services/netbird/SKILL.md`:

```markdown
---
name: netbird
version: native
description: Secure mesh networking via NetBird (system service)
---

# NetBird

EU-hosted mesh networking for secure remote access to your Bloom device. Uses NetBird cloud management (free tier, up to 5 peers).

NetBird provides the security layer for remote desktop (wayvnc) and file access (dufs).

NetBird is installed as a native system service (not a container) because WireGuard requires real kernel-level CAP_NET_ADMIN.

## Setup

NetBird authentication is handled automatically during Bloom's login flow (before Pi starts). If you need to re-authenticate:

1. Check status: `sudo netbird status`
2. Authenticate: `sudo netbird up`
3. Follow the browser link to sign in at https://app.netbird.io

## Adding Peers

Install NetBird on your other devices (laptop, phone) from https://netbird.io/download and sign in with the same account. All devices on the same account can reach each other.

## Operations

- Status: `sudo netbird status`
- Logs: `sudo journalctl -u netbird -n 100`
- Stop: `sudo systemctl stop netbird`
- Start: `sudo systemctl start netbird`
```

**Step 4: Update catalog.yaml for WhatsApp**

Change the whatsapp entry in `services/catalog.yaml` to reflect it's a native service:

```yaml
  whatsapp:
    version: "0.2.0"
    category: communication
    optional: true
    native: true
    preflight:
      commands: [systemctl]
```

Remove the `artifact` and `image` fields since there's no container.

**Step 5: Commit**

```bash
git add services/catalog.yaml services/netbird/SKILL.md
git rm services/netbird/quadlet/bloom-netbird.container services/netbird/quadlet/bloom-netbird-state.volume
git commit -m "refactor: remove NetBird from service catalog, update to native service

NetBird is now a system RPM, not a container service.
Also update WhatsApp catalog entry to reflect native service."
```

---

### Task 7: Update First-Boot Skill

**Files:**
- Modify: `skills/first-boot/SKILL.md`

**Step 1: Update the skill**

Key changes:
- Remove NetBird setup step (handled pre-Pi in greeting script)
- Update WhatsApp to use `systemctl --user enable --now bloom-whatsapp` instead of container install
- Renumber steps: 1) Git Identity, 2) dufs Setup, 3) Optional Services, 4) Mark Complete

Replace full file content:

```markdown
---
name: first-boot
description: Guide the user through one-time Bloom system setup on a fresh install
---

# First-Boot Setup

Use this skill on the first session after a fresh Bloom OS install.

## Prerequisite Check

If `~/.bloom/.setup-complete` exists, setup is already complete. Skip unless user asks to re-run specific steps.

## Setup Style

- Be conversational (one step at a time)
- Let user skip/defer steps
- Prefer Bloom tools over long shell copy-paste blocks
- Clarify tool-vs-shell: `service_install`, `bloom_repo_configure`, etc. are Pi tools (not bash commands)
- On fresh Bloom OS, user `bloom` has passwordless `sudo` for bootstrap tasks.

## Pre-Requisite: NetBird

NetBird mesh networking is configured before Pi starts (during the login greeting). If the user skipped it, they can authenticate later:

```bash
sudo netbird up
```

Verify with `sudo netbird status` — look for "Connected".

## Setup Steps

### 1) Git Identity

Ask the user for their name and email, then set globally:

```bash
git config --global user.name "<name>"
git config --global user.email "<email>"
```

Suggest sensible defaults (e.g., hostname-based) but let the user choose.

### 2) dufs Setup

- Install service package: `service_install(name="dufs", version="0.1.0")`
- Validate service: `service_test(name="dufs")`
- The WebDAV password is the channel token in `~/.config/bloom/channel-tokens/dufs.env` (BLOOM_CHANNEL_TOKEN)
- Direct user to `http://localhost:5000` (username: `admin`)
- dufs serves `$HOME` over WebDAV (mapped in container as bind mount)

If Bloom runs inside a VM, `localhost` in the guest may not be reachable from the host machine.
Offer one of these access paths:

- QEMU host-forwarded port (recommended in dev): host `localhost:5000` -> guest `5000`
- SSH tunnel: `ssh -L 5000:localhost:5000 -p 2222 bloom@localhost`
- Guest IP direct access on LAN if routing allows (`http://<guest-ip>:5000`)

### 3) Optional Services

#### Lemonade (local LLM + speech-to-text)

- Install service package: `service_install(name="lemonade", version="0.1.0")`
- Validate: `service_test(name="lemonade")`
- API available at `http://localhost:8000` (OpenAI-compatible)

#### WhatsApp Bridge

WhatsApp runs as a native systemd user service (not a container). Enable it:

```bash
systemctl --user enable --now bloom-whatsapp
```

The first start opens a Chromium window on the Sway desktop with a WhatsApp QR code. Scan it with your phone to pair.

Check logs: `journalctl --user -u bloom-whatsapp -f`

The WhatsApp bridge needs the bloom-channels socket for IPC. If bloom-channels is not running, WhatsApp will reconnect automatically when it becomes available.

### 4) Mark Setup Complete

```bash
touch ~/.bloom/.setup-complete
```

## Notes

- Revisit skipped steps on demand
- Confirm each critical step before moving on

## Developer Mode (optional, not part of first-boot)

For contributors who want to submit PRs back to the Bloom repo, install `gh` and configure the repo:

```bash
sudo dnf install gh
gh auth login
```

Then use `bloom_repo_configure` to set up fork-based PR flow:
1. `bloom_repo_configure(repo_url="https://github.com/{owner}/pi-bloom.git")`
2. `bloom_repo_status` (verify PR-ready state)
3. `bloom_repo_sync(branch="main")`
```

**Step 2: Commit**

```bash
git add skills/first-boot/SKILL.md
git commit -m "docs: update first-boot skill for native NetBird and WhatsApp

- Remove NetBird step (handled pre-Pi in greeting script)
- Update WhatsApp to native systemd service (no container)
- Document WebDAV password as channel token
- Renumber steps"
```

---

### Task 8: Update Documentation

**Files:**
- Modify: `docs/pibloom-setup.md` (if it references NetBird container setup)
- Modify: `docs/service-architecture.md` (update NetBird and WhatsApp entries)

**Step 1: Check and update docs**

Read `docs/pibloom-setup.md` and `docs/service-architecture.md`. Update any references to:
- NetBird as a container service -> native system service
- WhatsApp container image -> native systemd service
- `podman exec bloom-netbird netbird up` -> `sudo netbird up`
- `journalctl --user -u bloom-netbird` -> `sudo journalctl -u netbird`

**Step 2: Commit**

```bash
git add docs/
git commit -m "docs: update architecture docs for native NetBird and WhatsApp"
```

---

### Task 9: Build and Test in VM

**Step 1: Build the OS image**

Run: `just build`
Expected: Image builds, `bootc container lint` passes.

**Step 2: Generate qcow2 and boot VM**

Run: `just qcow2 && just vm`

**Step 3: Verify NetBird auth flow**

On VM boot, the greeting script should:
1. Show the welcome message
2. Check NetBird status
3. Prompt for auth if not connected
4. Wait for connection

**Step 4: Verify Pi first-boot**

After NetBird auth, Pi should launch and guide through:
1. Git identity setup (no gh auth step)
2. dufs service install (should start without SELinux issues)
3. Optional services (lemonade container, WhatsApp native)

**Step 5: Verify dufs works**

From host: `curl -s -o /dev/null -w '%{http_code}' http://localhost:5000/`
Expected: `401` (auth required — dufs is running)

**Step 6: Verify WhatsApp native service**

On VM: `systemctl --user enable --now bloom-whatsapp && systemctl --user status bloom-whatsapp`
Expected: Active (running), Chromium window opens on Sway desktop

---

### Task 10: Final Cleanup Commit

**Step 1: Run checks**

```bash
npm run build
npm run check
npm run test
```

Fix any issues.

**Step 2: Single squash commit if needed, or leave as-is**

The individual task commits tell a clear story. Only squash if requested.
