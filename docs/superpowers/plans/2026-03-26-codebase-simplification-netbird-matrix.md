# Codebase Simplification: NetBird and Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the NetBird cloud provisioning layer (provisioner + watcher) and replace the self-hosted Continuwuity Matrix server with an external matrix.org account, deleting all related NixOS modules, tests, and wizard steps.

**Architecture:** Pure deletion and simplification — no new modules. NetBird stays as a daemon + `wt0` firewall. Matrix credentials (homeserver URL, bot user ID, access token) are written to `~/.pi/matrix-credentials.json` by the wizard; the daemon runtime reads them unchanged. Element Web is reconfigured to point to matrix.org at build time.

**Tech Stack:** Nix/NixOS modules, bash (wizard), systemd (for what remains).

**Spec:** `docs/superpowers/specs/2026-03-26-codebase-simplification-netbird-matrix-design.md`

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Delete | `core/os/modules/netbird-provisioner.nix` | NetBird cloud provisioner — removed entirely |
| Delete | `core/os/modules/nixpi-netbird-watcher.nix` | NetBird events watcher — removed entirely |
| Delete | `tests/nixos/nixpi-netbird-provisioner.nix` | Test for deleted module |
| Delete | `tests/nixos/nixpi-netbird-watcher.nix` | Test for deleted module |
| Delete | `core/os/modules/matrix.nix` | Continuwuity NixOS service module — removed entirely |
| Delete | `tests/nixos/nixpi-matrix.nix` | Test for deleted module |
| Delete | `tests/nixos/nixpi-matrix-bridge.nix` | Test for deleted module |
| Delete | `tests/nixos/nixpi-matrix-reply.nix` | Test for deleted module |
| Delete | `docs/superpowers/specs/2026-03-24-netbird-integration-design.md` | Obsolete spec |
| Delete | `docs/superpowers/plans/2026-03-24-netbird-integration.md` | Obsolete plan |
| Modify | `core/os/modules/collab.nix` | Remove 3 dead imports |
| Modify | `core/os/modules/options.nix` | Strip `nixpi.netbird` to `ssh.enable` only; remove entire `nixpi.matrix` block; remove `continuwuity.service` from `nixpi.agent.allowedUnits` |
| Modify | `core/os/modules/network.nix` | Remove DNS proxy script, service, and `services.resolved` config |
| Modify | `core/os/modules/service-surface.nix` | Remove Matrix proxy routes and `/.well-known/matrix/` endpoints; hardcode matrix.org for Element Web config; drop `matrixPort` and `matrixClientBaseUrl` from nixpi-home call |
| Modify | `core/os/services/nixpi-home.nix` | Remove `matrixPort` and `matrixClientBaseUrl` options; remove Matrix link from home page HTML |
| Modify | `tests/nixos/default.nix` | Remove 5 test entries and `smoke-matrix` alias |
| Modify | `core/scripts/wizard-matrix.sh` | Remove NetBird cloud setup; replace Matrix server steps with credentials collection |
| Modify | `docs/matrix-infrastructure.md` | Update to describe external homeserver flow |
| Modify | `docs/netbird-infrastructure.md` | Update to remove cloud provisioning references |

> **Ordering note:** Tasks 7, 8, and 9 (options.nix, service-surface.nix, nixpi-home.nix) share `config.nixpi.matrix.*` references across files. They must be completed and built together before committing. The build check is at the end of Task 9.

---

## Task 1: Remove NetBird module files and collab.nix imports

**Files:**
- Delete: `core/os/modules/netbird-provisioner.nix`
- Delete: `core/os/modules/nixpi-netbird-watcher.nix`
- Modify: `core/os/modules/collab.nix`

- [ ] **Step 1: Delete the provisioner and watcher modules**

```bash
git rm core/os/modules/netbird-provisioner.nix core/os/modules/nixpi-netbird-watcher.nix
```

Expected: `rm 'core/os/modules/netbird-provisioner.nix'` and `rm 'core/os/modules/nixpi-netbird-watcher.nix'`

- [ ] **Step 2: Remove the two dead imports from collab.nix**

`core/os/modules/collab.nix` currently reads:
```nix
{ ... }:

{
  imports = [
    ./matrix.nix
    ./service-surface.nix
    ./netbird-provisioner.nix
    ./nixpi-netbird-watcher.nix
  ];
}
```

Replace with:
```nix
{ ... }:

{
  imports = [
    ./matrix.nix
    ./service-surface.nix
  ];
}
```

- [ ] **Step 3: Verify the NixOS config still evaluates**

