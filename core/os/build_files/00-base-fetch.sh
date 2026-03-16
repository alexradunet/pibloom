#!/bin/bash
set -xeuo pipefail

dnf -y install dnf5-plugins

# Add third-party repositories
# shellcheck disable=SC1091
source /ctx/packages/repos.sh

# Install all packages from the list
grep -vE '^\s*(#|$)' /ctx/packages/packages-install.txt | xargs dnf -y install --allowerasing

# EFI boot files: ostree doesn't populate /boot/efi, so extract from RPMs
# (needed by bootc-image-builder to create bootable ISOs)
mkdir -p /boot/efi/EFI/fedora /boot/efi/EFI/BOOT
for pkg in shim-x64 grub2-efi-x64 grub2-efi-x64-cdboot; do
    if rpm -q "$pkg" &>/dev/null; then
        dnf download --destdir=/tmp/efi-rpms "$pkg"
        rpm2cpio /tmp/efi-rpms/"$pkg"*.rpm | (cd / && cpio -idmu './boot/efi/*' 2>/dev/null) || true
    fi
done
rm -rf /tmp/efi-rpms

dnf clean all
