# Calamares Native Installer Design

**Date:** 2026-03-17
**Status:** Approved

## Overview

Replace the current two-step install flow (Calamares installs vanilla NixOS → `bloom-convert.sh` converts to Bloom) with a single native Calamares installer that generates a proper Bloom OS configuration directly. All wizard configuration (NetBird key, Matrix username, Git identity, optional services) is collected during installation so that after the first reboot everything is running — no interactive setup required.

Service-dependent steps (NetBird connection, Matrix account creation, optional service activation) that require the installed system's running daemons are handled by an automated first-boot systemd service, invisible to the user.

## Goals

- Single Calamares pass installs a fully-configured Bloom OS
- No post-install conversion script or interactive wizard on first login
- Installed system tracks the upstream Bloom flake for OTA updates
- All Bloom-specific data collected as natural Calamares wizard pages
- WiFi credentials, git identity, and AI config applied at install time (no first-boot needed)
- NetBird + Matrix + optional services complete automatically on first boot before login

## Non-Goals

- Replacing the disko-based provisioning path (`just vm`, `just raw`, `just qcow2`)
- LUKS full-disk encryption (out of scope for this iteration)
- Multi-disk or custom partition layouts beyond Calamares's guided mode

## Architecture

### Components

**1. `nixosModules.bloom` and `nixosModules.bloom-firstboot` (new flake outputs)**

Two new outputs added to `flake.nix`:

- `nixosModules.bloom` — exports the six Bloom feature modules (`bloom-app`, `bloom-llm`, `bloom-matrix`, `bloom-network`, `bloom-shell`, `bloom-update`) as a single composable NixOS module, plus `nixpkgs.config.allowUnfree = true`. Does not include disko disk config or VM-specific mounts. **Requires `piAgent` and `bloomApp` in the consuming system's `specialArgs`** — these are packages from `llm-agents-nix` and `pkgs.callPackage ./core/os/pkgs/bloom-app` respectively. The generated installer `flake.nix` always provides them (see Step 3 below).
- `nixosModules.bloom-firstboot` — exports the first-boot service module (see below).

These allow the Calamares-installed system's local `flake.nix` to import Bloom cleanly without pulling in machine-specific or dev-only configuration.

**2. `core/calamares/` — custom Calamares extensions package**

An override of `calamares-nixos-extensions` bundled in the repo. Wired into the flake as a nixpkgs overlay in `packages.x86_64-linux` and applied in `x86_64-installer.nix`.

Structure:
```
core/calamares/
  bloom_nixos/
    main.py          # Replaces the standard nixos Calamares module
    module.desc      # Module descriptor
  bloom_prefill/
    main.py          # Python module: reads globalstorage, writes prefill.env + .gitconfig + NM configs
    module.desc      # Module descriptor
  pages/
    BloomNetbird.qml # Page: NetBird setup key
    BloomGit.qml     # Page: Git name + email
    BloomServices.qml# Page: Optional services checkboxes
  config/
    bloom-settings.conf  # Calamares settings.conf (sequence definition)
    bloom-nixos.conf     # bloom-nixos module config
    users.conf           # Override: lock username to "pi"
  package.nix            # Nix derivation
```

**3. Custom Calamares QML pages**

Four new wizard pages inserted before the partition step:

| Page | Fields | Storage key |
|------|--------|-------------|
| `BloomGit` | Full name, email address | `bloom_git_name`, `bloom_git_email` |
| `BloomMatrix` | Matrix username (the chat handle, e.g. `alice`) | `bloom_matrix_username` |
| `BloomNetbird` | NetBird setup key (password field, link to app.netbird.io) | `bloom_netbird_key` |
| `BloomServices` | FluffyChat checkbox, dufs checkbox | `bloom_services` (comma-separated) |

All fields are optional — the first-boot service handles missing keys gracefully (skips the step).

`bloom_matrix_username` is distinct from the OS login username (which is always `pi`). It is the user's chosen Matrix handle and maps to `PREFILL_USERNAME` in `prefill.env` (the key `bloom-wizard.sh` already reads for Matrix account creation).

