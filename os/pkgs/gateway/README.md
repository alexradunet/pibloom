# ownloom-gateway

Thin Ownloom transport gateway over the Pi SDK. The gateway owns transports,
identity/auth, session mapping, delivery/retry, and attachment staging; Pi stays
the canonical agent runtime.

Run `npm ci` after package-lock changes so local `node_modules` matches the
lockfile. The Baileys tree uses a protobuf override; stale local installs can
report `protobufjs@6.8.8 invalid` until `npm ci` refreshes dependencies.

Use `npm run audit` to run both `npm audit` and the lockfile-only protobuf
dependency check.

## Client protocol v1

First-party clients use WebSocket JSON frames. The legacy bundled web UI and
legacy web-chat protocol were removed; clients must speak protocol/v1.

Default local endpoint in NixOS deployments is loopback-only unless configured
otherwise:

```text
ws://127.0.0.1:<transports.client.port>/
http://127.0.0.1:<transports.client.port>/api/v1/...
```

If `transports.client.authToken` is configured:

- WebSocket `connect.auth.token` must match it.
- REST calls must include `Authorization: Bearer <token>`.

### Connect

The first WebSocket frame must be `connect`:

```json
{
  "type": "connect",
  "protocol": 1,
  "role": "operator",
  "scopes": ["read", "write"],
  "auth": { "token": "optional-token" },
  "client": { "id": "web-main", "version": "0.1.0", "platform": "web" }
}
```

Successful response:

```json
{
  "type": "res",
  "id": "connect",
  "ok": true,
  "payload": {
    "type": "hello-ok",
    "protocol": 1,
    "server": { "version": "1.0.0", "connId": "client-..." },
    "features": {
      "methods": ["agent", "agent.wait", "commands.list", "health", "sessions.get", "sessions.list", "sessions.reset", "status"],
      "events": ["agent", "shutdown", "tick"]
    },
    "auth": { "role": "operator", "scopes": ["read", "write"] },
    "policy": { "maxPayload": 26214400, "tickIntervalMs": 15000 }
  }
}
```

### Request frame

All method calls use `req` frames:

```json
{
  "type": "req",
  "id": "req-1",
  "method": "health",
  "params": {}
}
```

Response:

```json
{
  "type": "res",
  "id": "req-1",
  "ok": true,
  "payload": { "ok": true, "agent": "pi", "transports": ["whatsapp", "client"], "uptimeMs": 1234 }
}
```

### `agent` and `agent.wait`

Send a message to Pi:

```json
{
  "type": "req",
  "id": "msg-1",
  "method": "agent.wait",
  "params": {
    "message": "Summarize today's planner state",
    "sessionKey": "web-main"
  }
}
```

`sessionKey` is optional but recommended. It maps to stable Pi chat session
`client:<sessionKey>`. Without it, the gateway uses the connection id, so a new
WebSocket connection starts a different session.

During the run, clients receive `agent` events:

```json
{ "type": "event", "event": "agent", "seq": 1, "payload": { "runId": "...", "stream": "chunk", "text": "..." } }
{ "type": "event", "event": "agent", "seq": 2, "payload": { "runId": "...", "stream": "result", "text": "Done." } }
```

Final response:

```json
{
  "type": "res",
  "id": "msg-1",
  "ok": true,
  "payload": { "runId": "...", "status": "accepted" }
}
```

Today `agent` and `agent.wait` share the same implementation and both wait for
the local Pi run to finish while emitting events. Keep using `agent.wait` when a
client explicitly expects that behavior.

### Attachments

Upload attachment bytes over REST first:

```bash
curl -X POST "http://127.0.0.1:5233/api/v1/attachments" \
  -H "Authorization: Bearer $OWNLOOM_GATEWAY_TOKEN" \
  -H "Content-Type: image/jpeg" \
  -H "x-ownloom-attachment-kind: image" \
  -H "x-ownloom-filename: photo.jpg" \
  --data-binary @photo.jpg
```

Response:

```json
{
  "id": "...",
  "kind": "image",
  "mimeType": "image/jpeg",
  "fileName": "photo.jpg",
  "sizeBytes": 12345
}
```

Then reference the uploaded attachment in an agent request:

```json
{
  "type": "req",
  "id": "msg-2",
  "method": "agent.wait",
  "params": {
    "message": "What is in this image?",
    "sessionKey": "web-main",
    "attachments": [
      { "id": "...", "kind": "image", "mimeType": "image/jpeg", "fileName": "photo.jpg" }
    ]
  }
}
```

Current limits:

- `x-ownloom-attachment-kind` must be `image` or `audio`.
- Upload body must be non-empty.
- Max upload size is 25 MiB.
- Attachment retention/cleanup semantics are not finalized yet.

## REST API

Read-only/status endpoints:

```text
GET /api/v1/health
GET /api/v1/status
GET /api/v1/commands
GET /api/v1/sessions
```

Attachment upload:

```text
POST /api/v1/attachments
```

Headers:

```text
Content-Type: <mime-type>
x-ownloom-attachment-kind: image|audio
x-ownloom-filename: <optional original filename>
```
