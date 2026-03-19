# Architecture Review — Red-Team Findings

Date: 2026-03-17
Scope: Personal deployment + public template responsibilities
Method: Attacker/failure persona walkthrough, Pareto-prioritized

---

## Context

Bloom is a NixOS-based personal AI-first OS. The primary security perimeter is a NetBird
WireGuard mesh network. The NixOS firewall confirms this intent:

```nix
networking.firewall.trustedInterfaces = [ "wt0" ];
```

`wt0` is the NetBird interface. Only mesh peers reach Bloom services. Everything behind
the mesh is relatively trusted.

The review evaluated both the personal instance and the template's responsibilities to
downstream forkers who may deploy without full security awareness.

---

## Security Model Assumption

**NetBird is the load-bearing security boundary.**

Threat actors within scope:

- A compromised device on the NetBird mesh
- A compromised service container already running on the host (inside the mesh)
- A template forker who deploys without NetBird or with it misconfigured

This is a simple, defensible model. The 20% of fixes below protect against 80% of
realistic threats within it.

---

## Pareto-Prioritized Findings

### Finding 1 — NetBird not documented as a hard security requirement

**Severity:** High

**What the problem is:**
NetBird is the perimeter. If it is not running, Matrix, Bloom Home (port 8080), dufs
(port 5000), code-server (port 8443), and the Matrix bridges are all exposed on the local
network. The firewall trusts `wt0` (the NetBird interface) — but without NetBird active,
`wt0` does not exist and the firewall rule provides no protection.

Currently the setup docs present NetBird as a component to configure, not as a security
prerequisite that gates everything else.

**Blast radius for forkers:**
A forker who skips or misconfigures NetBird setup has no secondary containment. Matrix room
access → prompt injection → OS tools (nixos_update, systemd_control, container) is fully
exposed to local network devices.

**Proposed remediation:**
- Add a prominent security note to `docs/pibloom-setup.md` and `docs/quick_deploy.md`:
  "NetBird is not optional. It is the network security boundary for all Bloom services.
  Complete NetBird setup and verify `wt0` is active before exposing this machine to any
  network."
- Add a preflight check in the first-boot wizard (`setup-wizard.sh`) that warns if
  `netbird status` is not connected.
- Document the threat model explicitly in a `docs/security-model.md`: what is protected
  inside the mesh, what is not, what happens if NetBird is absent.

---

### Finding 2 — SSH is password-only with no path to key-based auth

**Severity:** Medium-High

**What the problem is:**
`bloom-network.nix` configures SSH as:

```nix
PasswordAuthentication = true;
PubkeyAuthentication = "no";
```

Password auth is enabled; public key auth is explicitly disabled. The `pi` user has no
initial password set (`bloom-shell.nix:37`), and TTY auto-login prompts for password
creation on first boot — so SSH is effectively blocked until the user sets a password.
This is the correct initial state.

The problem is structural: once a password is set, it is the only SSH gate. There is no
system-level path to key-based SSH without modifying the NixOS flake. For a template:

- Forkers who want to harden SSH (keys only, disable password) cannot do so without a
  flake change — it is not documented as a configuration point.
- Whatever password the user chooses in the first-boot wizard is the sole SSH credential.
  No password strength requirements are enforced.
- A compromised NetBird peer can brute-force or replay a weak password over SSH.

**Proposed remediation:**
- Add `PubkeyAuthentication = "yes"` (or remove the explicit `"no"`) and document key
  provisioning as the recommended hardening step after first boot.
- Alternatively, expose `bloom.sshKeyOnly = true` as a NixOS option in the template that
  switches to keys-only when the user is ready.
- At minimum, document SSH authentication options clearly for forkers in the setup guide.

---

### Finding 3 — Remote container images tag-pinned, not digest-pinned

**Severity:** Medium

**What the problem is:**
`services/catalog.yaml` pins remote images to tags, not digests:

Under `services:`:
```yaml
dufs:  docker.io/sigoden/dufs:v0.38.0
```

Under `bridges:`:
```yaml
whatsapp:  dock.mau.dev/mautrix/whatsapp:v26.02
telegram:  dock.mau.dev/mautrix/telegram:v0.15.3
signal:    dock.mau.dev/mautrix/signal:v26.02.2
```

The supply chain policy (`docs/supply-chain.md`) already requires digest pinning for remote
images. None of the four remote images comply — in either section of the catalog.

