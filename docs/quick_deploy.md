# Bloom OS Quick Deploy

> 📖 [Emoji Legend](LEGEND.md)

Audience: operators and maintainers building images or booting test VMs.

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

### ISO Build

```bash
just iso
```

Output: `result/` symlink pointing to the ISO in the Nix store.

### Bare-Metal Install (disko)

Boot from the installer ISO, then:

```bash
sudo nix run github:nix-community/disko -- --mode disko /path/to/x86_64-disk.nix
sudo nixos-install --flake github:alexradunet/piBloom#bloom-x86_64
```

### OTA Updates

The `bloom-update` timer checks for updates every 6 hours automatically. To apply manually:

```bash
just update          # pull from remote flake and switch
just rollback        # revert to previous generation
```

## 📚 Reference

Important outputs (all via `result` symlink):

- qcow2: `result/nixos.qcow2`
- ISO: `result/iso/`
- Raw disk: `result/`

Related `just` commands:

```bash
just deps
just clean
just lint
just fmt
```

After first login:

1. complete `bloom-wizard.sh` (prompted automatically on tty1)
2. let Pi resume the persona step
3. use `setup_status` if you need to inspect or resume Pi-side setup state

## 🔗 Related

- [pibloom-setup.md](pibloom-setup.md)
- [live-testing-checklist.md](live-testing-checklist.md)
