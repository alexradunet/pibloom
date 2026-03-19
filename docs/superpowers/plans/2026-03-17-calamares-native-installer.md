# Calamares Native Installer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-step install flow (Calamares → bloom-convert) with a single native Calamares installer that produces a fully-configured Bloom OS after one reboot.

**Architecture:** Custom `calamares-nixos-extensions` override in `core/calamares/` provides a Python `bloom_nixos` module (writes flake + host-config, runs nixos-install) and a `bloom_prefill` module (writes prefill.env, settings.json, .gitconfig, NM connections). Four QML pages collect Bloom-specific config. A new `bloom-firstboot.service` (declared in `core/os/modules/firstboot.nix`) runs before getty on first boot to connect NetBird, register Matrix accounts, and activate services non-interactively.

**Tech Stack:** NixOS flakes, Calamares Python job modules, Calamares QML pages, systemd, bash, Python 3

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| MODIFY | `flake.nix` | Add `nixosModules.platform`, `nixosModules.firstboot`, nixpkgs overlay |
| ADD | `core/os/modules/firstboot.nix` | Systemd oneshot service, sudo rules, linger tmpfile |
| ADD | `core/scripts/firstboot.sh` | Non-interactive: netbird, matrix, services, finalize |
| ADD | `core/calamares/package.nix` | Nix derivation for custom calamares-nixos-extensions |
| ADD | `core/calamares/bloom_nixos/module.desc` | Calamares module descriptor |
| ADD | `core/calamares/bloom_nixos/main.py` | Hardware detect, write host-config + flake, nixos-install |
| ADD | `core/calamares/bloom_prefill/module.desc` | Calamares module descriptor |
| ADD | `core/calamares/bloom_prefill/main.py` | Write prefill.env, settings.json, .gitconfig, NM connections |
| ADD | `core/calamares/pages/BloomGit.qml` | Git name + email fields |
| ADD | `core/calamares/pages/BloomMatrix.qml` | Matrix username field |
| ADD | `core/calamares/pages/BloomNetbird.qml` | NetBird setup key field |
| ADD | `core/calamares/pages/BloomServices.qml` | FluffyChat + dufs checkboxes |
| ADD | `core/calamares/config/bloom-settings.conf` | Calamares sequence (show + exec phases) |
| ADD | `core/calamares/config/bloom-nixos.conf` | bloom-nixos module config |
| ADD | `core/calamares/config/users.conf` | Lock username to pi, dont_create_user |
| MODIFY | `core/os/hosts/x86_64-installer.nix` | Use custom Calamares package, remove bloom-convert |
| MODIFY | `core/scripts/setup-wizard.sh` | Add PREFILL_SERVICES non-interactive path |
| DELETE | `core/scripts/bloom-convert.sh` | No longer needed |

---

## Task 1: flake.nix — nixosModules outputs

**Files:**
- Modify: `flake.nix`

**Context:** `x86_64.nix` currently imports the six bloom modules directly. `nixosModules.platform` re-exports them as a single composable module so the generated installer `flake.nix` can reference `bloom.nixosModules.platform`. `nixosModules.firstboot` exports the first-boot service (which is machine-specific, not part of the portable bloom module set).

- [ ] **Step 1: Add `nixosModules` outputs to `flake.nix`**

  In `flake.nix`, inside the `outputs = ... in {` block, add after `packages.${system}`:

  ```nix
  nixosModules = {
    # Single composable module exporting all six Bloom feature modules.
    # Consuming flake.nix must provide piAgent and bloomApp in specialArgs.
    bloom = { piAgent, bloomApp, ... }: {
      imports = [
        ./core/os/modules/app.nix
        ./core/os/modules/llm.nix
        ./core/os/modules/matrix.nix
        ./core/os/modules/network.nix
        ./core/os/modules/shell.nix
        ./core/os/modules/update.nix
      ];
      nixpkgs.config.allowUnfree = true;
    };

    # First-boot service module (included separately, not part of portable bloom module).
    bloom-firstboot = import ./core/os/modules/firstboot.nix;
  };
  ```

- [ ] **Step 2: Verify flake evaluates**

  ```bash
  nix eval .#nixosModules --apply builtins.attrNames
  ```
  Expected: `[ "bloom" "bloom-firstboot" ]`

- [ ] **Step 3: Commit**

  ```bash
  git add flake.nix
  git commit -m "feat(flake): add nixosModules.platform and nixosModules.firstboot outputs"
  ```

---

## Task 2: bloom-firstboot.nix

**Files:**
- Create: `core/os/modules/firstboot.nix`

**Context:** The module declares the systemd oneshot service. `firstboot.sh` is a sibling file referenced with `${./firstboot.sh}`. `bloom-shell.nix` already grants `pi` full NOPASSWD sudo, so the narrow extraRules here are redundant but document the future-hardening intent.

