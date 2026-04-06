# First Boot Setup

> Validating a fresh headless NixPI host after bootstrap

## Audience

Operators bringing up a fresh NixPI VPS or headless VM.

## Prerequisites

Before this checklist, you should already have:

1. a NixOS-capable VPS or headless VM
2. a successful `nixpi-bootstrap-vps` run
3. the canonical checkout present at `/srv/nixpi`
4. a completed `sudo nixos-rebuild switch --flake /srv/nixpi#nixpi`

## What First Boot Means Now

NixPI now expects the host to come up as a remote, headless service platform.

A fresh system should come up with one remote operator surface:

- chat in the main web app
- a browser terminal at `/terminal/`
- Pi running in SDK mode inside the application process
- system management still anchored in `/srv/nixpi`

## First-Boot Checklist

### 1. Verify the Base Services

```bash
systemctl status nixpi-chat.service
systemctl status nixpi-ttyd.service
systemctl status nginx.service
systemctl status netbird.service
```

Expected result: all four services are active or activatable without any desktop login step.

### 2. Verify the Remote App Paths

From the host itself:

```bash
curl -I http://127.0.0.1:8080/
curl -I http://127.0.0.1/terminal/
```

Expected result:

- the main app responds on `/`
- the browser terminal responds on `/terminal/`

### 3. Verify NetBird Before Normal Use

```bash
netbird status
ip link show wt0
```

Expected result:

- NetBird reports a connected peer when enrollment is complete
- `wt0` exists before you rely on the deployment as your secure operator path

If NetBird is not enrolled yet, finish that step before treating the host as ready for routine remote access.

### 4. Verify the Canonical Repo Flow

```bash
cd /srv/nixpi
git status --short
sudo nixos-rebuild switch --flake /srv/nixpi#nixpi
```

Expected result: the installed system rebuilds from `/srv/nixpi` without depending on a separate `/etc/nixos` checkout.

## Operator Orientation

After first boot, keep these boundaries in mind:

- `/srv/nixpi` is the canonical git working tree for sync, review, and rebuilds
- the remote web app is the default operator control plane
- `/terminal/` exists for shell-first recovery and administration
- Pi runs in SDK mode inside the app runtime rather than through a separate local-session story
- system services remain inspectable with normal NixOS and systemd tooling

## Reference

### Relevant Services

| Service | Purpose |
|------|---------|
| `nixpi-chat.service` | Main remote app runtime |
| `nixpi-ttyd.service` | Browser terminal backend |
| `nginx.service` | HTTP/HTTPS entry point |
| `netbird.service` | Mesh networking and remote security boundary |

### Current Behavior

- the machine boots to a normal headless multi-user target
- no desktop session is required to start operating NixPI
- the primary user workflow is remote web app plus browser terminal
- updates and rollbacks are run from `/srv/nixpi`
- if the remote surface fails, service status and logs remain the first recovery tools

## Related

- [Quick Deploy](./quick-deploy)
- [Install NixPI](../install)
- [Live Testing](./live-testing)
