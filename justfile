# NixPI — build, test, and develop

system    := "x86_64-linux"
flake     := "."
host      := "nixpi"
output    := "result"
nix_opts  := "--option substituters https://cache.nixos.org/"
nix_vm_lane_opts := "--option substituters https://cache.nixos.org/ --max-jobs 1"

# Build NixPI TypeScript app derivation only
build:
    nix build {{ flake }}#app

# Bootstrap a NixOS-capable VPS into the canonical /srv/nixpi checkout.
bootstrap-vps:
    nix run {{ flake }}#nixpi-bootstrap-vps

# Apply current flake config to the running system (local dev iteration)
switch:
    sudo nixos-rebuild switch --flake {{ flake }}#{{ host }}

# Apply the installed NixPI checkout
update:
    sudo nixos-rebuild switch --flake /srv/nixpi

# Roll back to the previous NixOS generation
rollback:
    sudo nixos-rebuild switch --rollback

# Build the minimal NixPI installer ISO
iso:
    nix build {{ flake }}#installerIso

# Remove build results
clean:
    rm -f result result-*

# Install host dependencies (Fedora build host; NixOS devs use nix develop)
deps:
    sudo dnf install -y just

# Fast config check: build the NixOS closure locally.
# Catches locale errors, bad module references, and evaluation failures
check-config:
    nix {{ nix_opts }} build {{ flake }}#checks.{{ system }}.config --no-link

# Fast bootstrap packaging contract check.
check-bootstrap-script:
    nix {{ nix_opts }} build {{ flake }}#checks.{{ system }}.bootstrap-script --no-link

# Fast installer helper regression tests without booting the ISO.
check-installer:
    nix {{ nix_opts }} build {{ flake }}#checks.{{ system }}.installer-frontend --no-link

# Fast generated-config eval: forces the shared installer module to
# evaluate as a NixOS module before the full VM smoke path.
check-installer-generated-config:
    nix {{ nix_opts }} build {{ flake }}#checks.{{ system }}.installer-generated-config --no-link

# Live minimal installer smoke test. This is intentionally separate from the
# PR smoke lane until runtime and stability are proven.
check-installer-smoke:
    nix {{ nix_vm_lane_opts }} build {{ flake }}#checks.{{ system }}.nixpi-installer-smoke --no-link -L

# Full VM boot test: boots the installed system in a NixOS test VM.
# Slower than check-config but verifies runtime behaviour (services, users).
# Requires KVM. Takes 20-40 min on first run.
check-boot:
    nix {{ nix_opts }} build {{ flake }}#checks.{{ system }}.boot --no-link

# PR-oriented NixOS VM smoke lane.
check-nixos-smoke:
    nix {{ nix_vm_lane_opts }} build {{ flake }}#checks.{{ system }}.nixos-smoke --no-link -L

# Comprehensive NixOS VM lane.
check-nixos-full:
    nix {{ nix_vm_lane_opts }} build {{ flake }}#checks.{{ system }}.nixos-full --no-link -L

# Long-running install/lockdown/broker lane.
check-nixos-destructive:
    nix {{ nix_vm_lane_opts }} build {{ flake }}#checks.{{ system }}.nixos-destructive --no-link -L

# Lint Nix files
lint:
    nix flake check --no-build
    statix check .

# Format Nix files
fmt:
    nix fmt
