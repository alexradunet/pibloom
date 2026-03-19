# NixOS Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully migrate Bloom OS from Fedora bootc to NixOS with a modular flake, replacing the Containerfile/BIB pipeline with `nix build` and `nixos-rebuild`.

**Architecture:** A single `flake.nix` at repo root exposes `nixosConfigurations.bloom-x86_64` and format-specific image packages (qcow2, raw, iso) via `nixos-generators`. Five focused NixOS modules under `core/os/modules/` compose into the host config. The only custom derivation is `app` (the TypeScript monorepo). `pkgs.matrix-continuwuity` and the `pi` agent from `llm-agents.nix` are sourced from upstream.

**Tech Stack:** Nix flakes, NixOS modules, nixos-generators, disko, llm-agents.nix (pi agent), `buildNpmPackage`, systemd tmpfiles, TypeScript (unchanged logic, updated OS interface)

**Spec:** `docs/superpowers/specs/2026-03-16-nixos-migration-design.md`

---

## File Map

### Created
| File | Purpose |
|------|---------|
| `flake.nix` | Flake inputs + all outputs |
| `core/os/hosts/x86_64.nix` | x86_64 host: imports modules, bootloader, disk, stateVersion |
| `core/os/modules/app.nix` | Bloom app install, pi-daemon user service, tmpfiles |
| `core/os/modules/matrix.nix` | Continuwuity Matrix server system service |
| `core/os/modules/network.nix` | NetBird, SSH, firewall, NetworkManager, packages |
| `core/os/modules/shell.nix` | pi user, autologin, sudoers, skel copy, branding |
| `core/os/modules/update.nix` | nixos-rebuild OTA timer, Cachix substituter |
| `core/os/pkgs/app/default.nix` | buildNpmPackage derivation for the Bloom TS monorepo |
| `core/os/disk/x86_64-disk.nix` | disko: EFI + btrfs root |
| `core/scripts/setup-wizard.sh` | Moved from system_files (first-boot wizard) |
| `core/scripts/login-greeting.sh` | Moved from system_files (login greeting) |
| `core/scripts/system-update.sh` | New: NixOS update + status-file script |

### Modified
| File | Change |
|------|--------|
| `justfile` | Replace all podman/BIB/bootc recipes with nix equivalents |
| `core/pi/extensions/os/types.ts` | `UpdateStatus`: add `generation?`, note `version` is now unused |
| `core/pi/extensions/os/actions.ts` | Replace `handleBootc` with `handleNixosUpdate`; fix `handleUpdateStatus` |
| `core/pi/extensions/os/index.ts` | Replace `bootc` tool with `nixos_update` tool |
| `core/pi/extensions/os/actions-health.ts` | Replace `bootcSection` with NixOS generation section |
| `core/lib/repo.ts` | Remove `bootc status` inference; rely on git remote only |
| `core/pi/extensions/bloom-services/actions-manifest.ts` | Remove `bootc status` image inference |

### Deleted
| Path | Reason |
|------|--------|
| `core/os/Containerfile` | Replaced by flake |
| `core/os/bib.Containerfile` | BIB workaround gone |
| `core/os/build_files/` | All shell build scripts replaced by Nix |
| `core/os/packages/` | package lists and repos.sh replaced by Nix |
| `core/os/system_files/` | All system files declared in NixOS modules |
| `core/os/disk_config/` | bib-config replaced by disko |

---

## Chunk 1: Flake Scaffolding + Disk Layout

### Task 1: Create directory structure

**Files:**
- Create: `core/os/hosts/` `core/os/modules/` `core/os/pkgs/app/` `core/os/disk/` `core/scripts/`

- [ ] **Step 1: Create directories**

```bash
mkdir -p core/os/hosts core/os/modules core/os/pkgs/app core/os/disk core/scripts
```

- [ ] **Step 2: Verify structure**

```bash
ls core/os/
```

Expected: `build_files  disk  disk_config  hosts  modules  packages  pkgs  system_files  Containerfile  bib.Containerfile`