**4. `core/os/modules/bloom-firstboot.nix` + `core/scripts/bloom-firstboot.sh`**

A new NixOS module that declares `bloom-firstboot.service`. The service runs once before `getty@tty1.service` on first boot, reads `~/.bloom/prefill.env`, and completes the service-dependent setup non-interactively.

**5. Updated `core/os/hosts/x86_64-installer.nix`**

Gains the nixpkgs overlay for the custom Calamares extensions and adds the QML pages to the live environment's package list.

**6. Removal of `bloom-convert.sh` and `bloom-convert-desktop`**

These are no longer needed. The installer now produces a Bloom system directly.

## Calamares Wizard Sequence

### Show Phase (pages presented to user)

1. `welcome` — unchanged
2. `locale` — unchanged (sets timezone, locale)
3. `keyboard` — unchanged
4. `users` — unchanged (sets password for `pi` user)
5. `bloom-git` — NEW: name + email
6. `bloom-matrix` — NEW: Matrix username (chat handle)
7. `bloom-netbird` — NEW: NetBird setup key
8. `bloom-services` — NEW: optional services selection
9. `partition` — unchanged (full GUI partitioning)
10. `summary` — unchanged

The `packagechooser` page (desktop environment selection) is removed. Bloom always installs headless with its own service stack.

### Exec Phase (installation jobs)

1. `partition` — formats and creates partitions per user selection
2. `mount` — mounts target at `/mnt`
3. `bloom-nixos` — custom module: generates local flake + `host-config.nix` + `hardware-configuration.nix`, runs `nixos-install`
4. `users` — sets `pi` password hash on the installed system (Calamares chpasswds the user it created; `users.conf` locks the username to `pi`)
5. `bloom-prefill` — Python module: reads globalstorage, writes `prefill.env` + `.gitconfig`, copies NM WiFi connections
6. `umount` — unmounts target

### Final Show Phase

1. `finished` — with reboot button

## `bloom_nixos` Module (`main.py`)

The custom Python module replaces `calamares-nixos-extensions/modules/nixos/main.py`. It reads from Calamares `globalstorage` (same API as the standard module) and produces a working Bloom installation.

### Step 1 — Hardware detection

```python
subprocess.check_output(["pkexec", "nixos-generate-config", "--root", root_mount_point])
```

Generates `/mnt/etc/nixos/hardware-configuration.nix` from actual hardware.

### Step 2 — Write `host-config.nix`

Machine-specific overrides written to `/mnt/etc/nixos/host-config.nix`:

```nix
{ ... }: {
  boot.loader.systemd-boot.enable = true;   # grub if BIOS firmware
  boot.loader.efi.canTouchEfiVariables = true;
  networking.hostName = "bloom";
  time.timeZone = "@@timezone@@";
  i18n.defaultLocale = "@@LANG@@";
  services.xserver.xkb = { layout = "@@kblayout@@"; variant = "@@kbvariant@@"; };
  console.keyMap = "@@vconsole@@";
  networking.networkmanager.enable = true;
  # NOTE: users.users.pi is NOT defined here. bloom-shell.nix (included via
  # nixosModules.bloom) already defines the pi user with group, shell, home,
  # and autologin. Calamares users exec module sets the password directly via
  # chpasswd on the mounted target — no initialPassword needed.
  system.stateVersion = "25.05";
}
```

The Calamares `users.conf` override sets `defaultGroups`, locks the displayed username field to `pi` (non-editable), and maps that username to what the exec-phase `users` module applies. The user types only a password in the Calamares users page, not a username.

### Step 3 — Write local `flake.nix`

