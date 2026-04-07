# Daemon Architecture

> Detailed documentation of the NixPI local chat runtime

## Why The Runtime Exists

NixPI includes a local runtime layer that handles web-chat sessions on the machine itself.

It exists to:

- Bridge local web-chat conversations into Pi sessions
- Preserve Pi session continuity within a browser session
- Serve the chat frontend and stream Pi responses as NDJSON events
- Manage idle session eviction and session lifecycle

## How The Runtime Works

The runtime lives in `core/chat-server/` and runs as the `nixpi-chat.service` systemd unit.

Session management is currently a single in-process Pi session shared by the local chat UI.

### Startup

At startup:

1. The HTTP server reads environment config (`NIXPI_CHAT_PORT`, `PI_DIR`)
2. A single `PiSessionBridge` instance is created
3. The server begins accepting `POST /chat` requests and serves the built frontend on `GET /`

### Runtime Path

**Primary files**:

| File | Purpose |
|------|---------|
| `core/chat-server/index.ts` | HTTP entry point, route wiring, static asset serving |
| `core/chat-server/pi-session.ts` | Pi SDK session creation, reset, and event translation |
| `core/chat-server/frontend/app.ts` | Browser-side chat client (NDJSON event consumer) |
| `core/os/modules/app.nix` | systemd service definition and runtime wiring |

**Current behavior**:

- A single in-process Pi session is created lazily and reused across chat requests
- `DELETE /chat/:id` resets that session; the `:id` segment is ignored for compatibility
- Agent events are translated into NDJSON events streamed to the browser

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `NIXPI_CHAT_PORT` | `8080` | Backend listening port |
| `PI_DIR` | `~/.pi` | Pi runtime directory |

## Reference

### Important Current Failure Behavior

- Startup is single-shot; systemd restart policy handles crashes
- Session reset is explicit via the legacy `DELETE /chat/:id` route

## Related

- [Service Architecture](./service-architecture)
- [Architecture](../architecture/)
