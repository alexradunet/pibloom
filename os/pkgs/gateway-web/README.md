# ownloom-gateway-web

Small protocol/v1-only Ownloom cockpit for local operator use.

It is intentionally static HTML/CSS/JS: no bundled legacy gateway UI, no framework, no build step. The browser app uses native ES modules plus a pragmatic Atomic Design layout.

Canonical design direction and guardrails live in the repo-level [`DESIGN.md`](../../../DESIGN.md): **Digital Scoarță / Pixel Loom Minimalism**. The gateway-specific [`DESIGN.md`](./DESIGN.md) explains how this package implements it: Pico-first, self-hosted assets, flat tonal layers, 4px rhythm, structural borders, pixel-stitch motifs, Newsreader headings, Work Sans interface text, and JetBrains Mono operational metadata.

## Use

On `ownloom-vps`, the NixOS service serves the UI loopback-only:

```text
http://127.0.0.1:8090
```

From another machine, use an SSH tunnel:

```bash
ssh -L 8090:127.0.0.1:8090 ownloom-vps
```

Then open <http://127.0.0.1:8090> and click **Pair this browser**. The browser receives a loopback-only runtime token, stores it in local storage only when **Remember locally** is enabled, and connects automatically.

You can still paste a named client token manually and click **Connect** if needed.

For ad-hoc local use without the NixOS service:

```bash
nix run .#ownloom-gateway-web
```

The server serves the static UI and proxies `/api/v1/*` plus WebSocket upgrades to `OWNLOOM_GATEWAY_URL`, defaulting to `http://127.0.0.1:8081`. It also proxies `/api/planner/*` to the existing Ownloom Planner API and `/radicale/` to Radicale's built-in collection management UI. When `OWNLOOM_TERMINAL_URL` is set, `/terminal/` is proxied to the loopback Zellij web client for the cockpit Terminal tab.

The terminal tab opens the shared `ownloom` Zellij session at `/terminal/ownloom`. Zellij web requires its own login token. The NixOS service creates one on first start and stores it at `/var/lib/ownloom-terminal/login-token`. The cockpit can copy that token from the loopback-only **Copy Zellij token** button; after login, Zellij stores a browser session cookie.

## Static architecture

The UI is organized as native ES modules:

```text
public/
  app.js                  # tiny compatibility bootstrap
  components.html         # static Ownloom component catalog / storybook-like loom
  js/
    app.js                # app composition/root controller
    constants.js          # storage keys, protocol constants
    state.js              # app state and chat/session helpers
    storage.js            # localStorage helpers
    dom.js                # safe DOM helpers
    gateway-client.js     # protocol/v1 WebSocket + REST wrappers
    a11y.js               # ARIA tab controller
    components/
      atoms.js
      molecules.js
      organisms/*.js
    controllers/*.js
  vendor/
    pico.min.css            # self-hosted Pico CSS v2 base (CSP stays style-src 'self')
    fonts/                  # self-hosted Newsreader, Work Sans, JetBrains Mono
  styles/
    tokens.css              # canonical Digital Scoarță tokens mapped to --pico-* variables
    base.css
    layout.css
    components.css
    utilities.css
    responsive.css
  icons/icon.svg
```

Atomic Design is used as file organization, not framework ceremony:

- **atoms**: buttons, chips, pills, small text primitives
- **molecules**: message bubbles, action rows, list item shells
- **organisms**: chat/session/client/delivery/command/terminal/settings renderers
- **controllers**: event wiring and flows for chat, config, terminal, organizer, and log

Dynamic UI is rendered with DOM APIs and `textContent`; avoid `innerHTML`, `outerHTML`, and `insertAdjacentHTML`.

CSS is Pico-first: `public/style.css` imports the vendored `public/vendor/pico.min.css` base, then a small Ownloom theme/app layer maps the canonical Digital Scoarță palette, typography, spacing, and radius tokens from `DESIGN.md`. Runtime fonts/styles are self-hosted to preserve CSP and local-first operation. Keep it no-build: add new CSS files explicitly and include them in the smoke check when needed.

## Mobile/PWA status

There is intentionally no PWA manifest or service worker for now. A proper mobile app can be designed later without carrying a half-PWA shell. The browser app unregisters any old `ownloom-gateway-web-*` service workers/caches left by earlier builds.

## Security headers

`server.mjs` serves static files with conservative local-cockpit headers:

- `Content-Security-Policy`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `X-Frame-Options: SAMEORIGIN`

It also rejects non-loopback `Host`/`Origin` headers to reduce DNS-rebinding exposure, and forces `Cache-Control: no-store, max-age=0` on proxied `/api/v1/*`, `/api/planner/*`, `/radicale/*`, and `/terminal/*` HTTP responses, including proxy errors. Do not add HSTS while the supported deployment is loopback HTTP/SSH tunnel.

The `/radicale/` proxy deliberately keeps Radicale same-origin so it works through the single Ownloom SSH tunnel and can be embedded as a tab. Treat Radicale as part of the trusted local cockpit, not as arbitrary third-party content.

## Current features

- flat Digital Scoarță / pixel-loom shell with a main card plus right context rail on every cockpit tab
- accessible ARIA tab navigation with keyboard support
- no PWA manifest/service-worker; old PWA caches are cleaned up on load
- loopback-only browser pairing into a full-operator runtime client
- protocol/v1 WebSocket `connect`
- `health`
- `agent.wait` chat with stable `sessionKey`
- clean centered Workbench conversation with no main background card, slide-out/right thread rail, New thread, web session switching, and local attach to existing WhatsApp sessions; conversation changes are blocked while an agent run is active
- streamed `agent` event display
- REST attachment upload using one-shot attachment refs
- sessions, clients, deliveries, and commands list panels
- live Planner tab backed by `ownloom-planner`/CalDAV with add, done, snooze/reschedule, edit, delete, overdue/today/upcoming views
- embedded Radicale built-in collection management UI under `/radicale/`, avoiding an extra CalDAV web app until needed
- current client de-duplication and clear labels for paired/config-managed clients
- operator action buttons with confirmation prompts
- Send button disabled while an agent run is active
- confirmations for destructive session, delivery, and runtime-client actions
- Shell tab that embeds `/terminal/ownloom` when the loopback Zellij web service is enabled
- loopback-only helper button to copy the generated Zellij web login token
- static `components.html` component loom for atoms, cards, rails, messages, planner/list patterns, and trace surfaces

The gateway client transport is still expected to stay loopback-only until HTTPS/reverse-proxy/pairing is designed.

## Validation

```bash
find os/pkgs/gateway-web/public -name '*.js' -print0 | xargs -0 -n1 node --check
node --check os/pkgs/gateway-web/server.mjs
nix build .#ownloom-gateway-web --no-link
nix build .#checks.x86_64-linux.ownloom-gateway-web-smoke --no-link
```

For local header/token smoke testing, run the package on a temporary port with a temporary terminal token file, then verify `/`, `/api/v1/terminal-token`, `/api/planner/items`, `/radicale/.web/`, and a proxy error path with `curl -D-`.

## Rollback

Prefer reverting the modernization commit(s). If an old service worker remains in a browser from pre-removal builds, clear it from browser DevTools or reload the current cockpit once so the cleanup hook can unregister it.
