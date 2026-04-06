# Quick Deploy

> Bootstrap NixPI onto a headless VPS and operate it from the remote web app

## Audience

Operators and maintainers deploying NixPI onto a NixOS-capable VPS or equivalent headless VM.

## Security Note: NetBird Is Mandatory

NetBird is the network security boundary for NixPI services. The firewall trusts only the NetBird interface (`wt0`). Without NetBird running, the remote app is exposed to whatever network can reach the host.

**Complete NetBird setup and verify `wt0` is active before treating the deployment as ready for normal use.** See [Security Model](../reference/security-model) for the full threat model.

## Canonical Deployment Path

NixPI is now VPS-first and headless-first. The standard public deployment flow is:

1. provision a NixOS-capable VPS
2. run the bootstrap command once
3. open the remote web app for chat and terminal access
4. keep operating from the canonical checkout at `/srv/nixpi`

## 1. Provision a NixOS-Capable VPS

Bring up a fresh x86_64 VPS or headless VM with:

- SSH access
- `sudo` privileges
- outbound internet access
- enough disk and RAM to complete a `nixos-rebuild switch`

If you are evaluating changes locally, a headless NixOS VM is fine. The public docs still optimize for the same remote operator contract used on a VPS.

## 2. Run the Bootstrap Command

From the target host:

```bash
nix run github:alexradunet/nixpi#nixpi-bootstrap-vps
```

If you already have a local checkout of this branch, you can use the repo-local command instead:

```bash
just bootstrap-vps
```

The bootstrap package:

- clones the repo into `/srv/nixpi` if it does not exist
- refreshes that checkout from `origin/main`
- runs `sudo nixos-rebuild switch --flake /srv/nixpi#nixpi`

> Warning: rerunning the bootstrap command on a host with local commits in `/srv/nixpi` will reset that checkout to `origin/main`. Commit or export local work first.

## 3. Connect to the Remote App

After the switch completes, NixPI runs as a headless service set. The default operator surface is the remote web app:

- `/` — main chat surface
- `/terminal/` — browser terminal

Preferred access is over NetBird. In practice that means:

1. enroll the host in NetBird
2. confirm `netbird status` reports a connected peer
3. verify the `wt0` interface exists
4. open the remote app over the NetBird-reachable host name or IP

Useful checks:

```bash
systemctl status netbird.service
netbird status
ip link show wt0
```

## 4. Operate from `/srv/nixpi`

Treat `/srv/nixpi` as the installed source of truth. Use it for edits, sync, and rebuilds.

Apply local changes manually:

```bash
cd /srv/nixpi
sudo nixos-rebuild switch --flake /srv/nixpi#nixpi
```

Sync with the default remote and rebuild:

```bash
cd /srv/nixpi
git fetch origin
git rebase origin/main
sudo nixos-rebuild switch --flake /srv/nixpi#nixpi
```

Roll back if needed:

```bash
sudo nixos-rebuild switch --rollback
```

## 5. Validate the Headless Surface

Smoke-check the core services on a running host:

```bash
systemctl status nixpi-chat.service
systemctl status nixpi-ttyd.service
systemctl status nginx.service
curl -I http://127.0.0.1:8080/
curl -I http://127.0.0.1/terminal/
```

For repo-side validation during development:

```bash
just check-config
nix build .#checks.x86_64-linux.nixpi-vps-bootstrap --no-link -L
```

## Related

- [First Boot Setup](./first-boot-setup)
- [Install NixPI](../install)
- [Security Model](../reference/security-model)
