# Quick Deploy

> Build, deploy, and test nixPI

## 🌱 Audience

Operators and maintainers installing nixPI on NixOS or running test VMs.

## 🛡️ Security Note: NetBird is Mandatory

NetBird is the network security boundary for all nixPI services. The firewall trusts only the NetBird interface (`wt0`). Without NetBird running, all services (Matrix, Home, Web Chat) are exposed to the local network.

**Complete NetBird setup and verify `wt0` is active before exposing this machine to any network.** See [Security Model](../reference/security-model) for the full threat model.

## 🚀 Installation Workflow

nixPI is installed on top of a standard NixOS system.

### 1. Install NixOS

1. Download the [official NixOS ISO](https://nixos.org/download.html)
2. Install NixOS with your preferred desktop environment
3. Set up your user, hostname, and basic configuration
4. Complete the standard NixOS install process

### 2. Download nixPI

After first boot (works without git installed):

```bash
nix --extra-experimental-features 'nix-command flakes' run nixpkgs#git -- clone https://github.com/alexradunet/nixpi.git ~/nixpi
cd ~/nixpi
```

### 3. Attach nixPI

Apply nixPI to your existing operator account:

```bash
# Replace 'alex' with your actual username
sudo NIXPI_PRIMARY_USER=alex nixos-rebuild switch --impure --flake .#desktop-attach
```

### 4. Complete Setup

Reboot, then run the setup wizard:

```bash
setup-wizard.sh
```

The wizard auto-runs on TTY login before setup completes. If it doesn't start (e.g., using a graphical display manager), run `setup-wizard.sh` manually.

## 💻 Development: VM Testing

For development and testing, use the QEMU VM workflow.

### Prerequisites

Install [Nix](https://determinate.systems/posts/determinate-nix-installer/) and `just`:

```bash
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install
sudo dnf install -y just qemu-system-x86 edk2-ovmf   # Fedora build host
```

Or install all deps at once:

```bash
just deps
```

### VM Commands

```bash
just vm         # Build and run VM (headless, serial console)
just vm-gui     # Run VM with GUI display
just vm-ssh     # SSH into running VM
just vm-stop    # Stop the VM

just vm-install         # Boot plain NixOS for install simulation
just vm-install-gui     # Same, with GUI display
just vm-install-daemon  # Background installer VM
just vm-install-ssh     # SSH into installer VM as alex
just vm-install-stop    # Stop installer VM
```

**Default forwarded ports**:
- `2222` → guest SSH

**Default local VM sizing**:
- 16 GiB RAM
- 4 vCPUs
- 24 GiB qcow2 disk

Override if needed:

```bash
NIXPI_VM_MEMORY_MB=8192 NIXPI_VM_CPUS=2 just vm-daemon
```

**Default operator user**: your existing NixOS account. The `agent` system user owns the always-on runtime.

### Full Install Simulation

To simulate the real MiniPC flow in a VM, boot the plain NixOS installer simulation:

```bash
just vm-install-daemon
just vm-install-ssh
```

Login:
- user: `alex`
- password: `cico`

Inside the guest, install nixPI onto that existing user:

```bash
sudo NIXPI_PRIMARY_USER=alex nixos-rebuild switch --impure --flake /mnt/host-repo#desktop
```

That path uses the current checkout mounted read-only into the VM and exercises the real existing-user install flow.

### Live NetBird E2E

For a one-shot live install test that also brings the guest onto NetBird, export a setup key at runtime:

```bash
export NIXPI_TEST_NETBIRD_SETUP_KEY='...'
just live-install-e2e
```

This flow:

1. Boots the plain installer VM
2. Installs nixPI onto the existing `alex` user
3. Injects a temporary prefill file from `/tmp`
4. Waits for firstboot to complete
5. Verifies `agent`, broker, daemon, Matrix, and NetBird are active

The key is consumed at runtime only. It is not committed to the repo and should not be hardcoded into Nix derivations.

## 🔄 OTA Updates

The `nixpi-update` timer checks for updates every 6 hours automatically. To apply manually:

```bash
just update          # pull from remote flake and switch
just rollback        # revert to previous generation
```

Or directly after exporting the operator account:

```bash
sudo --preserve-env=NIXPI_PRIMARY_USER NIXPI_PRIMARY_USER="$USER" nixos-rebuild switch --impure --flake github:alexradunet/nixPI#desktop
```

## 📚 Reference

### Common `just` Commands

```bash
just deps            # Install build dependencies
just switch          # Apply local flake to running system
just update          # Apply remote flake to running system
just rollback        # Revert to previous generation
just clean           # Remove build artifacts
just lint            # Run nix flake check
just fmt             # Format Nix files

# VM commands
just vm              # Run VM (headless)
just vm-gui          # Run VM with GUI display
just vm-ssh          # SSH into running VM
just vm-stop         # Stop running VM

# Testing commands
just check-config    # Fast: validate NixOS config
just check-boot      # Thorough: boot test in VM
```

### After First Login

1. Complete `setup-wizard.sh` (prompted automatically on tty1)
2. Let Pi resume the persona step
3. Use `setup_status` if you need to inspect or resume Pi-side setup state

## 🔗 Related

- [First Boot Setup](./first-boot-setup)
- [Live Testing](./live-testing)
- [Security Model](../reference/security-model)