Written to `/mnt/etc/nixos/flake.nix`:

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    bloom.url = "github:alexradunet/piBloom";
    llm-agents-nix = {
      url = "github:numtide/llm-agents.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, bloom, llm-agents-nix, ... }:
  let
    system = "x86_64-linux";
    pkgs = nixpkgs.legacyPackages.${system};
    piAgent = llm-agents-nix.packages.${system}.pi;
    bloomApp = pkgs.callPackage (bloom + "/core/os/pkgs/bloom-app") { inherit piAgent; };
  in {
    nixosConfigurations.bloom = nixpkgs.lib.nixosSystem {
      inherit system;
      specialArgs = { inherit piAgent bloomApp; };
      modules = [
        ./hardware-configuration.nix
        ./host-config.nix
        bloom.nixosModules.bloom
        bloom.nixosModules.bloom-firstboot
      ];
    };
  };
}
```

The installed system uses `nixos-rebuild switch --flake /etc/nixos#bloom` for updates, automatically tracking upstream Bloom.

### Step 4 — Install

```python
subprocess.run(["pkexec", "nixos-install", "--root", root_mount_point,
                "--no-root-passwd", "--flake", root_mount_point + "/etc/nixos#bloom"])
```

## `bloom_prefill` Python Module

A Calamares Python job module (not `shellprocess` — that module cannot read globalstorage values). Runs after `nixos-install`, before `umount`. Reads values from `libcalamares.globalstorage` and writes three things to the installed target:

**`/mnt/home/pi/.bloom/prefill.env`**
```bash
PREFILL_NETBIRD_KEY=<gs.value("bloom_netbird_key") or "">
PREFILL_USERNAME=<gs.value("bloom_matrix_username") or "">
PREFILL_NAME=<gs.value("bloom_git_name") or "">
PREFILL_EMAIL=<gs.value("bloom_git_email") or "">
PREFILL_SERVICES=<gs.value("bloom_services") or "">
```
`PREFILL_USERNAME` maps to the Matrix handle (`bloom_matrix_username`), not the OS login name. The OS login name is always `pi` (locked by `users.conf`) and is not written to `prefill.env`.

File written with `chmod 600`, owned by UID/GID 1000 (hardcoded — NixOS deterministically assigns UID 1000 to the first normal user; `pwd.getpwnam("pi")` is not used because the live ISO does not have a `pi` user in `/etc/passwd`). Parent directory `~pi/.bloom/` created if absent.

**`/mnt/home/pi/.pi/agent/settings.json`**
```json
{
  "packages": ["/usr/local/share/bloom"],
  "defaultProvider": "localai",
  "defaultModel": "omnicoder-9b-q4_k_m",
  "defaultThinkingLevel": "medium"
}
```
Written at install time with `chmod 600`. This replaces `step_ai` from `bloom-wizard.sh`; `pi-daemon.service` has its required `settings.json` on first boot without any first-boot step. Parent directory `~pi/.pi/agent/` created if absent.

**`/mnt/home/pi/.gitconfig`**
```ini
[user]
    name = <bloom_git_name>
    email = <bloom_git_email>
```
Written only if both name and email are non-empty. No first-boot step needed for git config.

**NetworkManager WiFi connections (best-effort)**

```python
src = "/etc/NetworkManager/system-connections"
dst = root_mount_point + "/etc/NetworkManager/system-connections"
os.makedirs(dst, exist_ok=True)
for f in glob.glob(src + "/*.nmconnection"):
    shutil.copy2(f, dst)
```

The target directory is created before the copy. If no `.nmconnection` files exist (e.g., user is on ethernet), the step completes silently with no error. Ensures WiFi connected during live session works immediately after reboot.

## First-Boot Automation

### `bloom-firstboot.nix`