- [ ] **Step 3: Copy setup-wizard.sh and login-greeting.sh to core/scripts/**

```bash
cp core/os/system_files/usr/local/bin/setup-wizard.sh core/scripts/setup-wizard.sh
cp core/os/system_files/usr/local/bin/login-greeting.sh core/scripts/login-greeting.sh
chmod +x core/scripts/setup-wizard.sh core/scripts/login-greeting.sh
```

> **Note:** The originals remain in `core/os/system_files/` until Task 15 deletes old files. Both copies coexist during the migration — this is intentional. Task 4 references `core/scripts/` paths which are already valid after this step.

- [ ] **Step 4: Add .gitkeep to empty directories so git tracks them**

```bash
touch core/os/hosts/.gitkeep core/os/modules/.gitkeep core/os/pkgs/app/.gitkeep core/os/disk/.gitkeep
```

- [ ] **Step 5: Commit**

```bash
git add core/os/hosts/ core/os/modules/ core/os/pkgs/ core/os/disk/ core/scripts/
git commit -m "chore: scaffold NixOS migration directory structure and copy wizard/greeting scripts"
```

---

### Task 2: Write minimal flake.nix (evaluates, no useful outputs yet)

**Files:**
- Create: `flake.nix`

- [ ] **Step 1: Write flake.nix**

```nix
# flake.nix
{
  description = "Bloom OS — Pi-native AI companion OS on NixOS";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    nixos-generators = {
      url = "github:nix-community/nixos-generators";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    disko = {
      url = "github:nix-community/disko";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    llm-agents-nix = {
      url = "github:numtide/llm-agents.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, nixos-generators, disko, llm-agents-nix, ... }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      piAgent = llm-agents-nix.packages.${system}.pi;
      bloomApp = pkgs.callPackage ./core/os/pkgs/app { inherit piAgent; };
    in {
      packages.${system} = {
        app = bloomApp;
      };

      nixosConfigurations.bloom-x86_64 = nixpkgs.lib.nixosSystem {
        inherit system;
        modules = [
          disko.nixosModules.disko
          ./core/os/hosts/x86_64.nix
        ];
        specialArgs = { inherit piAgent bloomApp; };
      };
    };
}
```

- [ ] **Step 2: Generate flake.lock**

```bash
nix flake lock
```

Expected: `flake.lock` is created. May take a few minutes on first run as all inputs are fetched from GitHub.

- [ ] **Step 3: Verify flake inputs resolved**

```bash
nix flake metadata . 2>&1 | grep -E "Inputs|nixpkgs|disko|llm"
```

Expected: all four inputs listed with resolved revisions.

> **Note on `nix flake show`:** Do NOT run `nix flake show` at this point. It eagerly evaluates `nixosConfigurations`, which will hard-fail because `core/os/hosts/x86_64.nix` and `core/os/pkgs/app/default.nix` don't exist yet. Run it after Task 5 (host stub) is in place.

- [ ] **Step 4: Write a minimal host stub so the flake can evaluate**

Create `core/os/hosts/x86_64.nix` as a temporary stub (replaced fully in Task 10):

```nix
# core/os/hosts/x86_64.nix — temporary evaluation stub; replaced in Task 10
{ ... }: {
  system.stateVersion = "25.05";
  nixpkgs.hostPlatform = "x86_64-linux";
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;
  fileSystems."/" = { device = "nodev"; fsType = "tmpfs"; };
}
```

Remove the `.gitkeep` from hosts/ now that a real file exists:
```bash
rm core/os/hosts/.gitkeep
```

- [ ] **Step 5: Commit flake + host stub**

```bash
git add flake.nix flake.lock core/os/hosts/x86_64.nix
git commit -m "feat: add flake.nix with NixOS inputs and host stub"
```

---

### Task 3: Write disko disk layout

**Files:**
- Create: `core/os/disk/x86_64-disk.nix`

- [ ] **Step 1: Write disk layout**

```nix
# core/os/disk/x86_64-disk.nix
# Declarative disk layout via disko.
# Replaces core/os/disk_config/bib-config.toml filesystem block.
# At install time, run: sudo disko-install --flake .#bloom-x86_64 --disk main /dev/sdX
{
  disk = {
    main = {
      type = "disk";
      # Device is overridden at install time via disko-install --disk flag.
      device = "/dev/sda";
      content = {
        type = "gpt";
        partitions = {
          ESP = {
            size = "512M";
            type = "EF00";
            content = {
              type = "filesystem";
              format = "vfat";
              mountpoint = "/boot";
              mountOptions = [ "defaults" ];
            };
          };
          root = {
            size = "100%";
            content = {
              type = "filesystem";
              format = "btrfs";
              mountpoint = "/";
              # compress=zstd: deliberate addition over spec's minimal description;
              # btrfs transparent compression reduces disk I/O with negligible CPU cost.
              mountOptions = [ "defaults" "compress=zstd" ];
            };
          };
        };
      };
    };
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add core/os/disk/x86_64-disk.nix
git commit -m "feat: add disko btrfs+EFI disk layout for x86_64"
```

---

## Chunk 2: app Derivation

### Task 4: Write app buildNpmPackage derivation

**Files:**
- Create: `core/os/pkgs/app/default.nix`

The `piAgent` argument is the `pi` package from `llm-agents.nix`. Before finalising the symlink paths, inspect its output structure:

```bash
nix build github:numtide/llm-agents.nix#pi --print-out-paths 2>/dev/null && ls result/
```

This tells you where pi-coding-agent's node_modules live (e.g. `result/lib/node_modules/` or `result/share/`). Adjust the symlink paths in installPhase accordingly.

- [ ] **Step 1: Inspect piAgent output structure FIRST to confirm symlink paths**

```bash
nix build github:numtide/llm-agents.nix#packages.x86_64-linux.pi -o /tmp/pi-agent-out
find /tmp/pi-agent-out -name "pi-coding-agent" -o -name "pi-ai" 2>/dev/null | head -10
ls /tmp/pi-agent-out/lib/node_modules/ 2>/dev/null || ls /tmp/pi-agent-out/
```

Note the exact path to `pi-coding-agent` and `pi-ai` in the output. The derivation in Step 2 uses `lib/node_modules/` as the assumed layout — update the symlink paths if different.

- [ ] **Step 2: Write the derivation with a placeholder npmDepsHash**

```nix
# core/os/pkgs/app/default.nix
{ lib, buildNpmPackage, nodejs, piAgent }:

buildNpmPackage {
  pname = "app";
  version = "0.1.0";

  # Source: repo root filtered to exclude build artifacts and the OS layer itself.
  src = lib.cleanSourceWith {
    src = ../../../..;
    filter = path: _type:
      let
        rel = lib.removePrefix (toString ../../../..) (toString path);
      in
        !(lib.hasPrefix "/node_modules" rel
          || lib.hasPrefix "/dist" rel
          || lib.hasPrefix "/coverage" rel
          || lib.hasPrefix "/core/os" rel
          || lib.hasPrefix "/.git" rel
          || lib.hasSuffix ".qcow2" rel
          || lib.hasSuffix ".iso" rel);
  };

  # Placeholder — will be replaced with the real hash in Step 4.
  npmDepsHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

  buildPhase = ''
    runHook preBuild
    npm run build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/share/bloom
    cp -r dist package.json node_modules $out/share/bloom/

    # Scripts (accessible on PATH via environment.systemPackages)
    mkdir -p $out/bin
    install -m 755 ${../../../../core/scripts/setup-wizard.sh} $out/bin/setup-wizard.sh
    install -m 755 ${../../../../core/scripts/login-greeting.sh} $out/bin/login-greeting.sh

    # Wire pi-coding-agent symlinks.
    # Paths below assume layout found in Step 1: lib/node_modules/@mariozechner/...
    # Update if Step 1 revealed a different layout.
    rm -rf $out/share/bloom/node_modules/@mariozechner
    mkdir -p $out/share/bloom/node_modules/@mariozechner
    ln -sf ${piAgent}/lib/node_modules/@mariozechner/pi-coding-agent \
      $out/share/bloom/node_modules/@mariozechner/pi-coding-agent
    ln -sf ${piAgent}/lib/node_modules/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-ai \
      $out/share/bloom/node_modules/@mariozechner/pi-ai || true

    # Pi settings (default; overridden at runtime by login-greeting.sh)
    mkdir -p $out/share/bloom/.pi/agent
    echo '{"packages": ["/usr/local/share/bloom"]}' > $out/share/bloom/.pi/agent/settings.json

    # Back-compat symlinks — use relative paths to avoid baking store path into link target
    cd $out/share/bloom
    ln -sf core/pi/persona persona
    ln -sf core/pi/skills  skills

    runHook postInstall
  '';

  meta = {
    description = "Bloom AI companion OS TypeScript application";
    license = lib.licenses.mit;
  };
}
```

- [ ] **Step 3: First build attempt (will fail with wrong hash — that's expected)**

```bash
nix build .#app 2>&1 | tail -20
```

Expected output contains: `error: hash mismatch in fixed-output derivation` with a line like:
```
  got:    sha256-<ACTUAL_HASH>
```

- [ ] **Step 4: Copy the correct hash into the derivation**

Edit `core/os/pkgs/app/default.nix` — replace the placeholder:
```nix
npmDepsHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
```
with the actual hash from Step 3's error output.

- [ ] **Step 5: Build succeeds — verify no dangling symlinks**

```bash
nix build .#app
ls result/share/bloom/dist/
ls result/share/bloom/node_modules/@mariozechner/
# Verify symlinks are not dangling (find -L resolves symlinks; dangling ones appear as broken)
find -L result/share/bloom/node_modules/@mariozechner/ -maxdepth 1 -type l 2>&1 | grep -v "No such file" || true
ls -la result/share/bloom/node_modules/@mariozechner/pi-ai 2>&1
```

Expected: `dist/` contains compiled JS, `node_modules/@mariozechner/` has `pi-coding-agent` and `pi-ai` entries. The `pi-ai` path resolves to a real directory inside the piAgent store path. If `pi-ai` is a dangling symlink (target path not found), the `|| true` in `installPhase` will have silently accepted a broken link — in that case revisit Step 1's output and correct the symlink target path in `default.nix`.

- [ ] **Step 6: Verify scripts are present**

```bash
ls result/bin/
```

Expected: `login-greeting.sh  setup-wizard.sh`

- [ ] **Step 7: Commit**

```bash
git add core/os/pkgs/app/default.nix core/scripts/
git commit -m "feat: add app buildNpmPackage derivation"
```

---

## Chunk 3: NixOS Modules

### Task 5: bloom-shell.nix — user, autologin, sudoers, skel, branding

**Files:**
- Create: `core/os/modules/shell.nix`

- [ ] **Step 1: Write bloom-shell.nix**

```nix
# core/os/modules/shell.nix
{ pkgs, lib, ... }:

let
  bashrc = pkgs.writeText "bloom-bashrc" ''
    export BLOOM_DIR="$HOME/Bloom"
    export XDG_RUNTIME_DIR="/run/user/$(id -u)"
    export BROWSER="chromium"
    export PATH="/usr/local/share/bloom/node_modules/.bin:$PATH"
  '';

  bashProfile = pkgs.writeText "bloom-bash_profile" ''
    # Source .bashrc for env vars (BLOOM_DIR, PATH, etc.)
    [ -f ~/.bashrc ] && . ~/.bashrc

    # First-boot wizard (runs once, before Pi)
    if [ -t 0 ] && [ ! -f "$HOME/.bloom/.setup-complete" ]; then
      setup-wizard.sh
    fi

    # Start Pi on interactive login (only after setup, only one instance — atomic mkdir lock)
    if [ -t 0 ] && [ -f "$HOME/.bloom/.setup-complete" ] && [ -z "$PI_SESSION" ] && mkdir /tmp/.bloom-pi-session 2>/dev/null; then
      trap 'rmdir /tmp/.bloom-pi-session 2>/dev/null' EXIT
      export PI_SESSION=1
      login-greeting.sh
      exec pi
    fi
  '';
in
{
  # pi user
  users.users.pi = {
    isNormalUser = true;
    group = "pi";
    extraGroups = [ "wheel" "networkmanager" "podman" ];
    home = "/home/pi";
    shell = pkgs.bash;
  };
  users.groups.pi = {};

  # Passwordless sudo for pi
  security.sudo.extraRules = [
    {
      users = [ "pi" ];
      commands = [ { command = "ALL"; options = [ "NOPASSWD" ]; } ];
    }
  ];

  # Autologin on tty1
  services.getty.autologinUser = "pi";

  # Autologin on ttyS0 (serial console)
  # Must use lib.mkForce to override the upstream ExecStart.
  systemd.services."serial-getty@ttyS0" = {
    overrideStrategy = "asDropin";
    serviceConfig.ExecStart = lib.mkForce [
      "" # clear upstream ExecStart first
      "${pkgs.util-linux}/sbin/agetty --autologin pi --keep-baud 115200,57600,38400,9600 ttyS0 $TERM"
    ];
  };

  # Skel files — written to /etc/skel; copied to home on first boot only (C = copy-if-absent)
  environment.etc = {
    "skel/.bashrc".source = bashrc;
    "skel/.bash_profile".source = bashProfile;
    "issue".text = "Bloom OS\n";
  };

  # Copy skel files to /home/pi on first boot if missing
  systemd.tmpfiles.rules = [
    "C /home/pi/.bashrc      0644 pi pi - /etc/skel/.bashrc"
    "C /home/pi/.bash_profile 0644 pi pi - /etc/skel/.bash_profile"
  ];

  # Kernel console verbosity (suppress noise from networking/containers on tty)
  boot.kernel.sysctl."kernel.printk" = "4 4 1 7";

  # Hostname (overridable per host)
  networking.hostName = lib.mkDefault "bloom";
}
```

- [ ] **Step 2: Add bloom-shell to the host stub imports and evaluate**

Edit `core/os/hosts/x86_64.nix` (the stub from Task 2) to add the import:

```nix
{ ... }: {
  imports = [ ../modules/bloom-shell.nix ];
  system.stateVersion = "25.05";
  nixpkgs.hostPlatform = "x86_64-linux";
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;
  fileSystems."/" = { device = "nodev"; fsType = "tmpfs"; };
}
```

```bash
nix eval .#nixosConfigurations.bloom-x86_64.config.users.users.pi.isNormalUser
```

Expected: `true`

- [ ] **Step 3: Commit**

```bash
git add core/os/modules/shell.nix core/os/hosts/x86_64.nix
git commit -m "feat: add bloom-shell NixOS module (pi user, autologin, skel, branding)"
```

---

### Task 6: bloom-network.nix — NetBird, SSH, firewall, packages

**Files:**
- Create: `core/os/modules/network.nix`

- [ ] **Step 1: Write bloom-network.nix**

```nix
# core/os/modules/network.nix
{ pkgs, lib, config, ... }:

{
  options.bloom.wifi = {
    ssid = lib.mkOption { type = lib.types.str; default = ""; description = "WiFi SSID (empty = disabled)"; };
    psk  = lib.mkOption { type = lib.types.str; default = ""; description = "WiFi PSK";  };
  };

  config = {
    # NetBird mesh networking
    services.netbird.enable = true;

    # SSH — password-only auth (matches existing 50-bloom.conf)
    services.openssh = {
      enable = true;
      settings = {
        PasswordAuthentication = true;
        # PubkeyAuthentication disabled deliberately — matches current config.
        # Change to "yes" when key-based auth is intentionally enabled.
        PubkeyAuthentication = "no";
        PermitRootLogin = "no";
      };
    };

    # Firewall — trust NetBird tunnel interface
    networking.firewall.trustedInterfaces = [ "wt0" ];

    # NetworkManager
    networking.networkmanager.enable = true;

    # Optional WiFi pre-configuration (replaces WIFI_SSID/WIFI_PSK build args)
    environment.etc."NetworkManager/system-connections/wifi.nmconnection" =
      lib.mkIf (config.bloom.wifi.ssid != "") {
        mode = "0600";
        text = ''
          [connection]
          id=${config.bloom.wifi.ssid}
          type=wifi
          autoconnect=true

          [wifi]
          mode=infrastructure
          ssid=${config.bloom.wifi.ssid}

          [wifi-security]
          key-mgmt=wpa-psk
          psk=${config.bloom.wifi.psk}

          [ipv4]
          method=auto

          [ipv6]
          method=auto
        '';
      };

    # System packages — all development tools
    environment.systemPackages = with pkgs; [
      # Core tools
      git git-lfs gh
      ripgrep fd bat htop jq curl wget unzip openssl

      # Build/format
      just shellcheck biome typescript

      # Container tooling
      podman buildah skopeo oras

      # VM testing (OVMF = UEFI firmware for QEMU; nixpkgs attr is OVMF not edk2-ovmf)
      qemu OVMF

      # AI / editors
      vscode chromium

      # Network
      netbird
    ];
  };
}
```

- [ ] **Step 2: Add bloom-network to the host stub imports and evaluate**

Edit `core/os/hosts/x86_64.nix` to add `../modules/bloom-network.nix` to its imports list, then:

```bash
nix eval .#nixosConfigurations.bloom-x86_64.config.services.netbird.enable
```

Expected: `true`

- [ ] **Step 3: Commit**

```bash
git add core/os/modules/network.nix
git commit -m "feat: add bloom-network NixOS module (netbird, SSH, firewall, packages)"
```

---

### Task 7: bloom-matrix.nix — Continuwuity Matrix server

**Files:**
- Create: `core/os/modules/matrix.nix`

The matrix.toml content is in `core/os/system_files/etc/bloom/matrix.toml`. Read it:
```
[global]
server_name = "bloom"
database_path = "/var/lib/continuwuity"
port = [6167]
address = "0.0.0.0"
allow_federation = false
allow_registration = true
registration_token_file = "/var/lib/continuwuity/registration_token"
max_request_size = 20000000
allow_check_for_updates = false
```

- [ ] **Step 1: Write bloom-matrix.nix**

```nix
# core/os/modules/matrix.nix
{ pkgs, lib, ... }:

{
  environment.etc."bloom/matrix.toml".text = ''
    [global]
    server_name = "bloom"
    database_path = "/var/lib/continuwuity"
    port = [6167]
    address = "0.0.0.0"
    allow_federation = false
    allow_registration = true
    registration_token_file = "/var/lib/continuwuity/registration_token"
    max_request_size = 20000000
    allow_check_for_updates = false
  '';

  systemd.services.bloom-matrix = {
    description = "Bloom Matrix Homeserver (Continuwuity)";
    after    = [ "network-online.target" ];
    wants    = [ "network-online.target" ];
    wantedBy = [ "multi-user.target" ];

    path = [ pkgs.openssl pkgs.bash ];

    serviceConfig = {
      Type        = "simple";
      # DynamicUser + StateDirectory: systemd sets up /var/lib/continuwuity and assigns
      # ownership to the dynamic UID BEFORE ExecStart runs — but NOT before ExecStartPre.
      # Token generation is therefore done inside a wrapper ExecStart script (not ExecStartPre)
      # so the StateDirectory is already owned by the dynamic user when we write the token.
      ExecStart   = pkgs.writeShellScript "bloom-matrix-start" ''
        TOKEN_FILE=/var/lib/continuwuity/registration_token
        if [ ! -f "$TOKEN_FILE" ]; then
          openssl rand -base64 32 > "$TOKEN_FILE"
          chmod 640 "$TOKEN_FILE"
        fi
        exec ${pkgs.matrix-continuwuity}/bin/conduwuit
      '';
      Environment = "CONTINUWUITY_CONFIG=/etc/bloom/matrix.toml";
      Restart     = "on-failure";
      RestartSec  = 5;
      DynamicUser = true;
      StateDirectory   = "continuwuity";
      RuntimeDirectory = "continuwuity";
    };
  };
}
```

- [ ] **Step 2: Verify binary name before committing**

```bash
nix eval nixpkgs#matrix-continuwuity.meta.mainProgram 2>/dev/null \
  || ls $(nix build nixpkgs#matrix-continuwuity --no-link --print-out-paths 2>/dev/null)/bin/
```

Expected: prints the binary name (e.g. `conduwuit` or `continuwuity`). Update the `ExecStart` line in `bloom-matrix.nix` if it differs from `conduwuit`.

- [ ] **Step 3: Evaluate**

Add `../modules/bloom-matrix.nix` to the host stub imports, then:

```bash
nix eval .#nixosConfigurations.bloom-x86_64.config.systemd.services.bloom-matrix.serviceConfig.DynamicUser
```

Expected: `true`

- [ ] **Step 4: Commit**

```bash
git add core/os/modules/matrix.nix
git commit -m "feat: add bloom-matrix NixOS module (continuwuity Matrix server)"
```

---

### Task 8: app.nix module — install app, pi-daemon user service, tmpfiles

**Files:**
- Create: `core/os/modules/app.nix`

- [ ] **Step 1: Write app.nix**

```nix
# core/os/modules/app.nix
{ pkgs, lib, bloomApp, piAgent, ... }:

{
  # Make app and pi scripts available system-wide
  environment.systemPackages = [ bloomApp piAgent ];

  # Bloom app at the conventional path
  systemd.tmpfiles.rules = [
    # Symlink app store path to the conventional location
    "L+ /usr/local/share/bloom - - - - ${bloomApp}/share/bloom"
    # Appservices directory (for service registration files)
    "d /etc/bloom/appservices 0755 root root -"
  ];

  # pi-daemon: user systemd service (runs as pi user)
  # Cannot depend on bloom-matrix.service or network-online.target — user manager
  # cannot order against system units. Uses Restart=on-failure + RestartSec=15
  # to recover if Matrix or network is not yet ready.
  systemd.user.services.pi-daemon = {
    description = "Bloom Pi Daemon (Matrix room agent)";
    wantedBy = [ "default.target" ];

    unitConfig.ConditionPathExists = "%h/.bloom/.setup-complete";

    serviceConfig = {
      Type       = "simple";
      ExecStart  = "${pkgs.nodejs}/bin/node /usr/local/share/bloom/dist/core/daemon/index.js";
      # Explicit PATH: NixOS user sessions inherit /run/current-system/sw/bin via PAM,
      # but adding it explicitly ensures the pi agent binary and system tools are always
      # reachable regardless of how the service is started (loginctl, systemctl --user, etc.).
      Environment = [
        "HOME=%h"
        "BLOOM_DIR=%h/Bloom"
        "PATH=${lib.makeBinPath [ piAgent pkgs.nodejs ]}:/run/current-system/sw/bin"
      ];
      Restart    = "on-failure";
      RestartSec = 15;
    };
  };
}
```

- [ ] **Step 2: Add to host stub imports and evaluate**

```bash
nix eval .#nixosConfigurations.bloom-x86_64.config.systemd.user.services.pi-daemon.serviceConfig.Restart
```

Expected: `"on-failure"`

- [ ] **Step 3: Verify tmpfiles rules include the bloomApp store path**

```bash
nix eval .#nixosConfigurations.bloom-x86_64.config.systemd.tmpfiles.rules --json 2>/dev/null | python3 -m json.tool | grep bloom
```

Expected: output contains a line with `L+` and `/usr/local/share/bloom` pointing into a `/nix/store/...` path.

- [ ] **Step 4: Commit**

```bash
git add core/os/modules/app.nix
git commit -m "feat: add app NixOS module (app install, pi-daemon user service)"
```

---

### Task 9: bloom-update.nix — OTA timer and Cachix

**Files:**
- Create: `core/os/modules/update.nix`
- Create: `core/scripts/system-update.sh`

- [ ] **Step 1: Write system-update.sh**

```bash
#!/usr/bin/env bash
# system-update.sh — NixOS OTA update + status-file writer.
# Runs as root via bloom-update.service. Writes status to /home/pi/.bloom/update-status.json.
set -euo pipefail

FLAKE_REF="github:alexradunet/piBloom"
HOST="bloom-x86_64"
FLAKE="${FLAKE_REF}#${HOST}"
STATUS_DIR="/home/pi/.bloom"
STATUS_FILE="$STATUS_DIR/update-status.json"
CHECKED=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

mkdir -p "$STATUS_DIR"
chown pi:pi "$STATUS_DIR" 2>/dev/null || true

# Current generation number
CURRENT_GEN=$(nix-env --list-generations -p /nix/var/nix/profiles/system 2>/dev/null | grep current | awk '{print $1}' || echo "0")

# Check if remote flake produces a different system closure
CURRENT_SYSTEM=$(readlink /run/current-system)
# nix build uses the full nixosConfigurations attribute path (not the short #host fragment)
NEW_SYSTEM=$(nix build "${FLAKE_REF}#nixosConfigurations.${HOST}.config.system.build.toplevel" --no-link --print-out-paths 2>/dev/null || echo "")

if [[ -z "$NEW_SYSTEM" ]] || [[ "$NEW_SYSTEM" == "$CURRENT_SYSTEM" ]]; then
  AVAILABLE=false
else
  AVAILABLE=true
fi

# Preserve notified flag
NOTIFIED=false
if [[ -f "$STATUS_FILE" ]] && [[ "$AVAILABLE" = "true" ]]; then
  NOTIFIED=$(jq -r '.notified // false' "$STATUS_FILE" 2>/dev/null || echo "false")
fi

# Write pre-apply status
jq -n \
  --arg checked "$CHECKED" \
  --argjson available "$AVAILABLE" \
  --arg generation "$CURRENT_GEN" \
  --argjson notified "$NOTIFIED" \
  '{"checked": $checked, "available": $available, "generation": $generation, "notified": $notified}' \
  > "$STATUS_FILE"
chown pi:pi "$STATUS_FILE"

# Apply if available
if [[ "$AVAILABLE" = "true" ]]; then
  if nixos-rebuild switch --flake "$FLAKE"; then
    NEW_GEN=$(nix-env --list-generations -p /nix/var/nix/profiles/system 2>/dev/null | grep current | awk '{print $1}' || echo "0")
    jq -n \
      --arg checked "$CHECKED" \
      --arg generation "$NEW_GEN" \
      '{"checked": $checked, "available": false, "generation": $generation, "notified": false}' \
      > "$STATUS_FILE"
    chown pi:pi "$STATUS_FILE"
  fi
fi
```

```bash
chmod +x core/scripts/system-update.sh
```

- [ ] **Step 2: Write bloom-update.nix**

```nix
# core/os/modules/update.nix
{ pkgs, lib, ... }:

{
  # Enable nix-command + flakes (required for nixos-rebuild --flake)
  nix.settings.experimental-features = [ "nix-command" "flakes" ];

  # Cachix substituter (pre-built closures; avoids on-device compilation during updates)
  # TODO: replace <cachix-url> and <cachix-pubkey> with real Cachix cache values
  # nix.settings.substituters = [ "https://cache.nixos.org" "<cachix-url>" ];
  # nix.settings.trusted-public-keys = [ "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY=" "<cachix-pubkey>" ];

  systemd.services.bloom-update = {
    description = "Bloom OS NixOS update";
    after    = [ "network-online.target" ];
    wants    = [ "network-online.target" ];

    serviceConfig = {
      Type            = "oneshot";
      # nixos-rebuild is NOT in nixpkgs (no pkgs.nixos-rebuild). It lives at
      # /run/current-system/sw/bin/nixos-rebuild on the running system.
      # The `path` attribute in NixOS systemd modules only accepts derivations, not plain
      # strings, so we cannot add /run/current-system/sw via `path`. Instead, set PATH
      # explicitly via Environment, prepending /run/current-system/sw/bin for nixos-rebuild
      # and then the store paths of nix, git, and jq.
      # nix-env --list-generations is part of pkgs.nix.
      Environment     = "PATH=/run/current-system/sw/bin:${lib.makeBinPath (with pkgs; [ nix git jq ])}";
      ExecStart       = pkgs.writeShellScript "bloom-update" (builtins.readFile ../../../core/scripts/system-update.sh);
      RemainAfterExit = false;
    };
  };

  systemd.timers.bloom-update = {
    description = "Bloom OS update check timer";
    wantedBy    = [ "timers.target" ];

    timerConfig = {
      OnBootSec        = "5min";
      OnUnitActiveSec  = "6h";
      Persistent       = true;
    };
  };
}
```

- [ ] **Step 3: Add to host stub imports and evaluate**

```bash
nix eval .#nixosConfigurations.bloom-x86_64.config.systemd.timers.bloom-update.timerConfig.OnUnitActiveSec
```

Expected: `"6h"`

- [ ] **Step 4: Verify builtins.readFile resolves the script path**

```bash
nix eval --raw .#nixosConfigurations.bloom-x86_64.config.systemd.services.bloom-update.serviceConfig.ExecStart 2>&1 | head -3
```

Expected: outputs a store path containing the bloom-update script content (not an error).

- [ ] **Step 5: Commit**

```bash
git add core/os/modules/update.nix core/scripts/system-update.sh
git commit -m "feat: add bloom-update NixOS module (nixos-rebuild OTA timer)"
```

---

## Chunk 4: Host Config + Image Generation + justfile

### Task 10: Write final hosts/x86_64.nix

**Files:**
- Modify: `core/os/hosts/x86_64.nix` (replace the evaluation stub with the real config)

- [ ] **Step 1: Write final host config**

```nix
# core/os/hosts/x86_64.nix
{ pkgs, lib, ... }:

{
  imports = [
    ../modules/app.nix
    ../modules/bloom-matrix.nix
    ../modules/bloom-network.nix
    ../modules/bloom-shell.nix
    ../modules/bloom-update.nix
  ];

  system.stateVersion = "25.05";
  nixpkgs.hostPlatform = "x86_64-linux";

  # EFI + systemd-boot
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;

  # Disk layout (disko)
  disko.devices = import ../disk/x86_64-disk.nix;

  # Locale
  time.timeZone   = "UTC";
  i18n.defaultLocale = "en_US.UTF-8";
}
```

- [ ] **Step 2: Full evaluation test**

```bash
nix eval .#nixosConfigurations.bloom-x86_64.config.system.stateVersion
```

Expected: `"25.05"`

```bash
nix eval .#nixosConfigurations.bloom-x86_64.config.users.users.pi.isNormalUser
nix eval .#nixosConfigurations.bloom-x86_64.config.services.netbird.enable
nix eval .#nixosConfigurations.bloom-x86_64.config.systemd.services.bloom-matrix.serviceConfig.DynamicUser
```

All expected: `true`

- [ ] **Step 3: Dry build the system (does not activate)**

```bash
nix build .#nixosConfigurations.bloom-x86_64.config.system.build.toplevel --dry-run 2>&1 | tail -10
```

Expected: outputs a list of paths to build, no evaluation errors.

- [ ] **Step 4: Commit**

```bash
git add core/os/hosts/x86_64.nix
git commit -m "feat: add x86_64 NixOS host configuration"
```

---

### Task 11: Wire image generation into flake.nix

**Files:**
- Modify: `flake.nix`

- [ ] **Step 1: Add image outputs to flake.nix**

Replace the existing `packages.${system}` block in `flake.nix`:

```nix
packages.${system} = {
  app = bloomApp;

  qcow2 = nixos-generators.nixosGenerate {
    inherit system;
    format = "qcow2";
    modules = [ disko.nixosModules.disko ./core/os/hosts/x86_64.nix ];
    specialArgs = { inherit piAgent bloomApp; };
  };

  raw = nixos-generators.nixosGenerate {
    inherit system;
    format = "raw";
    modules = [ disko.nixosModules.disko ./core/os/hosts/x86_64.nix ];
    specialArgs = { inherit piAgent bloomApp; };
  };

  iso = nixos-generators.nixosGenerate {
    inherit system;
    format = "install-iso";
    modules = [ disko.nixosModules.disko ./core/os/hosts/x86_64.nix ];
    specialArgs = { inherit piAgent bloomApp; };
  };
};
```

- [ ] **Step 2: Verify flake show lists all outputs**

```bash
nix flake show 2>&1
```

Expected: lists `packages.x86_64-linux.{app, qcow2, raw, iso}` and `nixosConfigurations.bloom-x86_64`.

- [ ] **Step 3: Build qcow2 image (this takes several minutes on first run)**

> **Prerequisite:** Task 4 Step 4 must be complete — `npmDepsHash` in `core/os/pkgs/app/default.nix` must have the real hash (not `sha256-AAAA...`). The qcow2 build includes `app` and will fail if the hash is still a placeholder.

```bash
nix build .#qcow2 -L 2>&1 | tail -20
ls -lh result/
```

Expected: `result/` contains `disk.qcow2`. Note: if Cachix is not yet configured, this builds everything locally — may be slow.

- [ ] **Step 4: Commit**

```bash
git add flake.nix
git commit -m "feat: add nixos-generators image outputs to flake (qcow2, raw, iso)"
```

---

### Task 12: Update justfile

**Files:**
- Modify: `justfile`

- [ ] **Step 1: Replace justfile**

Replace the entire justfile with the NixOS-native version:

```just
# Bloom OS — build, test, and deploy

system    := "x86_64-linux"
flake     := "."
host      := "bloom-x86_64"
output    := "result"
ovmf      := "/usr/share/edk2/ovmf/OVMF_CODE.fd"
ovmf_vars := "/usr/share/edk2/ovmf/OVMF_VARS.fd"

# Build Bloom TypeScript app derivation only
build:
    nix build {{ flake }}#app

# Generate qcow2 disk image
qcow2:
    nix build {{ flake }}#qcow2

# Generate raw disk image (dd to target disk)
raw:
    nix build {{ flake }}#raw

# Generate installer ISO
iso:
    nix build {{ flake }}#iso

# Apply current flake config to the running system (local dev iteration)
switch:
    sudo nixos-rebuild switch --flake {{ flake }}#{{ host }}

# Apply config from the remote GitHub flake (mirrors what bloom-update does on device)
update:
    sudo nixos-rebuild switch --flake github:alexradunet/piBloom#{{ host }}

# Roll back to the previous NixOS generation
rollback:
    sudo nixos-rebuild switch --rollback

# Boot qcow2 in QEMU headless (serial console + SSH on :2222)
vm:
    #!/usr/bin/env bash
    set -euo pipefail
    vars="/tmp/bloom-ovmf-vars.fd"
    cp "{{ ovmf_vars }}" "$vars"
    echo "Starting VM... Press Ctrl+A X to exit"
    qemu-system-x86_64 \
        -machine q35 \
        -cpu host \
        -enable-kvm \
        -m 12G \
        -smp 2 \
        -drive if=pflash,format=raw,readonly=on,file={{ ovmf }} \
        -drive if=pflash,format=raw,file="$vars" \
        -drive file={{ output }}/disk.qcow2,format=qcow2,if=virtio \
        -netdev user,id=net0,hostfwd=tcp::2222-:22,hostfwd=tcp::5000-:5000,hostfwd=tcp::8080-:8080,hostfwd=tcp::8081-:8081,hostfwd=tcp::8888-:80 \
        -device virtio-net-pci,netdev=net0 \
        -nographic \
        -serial mon:stdio

# Boot qcow2 in QEMU with graphical display (SSH on :2222)
vm-gui:
    #!/usr/bin/env bash
    set -euo pipefail
    vars="/tmp/bloom-ovmf-vars.fd"
    cp "{{ ovmf_vars }}" "$vars"
    qemu-system-x86_64 \
        -machine q35 \
        -cpu host \
        -enable-kvm \
        -m 12G \
        -smp 2 \
        -drive if=pflash,format=raw,readonly=on,file={{ ovmf }} \
        -drive if=pflash,format=raw,file="$vars" \
        -drive file={{ output }}/disk.qcow2,format=qcow2,if=virtio \
        -netdev user,id=net0,hostfwd=tcp::2222-:22,hostfwd=tcp::5000-:5000,hostfwd=tcp::8080-:8080,hostfwd=tcp::8081-:8081,hostfwd=tcp::8888-:80 \
        -device virtio-net-pci,netdev=net0 \
        -device virtio-vga-gl \
        -display gtk,gl=on

# Test ISO installation in QEMU (creates temporary disk, boots ISO installer)
test-iso:
    #!/usr/bin/env bash
    set -euo pipefail
    disk="/tmp/bloom-test-disk.qcow2"
    vars="/tmp/bloom-ovmf-vars.fd"
    if [ ! -f "{{ output }}/iso/nixos.iso" ] && [ ! -f "{{ output }}/iso.iso" ]; then
        echo "Error: No ISO found. Run 'just iso' first."
        exit 1
    fi
    ISO=$(find {{ output }} -name "*.iso" | head -1)
    rm -f "$disk" "$vars"
    qemu-img create -f qcow2 "$disk" 40G
    cp "{{ ovmf_vars }}" "$vars"
    echo "Starting ISO installation test... Press Ctrl+A X to exit"
    qemu-system-x86_64 \
        -machine q35 \
        -cpu host \
        -enable-kvm \
        -m 8G \
        -smp 2 \
        -drive if=pflash,format=raw,readonly=on,file={{ ovmf }} \
        -drive if=pflash,format=raw,file="$vars" \
        -drive file="$disk",format=qcow2,if=virtio \
        -cdrom "$ISO" \
        -netdev user,id=net0,hostfwd=tcp::2222-:22 \
        -device virtio-net-pci,netdev=net0 \
        -nographic \
        -serial mon:stdio

# SSH into the running VM
vm-ssh:
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 2222 pi@localhost

# Kill the running QEMU VM
vm-kill:
    pkill -f "[q]emu-system-x86_64.*disk.qcow2" || true

# Remove build results
clean:
    rm -f result result-*

# Install host dependencies (Fedora build host; NixOS devs use nix develop)
deps:
    sudo dnf install -y just qemu-system-x86 edk2-ovmf

# Lint Nix files
lint:
    nix flake check
    statix check .

# Format Nix files
# Note: ** glob requires globstar in bash (shopt -s globstar). nixfmt receives
# the expanded paths from the shell; if your shell doesn't expand **, list paths
# explicitly or use: find core/os -name '*.nix' | xargs nixfmt; nixfmt flake.nix
fmt:
    nixfmt core/os/**/*.nix flake.nix
