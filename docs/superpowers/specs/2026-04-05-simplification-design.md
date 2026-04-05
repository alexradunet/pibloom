# Simplification: Lean on Pi RPC Mode and NixOS Primitives

**Date:** 2026-04-05
**Status:** Approved

## Goal

Reduce code footprint across both the TypeScript chat server layer and the NixOS module layer by replacing custom reimplementations with Pi SDK and NixOS native capabilities. Target: ~750 lines of TypeScript server code → ~110 lines, with parallel cleanup in NixOS.

## Scope

Two independent layers are simplified in the same pass:

1. **TypeScript chat server** — replace in-process Pi SDK usage with `RpcClient` (subprocess/RPC mode); drop the web setup wizard entirely.
2. **NixOS modules** — remove wizard gate wiring from `app.nix`; leave `service-surface.nix`, `network.nix`, and `firstboot/repo.nix` structurally intact (complexity is inherent or load-bearing).

## Architecture: Before and After

### Before

```
Browser
  → HTTP POST /chat {sessionId, message}
  → index.ts router
  → ChatSessionManager (session.ts)
    → createAgentSession() [in-process, one per sessionId]
    → session.subscribe() [manual async event queue + notify pattern]
    → chatEventsFromAgentEvent() [text cursor delta hack]
  → NDJSON stream response

First-boot:
  Boot → nixpi-chat starts → / → 302 /setup
       → user enters Netbird key → POST /api/setup/apply
       → nixpi-setup-apply → netbird up → system-ready marker → /
```

### After

```
Browser
  → HTTP POST /chat {message}
  → index.ts router (~60 lines, thin)
  → RpcClientManager (~50 lines)
    → single RpcClient pre-spawned at server start
    → rpcClient.prompt() → pi subprocess stdin
    → rpcClient.onEvent() → pi subprocess stdout
  → NDJSON stream response

First-boot:
  Boot → nixpi-setup-apply oneshot reads prefill.env → netbird up
       → nixpi-chat starts → / → chat UI directly
```

## TypeScript Layer Changes

### Deletions

| File | Lines | Reason |
|---|---|---|
| `core/chat-server/setup.ts` | 273 | Web wizard removed; first-boot is prefill.env only |
| `core/chat-server/session.ts` | 212 | `ChatSessionManager` replaced by `RpcClient` |
| `core/lib/interactions.ts` | 304 | Extension UI handled natively by RPC protocol |

### Replacements

**`core/chat-server/rpc-client-manager.ts`** (~50 lines, new file):
- Holds a single `RpcClient` instance, pre-spawned when the server starts
- `sendMessage(text)` calls `rpcClient.prompt()` and streams `AgentEvent` objects back as NDJSON
- Delta computation for `message_update` events (text cursor map) stays here — this is inherent to the Pi SDK's `AgentEvent` shape in both SDK and RPC modes
- Extension UI requests (`RpcExtensionUIRequest`) forwarded to the active HTTP response

**`core/chat-server/index.ts`** (~60 lines, trimmed from 162):
- Remove: setup routes (`GET /setup`, `POST /api/setup/apply`)
- Remove: `shouldRedirectToSetup` / `shouldAutoApply` gate logic
- Remove: `ChatSessionManagerOptions` / session lifecycle wiring
- Keep: `POST /chat` → RpcClientManager proxy, `DELETE /chat` → reset session, static file serving

### Why RPC mode over SDK mode

| Concern | SDK mode | RPC mode |
|---|---|---|
| Session lifecycle | Must reimplement (idle timers, eviction, LRU) | `RpcClient` handles it |
| Extension UI | Must manage in-process (`interactions.ts`) | Native RPC protocol |
| Pi crash isolation | Crashes affect HTTP server | Subprocess — restartable |
| API stability | `createAgentSession` is internal | `RpcClient` is the official embedding API |
| Text delta events | `message_update` (accumulated) | Same — delta hack stays either way |
| Subprocess overhead | None | ~1–2s startup, mitigated by pre-spawning |

### Session model

Single `RpcClient` per server lifetime. The browser no longer sends a `sessionId` — session management (new session, switch session) is delegated to Pi via the RPC protocol. This is appropriate for a single-user system.

## NixOS Layer Changes

### `core/os/modules/app.nix`

Remove:
- `systemReadyFile` path construction and passing to the chat service
- `prefillFile` path and `shouldAutoApply` awareness
- Any wiring that gates the chat server on wizard completion

Keep:
- `nixpi-app-setup` oneshot (agent state dir creation, settings.json seeding)
- Chat service declaration

### `core/os/modules/setup-apply.nix`

No change — the `nixpi-setup-apply` systemd oneshot remains. It reads `prefill.env` at boot and runs `netbird up --setup-key`. The system-ready marker file it creates is no longer read by the HTTP server (that redirect gate is removed); the marker becomes dead state and can be removed in a follow-up cleanup.

### Leave alone

- `service-surface.nix` (160 lines) — nginx TLS setup is NixOS-native, complexity is justified
- `network.nix` (160 lines) — networking config, not wizard-related
- `firstboot/repo.nix` (182 lines) — imperative git bootstrap logic, inherently complex

## File Delta Summary

| File | Before | After |
|---|---|---|
| `session.ts` | 212 lines | deleted |
| `setup.ts` | 273 lines | deleted |
| `interactions.ts` | 304 lines | deleted |
| `index.ts` | 162 lines | ~60 lines |
| `rpc-client-manager.ts` | — | ~50 lines (new) |
| `app.nix` | 57 lines | ~35 lines |
| **Total TS server** | **~789 lines** | **~110 lines** |

## What Is Not Changed

- Frontend (`core/chat-server/frontend/`) — no changes
- `core/lib/` utilities (exec, filesystem, logging, etc.) — kept as-is; audit for dead code is a follow-up
- NixOS installer script (`nixpi-installer.sh`) — out of scope
- Pi extensions, skills, persona — unchanged
- Tests — updated to cover new RpcClientManager; wizard tests deleted

## Open Questions

None — resolved during brainstorming:
- Single session per server lifetime is acceptable for a single-user system
- Prefill.env-only first-boot is the canonical path (confirmed by recent commit history)
- Text delta computation stays in both modes; not a differentiator