Bridge containers are high-value targets: they run inside the NetBird mesh, hold Matrix
bridge credentials, and can read and post to Matrix rooms where Pi participates. A
compromised bridge image is already inside the security perimeter. `dufs` serves files from
`~/Public/Bloom` over WebDAV — a compromised dufs image has read access to that path.

**Proposed remediation:**
- Pin all four remote images to digests in `services/catalog.yaml`: `dufs` under
  `services:`, and `whatsapp`/`telegram`/`signal` under `bridges:`.
- Extend the existing `validatePinnedImage()` logic from `service_scaffold` to also lint
  `services/catalog.yaml` entries directly — either as a `just` recipe or CI check — so
  tag-only remote images are caught before they reach the catalog.

---

### Finding 4 — Pi-writable `~/Bloom/` enables persistent foothold after breach

**Severity:** Medium

**What the problem is:**
Several `~/Bloom/` subdirectories are Pi-writable by design. Three have outsized security
impact if a prior foothold is achieved (e.g., via a compromised mesh container sending a
crafted Matrix message):

- `~/Bloom/Agents/` — loaded by the daemon on every restart (`agent-registry.ts`).
  Writing a new `AGENTS.md` creates a persistent agent with arbitrary instructions and
  proactive jobs that survives reboots.
- `~/Bloom/guardrails.yaml` — user-override path, loaded first in `persona/actions.ts:37`.
  An empty or permissive file disables all shell command blocks.
- `~/Bloom/Objects/` and `~/Bloom/Persona/` — injected into Pi's context at every session
  start via `before_agent_start`. Writing here achieves persistent system-prompt injection.

Note: `~/Bloom/` is user state, not OS state, so NixOS rebuilds do not clear it.

**Proposed remediation:**
- Document `~/Bloom/Agents/` and `~/Bloom/guardrails.yaml` as high-sensitivity paths in
  AGENTS.md and the setup guide.
- Add guidance to Pi's persona/skill: writes to `Agents/` and `guardrails.yaml` are
  high-sensitivity operations that should be surfaced to the user explicitly, not done
  silently.
- Consider storing the default `guardrails.yaml` in a read-only location (e.g., the Nix
  store) and only loading user overrides from `~/Bloom/guardrails.yaml` when the file
  exists, so the default cannot be silently replaced with an empty file.

---

### Finding 5 — `autojoin: true` default creates silent command surfaces

**Severity:** Low-Medium

**What the problem is:**
`autojoin` defaults to `true` in two places:

- `agent-registry.ts:151` — the registry fallback for overlay agents
- `core/daemon/index.ts:154` — the synthesized default host agent, hardcoded

The daemon accepts Matrix room invites without user confirmation. Inside the NetBird mesh
this is lower risk, but it means new rooms become Pi command surfaces without the user
being explicitly aware. For template forkers, this is undocumented behavior.

**Proposed remediation:**
- Default `autojoin` to `false` in `agent-registry.ts` (registry fallback).
- Change the hardcoded `autojoin: true` in `index.ts:154` (`createDefaultAgent`) to
  `false` as well — both code paths need updating.
- Document the autojoin opt-in clearly: "Enabling autojoin means Pi will join any room it
  is invited to. All participants in that room can interact with Pi and its OS tools."

---

## What Was Explicitly Descoped

- **General prompt injection from internet attackers:** Descoped for the personal
  deployment (mitigated by NetBird perimeter + firewall). For template forkers without
  NetBird, this is the primary risk — addressed by Finding 1, which makes NetBird a
  documented hard requirement.
- **Misbehaving proactive job circuit breaker timing:** Low practical impact on a personal
  instance. No user-facing blast radius.
- **In-memory routing state lost on restart:** Minor UX issue (possible duplicate
  responses), not a security concern.
- **Message length limits:** Token-waste risk only, not exploitable within the mesh.
- **WiFi PSK in Nix store (`bloom-network.nix` TODO):** Already noted in the code. Out of
  scope for this review; sops-nix or agenix integration is a separate effort.

---

## Design Principle Reinforced

The security model stays simple:

1. **NetBird is the perimeter.** The firewall already enforces this (`trustedInterfaces = ["wt0"]`).
   Make it explicit in documentation and the first-boot wizard.
2. **Fix the seams where the perimeter assumption can silently fail** — digest-pinned
   images, documented SSH hardening path.
3. **Limit blast radius if the perimeter is ever breached** — Bloom directory write
   sensitivity, autojoin default off.

No secondary auth layers, no complex ACLs. Make the perimeter solid and document it.
