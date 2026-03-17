#!/usr/bin/env bash
# bloom-convert.sh — Convert a standard NixOS install to Bloom OS
# Run this after Calamares installation to switch to Bloom configuration
set -euo pipefail

BLOOM_FLAKE="github:alexradunet/piBloom#bloom-x86_64"
CONVERT_MARKER="$HOME/.bloom/.converted"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_banner() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════════════╗"
    echo "║                                                          ║"
    echo "║            🌱 Bloom OS Conversion Tool                   ║"
    echo "║                                                          ║"
    echo "╚══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

# Check if we're in a NixOS environment
check_nixos() {
    if [[ ! -f /etc/NIXOS ]]; then
        print_error "This script must run on NixOS"
        exit 1
    fi
}

# Check if already converted
check_converted() {
    if [[ -f "$CONVERT_MARKER" ]]; then
        print_info "System appears to already be converted to Bloom OS"
        echo ""
        echo "If you want to re-convert, remove the marker:"
        echo "  rm $CONVERT_MARKER"
        echo ""
        read -p "Continue anyway? [y/N] " continue_anyway
        [[ "$continue_anyway" =~ ^[Yy]$ ]] || exit 0
    fi
}

# Backup current configuration
backup_config() {
    print_info "Backing up current configuration..."
    local backup_dir="/etc/nixos/backup-$(date +%Y%m%d-%H%M%S)"
    sudo mkdir -p "$backup_dir"
    sudo cp /etc/nixos/configuration.nix "$backup_dir/" 2>/dev/null || true
    sudo cp -r /etc/nixos/*.nix "$backup_dir/" 2>/dev/null || true
    print_success "Configuration backed up to $backup_dir"
}

# Enable flakes if needed
enable_flakes() {
    print_info "Checking Nix flakes configuration..."
    sudo mkdir -p /etc/nix
    if ! grep -q "experimental-features.*nix-command.*flakes" /etc/nix/nix.conf 2>/dev/null; then
        echo "experimental-features = nix-command flakes" | sudo tee -a /etc/nix/nix.conf > /dev/null
        print_success "Enabled Nix flakes"
    else
        print_success "Nix flakes already enabled"
    fi
}

# Main conversion function
convert_to_bloom() {
    print_info "Switching to Bloom OS configuration..."
    echo "  Flake: $BLOOM_FLAKE"
    echo ""
    
    # Run nixos-rebuild switch with Bloom flake
    if sudo nixos-rebuild switch --flake "$BLOOM_FLAKE"; then
        print_success "Successfully switched to Bloom OS!"
        
        # Create marker file
        mkdir -p "$(dirname "$CONVERT_MARKER")"
        date -Iseconds > "$CONVERT_MARKER"
        
        return 0
    else
        print_error "Failed to switch to Bloom OS"
        return 1
    fi
}

# Print next steps
print_next_steps() {
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║              Conversion Complete! 🎉                      ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Reboot the system"
    echo "  2. The Bloom setup wizard will start automatically"
    echo "  3. Complete the wizard to configure:"
    echo "     - User password"
    echo "     - WiFi (if needed)"
    echo "     - NetBird mesh network"
    echo "     - Matrix messaging"
    echo "     - AI provider settings"
    echo ""
}

# Main function
main() {
    print_banner
    
    check_nixos
    check_converted
    
    echo "This will convert your NixOS installation to Bloom OS."
    echo ""
    echo -e "${YELLOW}Warning:${NC} This will replace your current system configuration."
    echo "Your data will be preserved, but system settings will change."
    echo ""
    
    read -p "Continue? [y/N] " confirm
    echo ""
    
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        print_info "Cancelled"
        exit 0
    fi
    
    backup_config
    enable_flakes
    
    if convert_to_bloom; then
        print_next_steps
        
        read -p "Reboot now? [Y/n] " reboot
        if [[ ! "$reboot" =~ ^[Nn]$ ]]; then
            print_info "Rebooting..."
            sudo reboot
        else
            print_warning "Remember to reboot to complete the conversion!"
        fi
    else
        print_error "Conversion failed. Check the output above for errors."
        print_info "Your original configuration is backed up in /etc/nixos/backup-*"
        exit 1
    fi
}

main "$@"