```bash
nix build .#checks.x86_64-linux.config
```

Expected: build succeeds (no output, exit 0).

- [ ] **Step 4: Commit**

```bash
git add core/os/modules/collab.nix
git commit -m "chore: remove NetBird cloud provisioner and watcher modules"
```

---

## Task 2: Strip nixpi.netbird cloud options from options.nix

**Files:**
- Modify: `core/os/modules/options.nix`

- [ ] **Step 1: Replace the nixpi.netbird block**

In `core/os/modules/options.nix`, find the entire `netbird = { ... };` block (the block starting with `netbird = {` and containing `apiTokenFile`, `apiEndpoint`, `groups`, `setupKeys`, `policies`, `postureChecks`, `dns`, and `ssh` sub-options) and replace it with:

```nix
    netbird = {
      ssh = {
        enable = lib.mkOption {
          type = lib.types.bool;
          default = true;
          description = ''
            Whether to enable NetBird's built-in SSH daemon on the Pi (port 22022).
            Authentication uses NetBird peer identity (WireGuard key).
          '';
        };
      };
    };
```

- [ ] **Step 2: Verify the NixOS config still evaluates**

```bash
nix build .#checks.x86_64-linux.config
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add core/os/modules/options.nix
git commit -m "chore: strip nixpi.netbird options to ssh.enable only"
```

---

## Task 3: Remove DNS proxy and resolved config from network.nix

**Files:**
- Modify: `core/os/modules/network.nix`

- [ ] **Step 1: Remove the netbirdDnsProxy let binding**

In the `let` block at the top of `core/os/modules/network.nix`, delete the entire `netbirdDnsProxy` binding — the block beginning with `netbirdDnsProxy = pkgs.writeShellScriptBin "nixpi-netbird-dns-proxy" ''` through its closing `'';`.

- [ ] **Step 2: Remove the services.resolved and DNS proxy service blocks**

In the `config = lib.mkMerge [ { ... } ]` section, find and remove these three blocks:

```nix
      services.resolved.enable = lib.mkIf (config.nixpi.netbird.apiTokenFile != null) true;
      services.resolved.settings = lib.mkIf (config.nixpi.netbird.apiTokenFile != null) {
        Resolve = {
          DNS = [ "127.0.0.1" ];
          Domains = [ "~${config.nixpi.netbird.dns.domain}" ];
        };
      };

      systemd.services.nixpi-netbird-dns-proxy = lib.mkIf (config.nixpi.netbird.apiTokenFile != null) {
        description = "Loopback DNS proxy for NetBird local forwarder";
        after = [ "netbird.service" ];
        wants = [ "netbird.service" ];
        wantedBy = [ "multi-user.target" ];
        serviceConfig = {
          ExecStart = "${netbirdDnsProxy}/bin/nixpi-netbird-dns-proxy";
          Restart = "on-failure";
          RestartSec = "5s";
          AmbientCapabilities = [ "CAP_NET_BIND_SERVICE" ];
          CapabilityBoundingSet = [ "CAP_NET_BIND_SERVICE" ];
          NoNewPrivileges = false;
        };
      };
```

- [ ] **Step 3: Remove netbirdDnsProxy from environment.systemPackages**

Find:
```nix
      environment.systemPackages = with pkgs; [
        jq
        netbird
        netbirdDnsProxy
        preferWifi
      ];
```

Replace with:
```nix
      environment.systemPackages = with pkgs; [
        jq
        netbird
        preferWifi
      ];
```

- [ ] **Step 4: Update the port-uniqueness assertion message**

Find:
```nix
          assertion = lib.length (lib.unique exposedPorts) == lib.length exposedPorts;
          message = "NixPI service ports must be unique across built-in services and Matrix.";
```

Replace with:
```nix
          assertion = lib.length (lib.unique exposedPorts) == lib.length exposedPorts;
          message = "NixPI service ports must be unique across built-in services.";
```

- [ ] **Step 5: Verify the NixOS config still evaluates**

```bash
nix build .#checks.x86_64-linux.config
```

Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add core/os/modules/network.nix
git commit -m "chore: remove NetBird DNS proxy and resolved config from network.nix"
```

---

## Task 4: Remove NetBird tests and test registry entries

**Files:**
- Delete: `tests/nixos/nixpi-netbird-provisioner.nix`
- Delete: `tests/nixos/nixpi-netbird-watcher.nix`
- Modify: `tests/nixos/default.nix`

- [ ] **Step 1: Delete the test files**

```bash
git rm tests/nixos/nixpi-netbird-provisioner.nix tests/nixos/nixpi-netbird-watcher.nix
```

- [ ] **Step 2: Remove the two test entries from tests/nixos/default.nix**

Find and remove:
```nix
    nixpi-netbird-provisioner  = runTest ./nixpi-netbird-provisioner.nix;
    nixpi-netbird-watcher      = runTest ./nixpi-netbird-watcher.nix;
