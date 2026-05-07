# ownloom-gateway-web

Small protocol/v1-only web client skeleton for Ownloom Gateway.

It is intentionally static HTML/CSS/JS: no bundled legacy gateway UI, no framework, no build step.

## Use

Open `public/index.html` from a local/static server, enter the loopback gateway URL and a named client token, then connect.

Current features:

- protocol/v1 WebSocket `connect`
- `health`
- `agent.wait` chat with stable `sessionKey`
- streamed `agent` event display
- REST attachment upload using one-shot attachment refs
- sessions, deliveries, and commands list panels

The gateway client transport is still expected to stay loopback-only until HTTPS/reverse-proxy/pairing is designed.