```nix
{ config, pkgs, ... }: {
  systemd.services.bloom-firstboot = {
    description = "Bloom First-Boot Setup";
    # Pulled into multi-user.target and must complete before getty starts.
    # systemd starts getty@tty1 only after bloom-firstboot completes because
    # of the Before= relationship and the shared multi-user.target membership.
    wantedBy = [ "multi-user.target" ];
    # Use getty.target (not individual getty@ttyN instances) to reliably block all
    # console logins — individual instances may not be in the transaction if they are
    # socket-activated or demand-started.
    before = [ "getty.target" ];
    after = [ "network-online.target" "bloom-matrix.service" "netbird.service" "user@1000.service" ];
    wants = [ "network-online.target" "bloom-matrix.service" "netbird.service" "user@1000.service" ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      User = "pi";
      ExecStart = "${pkgs.bash}/bin/bash ${./bloom-firstboot.sh}";
      StandardOutput = "journal+console";
      # systemctl --user requires XDG_RUNTIME_DIR to reach the user bus socket.
      # When a system service runs as User="pi" outside a PAM session, this env var
      # is not set automatically. UID 1000 is hardcoded (same rationale as bloom_prefill).
      Environment = "XDG_RUNTIME_DIR=/run/user/1000";
      # Do not fail the boot if setup fails — user can recover via bloom-wizard.sh
      SuccessExitStatus = "0 1";
    };
    unitConfig.ConditionPathExists = "!/home/pi/.bloom/.setup-complete";
  };

  # Passwordless sudo rules required by bloom-firstboot.sh in the non-TTY service context.
  # NOTE: bloom-shell.nix (included via nixosModules.bloom) already grants pi ALL NOPASSWD
  # sudo, so these narrow rules are currently redundant. They are included here for
  # documentation clarity and to support future hardening (when bloom-shell.nix's full-sudo
  # grant is removed, these rules must be present for the first-boot service to work).
  security.sudo.extraRules = [
    {
      users = [ "pi" ];
      commands = [
        # Read the Matrix registration token (owned by the continuwuity service UID)
        { command = "/run/current-system/sw/bin/cat /var/lib/continuwuity/registration_token"; options = [ "NOPASSWD" ]; }
        # Read the first-boot Matrix token from the journal
        { command = "/run/current-system/sw/bin/journalctl -u bloom-matrix --no-pager"; options = [ "NOPASSWD" ]; }
        # Connect to NetBird mesh
        { command = "/run/current-system/sw/bin/netbird up --setup-key *"; options = [ "NOPASSWD" ]; }
        # Start NetBird daemon if not running
        { command = "/run/current-system/sw/bin/systemctl start netbird.service"; options = [ "NOPASSWD" ]; }
      ];
    }
  ];

  # Enable linger for pi statically via tmpfiles rather than loginctl at runtime.
  # loginctl enable-linger from a non-interactive systemd service (User = "pi")
  # requires polkit; writing the linger file directly avoids that dependency.
  systemd.tmpfiles.rules = [ "f+ /var/lib/systemd/linger/pi - - - -" ];
}
```

The `wants = [ "bloom-matrix.service" "netbird.service" ]` ensures those services are started before `bloom-firstboot` attempts to use them, even though they may not be fully ready at the socket level. The script uses retry loops (see below) to wait for application-level readiness.

### `bloom-firstboot.sh`

A stripped, non-interactive version of `bloom-wizard.sh`. Reads `~/.bloom/prefill.env`. Linger for `pi` is enabled statically via `systemd.tmpfiles.rules` in `bloom-firstboot.nix` — no `loginctl` call is needed in the script. Execution order:

1. **`step_netbird`** — starts netbird daemon via `sudo systemctl start netbird.service`, then connects with `sudo netbird up --setup-key $PREFILL_NETBIRD_KEY`; skipped if `PREFILL_NETBIRD_KEY` is empty.
2. **`step_matrix`** — polls `http://localhost:6167/_matrix/client/versions` in a retry loop (up to 60s, 1s interval). Once the homeserver is accepting connections, reads the registration token via `sudo cat /var/lib/continuwuity/registration_token` and registers bot + user accounts using `PREFILL_USERNAME`. Skipped if `PREFILL_USERNAME` is empty.
3. **`step_services`** — always calls `install_home_infrastructure` (Bloom Home, unconditional). If `PREFILL_SERVICES` is non-empty, also iterates the comma-separated list and calls `install_service <name>` for each. `$BLOOM_SERVICES` resolves to `/usr/local/share/bloom/services`, populated by `bloomApp` via tmpfiles symlink at system activation.
4. **`finalize`** — starts `pi-daemon.service` via `systemctl --user`, writes `~/.bloom/.setup-complete`.

`settings.json` (AI provider config) is written by `bloom_prefill` at install time — `step_ai` is not needed here.