- [ ] **Step 1: Create `core/os/modules/firstboot.nix`**

  ```nix
  # core/os/modules/firstboot.nix
  { config, pkgs, ... }:

  {
    systemd.services.bloom-firstboot = {
      description = "Bloom First-Boot Setup";
      wantedBy = [ "multi-user.target" ];
      # getty.target blocks all console logins until this completes.
      # Individual getty@ttyN instances may not be in the transaction;
      # targeting getty.target is the reliable way to block all of them.
      before = [ "getty.target" ];
      after = [
        "network-online.target"
        "bloom-matrix.service"
        "netbird.service"
        "user@1000.service"
      ];
      wants = [
        "network-online.target"
        "bloom-matrix.service"
        "netbird.service"
        "user@1000.service"
      ];
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        User = "pi";
        ExecStart = "${pkgs.bash}/bin/bash ${./firstboot.sh}";
        StandardOutput = "journal+console";
        # systemctl --user needs XDG_RUNTIME_DIR to reach the user bus socket.
        # This env var is not set automatically for system services running as a
        # non-root user outside a PAM login session. UID 1000 is deterministic
        # for the first normal user in NixOS (same rationale as bloom_prefill).
        Environment = "XDG_RUNTIME_DIR=/run/user/1000";
        # Exit 1 = non-fatal partial failure; user can recover via setup-wizard.sh.
        SuccessExitStatus = "0 1";
      };
      unitConfig.ConditionPathExists = "!/home/pi/.bloom/.setup-complete";
    };

    # Narrow sudo rules for commands firstboot.sh needs in a non-TTY context.
    # NOTE: bloom-shell.nix already grants pi full NOPASSWD sudo, making these rules
    # currently redundant. They are kept for future hardening documentation.
    security.sudo.extraRules = [
      {
        users = [ "pi" ];
        commands = [
          { command = "/run/current-system/sw/bin/cat /var/lib/continuwuity/registration_token"; options = [ "NOPASSWD" ]; }
          { command = "/run/current-system/sw/bin/journalctl -u bloom-matrix --no-pager"; options = [ "NOPASSWD" ]; }
          { command = "/run/current-system/sw/bin/netbird up --setup-key *"; options = [ "NOPASSWD" ]; }
          { command = "/run/current-system/sw/bin/systemctl start netbird.service"; options = [ "NOPASSWD" ]; }
        ];
      }
    ];

    # Enable linger for pi via tmpfiles to avoid polkit dependency at runtime.
    # Writing /var/lib/systemd/linger/pi directly achieves the same effect as
    # `loginctl enable-linger pi` without requiring a PAM/polkit context.
    systemd.tmpfiles.rules = [ "f+ /var/lib/systemd/linger/pi - - - -" ];
  }
  ```

- [ ] **Step 2: Verify nix parses the file**

  ```bash
  nix eval --expr 'import ./core/os/modules/firstboot.nix' --apply builtins.isFunction
  ```
  Expected: `true`

- [ ] **Step 3: Commit**

  ```bash
  git add core/os/modules/firstboot.nix
  git commit -m "feat(os): add bloom-firstboot.nix systemd service module"
  ```

---

## Task 3: firstboot.sh

**Files:**
- Create: `core/scripts/firstboot.sh`

**Context:** This script runs as `pi` via the systemd service from Task 2. It is a stripped, non-interactive version of `setup-wizard.sh`. All helper functions it calls (`matrix_login`, `matrix_register`, `install_home_infrastructure`, `install_service`, etc.) live in `setup-wizard.sh` and are re-sourced here — this avoids duplicating shared logic. The script reads `~/.bloom/prefill.env` which `bloom_prefill` writes at install time.

Note: `finalize` in `setup-wizard.sh` calls `loginctl enable-linger` — this script does NOT do that (linger is handled by `bloom-firstboot.nix` via tmpfiles).

- [ ] **Step 1: Create `core/scripts/firstboot.sh`**

  ```bash
  #!/usr/bin/env bash
  # firstboot.sh — Non-interactive first-boot automation for Bloom OS.
  # Runs once before getty via bloom-firstboot.service (User=pi).
  # Reads ~/.bloom/prefill.env written by the Calamares bloom_prefill module.
  # On failure, exits 1 (non-fatal per SuccessExitStatus). User can re-run
  # setup-wizard.sh on next login to resume from the last incomplete checkpoint.
  set -euo pipefail

  WIZARD_STATE="$HOME/.bloom/wizard-state"
  SETUP_COMPLETE="$HOME/.bloom/.setup-complete"
  BLOOM_DIR="${BLOOM_DIR:-$HOME/Bloom}"
  BLOOM_SERVICES="/usr/local/share/bloom/services"
  SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
  BLOOM_CONFIG="$HOME/.config/bloom"
  PI_DIR="$HOME/.pi"
  MATRIX_HOMESERVER="http://localhost:6167"
  MATRIX_STATE_DIR="$WIZARD_STATE/matrix-state"

  PREFILL_FILE="$HOME/.bloom/prefill.env"
  if [[ -f "$PREFILL_FILE" ]]; then
      # shellcheck source=/dev/null
      source "$PREFILL_FILE"
  fi

  # Re-use all helper functions from setup-wizard.sh to avoid duplication.
  # shellcheck source=setup-wizard.sh
  WIZARD_SCRIPT="$(dirname "$0")/setup-wizard.sh"
  if [[ ! -f "$WIZARD_SCRIPT" ]]; then
      WIZARD_SCRIPT="/usr/local/share/bloom/dist/scripts/setup-wizard.sh"
  fi
  # Source only the function definitions (skip main() execution) by setting a guard.
  BLOOM_FIRSTBOOT_SOURCING=1
  source "$WIZARD_SCRIPT"
  unset BLOOM_FIRSTBOOT_SOURCING

  step_done() { [[ -f "$WIZARD_STATE/$1" ]]; }

  # --- First-boot steps ---

  firstboot_netbird() {
      [[ -z "${PREFILL_NETBIRD_KEY:-}" ]] && { echo "bloom-firstboot: no NetBird key, skipping"; return 0; }
      echo "bloom-firstboot: connecting to NetBird..."
      if ! systemctl is-active --quiet netbird.service; then
          sudo systemctl start netbird.service
      fi
      local wait_count=0
      while [[ ! -S /var/run/netbird/sock ]]; do
          wait_count=$((wait_count + 1))
          [[ $wait_count -ge 20 ]] && { echo "bloom-firstboot: NetBird daemon did not start" >&2; return 1; }
          sleep 0.5
      done
      if sudo netbird up --setup-key "$PREFILL_NETBIRD_KEY"; then
          sleep 3
          local mesh_ip
          mesh_ip=$(netbird status 2>/dev/null | grep -oP 'NetBird IP:\s+\K[\d.]+' || true)
          [[ -n "$mesh_ip" ]] && mark_done_with netbird "$mesh_ip"
          echo "bloom-firstboot: NetBird connected (${mesh_ip:-unknown IP})"
      else
          echo "bloom-firstboot: NetBird connection failed" >&2
          return 1
      fi
  }

  firstboot_matrix() {
      [[ -z "${PREFILL_USERNAME:-}" ]] && { echo "bloom-firstboot: no Matrix username, skipping"; return 0; }
      echo "bloom-firstboot: setting up Matrix..."
      # Poll until homeserver accepts connections (up to 60s)
      local attempts=0
      until curl -sf "http://localhost:6167/_matrix/client/versions" >/dev/null 2>&1; do
          attempts=$((attempts + 1))
          [[ $attempts -ge 60 ]] && { echo "bloom-firstboot: Matrix homeserver not ready after 60s" >&2; return 1; }
          sleep 1
      done
      echo "bloom-firstboot: Matrix homeserver ready"
      # Delegate to wizard's step_matrix (reads PREFILL_USERNAME from env)
      step_matrix
  }

  firstboot_services() {
      echo "bloom-firstboot: provisioning Bloom Home..."
      local installed=""
      local mesh_ip mesh_fqdn
      mesh_ip=$(read_checkpoint_data netbird)
      mesh_fqdn=$(netbird_fqdn)
      write_service_home_runtime "$installed" "$mesh_ip" "$mesh_fqdn"
      install_home_infrastructure || echo "bloom-firstboot: Bloom Home setup failed (non-fatal)"

      if [[ -n "${PREFILL_SERVICES:-}" ]]; then
          IFS=',' read -ra svc_list <<< "$PREFILL_SERVICES"
          for svc in "${svc_list[@]}"; do
              svc="$(echo "$svc" | xargs)"
              [[ -z "$svc" ]] && continue
              echo "bloom-firstboot: installing service: $svc"
              if install_service "$svc"; then
                  installed="${installed} ${svc}"
                  write_service_home_runtime "$installed" "$mesh_ip" "$mesh_fqdn"
              else
                  echo "bloom-firstboot: service $svc failed (non-fatal)" >&2
              fi
          done
      fi

      write_service_home_runtime "$installed" "$mesh_ip" "$mesh_fqdn"
      mark_done_with services "${installed:-none}"
  }

  firstboot_finalize() {
      # linger is enabled statically via systemd.tmpfiles.rules in bloom-firstboot.nix
      systemctl --user enable --now pi-daemon.service || \
          echo "bloom-firstboot: pi-daemon enable failed (non-fatal)" >&2
      touch "$SETUP_COMPLETE"
      echo "bloom-firstboot: setup complete"
  }

  main() {
      mkdir -p "$WIZARD_STATE"
      step_done netbird  || firstboot_netbird  || true
      step_done matrix   || firstboot_matrix   || true
      step_done services || firstboot_services || true
      firstboot_finalize
  }

  main
  ```

