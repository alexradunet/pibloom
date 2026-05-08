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

Authentication options:

- `transports.client.authToken` is a global pre-shared token.
- `transports.client.clients` defines named client identities with individual tokens and scopes.
- If either is configured, WebSocket `connect.auth.token` must match the global token or a named client token.
- REST calls must include `Authorization: Bearer <token>` matching the global token or a named client token.
- Named client REST calls enforce scopes: `read` for status/list endpoints, `write` for attachment upload.

Scope rules:

- `read`: `health`, `status`, `commands.list`, `clients.list`, `sessions.list`, `sessions.get`, `deliveries.list`
- `write`: `agent`, `agent.wait`
- `admin`: `sessions.reset`, `deliveries.retry`, `deliveries.delete`

Example named client config:

```yaml
transports:
  client:
    enabled: true
    host: 127.0.0.1
    port: 8081
    clients:
      - id: web-main
        displayName: Web Main
        token: change-me-in-private-config
        scopes: [read, write]
```

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
      "methods": ["agent", "agent.wait", "clients.list", "commands.list", "deliveries.delete", "deliveries.list", "deliveries.retry", "health", "sessions.get", "sessions.list", "sessions.reset", "status"],
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
    "sessionKey": "web-main",
    "idempotencyKey": "web-main-msg-0001"
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

### Duplicate request protection

For requests that may cause side effects, clients should include an
`idempotencyKey` in `params`. This is just duplicate-request protection for
network retries.

If the gateway has already completed a request with the same client identity,
method, and key, it returns the stored response instead of running the method
again. If the original request is still running, the duplicate receives:

```json
{
  "type": "res",
  "id": "retry-1",
  "ok": false,
  "error": { "message": "Request with this idempotencyKey is already running", "code": "REQUEST_PENDING" }
}
```

Rules:

- `idempotencyKey` is optional.
- Max length is 200 characters.
- Keys are scoped by resolved identity, or by `connect.client.id` when no identity exists, plus method.
- Stored keys expire after 7 days.

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

Attachment lifecycle:

- Attachment refs are one-shot.
- After a successful agent run, referenced attachments are deleted from gateway state and disk.
- Failed agent runs keep attachments so the client can retry.
- Uploading a new attachment also prunes staged uploads older than 24 hours.

Current limits:

- `x-ownloom-attachment-kind` must be `image` or `audio`.
- Upload body must be non-empty.
- Max upload size is 25 MiB.

### Client identities

`clients.list` returns the current WebSocket client identity/scopes and configured
named clients without token material:

```json
{ "type": "req", "id": "clients-1", "method": "clients.list", "params": {} }
```

### Delivery administration

Queued/dead-lettered deliveries can be inspected with `deliveries.list` and
manually managed over WebSocket with an admin-scoped client:

```json
{ "type": "req", "id": "retry-1", "method": "deliveries.retry", "params": { "id": "delivery-..." } }
```

`deliveries.retry` clears `deadAt`/`nextAttemptAt`, resets attempts, and triggers
an immediate queued-delivery drain. To remove a queued delivery:

```json
{ "type": "req", "id": "delete-1", "method": "deliveries.delete", "params": { "id": "delivery-..." } }
```

## REST API

Read-only/status endpoints:

```text
GET /api/v1/health
GET /api/v1/status
GET /api/v1/commands
GET /api/v1/sessions
GET /api/v1/deliveries
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

## Protocol client example

Run the Node example against a local gateway:

```bash
cd os/pkgs/gateway
OWNLOOM_GATEWAY_TOKEN=change-me npm run example:protocol
```

Useful environment variables:

```text
OWNLOOM_GATEWAY_HTTP_URL=http://127.0.0.1:8081
OWNLOOM_GATEWAY_WS_URL=ws://127.0.0.1:8081
OWNLOOM_GATEWAY_TOKEN=<client or global token>
OWNLOOM_GATEWAY_SESSION=web-main
OWNLOOM_GATEWAY_MESSAGE="Hello from protocol/v1"
OWNLOOM_GATEWAY_ATTACHMENT=/path/to/photo.jpg
OWNLOOM_GATEWAY_ATTACHMENT_KIND=image
OWNLOOM_GATEWAY_ATTACHMENT_MIME=image/jpeg
```

The example connects, calls `health`, then sends `agent.wait` with a stable
`sessionKey` and an `idempotencyKey`. If an attachment path is provided, it
uploads the attachment over REST first and then references it from the agent
request.
