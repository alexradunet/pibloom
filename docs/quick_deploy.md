# Bloom OS Quick Deploy

> 📖 [Emoji Legend](LEGEND.md)

Audience: operators and maintainers building images or booting test VMs.

> 🛡️ **Security Note: NetBird is Mandatory**
>
> NetBird is the network security boundary for all Bloom services. The firewall
> trusts only the NetBird interface (`wt0`). Without NetBird running, all services
> (Matrix, Bloom Home, dufs, code-server) are exposed to the local network.
>
> **Complete NetBird setup and verify `wt0` is active before exposing this
> machine to any network.** See [security-model.md](security-model.md) for the
> full threat model.

## 🌱 Why This Guide Exists

This guide is the operational path for building and booting Bloom from the current `justfile`.

Use it for:

- local image builds (qcow2, raw, ISO)
- QEMU test boots
- ISO generation
- bare-metal NixOS installs

## 🚀 How To Build And Boot Bloom

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

### Fast Dev Path: QEMU

```bash
just qcow2   # build the NixOS qcow2 image
just vm      # boot it in QEMU (headless, serial console)
```

Forwarded ports in `just vm`:

- `2222` -> guest SSH
- `5000` -> `dufs`
- `8080` -> guest port `8080`
- `8081` -> `fluffychat`
- `8888` -> guest port `80`

Default user: `pi` (no initial password; TTY auto-login prompts for password creation on first boot).

Access the VM:

```bash
just vm-ssh
```

Stop it:

```bash
just vm-kill
```

## 💿 Installer ISO Options

Bloom provides two installer ISO variants:

| Variant | Desktop | Size | Best For |
|---------|---------|------|----------|
| **Graphical** (`iso-gui`) | LXQt + Calamares | ~2GB | Mini PCs, GUI installation, disk partitioning |
| **Minimal** (`iso`) | None (CLI) | ~500MB | Headless servers, advanced users, automation |

### Graphical Installer (Recommended for Mini PCs)

The graphical installer provides a point-and-click installation experience with:
- **Calamares** GUI installer (partitioning, user creation, locale/timezone selection)
- **LXQt** lightweight desktop (~400MB RAM)
- **Firefox** for documentation
- **GParted** for disk management

#### Build Graphical ISO

```bash
just iso-gui
```

#### Flash to USB

```bash
sudo dd if=result/iso/bloom-os-installer.iso of=/dev/sdX bs=4M status=progress conv=fsync
```

Replace `/dev/sdX` with your USB device (check with `lsblk`).

#### Installation Steps

1. **Boot from USB** on your mini PC
2. **LXQt desktop loads** (auto-login as `nixos`)
3. **Double-click "Install NixOS"** on the desktop
4. **Complete Calamares wizard:**
   - Welcome → Location → Keyboard → Partitions → Users → Summary
   - Choose "Erase disk" for automatic partitioning or manual setup
   - Set your username, password, hostname
5. **Reboot** when installation completes
6. **Convert to Bloom OS:**
   - Login to the installed system
   - Open a terminal
   - Run: `bloom-convert`
   - This switches the system to Bloom configuration and reboots
7. **Complete Bloom setup:**
   - After reboot, `bloom-wizard.sh` runs automatically
   - Set password, WiFi, NetBird, Matrix, AI provider
8. **Done!** Pi agent starts

#### Test in QEMU (with GUI)

```bash
just test-iso-gui
```

This opens a QEMU window with the graphical installer for testing.

### Minimal Installer (Headless/CLI)

The minimal installer is a command-line only ISO for advanced users or headless installations.

#### Build Minimal ISO

```bash
just iso
```

#### Bare-Metal Install (disko)

Boot from the installer ISO, then:

```bash
sudo nix run github:nix-community/disko -- --mode disko /path/to/x86_64-disk.nix
sudo nixos-install --flake github:alexradunet/piBloom#bloom-x86_64
```

## 🔄 OTA Updates

The `bloom-update` timer checks for updates every 6 hours automatically. To apply manually:

```bash
just update          # pull from remote flake and switch
just rollback        # revert to previous generation
```

## 📚 Reference

Important outputs (all via `result` symlink):

| Output | Path | Description |
|--------|------|-------------|
| qcow2 | `result/nixos.qcow2` | VM disk image |
| ISO (GUI) | `result/iso/bloom-os-installer.iso` | Graphical installer |
| ISO (minimal) | `result/iso/nixos.iso` | CLI-only installer |
| Raw disk | `result/` | Raw disk image for `dd` |

Related `just` commands:

```bash
just deps            # Install build dependencies
just clean           # Remove build artifacts
just lint            # Run nix flake check
just fmt             # Format Nix files

# ISO commands
just iso             # Build minimal CLI ISO
just iso-gui         # Build graphical ISO
just test-iso        # Test CLI ISO in QEMU (headless)
just test-iso-gui    # Test graphical ISO in QEMU (with GUI)

# VM commands
just qcow2           # Build qcow2 image
just vm              # Run VM (headless)
just vm-gui          # Run VM with GUI display
just vm-ssh          # SSH into running VM
just vm-kill         # Stop running VM
```

After first login:

1. complete `bloom-wizard.sh` (prompted automatically on tty1)
2. let Pi resume the persona step
3. use `setup_status` if you need to inspect or resume Pi-side setup state

## 🔗 Related

- [pibloom-setup.md](pibloom-setup.md)
- [live-testing-checklist.md](live-testing-checklist.md)