```

- [ ] **Step 3: Verify the NixOS config still evaluates**

```bash
nix build .#checks.x86_64-linux.config
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add tests/nixos/default.nix
git commit -m "chore: remove NetBird provisioner and watcher NixOS tests"
```

---

## Task 5: Remove wizard NetBird cloud provisioning step

**Files:**
- Modify: `core/scripts/wizard-matrix.sh`

- [ ] **Step 1: Remove run_netbird_cloud_setup function**

In `core/scripts/wizard-matrix.sh`, delete the entire `run_netbird_cloud_setup()` function — the block from `run_netbird_cloud_setup() {` through its closing `}`.

- [ ] **Step 2: Remove the two calls to run_netbird_cloud_setup inside step_netbird**

Inside the `step_netbird` function there are two calls: `run_netbird_cloud_setup || true` (one in the web-login branch, one in the setup-key branch, both appearing just before `mark_done_with netbird "$mesh_ip"`). Delete each call line.

- [ ] **Step 3: Verify the wizard script is syntactically valid**

```bash
bash -n core/scripts/wizard-matrix.sh
```

Expected: no output (exit 0).

- [ ] **Step 4: Commit**

```bash
git add core/scripts/wizard-matrix.sh
git commit -m "chore: remove NetBird cloud provisioning from setup wizard"
```

---

## Task 6: Remove Matrix NixOS module and collab.nix import

**Files:**
- Delete: `core/os/modules/matrix.nix`
- Modify: `core/os/modules/collab.nix`

- [ ] **Step 1: Delete the Matrix module**

```bash
git rm core/os/modules/matrix.nix
```

- [ ] **Step 2: Remove the matrix.nix import from collab.nix**

`core/os/modules/collab.nix` currently reads (after Task 1):
```nix
{ ... }:

{
  imports = [
    ./matrix.nix
    ./service-surface.nix
  ];
}
```

Replace with:
```nix
{ ... }:

{
  imports = [
    ./service-surface.nix
  ];
}
```

- [ ] **Step 3: Verify the NixOS config still evaluates**

The `nixpi.matrix` options are still declared in `options.nix` at this point, so `service-surface.nix` (which references `config.nixpi.matrix.port`) still evaluates correctly. Build to confirm:

```bash
nix build .#checks.x86_64-linux.config
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add core/os/modules/collab.nix
git commit -m "chore: remove Matrix Continuwuity NixOS module"
```

---

## Task 7: Remove nixpi.matrix options from options.nix

> **Do not build or commit after this task alone.** `service-surface.nix` and `nixpi-home.nix` still reference `config.nixpi.matrix.*` — the build check is at the end of Task 9 after all three files are updated.

**Files:**
- Modify: `core/os/modules/options.nix`

- [ ] **Step 1: Remove the entire nixpi.matrix block**

In `core/os/modules/options.nix`, find and delete the entire `matrix = { ... };` block inside `options.nixpi`. It starts with `matrix = {` and ends with its closing `};`, and contains: `bindAddress`, `port`, `clientBaseUrl`, `enableRegistration`, `keepRegistrationAfterSetup`, `maxUploadSize`, `registrationSharedSecretFile`.

- [ ] **Step 2: Remove continuwuity.service from agent.allowedUnits default**

Find:
```nix
        default = [
          "nixpi-daemon.service"
          "netbird.service"
          "nixpi-home.service"
          "nixpi-element-web.service"
          "continuwuity.service"
          "nixpi-update.service"
        ];
```

Replace with:
```nix
        default = [
          "nixpi-daemon.service"
          "netbird.service"
          "nixpi-home.service"
          "nixpi-element-web.service"
          "nixpi-update.service"
        ];
