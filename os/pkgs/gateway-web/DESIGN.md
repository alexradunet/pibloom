# Gateway Web Design Implementation

The canonical Ownloom design system is the repo-level [`../../../DESIGN.md`](../../../DESIGN.md): **Digital Scoarță / Pixel Loom Minimalism**.

This package implements that system for the static Ownloom web shell and local cockpit. If this file and the repo-level design ever conflict, the repo-level `DESIGN.md` wins.

## Non-negotiables for gateway-web

- Keep the runtime static: served HTML, CSS, and JavaScript files with no browser-side build service.
- Build-time Tailwind v4 and Lit/mini-lit-style component generation is allowed when output is self-hosted under `public/generated/`.
- Keep Pico CSS as the temporary baseline reset/component layer; map Ownloom tokens onto Pico variables in `public/styles/tokens.css`.
- Tailwind must use Digital Scoarță tokens as aliases, not introduce a second visual system. Avoid Tailwind Preflight while Pico remains.
- Keep runtime assets self-hosted. No remote scripts, styles, fonts, icons, analytics, or image assets.
- Preserve CSP compatibility: `style-src 'self'`, `font-src 'self'`, loopback-only API/WebSocket/frame assumptions.
- Preserve required `/admin` IDs, `data-*` hooks, ARIA tabs, terminal hooks, Radicale frame hooks, and protocol behavior.
- Keep `components.html` as a static no-JS component loom and `components-lit.html` as the generated Lit/Tailwind proof island. The generated island must stay catalog-only until a migration step explicitly moves a live flow.

## Core visual contract

- **Mood:** private warm study, local digital hearth, constructed not glossy.
- **Palette:** exact Digital Scoarță colors from `../../../DESIGN.md` are exposed as `--ds-*` tokens.
- **Typography:** Newsreader for headings, Work Sans for interface/body, JetBrains Mono for labels/chips/logs/metadata. Fonts live under `public/vendor/fonts/`.
- **Geometry:** mostly rectangular, 4px default radius, 4px spacing rhythm, crisp 1px structural borders.
- **Depth:** use tonal layers and borders, not shadows. Shadows should remain `none` unless explicitly justified.
- **Motifs:** only subtle CSS pixel-stitch dividers, woven edges, and 4px notches. No wallpaper, literal folklore graphics, mascots, flags, or stock traditional imagery.
- **Accessibility:** state must never rely on color alone; keep visible focus, reduced-motion, forced-colors, keyboard tab support, and semantic HTML.

## File responsibilities

```text
public/index.html                  # personal/user-mode shell at /
public/admin.html                  # existing operator cockpit at /admin
public/style.css                   # import order: Pico, tokens/theme, app CSS
public/vendor/pico.min.css         # self-hosted Pico CSS
public/vendor/fonts/               # self-hosted Digital Scoarță typefaces
public/styles/tokens.css           # canonical --ds-* tokens + Pico variable mapping
public/styles/base.css             # base typography, forms, focus, selection
public/styles/layout.css           # app shell, sidebar, workbench, grids
public/styles/components.css       # cards, chips, messages, lists, service frames, log
public/styles/responsive.css       # mobile/zoom/reduced-motion/forced-colors
src/styles/ownloom-tailwind.css    # Tailwind v4 token bridge; no Preflight
src/components/ownloom-lit.ts      # catalog-only Lit component island source
public/generated/ownloom-lit.css   # generated Tailwind CSS output
public/generated/ownloom-lit.js    # bundled self-hosted Lit island output
```

## Component guidance

- **Personal shell (`/`):** calm user-mode entry point for today, planner, journal, documents, and clear links to advanced/admin surfaces.
- **Admin cockpit (`/admin`):** preserve the existing operator behavior and hooks until a deliberate migration step moves one flow at a time.
- **Sidebar:** the admin loom frame. It should carry a restrained stitched edge and active tab state that is visible beyond color.
- **Top lintel:** title, purpose, and live status in one quiet band.
- **Workbench:** centered active thread first; thread rail secondary and hideable.
- **Composer:** simple bottom tool strip; attachments remain explicit and one-shot.
- **Planner:** embed Radicale collection management honestly; individual item operations belong in chat/CLI, not a duplicate custom web app.
- **Access:** operator clarity; never echo tokens in normal text/logs.
- **Shell:** clearly local/loopback; iframe lazy-load stays tab-gated.
- **Trace:** local redacted diagnostics, monospace, readable, not durable memory.
- **Component catalog:** `components.html` demonstrates real classes/components without loading cockpit JS.

## Page layout pattern

Every admin cockpit tab should use a two-part layout:

```html
<div class="page-layout">
  <article class="page-card">Main work surface</article>
  <aside class="page-sidebar">Right context rail</aside>
</div>
```

The main work surface is carded consistently. The Workbench/chat exception keeps `.workbench-card` transparent so the conversation itself has no card background, while the right thread rail still participates in the same sidebar pattern.

## Change checklist

Before committing gateway-web visual changes:

1. Verify the change still follows `../../../DESIGN.md`.
2. Keep custom CSS minimal and app-specific; prefer Pico semantics for existing live flows until they are intentionally migrated.
3. Use Tailwind utilities for generated islands only when they make the component clearer than hand-written CSS.
4. Update smoke checks for intentional new static/generated assets/selectors.
5. Run:

```bash
cd os/pkgs/gateway-web && npm run build && npm run check
find os/pkgs/gateway-web/public -name '*.js' -print0 | xargs -0 -n1 node --check
node --check os/pkgs/gateway-web/server.mjs
nix build .#ownloom-gateway-web --no-link
nix build .#checks.x86_64-linux.ownloom-gateway-web-smoke --no-link
```
