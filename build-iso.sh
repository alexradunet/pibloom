#!/usr/bin/env bash
# Bloom OS — build ISO for Hyper-V deployment
# Usage: ./build-iso.sh
# Output: os/output/bootiso/install.iso
# Then copy to Windows: cp os/output/bootiso/install.iso /mnt/c/Users/<you>/Downloads/

set -euo pipefail

IMAGE="localhost/bloom-os:latest"
OUTPUT="os/output"
BIB="quay.io/centos-bootc/bootc-image-builder:latest"
BIB_CONFIG="os/bib-config.toml"
STORAGE="/var/lib/containers/storage"

# Ensure bib-config.toml exists
if [[ ! -f "$BIB_CONFIG" ]]; then
    echo "Creating $BIB_CONFIG from example..."
    cp os/bib-config.example.toml "$BIB_CONFIG"
    echo "Edit $BIB_CONFIG to add your SSH key if needed, then re-run."
    exit 1
fi

echo "==> Building container image (--network=host for WSL2)..."
sudo podman build --network=host -f os/Containerfile -t "$IMAGE" .

echo "==> Generating ISO via bootc-image-builder..."
mkdir -p "$OUTPUT"
sudo podman run --rm -it --privileged --pull=newer \
    --security-opt label=type:unconfined_t \
    -v ./"$BIB_CONFIG":/config.toml:ro \
    -v ./"$OUTPUT":/output \
    -v "$STORAGE":/var/lib/containers/storage \
    "$BIB" \
    --type anaconda-iso --local "$IMAGE"

sudo chown -R "$(id -u):$(id -g)" "$OUTPUT" || true

cat <<'EOF'

==> Done! ISO at: os/output/bootiso/install.iso

Copy to Windows:
  cp os/output/bootiso/install.iso /mnt/c/Users/$USER/Downloads/bloom-os.iso

Then in PowerShell (Admin):
  New-VM -Name "BloomOS" -MemoryStartupBytes 4GB -Generation 2 -NewVHDPath "C:\VMs\BloomOS.vhdx" -NewVHDSizeBytes 64GB
  Set-VMFirmware -VMName "BloomOS" -EnableSecureBoot Off
  Add-VMDvdDrive -VMName "BloomOS" -Path "C:\Users\$env:USERNAME\Downloads\bloom-os.iso"
  Set-VMFirmware -VMName "BloomOS" -FirstBootDevice (Get-VMDvdDrive -VMName "BloomOS")
  Set-VMProcessor -VMName "BloomOS" -Count 2
  Start-VM -VMName "BloomOS"
EOF