- [ ] **Step 2: Check for the sourcing guard in setup-wizard.sh**

  `firstboot.sh` sources `setup-wizard.sh` to reuse helper functions, but must not trigger `main`. Verify `setup-wizard.sh` ends with a plain `main` call (no guard) and add a guard:

  Open `core/scripts/setup-wizard.sh`, find the last two lines:
  ```bash
  main
  ```

  Replace with:
  ```bash
  # Allow sourcing for function reuse without executing main
  [[ -z "${BLOOM_FIRSTBOOT_SOURCING:-}" ]] && main
  ```

- [ ] **Step 3: Verify syntax of both scripts**

  ```bash
  bash -n core/scripts/firstboot.sh && echo "firstboot.sh: OK"
  bash -n core/scripts/setup-wizard.sh    && echo "wizard.sh: OK"
  ```
  Both should print `OK`.

- [ ] **Step 4: Commit**

  ```bash
  git add core/scripts/firstboot.sh core/scripts/setup-wizard.sh
  git commit -m "feat(scripts): add firstboot.sh non-interactive first-boot automation"
  ```

---

## Task 4: setup-wizard.sh PREFILL_SERVICES support

**Files:**
- Modify: `core/scripts/setup-wizard.sh` (lines 1025–1067, `step_services`)

**Context:** When `PREFILL_SERVICES` is set (e.g., `"fluffychat,dufs"`), skip the interactive `read -rp` prompts and iterate the comma-separated list. When unset/empty, the existing interactive behavior is unchanged. `install_home_infrastructure` is always called first. `write_service_home_runtime` and `mark_done_with` are called in both paths with correct signatures.