All interactive prompts are removed. Non-fatal failures are logged to the journal and do not block subsequent steps or login.

**`bloom-wizard.sh` `step_services` change:** `install_home_infrastructure` is always called first. Then:

```bash
# Pseudocode for the modified step_services non-interactive path
install_home_infrastructure
if [[ -n "$PREFILL_SERVICES" ]]; then
  # Non-interactive: iterate comma-separated list
  IFS=',' read -ra services <<< "$PREFILL_SERVICES"
  for svc in "${services[@]}"; do
    svc="$(echo "$svc" | xargs)"  # trim whitespace
    install_service "$svc"
    installed+=" $svc"
  done
else
  # Interactive: existing read -rp prompts unchanged
  ...
fi
# Both paths call these — mesh context is read from prior checkpoint data
mesh_ip=$(read_checkpoint_data netbird)
mesh_fqdn=$(netbird_fqdn)
write_service_home_runtime "$installed" "$mesh_ip" "$mesh_fqdn"
mark_done_with services "${installed:-none}"
```

`write_service_home_runtime` takes three args: installed services string, mesh IP, mesh FQDN. `mark_done_with` takes two args: step name and data string (matches its actual signature). Both are called in both the interactive and non-interactive paths.

**`step_ai` in `bloom-wizard.sh`:** `step_ai` is kept in the wizard's recovery sequence. `bloom_prefill` writes `settings.json` at install time, so on the recovery path `step_ai` encounters an already-existing file and the `jq` merge branch is taken (idempotent). No change to `bloom-wizard.sh`'s `step_ai` or its place in `main()`.

`bloom-wizard.sh` continues to work as a recovery mechanism: if `.setup-complete` is absent it re-runs from the last incomplete checkpoint using the same prefill logic.

## File Changes Summary

| Action | Path |
|--------|------|
| ADD | `core/calamares/package.nix` |
| ADD | `core/calamares/bloom_nixos/main.py` |
| ADD | `core/calamares/bloom_nixos/module.desc` |
| ADD | `core/calamares/pages/BloomGit.qml` |
| ADD | `core/calamares/pages/BloomMatrix.qml` |
| ADD | `core/calamares/pages/BloomNetbird.qml` |
| ADD | `core/calamares/pages/BloomServices.qml` |
| ADD | `core/calamares/config/bloom-settings.conf` |
| ADD | `core/calamares/config/bloom-nixos.conf` |
| ADD | `core/calamares/config/users.conf` |
| ADD | `core/calamares/bloom_prefill/main.py` |
| ADD | `core/calamares/bloom_prefill/module.desc` |
| ADD | `core/os/modules/bloom-firstboot.nix` |
| ADD | `core/scripts/bloom-firstboot.sh` |
| MODIFY | `flake.nix` — add `nixosModules.bloom` + `nixosModules.bloom-firstboot` outputs + nixpkgs overlay |
| MODIFY | `core/os/hosts/x86_64-installer.nix` — use custom Calamares package, remove bloom-convert |
| MODIFY | `core/scripts/bloom-wizard.sh` — add `PREFILL_SERVICES` support to `step_services` |
| DELETE | `core/scripts/bloom-convert.sh` |

## Error Handling

- **nixos-install fails**: Calamares shows error dialog with journal output. User can retry from the summary page.
- **First-boot NetBird fails**: Logged to journal. `bloom-wizard.sh` re-runs the netbird step on next login (existing checkpoint resume logic).
- **First-boot Matrix fails**: Same — wizard resumes from `step_matrix` on next login.
- **Missing prefill.env**: First-boot service skips NetBird/services gracefully. Matrix runs but prompts for username interactively via `bloom-wizard.sh` on next login.

## Testing

- `just iso-gui` builds the new installer ISO
- `just test-iso-gui` boots it in QEMU with display — verify all 9 wizard pages appear
- After install + reboot, `systemctl status bloom-firstboot` shows completed
- `netbird status` shows Connected
- `~/.pi/matrix-credentials.json` exists with valid tokens
- `pi` command starts successfully
