---
title: Install NixPI
description: Bootstrap NixPI onto a NixOS-capable VPS and operate it from the remote web app.
---

<SectionHeading
  label="Install path"
  title="The shortest path from repository to a running VPS"
  lede="NixPI now targets a VPS-first, headless operator flow. The public install path is a one-command bootstrap that prepares `/srv/nixpi`, switches the host to the NixPI profile, and leaves you with one remote web app for chat plus terminal access."
/>

<PresentationBand
  eyebrow="Quick path"
  title="From host access to live NixPI"
  lede="This is the fastest public-facing install narrative. The more detailed operational guidance lives in the Operations section."
>

<TerminalFrame title="Quick Install">
```bash
nix run github:alexradunet/nixpi#nixpi-bootstrap-vps
```
</TerminalFrame>

</PresentationBand>

## What happens during bootstrap

<div class="quick-grid">
  <div class="quick-card">
    <strong>1. Start with a NixOS-capable VPS</strong>
    Provision a fresh x86_64 VPS or headless VM with SSH, sudo, and outbound internet access.
  </div>
  <div class="quick-card">
    <strong>2. Run the bootstrap command</strong>
    The bootstrap package clones or refreshes the canonical checkout in <code>/srv/nixpi</code>.
  </div>
  <div class="quick-card">
    <strong>3. Switch the system</strong>
    Bootstrap runs <code>sudo nixos-rebuild switch --flake /srv/nixpi#nixpi</code> to activate the headless NixPI profile.
  </div>
  <div class="quick-card">
    <strong>4. Operate through the remote app</strong>
    After the switch, use the main app for chat and the built-in browser terminal for shell access.
  </div>
</div>

NixPI does not require a desktop session as part of the primary install narrative. The intended operator surface is remote and headless from the start.

<PresentationBand
  eyebrow="After install"
  title="Operate the machine from the canonical checkout"
  lede="Once the system is live, edit and sync the canonical NixPI repo in `/srv/nixpi`, then rebuild from that same checkout."
>

<TerminalFrame title="Post-install workflow">
```bash
cd /srv/nixpi
git fetch origin
git rebase origin/main
sudo nixos-rebuild switch --flake /srv/nixpi#nixpi
```
</TerminalFrame>

</PresentationBand>

---

## Supported targets

NixPI currently targets **x86_64 NixOS-capable VPSes or headless VMs** with:

- 4 GB RAM or more
- enough storage for a full `nixos-rebuild switch`
- outbound internet access
- SSH access and `sudo` privileges during bootstrap

The public product boundary is VPS-first. The default story is one-command bootstrap onto a remote, headless host.

---

## Step-by-step install

1. Provision a fresh VPS or headless VM.
2. SSH into the host with a user that can run `sudo`.
3. Run the bootstrap command:

   ```bash
   nix run github:alexradunet/nixpi#nixpi-bootstrap-vps
   ```

4. Wait for the bootstrap to finish. It will prepare `/srv/nixpi` and run:

   ```bash
   sudo nixos-rebuild switch --flake /srv/nixpi#nixpi
   ```

5. Open the remote app and verify both paths:

   - `/` for chat
   - `/terminal/` for the browser terminal

6. Enroll and verify NetBird before treating the deployment as ready for routine remote use.

---

## First boot

After the first switch, the host should already behave like a headless NixPI system.

Use these checks:

```bash
systemctl status nixpi-chat.service
systemctl status nixpi-ttyd.service
systemctl status nginx.service
systemctl status netbird.service
curl -I http://127.0.0.1:8080/
curl -I http://127.0.0.1/terminal/
```

If those pass, continue normal operation from `/srv/nixpi` and the remote web app.

---

## Troubleshooting

### Bootstrap refresh behavior

The bootstrap command is meant for fresh hosts or disposable test machines. If `/srv/nixpi` already exists, the command refreshes it from `origin/main`.

If you have local work there, commit or export it first.

### Service checks

```bash
journalctl -u nixpi-chat.service -n 100
journalctl -u nixpi-ttyd.service -n 100
journalctl -u nginx.service -n 100
journalctl -u netbird.service -n 100
```

### Rebuild manually

```bash
cd /srv/nixpi
sudo nixos-rebuild switch --flake /srv/nixpi#nixpi
```

### Common issues

**The remote app does not load** — check `nixpi-chat.service`, `nixpi-ttyd.service`, and `nginx.service`, then verify the local probes on `127.0.0.1` still respond.

**NetBird is not connected** — run `netbird status`, verify `wt0` exists, and complete enrollment before exposing the system for routine use.

**I need to recover from a bad switch** — use:

```bash
sudo nixos-rebuild switch --rollback
```

---

## Need more detail?

- [Operations: Quick Deploy](./operations/quick-deploy)
- [Operations: First Boot Setup](./operations/first-boot-setup)
- [Operations](./operations/)