```

- [ ] **Step 2: Verify just recipes parse**

```bash
just --list
```

Expected: all recipes listed with no parse errors.

- [ ] **Step 3: Commit**

```bash
git add justfile
git commit -m "feat: replace podman/BIB justfile with nix build recipes"
```

---

## Chunk 5: TypeScript Updates + Cleanup

### Task 13: Update UpdateStatus type and os extension

The current `os` extension calls `bootc` CLI commands. These are replaced with NixOS-native equivalents:

| Old (bootc) | New (NixOS) |
|-------------|-------------|
| `bootc status` | `nixos-rebuild list-generations` + read current system |
| `bootc upgrade --check` | compare remote flake with current system (done by bloom-update.service) |
| `bootc upgrade` | `sudo nixos-rebuild switch --flake github:...` |
| `bootc upgrade --apply` | same (nixos-rebuild applies atomically, no separate apply step) |
| `bootc rollback` | `sudo nixos-rebuild switch --rollback` |

**Files:**
- Modify: `core/pi/extensions/os/types.ts`
- Modify: `core/pi/extensions/os/actions.ts`
- Modify: `core/pi/extensions/os/index.ts`
- Modify: `core/pi/extensions/os/actions-health.ts`

- [ ] **Step 1: Update UpdateStatus type**

Edit `core/pi/extensions/os/types.ts`. Replace `UpdateStatus`:

```typescript
/** Update status persisted to /home/pi/.bloom/update-status.json by the bloom-update.service. */
export interface UpdateStatus {
	available: boolean;
	checked: string;
	generation?: string;   // NixOS generation number
	notified?: boolean;
}
```

(Remove `version?` — no longer written by the NixOS update service.)

- [ ] **Step 2: Update actions.ts — replace handleBootc, fix handleUpdateStatus**

In `core/pi/extensions/os/actions.ts`:

**Delete** the entire `handleBootc` function body (find `export async function handleBootc` and remove it and all its lines up to and including the closing `}`).

Then add `handleNixosUpdate` in its place:

```typescript
export async function handleNixosUpdate(
	action: "status" | "apply" | "rollback",
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
) {
	if (action === "apply" || action === "rollback") {
		const denied = await requireConfirmation(ctx, `OS ${action}`);
		if (denied) return errorResult(denied);
	}

	if (action === "status") {
		const gen = await run("nixos-rebuild", ["list-generations"], signal);
		const text = gen.exitCode === 0
			? gen.stdout.trim() || "No generation info available."
			: `Error: ${gen.stderr}`;
		return { content: [{ type: "text" as const, text: truncate(text) }], details: { exitCode: gen.exitCode } };
	}

	if (action === "rollback") {
		const result = await run("sudo", ["nixos-rebuild", "switch", "--rollback"], signal);
		const text = result.exitCode === 0
			? "Rolled back to previous generation. Reboot to complete."
			: `Rollback failed: ${result.stderr}`;
		return { content: [{ type: "text" as const, text }], details: { exitCode: result.exitCode }, isError: result.exitCode !== 0 };
	}

	// apply
	const flake = "github:alexradunet/piBloom#bloom-x86_64";
	const result = await run("sudo", ["nixos-rebuild", "switch", "--flake", flake], signal);
	const text = result.exitCode === 0
		? "Update applied successfully. New generation is active."
		: `Update failed: ${result.stderr}`;
	return { content: [{ type: "text" as const, text: truncate(text) }], details: { exitCode: result.exitCode }, isError: result.exitCode !== 0 };
}
```

Update `handleUpdateStatus` to show `generation` instead of `version`:

```typescript
export async function handleUpdateStatus() {
	try {
		const raw = await readFile(getUpdateStatusPath(), "utf-8");
		const status = JSON.parse(raw) as UpdateStatus;
		const text = status.available
			? `Update available (checked ${status.checked}). Current generation: ${status.generation ?? "unknown"}`
			: `System is up to date (checked ${status.checked}). Generation: ${status.generation ?? "unknown"}`;
		return { content: [{ type: "text" as const, text }], details: status };
	} catch {
		return errorResult("No update status available. The update timer may not have run yet.");
	}
}
```

- [ ] **Step 3: Update index.ts — replace bootc tool with nixos_update**

In `core/pi/extensions/os/index.ts`:

Replace the `bootc` tool definition:

```typescript
defineTool({
    name: "nixos_update",
    label: "NixOS Update Management",
    description: "Manage NixOS OS updates: view generation history, apply a pending update, or rollback to the previous generation.",
    parameters: Type.Object({
        action: StringEnum(["status", "apply", "rollback"] as const, {
            description: "status: list NixOS generations. apply: run nixos-rebuild switch. rollback: revert to previous generation.",
        }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const typedParams = params as { action: "status" | "apply" | "rollback" };
        return handleNixosUpdate(typedParams.action, signal, ctx);
    },
}),
```

Update the import at top of file: replace `handleBootc` with `handleNixosUpdate`.

Update the JSDoc comment:
```typescript
/**
 * os — OS management: NixOS lifecycle, containers, systemd, health, updates.
 *
 * @tools nixos_update, container, systemd_control, system_health, update_status, schedule_reboot
 * @hooks before_agent_start
 */
```

- [ ] **Step 4: Update actions-health.ts — replace bootcSection with NixOS generation info**

In `core/pi/extensions/os/actions-health.ts`:

Replace `parseBootcSection`, `bootcSection`, and the `run("bootc", ...)` call:

```typescript
function nixosSection(result: Awaited<ReturnType<typeof run>>): string {
	if (result.exitCode !== 0) return "## OS\n(nixos-rebuild unavailable)";
	const lines = result.stdout.trim().split("\n");
	const current = lines.find(l => l.includes("current")) ?? lines.at(-1) ?? "";
	return `## OS\nNixOS — ${current.trim()}`;
}
```

In `handleSystemHealth`, replace the `bootc` run call:
```typescript
// was: run("bootc", ["status", "--format=json"], signal)
// now:
run("nixos-rebuild", ["list-generations"], signal),
```

And replace `bootcSection(bootc)` with `nixosSection(bootc)` in the sections array.

- [ ] **Step 5: Run TypeScript build to verify no type errors**

```bash
npm run build 2>&1 | tail -30
```

Expected: exits 0, no TypeScript errors.

- [ ] **Step 6: Commit TypeScript changes**

```bash
git add core/pi/extensions/os/
git commit -m "feat: replace bootc extension with NixOS nixos_update tool"
```

---

### Task 14: Update repo.ts and bloom-services manifest

**Files:**
- Modify: `core/lib/repo.ts`
- Modify: `core/pi/extensions/bloom-services/actions-manifest.ts`

- [ ] **Step 1: Update repo.ts — remove bootc fallback**

In `core/lib/repo.ts`, replace `inferRepoUrl`:

```typescript
/** Infer the upstream repo URL from existing remotes. */
export async function inferRepoUrl(repoDir: string, signal?: AbortSignal): Promise<string> {
	const existingUpstream = await getRemoteUrl(repoDir, "upstream", signal);
	if (existingUpstream) return existingUpstream;

	const origin = await getRemoteUrl(repoDir, "origin", signal);
	if (origin) return origin;

	return "https://github.com/alexradunet/piBloom.git";
}
```

(Remove the `bootc` import and the `run("bootc", ...)` block entirely.)

- [ ] **Step 2: Update bloom-services/actions-manifest.ts — remove bootc image inference**

Find the entire `detectBootedImage` async function and replace it wholesale:

```typescript
async function detectBootedImage(currentImage: string | undefined, _signal: AbortSignal | undefined) {
	return currentImage;
}
```

This removes the `bootc status --format=json` subprocess call entirely. The function now simply returns whatever `currentImage` was passed in (from the caller's context), with no runtime OS inference.

- [ ] **Step 3: Build again to confirm clean compilation**

```bash
npm run build 2>&1 | tail -10
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add core/lib/repo.ts core/pi/extensions/bloom-services/actions-manifest.ts
git commit -m "fix: remove bootc CLI references from repo.ts and services manifest"
```

---

### Task 15: Delete old core/os files

- [ ] **Step 1: Delete all Fedora bootc artifacts**

```bash
git rm -r core/os/Containerfile core/os/bib.Containerfile core/os/build_files/ core/os/packages/ core/os/system_files/ core/os/disk_config/
```

- [ ] **Step 2: Verify what remains in core/os/**

```bash
ls core/os/
```

Expected: `disk  hosts  modules  pkgs`

- [ ] **Step 3: Build again to confirm nothing broke**

```bash
npm run build 2>&1 | tail -5
nix eval .#nixosConfigurations.bloom-x86_64.config.system.stateVersion
```

- [ ] **Step 4: Commit the deletion**

```bash
git commit -m "chore: delete Fedora bootc Containerfile, BIB, build scripts, system_files, disk_config"
```

---

### Task 16: VM smoke test

- [ ] **Step 1: Build the qcow2 image**

```bash
just qcow2
```

- [ ] **Step 2: Boot in QEMU**

```bash
just vm
```

- [ ] **Step 3: Verify services in the VM (SSH in from another terminal)**

```bash
just vm-ssh
# Inside the VM:
systemctl status bloom-matrix
systemctl status netbird
loginctl  # should show pi session
```

Expected: `bloom-matrix` active, `netbird` active, pi user session present.

- [ ] **Step 4: Verify bloom-update writes update-status.json**

```bash
# Inside VM:
sudo systemctl start bloom-update
sleep 5
cat /home/pi/.bloom/update-status.json
```

Expected: valid JSON with `available`, `checked`, and `generation` fields, e.g.:
```json
{"available":false,"checked":"2026-03-16T12:00:00.000Z","generation":"42"}
```

If the file is missing, check: `journalctl -u bloom-update -n 30`

- [ ] **Step 5: Verify pi-daemon starts after setup-complete**

```bash
# Inside VM:
mkdir -p ~/.bloom && touch ~/.bloom/.setup-complete
systemctl --user start pi-daemon
systemctl --user status pi-daemon
```

Expected: pi-daemon active.

- [ ] **Step 6: Verify pi-daemon connects to Matrix**

```bash
# Inside VM:
journalctl --user -u pi-daemon -n 20
```

Expected: log lines showing a successful Matrix connection (e.g. "Connected to Matrix", room join messages). No authentication errors or connection-refused entries.

- [ ] **Step 7: Final commit**

```bash
git commit --allow-empty -m "chore: NixOS migration complete — Fedora bootc fully replaced"
```