```

> Continue directly to Task 8 — do not build yet.

---

## Task 8: Update service-surface.nix for external Matrix

> **Do not build or commit after this task alone.** nixpi-home.nix still declares `matrixPort` as a required option with no default. Complete Task 9 first.

**Files:**
- Modify: `core/os/modules/service-surface.nix`

- [ ] **Step 1: Remove three Matrix-related let bindings**

In the `let` block at the top of `core/os/modules/service-surface.nix`, remove:

```nix
  secureWebMatrixBaseUrl = "https://${config.networking.hostName}";
  matrixClientWellKnown = builtins.toJSON {
    "m.homeserver" = {
      base_url = "https://$host";
    };
  };
  matrixServerWellKnown = builtins.toJSON {
    "m.server" = "$host:443";
  };
```

- [ ] **Step 2: Update the nixpi-home call — remove matrixPort, simplify matrixClientBaseUrl**

In the `system.services.nixpi-home` block, find:
```nix
            matrixPort = config.nixpi.matrix.port;
            matrixClientBaseUrl =
              if cfg.secureWeb.enable then
                secureWebMatrixBaseUrl
              else if config.nixpi.matrix.clientBaseUrl != "" then
                config.nixpi.matrix.clientBaseUrl
              else
                "http://${config.networking.hostName}:${toString config.nixpi.matrix.port}";
```

Remove both lines entirely (nixpi-home no longer has these options after Task 9).

- [ ] **Step 3: Update the nixpi-element-web call**

In the `system.services.nixpi-element-web` block, find:
```nix
            matrixServerName = config.networking.hostName;
            matrixClientBaseUrl =
              if cfg.secureWeb.enable then
                secureWebMatrixBaseUrl
              else if config.nixpi.matrix.clientBaseUrl != "" then
                config.nixpi.matrix.clientBaseUrl
              else
                "http://${config.networking.hostName}:${toString config.nixpi.matrix.port}";
```

Replace with:
```nix
            matrixServerName = "matrix.org";
            matrixClientBaseUrl = "https://matrix.org";
```

- [ ] **Step 4: Remove four Matrix nginx proxy/well-known locations**

In the `services.nginx.virtualHosts.nixpi-secure-web` block, find and remove:

```nix
          locations."/_matrix".proxyPass = "http://127.0.0.1:${toString config.nixpi.matrix.port}";
          locations."/_synapse".proxyPass = "http://127.0.0.1:${toString config.nixpi.matrix.port}";
          locations."= /.well-known/matrix/client".extraConfig = ''
            default_type application/json;
            return 200 '${matrixClientWellKnown}';
          '';
          locations."= /.well-known/matrix/server".extraConfig = ''
            default_type application/json;
            return 200 '${matrixServerWellKnown}';
          '';
```

> Continue directly to Task 9 — do not build yet.

---

## Task 9: Remove Matrix options from nixpi-home service (then build and commit all three)

**Files:**
- Modify: `core/os/services/nixpi-home.nix`

- [ ] **Step 1: Remove matrixPort and matrixClientBaseUrl option declarations**

In `core/os/services/nixpi-home.nix`, in the `options.nixpi-home` block, find and remove:

```nix
    matrixPort = mkOption {
      type = types.port;
    };

    matrixClientBaseUrl = mkOption {
      type = types.str;
    };
```

- [ ] **Step 2: Remove the Matrix URL list item from the home page HTML**

In the `configData."webroot/index.html".text` inline HTML, find and remove this `<li>`:

```html
            <li>Matrix URL: <a data-matrix-link href="">canonical host not available on localhost recovery</a></li>
```

- [ ] **Step 3: Remove the Matrix URL JavaScript block from the home page**

In the same inline HTML, find and remove:

```js
              const matrixUrl = "https://" + canonicalHost;
```

And remove the loop that follows it:

```js
              for (const node of document.querySelectorAll("[data-matrix-link]")) {
                node.textContent = matrixUrl;
                node.href = matrixUrl;
              }
```

- [ ] **Step 4: Verify the NixOS config builds cleanly (Tasks 7 + 8 + 9 together)**

```bash
nix build .#checks.x86_64-linux.config
```

Expected: build succeeds. This is the first build check since Task 6 — it validates all three files changed in Tasks 7–9.

- [ ] **Step 5: Commit all three files together**

```bash
git add core/os/modules/options.nix \
        core/os/modules/service-surface.nix \
        core/os/services/nixpi-home.nix
git commit -m "chore: remove nixpi.matrix options, Matrix nginx proxy, and home page Matrix link"
```

---

## Task 10: Remove Matrix NixOS tests and test registry entries

**Files:**
- Delete: `tests/nixos/nixpi-matrix.nix`
- Delete: `tests/nixos/nixpi-matrix-bridge.nix`
- Delete: `tests/nixos/nixpi-matrix-reply.nix`
- Modify: `tests/nixos/default.nix`

- [ ] **Step 1: Delete the test files**

```bash
git rm tests/nixos/nixpi-matrix.nix tests/nixos/nixpi-matrix-bridge.nix tests/nixos/nixpi-matrix-reply.nix
```

- [ ] **Step 2: Remove the three test entries from tests/nixos/default.nix**

Find and remove:
```nix
    nixpi-matrix               = runTest ./nixpi-matrix.nix;
