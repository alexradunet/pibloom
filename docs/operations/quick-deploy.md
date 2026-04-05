# Quick Deploy

> Build, install, and validate NixPI

## Audience

Operators and maintainers installing NixPI from the official installer image or validating local builds.

## Security Note: NetBird Is Mandatory

NetBird is the network security boundary for all NixPI services. The firewall trusts only the NetBird interface (`wt0`). Without NetBird running, the local web chat surface is exposed to the local network.

**Complete NetBird setup and verify `wt0` is active before exposing this machine to any network.** See [Security Model](../reference/security-model) for the full threat model.

## Installation Workflow

NixPI ships as a minimal NixOS installer image. It boots to a console and exposes a destructive terminal installer wizard as `nixpi-installer`.

### 1. Build or Download the Installer ISO

Build locally:

```bash
nix build .#installerIso
```

The resulting image is in `./result/iso/`.

### 2. Write the Image to USB

Use your preferred image writer, or from a Linux host:

```bash
sudo dd if=./result/iso/*.iso of=/dev/<usb-device> bs=4M status=progress oflag=sync
```

### 3. Install NixPI

1. Boot the USB stick
2. Open a root shell with `sudo -i`
3. Run `nixpi-installer`
4. Choose the target disk
5. Confirm the destructive install. The installer always creates `EFI + ext4 root + 8 GiB swap`.
6. Reboot into the installed system

The installer writes `/etc/nixos/nixpi-install.nix` (hashed password, hostname, primary user) and a `configuration.nix` that imports the pre-built desktop closure carried in the ISO. No git clone or `nixos-rebuild` happens after reboot.

### 4. Complete Setup

After reboot, the system autologins into the XFCE desktop. Open a browser to `http://nixpi.local:8080/setup` (or `http://localhost:8080/setup`). The web wizard shows a single optional field: a Netbird setup key. Submit the form to configure Netbird and mark the system ready. The page redirects to `/` when done.

After setup, log in via the terminal and run `pi /login` and `pi /model`.

## Development: Local Builds and VM Testing

For development and testing, use the ISO install workflow in QEMU.

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

### Common Commands

```bash
just iso             # Build the installer ISO
just vm-install-iso  # Boot the ISO in QEMU and run the full install flow
just vm-ssh          # SSH into the installer VM or installed system
just check-config    # Fast: validate NixOS config
just check-boot      # Thorough: boot test in VM
```

**Default operator user**: `human` (hardcoded). The primary account password is set during the interactive installer run.

## OTA Updates

Use `~/nixpi` as the canonical editable source of truth for an installed system. Treat `/etc/nixos` as deployed compatibility state, not the repo you edit or sync.

The recommended fork-first workflow is:

```bash
git clone <your-fork-url> ~/nixpi
cd ~/nixpi
git remote add upstream https://github.com/alexradunet/nixpi.git
```

To apply local changes manually:

```bash
cd ~/nixpi
sudo nixos-rebuild switch --flake /etc/nixos#$(hostname -s)
```

To sync with upstream and rebuild:

```bash
cd ~/nixpi
git fetch upstream
git rebase upstream/main
git push origin main
sudo nixos-rebuild switch --flake /etc/nixos#$(hostname -s)
```

Automatic updates remain local-only and do not `git pull` for the user. Syncing a fork with upstream stays a manual step so local customizations remain under the operator's control.

To roll back:

```bash
sudo nixos-rebuild switch --rollback
```

## Related

- [First Boot Setup](./first-boot-setup)
- [Live Testing](./live-testing)
- [Security Model](../reference/security-model)
