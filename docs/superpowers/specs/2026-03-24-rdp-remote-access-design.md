# RDP Remote Access via Netbird Mesh — Design Spec

**Date:** 2026-03-24
**Status:** Approved

---

## Overview

Add minimal RDP (Remote Desktop Protocol) access to the Bloom OS VM so it can be reached
via GUI (RDP) or SSH from within the Netbird mesh network (`wt0`). Both transports are
restricted to the trusted Netbird interface — RDP never exposed on the physical interface.

---

## Architecture

### What changes

**`core/os/modules/desktop-xfce.nix`** — two additions:

1. **`services.xrdp`** — enables the xrdp daemon with XFCE as the window manager. Each RDP
   connection spawns an independent Xvfb-backed XFCE session, completely separate from the
   auto-login console session. Sessions persist across disconnects.

2. **Firewall rule** — port 3389 added to
   `networking.firewall.interfaces."${securityCfg.trustedInterface}".allowedTCPPorts`.
   NixOS merges per-interface port lists across modules, so this stacks cleanly with the
   existing rules in `network.nix` without touching that file.

### What does NOT change

- `network.nix` — untouched. No new options, no new modules.
- SSH setup — already works over Netbird (port 22 open globally, Netbird on `wt0`).
- Auto-login console session — unaffected by xrdp sessions.

### Nix config

```nix
services.xrdp = {
  enable = true;
  defaultWindowManager = "${pkgs.xfce.xfce4-session}/bin/xfce4-session";
  openFirewall = false;   # managed manually below
};

networking.firewall.interfaces."${securityCfg.trustedInterface}".allowedTCPPorts = [ 3389 ];
```

Key decisions:
- `openFirewall = false` — we use the interface-scoped rule instead of the global allowlist,
  consistent with how all other NixOS services are firewalled in this project.
- Store path for `defaultWindowManager` — plain string `"xfce4-session"` is not reliable on
  NixOS; the store path ensures the correct binary is found.
- Port 3389 (default) — no reason to change it for a private mesh deployment.

---

## Connecting

From any machine on the Netbird mesh, point an RDP client at the VM's Netbird IP on port
3389. Recommended clients: Remmina (Linux), Microsoft Remote Desktop (macOS/Windows),
built-in Windows RDP (`mstsc`).

Authentication uses the local user account credentials. A self-signed TLS certificate is
generated automatically by xrdp on first start; clients will need to accept it (TOFU).

---

## Known issues / caveats

- **IPv6 binding bug** (upstream nixpkgs issue #304855): older nixpkgs versions bind xrdp
  to IPv6 only. Mitigated by connecting via IPv4 Netbird address, or accept that it works
  regardless due to dual-stack. Should be fixed in recent nixpkgs.
- **`~/startwm.sh` override** (upstream issue #372265): per-user window manager override
  via `~/startwm.sh` does not work reliably on NixOS. Not relevant here — we always want
  XFCE.
- **xrdp service restart required** after config changes — `systemctl restart xrdp xrdp-sesman`.
- **`~/.xprofile` not sourced in RDP sessions** — the keyboard layout (`setxkbmap`) and background colour set up for the LightDM auto-login path are not applied to xrdp sessions. RDP sessions will use server defaults. Cosmetic only.
- **`xrdp-sesman` unit name** — since nixpkgs ~24.05, xrdp ships `xrdp.service` and `xrdp-sesman.service` as separate units. Verify this on the project's actual nixpkgs revision before relying on the unit name in the test.

---

## Testing

New test file: **`tests/nixos/nixpi-rdp.nix`**
Registered in: **`tests/nixos/default.nix`** as `nixpi-rdp`

The test imports `desktop-xfce.nix` (same as `nixpi-desktop.nix`) and additionally:

1. Waits for `xrdp.service` and `xrdp-sesman.service` to reach `active`.
2. Verifies port 3389 is listening (`ss -tlnp | grep 3389`).
3. Verifies the xrdp process is running.

A full RDP connection test (using `xfreerdp`) is out of scope for this test because:
- The firewall gates port 3389 to `wt0`, which does not exist in the NixOS VM test
  environment (Netbird is not connected).
- The upstream nixpkgs xrdp test already covers protocol-level connectivity.

The test verifies that the service is correctly configured and listening, which is the
meaningful invariant we own.

---

## Files touched

| File | Change |
|------|--------|
| `core/os/modules/desktop-xfce.nix` | Add `services.xrdp` + firewall rule |
| `tests/nixos/nixpi-rdp.nix` | New test file |
| `tests/nixos/default.nix` | Register `nixpi-rdp` test |