- [ ] **Step 1: Replace `step_services` in `setup-wizard.sh`**

  Find the function (lines ~1025–1067):
  ```bash
  step_services() {
  	echo ""
  	echo "--- Services ---"
  	local installed=""
  	local mesh_ip mesh_fqdn
  	mesh_ip=$(read_checkpoint_data netbird)
  	mesh_fqdn=$(netbird_fqdn)

  	echo "  Provisioning Bloom Home landing page..."
  	write_service_home_runtime "$installed" "$mesh_ip" "$mesh_fqdn"
  	if install_home_infrastructure; then
  		echo "  Bloom Home ready."
  	else
  		echo "  Bloom Home setup failed."
  	fi

  	read -rp "Install Bloom Web Chat? (FluffyChat web client for Matrix over NetBird) [y/N]: " fluffychat_answer
  	if [[ "${fluffychat_answer,,}" == "y" ]]; then
  		echo "  Installing FluffyChat..."
  		if install_service fluffychat; then
  			echo "  FluffyChat installed."
  			installed="${installed} fluffychat"
  			write_service_home_runtime "$installed" "$mesh_ip" "$mesh_fqdn"
  		else
  			echo "  FluffyChat installation failed."
  		fi
  	fi

  	read -rp "Install dufs file server? (access files from any device via WebDAV) [y/N]: " dufs_answer
  	if [[ "${dufs_answer,,}" == "y" ]]; then
  		echo "  Installing dufs..."
  		if install_service dufs; then
  			echo "  dufs installed."
  			installed="${installed} dufs"
  			write_service_home_runtime "$installed" "$mesh_ip" "$mesh_fqdn"
  		else
  			echo "  dufs installation failed."
  		fi
  	fi

  	write_service_home_runtime "$installed" "$mesh_ip" "$mesh_fqdn"
  	mark_done_with services "${installed:-none}"
  }
  ```

  Replace with:
  ```bash
  step_services() {
  	echo ""
  	echo "--- Services ---"
  	local installed=""
  	local mesh_ip mesh_fqdn
  	mesh_ip=$(read_checkpoint_data netbird)
  	mesh_fqdn=$(netbird_fqdn)

  	echo "  Provisioning Bloom Home landing page..."
  	write_service_home_runtime "$installed" "$mesh_ip" "$mesh_fqdn"
  	if install_home_infrastructure; then
  		echo "  Bloom Home ready."
  	else
  		echo "  Bloom Home setup failed."
  	fi

  	if [[ -n "${PREFILL_SERVICES:-}" ]]; then
  		# Non-interactive path: iterate comma-separated list from prefill.env
  		IFS=',' read -ra _svc_list <<< "$PREFILL_SERVICES"
  		for _svc in "${_svc_list[@]}"; do
  			_svc="$(echo "$_svc" | xargs)"
  			[[ -z "$_svc" ]] && continue
  			echo "  Installing ${_svc}..."
  			if install_service "$_svc"; then
  				echo "  ${_svc} installed."
  				installed="${installed} ${_svc}"
  				write_service_home_runtime "$installed" "$mesh_ip" "$mesh_fqdn"
  			else
  				echo "  ${_svc} installation failed."
  			fi
  		done
  	else
  		# Interactive path: ask for each optional service
  		read -rp "Install Bloom Web Chat? (FluffyChat web client for Matrix over NetBird) [y/N]: " fluffychat_answer
  		if [[ "${fluffychat_answer,,}" == "y" ]]; then
  			echo "  Installing FluffyChat..."
  			if install_service fluffychat; then
  				echo "  FluffyChat installed."
  				installed="${installed} fluffychat"
  				write_service_home_runtime "$installed" "$mesh_ip" "$mesh_fqdn"
  			else
  				echo "  FluffyChat installation failed."
  			fi
  		fi

  		read -rp "Install dufs file server? (access files from any device via WebDAV) [y/N]: " dufs_answer
  		if [[ "${dufs_answer,,}" == "y" ]]; then
  			echo "  Installing dufs..."
  			if install_service dufs; then
  				echo "  dufs installed."
  				installed="${installed} dufs"
  				write_service_home_runtime "$installed" "$mesh_ip" "$mesh_fqdn"
  			else
  				echo "  dufs installation failed."
  			fi
  		fi
  	fi

  	write_service_home_runtime "$installed" "$mesh_ip" "$mesh_fqdn"
  	mark_done_with services "${installed:-none}"
  }
  ```

- [ ] **Step 2: Verify syntax**

  ```bash
  bash -n core/scripts/setup-wizard.sh && echo "OK"
  ```
  Expected: `OK`

- [ ] **Step 3: Commit**

  ```bash
  git add core/scripts/setup-wizard.sh
  git commit -m "feat(wizard): add PREFILL_SERVICES non-interactive path to step_services"
  ```

---

## Task 5: core/calamares package scaffold

**Files:**
- Create: `core/calamares/package.nix`
- Create: `core/calamares/bloom_nixos/module.desc`
- Create: `core/calamares/bloom_prefill/module.desc`

**Context:** The package is a Nix derivation that copies our Python modules and QML pages into the same layout as the upstream `calamares-nixos-extensions` package (so it can be swapped in via nixpkgs overlay). Module descriptors are YAML files that Calamares reads to locate the Python `main.py`.

- [ ] **Step 1: Create `core/calamares/package.nix`**

  ```nix
  # core/calamares/package.nix
  # Custom calamares-nixos-extensions override for Bloom OS.
  # Replaces the standard nixos install module with bloom_nixos and adds bloom_prefill.
  { pkgs }:

  pkgs.calamares-nixos-extensions.overrideAttrs (old: {
    src = pkgs.runCommand "bloom-calamares-src" {} ''
      # Start from the upstream package source
      cp -r ${old.src} $out
      chmod -R u+w $out

      # Replace the standard nixos module with our bloom_nixos module
      rm -rf $out/modules/nixos
      cp -r ${./bloom_nixos} $out/modules/bloom-nixos

      # Add the bloom_prefill module
      cp -r ${./bloom_prefill} $out/modules/bloom-prefill

      # Add our QML wizard pages
      mkdir -p $out/pages
      cp ${./pages}/*.qml $out/pages/

      # Override Calamares config with our sequence and module configs
      cp ${./config/bloom-settings.conf} $out/settings.conf
      cp ${./config/bloom-nixos.conf}    $out/modules/bloom-nixos/bloom-nixos.conf
      cp ${./config/users.conf}          $out/modules/users/users.conf
    '';
  })
  ```

- [ ] **Step 2: Create `core/calamares/bloom_nixos/module.desc`**

  ```yaml
  # Calamares module descriptor for bloom-nixos
  # Replaces the standard nixos module with Bloom-specific flake generation.
  type:       "job"
  name:       "bloom-nixos"
  interface:  "python"
  script:     "main.py"
  ```

- [ ] **Step 3: Create `core/calamares/bloom_prefill/module.desc`**

  ```yaml
  # Calamares module descriptor for bloom-prefill
  # Writes prefill.env, settings.json, .gitconfig, and NM connections to target.
  type:       "job"
  name:       "bloom-prefill"
  interface:  "python"
  script:     "main.py"
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add core/calamares/package.nix core/calamares/bloom_nixos/module.desc core/calamares/bloom_prefill/module.desc
  git commit -m "feat(calamares): add package scaffold and module descriptors"
  ```

---

## Task 6: bloom_nixos/main.py

**Files:**
- Create: `core/calamares/bloom_nixos/main.py`

**Context:** This Python module runs as Calamares exec job #3 (after partition and mount). It reads `globalstorage` for locale/keyboard/timezone data (same keys as the standard nixos module), generates three files on the target, then runs `nixos-install`. The standard nixos module source is at `pkgs/by-name/ca/calamares-nixos-extensions/` in nixpkgs — reference it for the globalstorage key names (`locale`, `keyboard`, `rootMountPoint`).