```

And:
```nix
    nixpi-matrix-bridge        = runTest ./nixpi-matrix-bridge.nix;
    nixpi-matrix-reply         = runTest ./nixpi-matrix-reply.nix;
```

- [ ] **Step 3: Remove the smoke-matrix alias**

Find and remove:
```nix
    smoke-matrix    = tests.nixpi-matrix;
```

- [ ] **Step 4: Check whether any remaining test still uses Matrix test helpers**

The `sharedArgs` in `tests/nixos/default.nix` passes `mkMatrixAdminSeedConfig`, `mkMatrixMultiSeedConfig`, `matrixTestClient`, `matrixRegisterScript` to all tests. Check if any remaining test file uses them:

```bash
grep -rl "mkMatrixAdminSeedConfig\|mkMatrixMultiSeedConfig\|matrixTestClient\|matrixRegisterScript" tests/nixos/ | grep -v "lib.nix" | grep -v "default.nix"
```

Expected output: empty. If any test files appear, do not remove the helpers from `lib.nix` — that's a separate cleanup.

- [ ] **Step 5: Verify the NixOS config still evaluates**

```bash
nix build .#checks.x86_64-linux.config
```

Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add tests/nixos/default.nix
git commit -m "chore: remove Matrix NixOS tests and smoke alias"
```

---

## Task 11: Update wizard for Matrix credentials collection

**Files:**
- Modify: `core/scripts/wizard-matrix.sh`

The daemon reads `~/.pi/matrix-credentials.json` (path from `matrixCredentialsPath()` in `core/lib/matrix.ts`, which resolves to `getPiDir() + "/matrix-credentials.json"`) for the bot's homeserver URL, user ID, and access token. The wizard writes this file.

- [ ] **Step 1: Add a step_matrix_credentials function**

In `core/scripts/wizard-matrix.sh`, add this function after `step_netbird`:

```bash
step_matrix_credentials() {
	echo ""
	echo "--- Matrix Bot Account ---"
	echo "Pi uses a Matrix bot account on matrix.org to communicate with you."
	echo ""
	echo "To set up a bot account:"
	echo "  1. Go to https://app.element.io and register a new account"
	echo "  2. In Element: Settings -> Security -> Access Tokens -> copy your token"
	echo ""

	local bot_user_id=""
	local bot_access_token=""

	if [[ "$NONINTERACTIVE_SETUP" -eq 1 ]]; then
		bot_user_id="${PREFILL_MATRIX_BOT_USER_ID:-}"
		bot_access_token="${PREFILL_MATRIX_BOT_ACCESS_TOKEN:-}"
		if [[ -z "$bot_user_id" || -z "$bot_access_token" ]]; then
			echo "Skipping Matrix credentials in noninteractive mode (PREFILL_MATRIX_BOT_USER_ID or PREFILL_MATRIX_BOT_ACCESS_TOKEN not set)."
			mark_done matrix
			return
		fi
		echo "Matrix bot user ID: [prefilled]"
		echo "Matrix access token: [prefilled]"
	else
		while [[ -z "$bot_user_id" ]]; do
			read -rp "Bot Matrix user ID (e.g. @mypi:matrix.org): " bot_user_id
			if [[ -z "$bot_user_id" ]]; then
				echo "User ID cannot be empty."
			fi
		done
		while [[ -z "$bot_access_token" ]]; do
			read -rsp "Bot access token: " bot_access_token
			echo ""
			if [[ -z "$bot_access_token" ]]; then
				echo "Access token cannot be empty."
			fi
		done
	fi

	local creds_dir="${HOME}/.pi"
	local creds_file="${creds_dir}/matrix-credentials.json"
	mkdir -p "$creds_dir"
	printf '{"homeserver":"https://matrix.org","botUserId":"%s","botAccessToken":"%s"}\n' \
		"$bot_user_id" "$bot_access_token" > "$creds_file"
	chmod 0600 "$creds_file"

	echo ""
	echo "Credentials saved. DM ${bot_user_id} from any Matrix client to talk to Pi."
	mark_done_with matrix "$bot_user_id"
}
```

