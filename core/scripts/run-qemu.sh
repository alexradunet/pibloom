#!/usr/bin/env bash
# run-qemu.sh — shared QEMU setup and launch helper for justfile vm recipes.
# Dev-only tool: NOT installed into the NixOS system.
#
# Usage:
#   run-qemu.sh --mode headless|gui|daemon [--skip-setup]
set -euo pipefail

DISK="/tmp/garden-vm-disk.qcow2"
VARS="/tmp/garden-ovmf-vars.fd"
OVMF_CODE="/usr/share/edk2/ovmf/OVMF_CODE.fd"
OVMF_VARS_SRC="/usr/share/edk2/ovmf/OVMF_VARS.fd"
OUTPUT="result"

mode=""
skip_setup=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --mode) mode="$2"; shift 2 ;;
        --skip-setup) skip_setup=1; shift ;;
        *) echo "Unknown flag: $1" >&2; exit 1 ;;
    esac
done

if [[ -z "$mode" ]]; then
    echo "Error: --mode is required (headless|gui|daemon)" >&2
    exit 1
fi

if [[ "$skip_setup" -eq 0 ]]; then
    rm -f "$VARS"
    qcow2_src=$(find -L "$OUTPUT" -name "*.qcow2" -type f | head -1)
    if [[ -z "$qcow2_src" ]]; then
        echo "Error: No qcow2 found in $OUTPUT. Run 'just qcow2' first." >&2
        exit 1
    fi
    echo "Found qcow2: $qcow2_src"
    echo "Copying disk image to $DISK..."
    cp -f "$qcow2_src" "$DISK"
    chmod 644 "$DISK"
    qemu-img resize "$DISK" 24G
    cp "$OVMF_VARS_SRC" "$VARS"
    if [[ -f "core/scripts/prefill.env" ]]; then
        mkdir -p "$HOME/.garden"
        cp "core/scripts/prefill.env" "$HOME/.garden/prefill.env"
        echo "Staged core/scripts/prefill.env → ~/.garden/prefill.env"
    fi
else
    if [[ ! -f "$DISK" ]]; then
        echo "Error: No VM disk found at $DISK. Run 'just vm' first." >&2
        exit 1
    fi
    # Only copy fresh OVMF vars if they don't exist yet, to preserve any
    # UEFI state (boot order etc.) written by a previous VM run.
    if [[ ! -f "$VARS" ]]; then
        cp "$OVMF_VARS_SRC" "$VARS"
    fi
fi

QEMU_COMMON=(
    qemu-system-x86_64
    -machine q35
    -cpu host
    -enable-kvm
    -m 4096
    -smp 2
    -boot order=c,menu=on
    -drive "if=pflash,format=raw,readonly=on,file=${OVMF_CODE}"
    -drive "if=pflash,format=raw,file=${VARS}"
    -drive "file=${DISK},format=qcow2,if=virtio,cache=writeback"
    -netdev "user,id=net0,hostfwd=tcp::2222-:22,hostfwd=tcp::5000-:5000,hostfwd=tcp::8080-:8080,hostfwd=tcp::8081-:8081,hostfwd=tcp::8888-:80"
    -device virtio-net-pci,netdev=net0
    -virtfs "local,path=$HOME/.garden,mount_tag=host-garden,security_model=none,readonly=on"
)

case "$mode" in
    headless)
        echo "Starting VM... Press Ctrl+A X to exit"
        "${QEMU_COMMON[@]}" -nographic -serial mon:stdio
        echo ""
        echo "Hint: Use 'just vm-daemon' to run VM in background, then 'just vm-ssh' to connect"
        ;;
    gui)
        echo "Starting VM with GUI... Close window to exit"
        "${QEMU_COMMON[@]}" -vga virtio -display gtk
        ;;
    daemon)
        if pgrep -f "[q]emu-system-x86_64.*garden-vm-disk" > /dev/null; then
            echo "VM already running. Use 'just vm-ssh' to connect or 'just vm-stop' to stop."
            exit 1
        fi
        echo "Starting VM in background..."
        echo "  - Log file: /tmp/garden-vm.log"
        echo "  - Connect:  just vm-ssh"
        echo "  - Stop:     just vm-stop"
        nohup "${QEMU_COMMON[@]}" -nographic -serial file:/tmp/garden-vm.log \
            > /dev/null 2>&1 &
        echo "Waiting for VM to boot..."
        for i in {1..30}; do
            if nc -z localhost 2222 2>/dev/null; then
                echo "VM is ready! SSH available on port 2222"
                exit 0
            fi
            sleep 1
        done
        echo "VM starting... try 'just vm-ssh' in a few seconds"
        ;;
    *)
        echo "Error: unknown mode '$mode'. Must be headless, gui, or daemon." >&2
        exit 1
        ;;
esac
