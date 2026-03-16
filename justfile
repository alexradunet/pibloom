# Bloom OS — build, test, and deploy

system    := "x86_64-linux"
flake     := "."
host      := "bloom-x86_64"
output    := "result"
ovmf      := "/usr/share/edk2/ovmf/OVMF_CODE.fd"
ovmf_vars := "/usr/share/edk2/ovmf/OVMF_VARS.fd"

# Build Bloom TypeScript app derivation only
build:
    nix build {{ flake }}#bloom-app

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
    disk="/tmp/bloom-vm-disk.qcow2"
    vars="/tmp/bloom-ovmf-vars.fd"
    # Nix store images are read-only; copy to /tmp so QEMU can write
    if [ ! -f "$disk" ] || [ "{{ output }}/nixos.qcow2" -nt "$disk" ]; then
        echo "Copying disk image to $disk..."
        cp "{{ output }}/nixos.qcow2" "$disk"
        chmod 644 "$disk"
    fi
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
        -drive file="$disk",format=qcow2,if=virtio \
        -netdev user,id=net0,hostfwd=tcp::2222-:22,hostfwd=tcp::5000-:5000,hostfwd=tcp::8080-:8080,hostfwd=tcp::8081-:8081,hostfwd=tcp::8888-:80 \
        -device virtio-net-pci,netdev=net0 \
        -nographic \
        -serial mon:stdio

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
    pkill -f "[q]emu-system-x86_64.*bloom-vm-disk" || true

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