- [ ] **Step 2: Verify the wizard script is syntactically valid**

```bash
bash -n core/scripts/wizard-matrix.sh
```

Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add core/scripts/wizard-matrix.sh
git commit -m "feat: replace local Matrix server wizard step with matrix.org credentials collection"
```

---

## Task 12: Delete obsolete spec and plan files

**Files:**
- Delete: `docs/superpowers/specs/2026-03-24-netbird-integration-design.md`
- Delete: `docs/superpowers/plans/2026-03-24-netbird-integration.md`

- [ ] **Step 1: Delete the obsolete files**

```bash
git rm docs/superpowers/specs/2026-03-24-netbird-integration-design.md \
       docs/superpowers/plans/2026-03-24-netbird-integration.md
```

- [ ] **Step 2: Commit**

```bash
git commit -m "chore: delete obsolete NetBird integration spec and plan"
```

---

## Task 13: Update documentation

**Files:**
- Modify: `docs/matrix-infrastructure.md`
- Modify: `docs/netbird-infrastructure.md`

- [ ] **Step 1: Rewrite docs/matrix-infrastructure.md**

Replace the entire file content with:

```markdown
---
name: matrix
version: 0.1.0
description: Matrix bot account on matrix.org (no local homeserver)
---

# Matrix

Pi uses a bot account on matrix.org to communicate with you. No Matrix server runs on the device.

## Setup

During first-boot setup, the wizard prompts you to paste the bot account's user ID and access token. These are stored at `~/.pi/matrix-credentials.json`.

To set up a bot account:
1. Go to https://app.element.io and register a new account (e.g. `@mypi:matrix.org`)
2. In Element: Settings → Security → Access Tokens → copy your token
3. Paste both into the setup wizard when prompted

## Re-configuring credentials

Edit `~/.pi/matrix-credentials.json` directly:
```json
{
  "homeserver": "https://matrix.org",
  "botUserId": "@mypi:matrix.org",
  "botAccessToken": "<token>"
}
```

Then restart the daemon: `systemctl restart nixpi-daemon.service`

## Troubleshooting

- Check daemon logs: `journalctl -u nixpi-daemon -n 100`
- Verify credentials file: `ls ~/.pi/matrix-credentials.json`
```

- [ ] **Step 2: Rewrite docs/netbird-infrastructure.md**

Replace the entire file content with:

```markdown
---
name: netbird
version: native
description: Secure mesh networking via NetBird (system service)
---

# NetBird

EU-hosted mesh networking for secure remote access to your NixPI device. Uses NetBird cloud management (free tier, up to 5 peers).

NetBird provides the security layer for SSH remote access and the built-in NixPI web surface. Services are firewalled to the `wt0` interface — only devices on the mesh can reach them.

NetBird is installed as a native system service (not a container) because WireGuard requires real kernel-level CAP_NET_ADMIN.

## Setup

Connect during NixPI's first-boot wizard using a setup key or web login.

To re-authenticate:
1. Get a new setup key from https://app.netbird.io -> Setup Keys
2. Run: `sudo netbird up --setup-key <KEY>`
3. Verify: `sudo netbird status`

## Managing access

Groups, ACL policies, and DNS routes are managed directly in the NetBird dashboard at https://app.netbird.io. NixPI does not manage cloud state automatically.

## Operations

- Status: `sudo netbird status`
- Logs: `sudo journalctl -u netbird -n 100`
- Stop: `sudo systemctl stop netbird`
- Start: `sudo systemctl start netbird`
```

- [ ] **Step 3: Commit**

```bash
git add docs/matrix-infrastructure.md docs/netbird-infrastructure.md
git commit -m "docs: update matrix and netbird infrastructure docs for simplified setup"
```

---

## Final Verification

After all tasks are complete, run these checks:

```bash
# No remaining references to removed Matrix options
grep -r "nixpi\.matrix\." core/os/

# No remaining references to removed NetBird cloud options
grep -r "apiTokenFile\|netbird\.dns\|netbird\.groups\|netbird\.policies\|netbird\.postureChecks\|netbird\.setupKeys" core/os/

# No remaining references to continuwuity
grep -r "continuwuity" core/os/

# Wizard no longer has run_netbird_cloud_setup
grep -c "run_netbird_cloud_setup" core/scripts/wizard-matrix.sh

# Wizard script is valid bash
bash -n core/scripts/wizard-matrix.sh

# Config builds
nix build .#checks.x86_64-linux.config
```

All grep commands should return empty output (or 0 for the count). The build should succeed.