- [ ] **Step 1: Create `core/calamares/bloom_nixos/main.py`**

  ```python
  #!/usr/bin/env python3
  # bloom_nixos/main.py
  # Calamares job module: generates Bloom OS NixOS configuration and runs nixos-install.
  # Replaces the standard calamares-nixos-extensions nixos module.
  #
  # Globals read from libcalamares.globalstorage:
  #   rootMountPoint  — target mount point, e.g. "/mnt"
  #   locale          — dict with "language" key, e.g. {"language": "en_US.UTF-8"}
  #   keyboard        — dict with "layout", "variant", "vconsole" keys
  #   timezoneName    — string, e.g. "Europe/London"
  #   efiSystemPartition — path, e.g. "/boot"

  import subprocess
  import os
  import libcalamares


  def pretty_name():
      return "Installing Bloom OS"


  def run():
      gs = libcalamares.globalstorage
      root = gs.value("rootMountPoint") or "/mnt"

      # ── Step 1: Generate hardware-configuration.nix ──────────────────────────
      # Precondition: root is already mounted (exec-phase mount job ran before us).
      libcalamares.utils.debug("bloom_nixos: generating hardware config")
      subprocess.check_output(
          ["pkexec", "nixos-generate-config", "--root", root],
          stderr=subprocess.STDOUT,
      )

      # ── Step 2: Write host-config.nix ────────────────────────────────────────
      locale_data  = gs.value("locale") or {}
      keyboard_data = gs.value("keyboard") or {}
      timezone     = gs.value("timezoneName") or "UTC"
      lang         = locale_data.get("language", "en_US.UTF-8")
      kb_layout    = keyboard_data.get("layout", "us")
      kb_variant   = keyboard_data.get("variant", "")
      vconsole     = keyboard_data.get("vconsole", "us")

      # Detect firmware type: EFI if efiSystemPartition is set
      efi_partition = gs.value("efiSystemPartition")
      if efi_partition:
          bootloader_block = (
              "  boot.loader.systemd-boot.enable = true;\n"
              "  boot.loader.efi.canTouchEfiVariables = true;"
          )
      else:
          bootloader_block = (
              '  boot.loader.grub.enable = true;\n'
              '  boot.loader.grub.device = "nodev";\n'
              '  boot.loader.grub.efiSupport = false;'
          )

      host_config = f"""\
  # host-config.nix — machine-specific overrides, generated by Calamares bloom_nixos module.
  # Do not edit by hand; re-run the installer to regenerate.
  {{ ... }}: {{
  {bootloader_block}
    networking.hostName = "bloom";
    time.timeZone = "{timezone}";
    i18n.defaultLocale = "{lang}";
    services.xserver.xkb = {{ layout = "{kb_layout}"; variant = "{kb_variant}"; }};
    console.keyMap = "{vconsole}";
    networking.networkmanager.enable = true;
    # NOTE: users.users.pi is NOT defined here.
    # bloom-shell.nix (included via nixosModules.platform) owns the pi user definition.
    # Calamares users exec module sets the password via chpasswd (dont_create_user = true).
    system.stateVersion = "25.05";
  }}
  """

      nixos_dir = os.path.join(root, "etc", "nixos")
      os.makedirs(nixos_dir, exist_ok=True)
      with open(os.path.join(nixos_dir, "host-config.nix"), "w") as f:
          f.write(host_config)

      # ── Step 3: Write local flake.nix ────────────────────────────────────────
      flake_nix = """\
  # /etc/nixos/flake.nix — generated by Calamares bloom_nixos module.
  # Use `nixos-rebuild switch --flake /etc/nixos#bloom` to update.
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
      bloomApp = pkgs.callPackage (bloom + "/core/os/pkgs/app") { inherit piAgent; };
    in {
      nixosConfigurations.bloom = nixpkgs.lib.nixosSystem {
        inherit system;
        specialArgs = { inherit piAgent bloomApp; };
        modules = [
          ./hardware-configuration.nix
          ./host-config.nix
          bloom.nixosModules.platform
          bloom.nixosModules.firstboot
        ];
      };
    };
  }
  """

      with open(os.path.join(nixos_dir, "flake.nix"), "w") as f:
          f.write(flake_nix)

      # ── Step 4: Run nixos-install ─────────────────────────────────────────────
      libcalamares.utils.debug("bloom_nixos: running nixos-install")
      result = subprocess.run(
          [
              "pkexec", "nixos-install",
              "--root", root,
              "--no-root-passwd",
              "--flake", root + "/etc/nixos#bloom",
          ],
          capture_output=False,
      )
      if result.returncode != 0:
          return (
              "nixos-install failed",
              "Check the installation log for details. You can retry from the summary page.",
          )

      return None
  ```

- [ ] **Step 2: Verify Python syntax**

  ```bash
  python3 -c "import ast; ast.parse(open('core/calamares/bloom_nixos/main.py').read()); print('syntax OK')"
  ```
  Expected: `syntax OK`

- [ ] **Step 3: Commit**

  ```bash
  git add core/calamares/bloom_nixos/main.py
  git commit -m "feat(calamares): add bloom_nixos Python installer module"
  ```

---

## Task 7: bloom_prefill/main.py

**Files:**
- Create: `core/calamares/bloom_prefill/main.py`

**Context:** Runs after `nixos-install` (exec job #5) and before `umount`. Reads all the Bloom-specific keys from `globalstorage` that the QML pages stored, then writes four things to the target. UID/GID 1000 is hardcoded because the live ISO has no `pi` user in `/etc/passwd` (NixOS deterministically assigns 1000 to the first normal user).

- [ ] **Step 1: Create `core/calamares/bloom_prefill/main.py`**

  ```python
  #!/usr/bin/env python3
  # bloom_prefill/main.py
  # Calamares job module: writes Bloom OS first-boot configuration to the target.
  # Runs after nixos-install and before umount.
  #
  # Writes to target:
  #   ~pi/.bloom/prefill.env      — first-boot automation config
  #   ~pi/.pi/agent/settings.json — AI provider config for pi-daemon
  #   ~pi/.gitconfig              — git identity (if name+email provided)
  #   /etc/NetworkManager/system-connections/*.nmconnection — WiFi credentials

  import glob
  import json
  import os
  import shutil
  import libcalamares

  # UID/GID 1000 is hardcoded: the live ISO has no 'pi' user in /etc/passwd
  # (pwd.getpwnam("pi") would raise KeyError). NixOS deterministically assigns
  # UID 1000 to the first normal user declared in users.users.
  PI_UID = 1000
  PI_GID = 1000


  def pretty_name():
      return "Writing Bloom configuration"


  def _makedirs_owned(path):
      """Create directory tree with pi ownership."""
      os.makedirs(path, exist_ok=True)
      os.chown(path, PI_UID, PI_GID)


  def _write_owned(path, content, mode=0o600):
      """Write file with pi ownership and restricted permissions."""
      os.makedirs(os.path.dirname(path), exist_ok=True)
      with open(path, "w") as f:
          f.write(content)
      os.chmod(path, mode)
      os.chown(path, PI_UID, PI_GID)


  def run():
      gs = libcalamares.globalstorage
      root = gs.value("rootMountPoint") or "/mnt"
      pi_home = os.path.join(root, "home", "pi")

      netbird_key    = gs.value("bloom_netbird_key")    or ""
      matrix_user    = gs.value("bloom_matrix_username") or ""
      git_name       = gs.value("bloom_git_name")       or ""
      git_email      = gs.value("bloom_git_email")      or ""
      services       = gs.value("bloom_services")       or ""

      # ── prefill.env ──────────────────────────────────────────────────────────
      prefill_dir  = os.path.join(pi_home, ".bloom")
      prefill_path = os.path.join(prefill_dir, "prefill.env")
      _makedirs_owned(prefill_dir)

      prefill_content = (
          f"PREFILL_NETBIRD_KEY={netbird_key}\n"
          f"PREFILL_USERNAME={matrix_user}\n"
          f"PREFILL_NAME={git_name}\n"
          f"PREFILL_EMAIL={git_email}\n"
          f"PREFILL_SERVICES={services}\n"
      )
      _write_owned(prefill_path, prefill_content, mode=0o600)
      libcalamares.utils.debug(f"bloom_prefill: wrote {prefill_path}")

      # ── settings.json ────────────────────────────────────────────────────────
      settings_dir  = os.path.join(pi_home, ".pi", "agent")
      settings_path = os.path.join(settings_dir, "settings.json")
      _makedirs_owned(settings_dir)
      os.chown(os.path.join(pi_home, ".pi"), PI_UID, PI_GID)

      settings = {
          "packages": ["/usr/local/share/bloom"],
          "defaultProvider": "localai",
          "defaultModel": "omnicoder-9b-q4_k_m",
          "defaultThinkingLevel": "medium",
      }
      _write_owned(settings_path, json.dumps(settings, indent=2) + "\n", mode=0o600)
      libcalamares.utils.debug(f"bloom_prefill: wrote {settings_path}")

      # ── .gitconfig ───────────────────────────────────────────────────────────
      if git_name and git_email:
          gitconfig_path = os.path.join(pi_home, ".gitconfig")
          gitconfig = f"[user]\n    name = {git_name}\n    email = {git_email}\n"
          _write_owned(gitconfig_path, gitconfig, mode=0o644)
          libcalamares.utils.debug(f"bloom_prefill: wrote {gitconfig_path}")

      # ── NetworkManager WiFi connections (best-effort) ────────────────────────
      src_nm = "/etc/NetworkManager/system-connections"
      dst_nm = os.path.join(root, "etc", "NetworkManager", "system-connections")
      try:
          os.makedirs(dst_nm, exist_ok=True)
          for conn_file in glob.glob(os.path.join(src_nm, "*.nmconnection")):
              shutil.copy2(conn_file, dst_nm)
              libcalamares.utils.debug(f"bloom_prefill: copied {conn_file}")
      except Exception as e:
          # Non-fatal: user may be on ethernet, or permissions may differ
          libcalamares.utils.warning(f"bloom_prefill: NM connection copy failed: {e}")

      return None
  ```

- [ ] **Step 2: Verify Python syntax**

  ```bash
  python3 -c "import ast; ast.parse(open('core/calamares/bloom_prefill/main.py').read()); print('syntax OK')"
  ```
  Expected: `syntax OK`

- [ ] **Step 3: Commit**

  ```bash
  git add core/calamares/bloom_prefill/main.py
  git commit -m "feat(calamares): add bloom_prefill Python module"
  ```

---

## Task 8: QML wizard pages

**Files:**
- Create: `core/calamares/pages/BloomGit.qml`
- Create: `core/calamares/pages/BloomMatrix.qml`
- Create: `core/calamares/pages/BloomNetbird.qml`
- Create: `core/calamares/pages/BloomServices.qml`

**Context:** Calamares QML pages are show-phase UI components. They write values into `Calamares.Global.storage` (the JS API for `libcalamares.globalstorage`). All fields are optional — the user can leave them blank to skip that feature. Pages use the standard Calamares QML API: `Calamares.Global.storage.insert(key, value)`.

- [ ] **Step 1: Create `core/calamares/pages/BloomGit.qml`**

  ```qml
  /* BloomGit.qml — Collect git identity for .gitconfig */
  import QtQuick 2.15
  import QtQuick.Controls 2.15
  import QtQuick.Layouts 1.15
  import org.calamares.ui 1.0

  Page {
      id: gitPage

      property bool isNextEnabled: true  // all fields optional

      ColumnLayout {
          anchors.centerIn: parent
          width: Math.min(parent.width * 0.7, 480)
          spacing: 16

          Label {
              text: qsTr("Git Identity (optional)")
              font.bold: true
              font.pixelSize: 18
          }

          Label {
              text: qsTr("Set your name and email for git commits. You can change these later with git config.")
              wrapMode: Text.WordWrap
              Layout.fillWidth: true
          }

          TextField {
              id: nameField
              placeholderText: qsTr("Full name (e.g. Alice Smith)")
              Layout.fillWidth: true
              onTextChanged: Calamares.Global.storage.insert("bloom_git_name", text)
          }

          TextField {
              id: emailField
              placeholderText: qsTr("Email address")
              Layout.fillWidth: true
              onTextChanged: Calamares.Global.storage.insert("bloom_git_email", text)
          }
      }
  }
  ```

- [ ] **Step 2: Create `core/calamares/pages/BloomMatrix.qml`**

  ```qml
  /* BloomMatrix.qml — Collect Matrix chat username */
  import QtQuick 2.15
  import QtQuick.Controls 2.15
  import QtQuick.Layouts 1.15
  import org.calamares.ui 1.0

  Page {
      id: matrixPage

      property bool isNextEnabled: true  // optional

      ColumnLayout {
          anchors.centerIn: parent
          width: Math.min(parent.width * 0.7, 480)
          spacing: 16

          Label {
              text: qsTr("Matrix Username (optional)")
              font.bold: true
              font.pixelSize: 18
          }

          Label {
              text: qsTr("Choose a username for your private Matrix chat account. "
                         "This is your handle on the local homeserver (e.g. @alice:bloom). "
                         "Leave blank to set this up later.")
              wrapMode: Text.WordWrap
              Layout.fillWidth: true
          }

          Label { text: qsTr("Username") }

          TextField {
              id: usernameField
              placeholderText: qsTr("alice")
              Layout.fillWidth: true
              validator: RegularExpressionValidator {
                  regularExpression: /^[a-z][a-z0-9._-]*$|^$/
              }
              onTextChanged: Calamares.Global.storage.insert("bloom_matrix_username", text)
          }

          Label {
              text: qsTr("Lowercase letters, numbers, '.', '_', '-' only. Cannot be changed later.")
              font.pixelSize: 11
              color: "gray"
              wrapMode: Text.WordWrap
              Layout.fillWidth: true
          }
      }
  }
  ```

- [ ] **Step 3: Create `core/calamares/pages/BloomNetbird.qml`**

  ```qml
  /* BloomNetbird.qml — Collect NetBird setup key */
  import QtQuick 2.15
  import QtQuick.Controls 2.15
  import QtQuick.Layouts 1.15
  import org.calamares.ui 1.0

  Page {
      id: netbirdPage

      property bool isNextEnabled: true  // optional

      ColumnLayout {
          anchors.centerIn: parent
          width: Math.min(parent.width * 0.7, 480)
          spacing: 16

          Label {
              text: qsTr("NetBird VPN (optional)")
              font.bold: true
              font.pixelSize: 18
          }

          Label {
              text: qsTr("NetBird creates a secure private mesh so you can access Bloom from anywhere. "
                         "Get a setup key from app.netbird.io → Setup Keys. "
                         "Leave blank to connect manually later.")
              wrapMode: Text.WordWrap
              Layout.fillWidth: true
          }

          Label { text: qsTr("Setup Key") }

          TextField {
              id: keyField
              placeholderText: qsTr("Paste your NetBird setup key")
              echoMode: TextInput.Password
              Layout.fillWidth: true
              onTextChanged: Calamares.Global.storage.insert("bloom_netbird_key", text)
          }
      }
  }
  ```

- [ ] **Step 4: Create `core/calamares/pages/BloomServices.qml`**

  ```qml
  /* BloomServices.qml — Select optional services */
  import QtQuick 2.15
  import QtQuick.Controls 2.15
  import QtQuick.Layouts 1.15
  import org.calamares.ui 1.0

  Page {
      id: servicesPage

      property bool isNextEnabled: true

      function updateStorage() {
          var selected = []
          if (fluffychatCheck.checked) selected.push("fluffychat")
          if (dufsCheck.checked) selected.push("dufs")
          Calamares.Global.storage.insert("bloom_services", selected.join(","))
      }

      ColumnLayout {
          anchors.centerIn: parent
          width: Math.min(parent.width * 0.7, 480)
          spacing: 16

          Label {
              text: qsTr("Optional Services")
              font.bold: true
              font.pixelSize: 18
          }

          Label {
              text: qsTr("These services are installed on first boot. All are optional and can be added later.")
              wrapMode: Text.WordWrap
              Layout.fillWidth: true
          }

          CheckBox {
              id: fluffychatCheck
              text: qsTr("Bloom Web Chat (FluffyChat) — Matrix web client over NetBird")
              onCheckedChanged: servicesPage.updateStorage()
          }

          CheckBox {
              id: dufsCheck
              text: qsTr("dufs file server — access files from any device via WebDAV")
              onCheckedChanged: servicesPage.updateStorage()
          }
      }
  }
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add core/calamares/pages/
  git commit -m "feat(calamares): add BloomGit, BloomMatrix, BloomNetbird, BloomServices QML pages"
  ```

---

## Task 9: Calamares configuration files

**Files:**
- Create: `core/calamares/config/bloom-settings.conf`
- Create: `core/calamares/config/bloom-nixos.conf`
- Create: `core/calamares/config/users.conf`

**Context:** `bloom-settings.conf` is the Calamares top-level configuration; it defines the full show + exec sequence. `users.conf` must set `dont_create_user: true` because `pi` already exists after `nixos-install` activates `bloom-shell.nix`. `bloom-nixos.conf` configures the `bloom-nixos` job module.

- [ ] **Step 1: Create `core/calamares/config/bloom-settings.conf`**

  ```yaml
  # bloom-settings.conf — Calamares sequence for Bloom OS installer
  ---
  modules-search: [ local, /run/current-system/lib/calamares/modules ]

  sequence:
    - show:
      - welcome
      - locale
      - keyboard
      - users
      - bloom-git
      - bloom-matrix
      - bloom-netbird
      - bloom-services
      - partition
      - summary
    - exec:
      - partition
      - mount
      - bloom-nixos
      - users
      - bloom-prefill
      - umount
    - show:
      - finished

  branding: nixi
  prompt-install: false
  dont-chroot: false
  ```

- [ ] **Step 2: Create `core/calamares/config/bloom-nixos.conf`**

  ```yaml
  # bloom-nixos.conf — configuration for the bloom-nixos Calamares job module
  ---
  # No additional configuration needed; all values are read from globalstorage.
  # This file is required by the Calamares module loader.
  ```

- [ ] **Step 3: Create `core/calamares/config/users.conf`**

  ```yaml
  # users.conf — Calamares users module configuration for Bloom OS
  # The OS user is always "pi". The user types only a password on the users page.
  ---
  defaultGroups:
    - users
    - wheel
    - networkmanager
    - audio
    - video

  # Lock the username to "pi" — no text field shown, value is fixed.
  user:
    shell: /run/current-system/sw/bin/bash
    forbidden_names: []

  # CRITICAL: pi already exists after nixos-install (declared in bloom-shell.nix).
  # Without this flag, the users exec module calls `useradd pi` which fails with
  # "user already exists". Setting this to true makes it only run chpasswd.
  dont_create_user: true

  autologin_group:
  sudoers_group: wheel

  hostname_action: none
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add core/calamares/config/
  git commit -m "feat(calamares): add Calamares configuration files (sequence, nixos conf, users conf)"
  ```

---

## Task 10: x86_64-installer.nix update

**Files:**
- Modify: `core/os/hosts/x86_64-installer.nix`

**Context:** The installer host config needs to (1) use our custom `core/calamares/package.nix` derivation instead of the upstream `calamares-nixos-extensions`, and (2) remove the `bloom-convert` desktop item and script that are no longer needed.

- [ ] **Step 1: Replace the content of `core/os/hosts/x86_64-installer.nix`**

  ```nix
  # core/os/hosts/x86_64-installer.nix
  # Graphical installer ISO configuration for Bloom OS.
  # Uses Calamares GUI installer with LXQt desktop.
  # Custom calamares-nixos-extensions override provides Bloom-specific wizard pages.
  { pkgs, lib, modulesPath, ... }:

  let
    # Build the custom Calamares extensions package from core/calamares/
    bloomCalamaresExtensions = pkgs.callPackage ../../calamares/package.nix { };
  in
  {
    imports = [
      # Calamares + GNOME installer base (provides Calamares, display manager, etc.)
      # We override the desktop to LXQt below.
      "${modulesPath}/installer/cd-dvd/installation-cd-graphical-calamares-gnome.nix"

      # LXQt desktop configuration
      ../modules/desktop.nix
    ];

    # Replace upstream calamares-nixos-extensions with our custom Bloom version
    nixpkgs.overlays = [
      (final: prev: {
        calamares-nixos-extensions = bloomCalamaresExtensions;
      })
    ];

    # Override: Use LXQt instead of GNOME
    services.desktopManager.gnome.enable = lib.mkForce false;
    services.displayManager.gdm.enable   = lib.mkForce false;

    # Ensure LightDM for LXQt
    services.xserver.displayManager.lightdm.enable = lib.mkDefault true;

    # ISO-specific settings
    isoImage.volumeID  = lib.mkDefault "BLOOM_INSTALLER";
    image.fileName     = lib.mkDefault "os-installer.iso";

    boot.kernelParams = [
      "copytoram"
      "quiet"
      "splash"
    ];

    environment.etc."issue".text = ''
      Welcome to Bloom OS Installer!

      Double-click the desktop icon to launch the installer.

      For help, visit: https://github.com/alexradunet/piBloom

    '';

    programs.firefox.preferences = {
      "browser.startup.homepage" = "https://github.com/alexradunet/piBloom";
    };

    networking.hostName = lib.mkDefault "bloom-installer";

    services.libinput.enable = true;
    networking.networkmanager.enable    = true;
    networking.wireless.enable          = lib.mkForce false;
  }
  ```

- [ ] **Step 2: Delete `core/scripts/bloom-convert.sh`**

  ```bash
  git rm core/scripts/bloom-convert.sh
  ```

- [ ] **Step 3: Verify the flake evaluates with the new installer host**

  ```bash
  nix eval .#packages.x86_64-linux --apply builtins.attrNames
  ```
  Expected output includes `iso-gui` (plus `app`, `qcow2`, `raw`, `iso`).

- [ ] **Step 4: Commit**

  ```bash
  git add core/os/hosts/x86_64-installer.nix
  git commit -m "feat(installer): wire custom Calamares package, remove bloom-convert"
  ```

---

## Task 11: Integration build + smoke test

**Files:** none new — verification only

**Context:** Build the full ISO and run it in QEMU to verify the wizard pages appear and the install sequence works end-to-end.

- [ ] **Step 1: Run `nix flake check`**

  ```bash
  nix flake check
  ```
  Expected: exits 0, no errors.

- [ ] **Step 2: Build the graphical installer ISO**

  ```bash
  just iso-gui
  ```
  This takes 30–60 min on first build (downloads nixpkgs). Expected: `result/iso/os-installer.iso` (or similar path shown in output).

- [ ] **Step 3: Boot the ISO in QEMU**

  ```bash
  just test-iso-gui
  ```
  In the QEMU window, verify:
  - LXQt desktop loads
  - Calamares starts (or double-click if it doesn't auto-launch)
  - Wizard shows all expected pages in order: Welcome → Locale → Keyboard → Users → **Git** → **Matrix** → **NetBird** → **Services** → Partition → Summary
  - All four Bloom pages display correctly with the described fields

- [ ] **Step 4: Complete a test install**

  In the QEMU Calamares wizard:
  - Fill in test values on the Bloom pages (e.g. git name "Test User", matrix user "testuser", leave NetBird blank, check FluffyChat)
  - Complete the partition step (use the full 40GB virtual disk)
  - Click Install, wait for nixos-install to complete
  - Click Reboot

- [ ] **Step 5: Boot the installed system and verify first-boot service**

  After reboot, the VM will boot from the installed disk. Check:
  ```bash
  # Wait for first boot to complete (bloom-firstboot.service runs before getty)
  systemctl status bloom-firstboot
  ```
  Expected: `active (exited)` — setup completed.

  ```bash
  cat ~/.bloom/prefill.env
  ```
  Expected: file exists with the values entered in the wizard.

  ```bash
  cat ~/.pi/agent/settings.json
  ```
  Expected: contains `localai`, `omnicoder-9b-q4_k_m`, `medium`.

  ```bash
  ls ~/.bloom/.setup-complete
  ```
  Expected: file exists.

- [ ] **Step 6: Final commit**

  If any minor fixes were needed during smoke testing, commit them:
  ```bash
  git add -p
  git commit -m "fix(calamares): smoke test fixes"
  ```
