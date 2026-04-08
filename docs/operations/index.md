# Operations

> Deploy, operate, and maintain NixPI as a headless VPS service

## What's In This Section

This section covers the headless operator workflow for NixPI:

- bootstrapping a fresh VPS
- validating first boot and remote service readiness
- running updates and rollbacks from `/srv/nixpi`
- day-to-day service inspection and smoke testing

## Operations Topics

| Topic | Description |
|-------|-------------|
| [OVH Rescue Deploy](./ovh-rescue-deploy) | Fresh-install NixPI onto an OVH VPS from rescue mode |
| [Quick Deploy](./quick-deploy) | Bootstrap a VPS, configure WireGuard, and open the Pi terminal surface |
| [First Boot Setup](./first-boot-setup) | Validate the public Pi terminal surface and service readiness |
| [Live Testing](./live-testing) | Release-time validation for the headless VPS operator path |

## Quick Reference

### Common Commands

```bash
# Fresh OVH rescue-mode install
nix run .#nixpi-deploy-ovh -- --target-host root@SERVER_IP --disk /dev/sda

# Fresh VPS bootstrap
nix run github:alexradunet/nixpi#nixpi-bootstrap-vps

# Rebuild through the standard flake-based /etc/nixos
cd /srv/nixpi
git fetch origin
git rebase origin/main
sudo nixpi-rebuild
sudo nixos-rebuild switch --rollback

# Service inspection
systemctl status nixpi-ttyd.service
systemctl status nginx.service
systemctl status wireguard-wg0.service
systemctl status systemd-networkd.service
networkctl status wg0

# Validation
nix --option substituters https://cache.nixos.org/ build .#checks.x86_64-linux.config --no-link
nix build .#checks.x86_64-linux.nixpi-vps-bootstrap --no-link -L
```

## Related

- [Install NixPI](../install) - public install path
- [Architecture](../architecture/) - system design
- [Reference](../reference/) - deep technical docs
