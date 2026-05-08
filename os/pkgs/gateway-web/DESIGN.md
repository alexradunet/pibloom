# Ownloom Cockpit Design System

Ownloom Cockpit is a private, local-first operator surface for Alex and his AI system. The design direction is now **Digital Scoarță / Pixel Loom Minimalism**: warm, grounded software that translates Romanian `scoarțe` / loom structure into a calm pixel-like workbench.

The UI should feel useful first: flat, blocky, readable, warm, and lightly woven. It must not feel like a generic SaaS dashboard, a glossy themed skin, or decorative folklore wallpaper.

## Research basis

Web research anchors for this direction:

- UNESCO describes traditional wall-carpet craftsmanship in Romania and Moldova as loom-based work with motifs that carry origin, identity, dowry, ritual, and community meaning: <https://ich.unesco.org/en/RL/traditional-wall-carpet-craftsmanship-in-romania-and-the-republic-of-moldova-01167>
- The National Museum of the Romanian Peasant describes `scoarțe` as a major element of the peasant interior, with regional variation, wool, natural/vegetal colors, borders, rhombi, tree/flower/vine motifs, birds, animals, human figures, and successive serrated bands: <https://muzeultaranuluiroman.ro/en/carpet/>
- Eliznik’s Romanian textile notes describe loom-made woven patterns, stripes, checks, `alesătură`, `neveditură`, diamonds, zigzags, waves, and spruce/fir branches: <https://eliznik.org.uk/traditions-in-romania/traditional-clothing/materials-and-decorations/woven-and-printed-patterns/>
- The National Village Museum and rural-interior references reinforce the material mood: simple wood furniture, wool/hemp/cotton textiles, ceramic plates, old beams, geometric wall carpets, yellow/blue/green accents, and warm layered rooms.

Use these as direction, not as assets. The product remains local and self-contained: no remote images, fonts, scripts, or icons.

## Concept: Digital Scoarță

Internal metaphor: **digital scoarță** — a woven wall-carpet logic translated into software layout.

- **Pixel loom**: woven motifs become small square accents, not illustration.
- **Vatra / hearth**: warmth, privacy, home base, human review, safety.
- **Război / loom**: structured threads, agent sessions, planner continuity, repeatable systems.
- **Scoarță / wall carpet**: panels with borders, fields, rhythm, and symbolic motifs.
- **Sat vechi / old village**: useful materials, low gloss, durable objects, visible craft.

Product phrase to guide tone: **woven context, local control**. Use sparingly.

## Visual principles

1. **Useful before ornamental** — Romanian textile cues should organize state and hierarchy, not distract.
2. **Flat before glossy** — prefer solid surfaces, crisp borders, and restrained shadows; avoid glow-heavy artificial dashboards.
3. **Pixel motif as structure** — small blocky stripes, teeth, and diamonds are allowed only at edges, dividers, active states, and the icon.
4. **Warm sovereignty** — local-first privacy should feel like a protected home/workroom, not a cold bunker.
5. **Woven workbench** — organize around one active work thread plus supporting tools, not dashboard decoration.
6. **Earthy restraint** — clay, wool, walnut, ochre, madder red, moss, and muted indigo; avoid neon/cyberpunk.
7. **No stale truth** — live state must stay explicit; never make cached planner/API data look current.

## Palette

Default theme is warm dark/operator mode.

### Primitive color story

- **Charred walnut** — private dark canvas, terminal depth.
- **Burnt clay** — panel warmth, village walls, pottery.
- **Undyed wool / hemp** — readable text, dividers, low-noise surfaces.
- **Madder red / brick** — primary action, user agency, festive protective thread.
- **Ochre / loomlight** — focus, attention, warning, lamp/hearth glow.
- **Moss** — healthy/connected/done.
- **Muted indigo** — secondary thread, historical textile dye accent, agent/system contrast.
- **Ember** — destructive/error states.

### Usage ratios

- 75% dark walnut/clay surfaces.
- 18% wool/hemp text and borders.
- 5% ochre/madder pixel accents.
- 2% moss/indigo/ember state colors.

### Accessibility rules

- Normal text contrast: WCAG AA 4.5:1 minimum.
- Large text and UI boundaries/states: 3:1 minimum.
- State cannot rely on color alone; pair color with readable labels.
- Use warm accent only where it helps users act or orient.

## Motif grammar

Use CSS gradients and borders only. No decorative image assets.

Allowed motifs:

- **Warp/weft lines**: a faint page grid only; avoid patterned fields behind text.
- **Rhombus / diamond**: app icon or occasional empty-state mark; not as page wallpaper.
- **Serrated teeth**: selected sidebar edge, status emphasis, section divider.
- **Pixel stripes / registers**: card top edges and header edge only.
- **Tree/vine inspiration**: deferred; avoid literal illustration for now.

Avoid:

- busy folk wallpaper behind text;
- literal costumes, flags, mascots, or stock “traditional” images;
- copying sacred/ritual motifs without understanding;
- turning the operator UI into a souvenir shop aesthetic.

## Token architecture

Use CSS custom properties only. No token JSON, build step, framework, Tailwind, or generated utilities.

Tokens live in `public/styles/tokens.css` and should remain additive/compatible:

1. **Primitive tokens** — raw palette, spacing, radius, typography, shadows, motion.
2. **Semantic tokens** — UI roles like background, surface, text, border, accent, danger, focus.
3. **Component tokens** — repeated roles for buttons, cards, chips, messages, inputs.

Keep existing token names working when refactoring so incremental changes stay safe.

## Typography

Use system fonts only.

- Body: readable `1rem` base, line-height around `1.5`.
- Headings: compact, warm, clear, slightly editorial; no decorative fonts.
- Labels/meta: compact but readable; operational controls must not be tiny.
- Logs/tokens/technical snippets: monospace system stack.

## Layout and surfaces

- Shell max width around 1320px.
- Sidebar is the loom frame: persistent navigation, warm border, one pixel-woven edge.
- Cards are `scoarță` fields: flat dark clay surfaces with crisp borders and one small top stitch.
- Header is the workbench lintel: title, meaning, and live status in one quiet band.
- Prefer border + surface contrast over dramatic elevation.
- Keep geometry mostly rectangular: small radii, blocky chips, and square-ish controls.

## Components

### Header

The header should quickly answer:

- Where am I? Ownloom Cockpit.
- What is this? A local loom for chat, planner context, config, terminal, and logs.
- Is it connected/offline? Status chips.

### Sidebar navigation

Preserve the native ARIA tab structure inside the sidebar. Active state should differ by more than color: use fill, border/accent, text contrast, and the left “woven edge”.

### Cards

Cards group meaningful operator work:

- chat composer/log;
- sessions;
- planner context;
- config/client/delivery groups;
- terminal/log panels.

Give each card a quiet textile edge; do not add decorative motifs that compete with content.

### Buttons

Use clear variants:

- primary: madder/ochre clay thread, one main action per area;
- secondary: muted wool-on-clay;
- ghost: low emphasis;
- danger: ember/red for destructive actions;
- small: repeated list actions.

Destructive actions still require confirmation.

### Chips and pills

Use for status, identity, scope, and source:

- connected/offline/error;
- web-main/current session;
- config-managed/paired browser;
- WhatsApp/web/local.

Every chip must contain readable text; color is reinforcement.

### Workbench

Workbench is the main working surface: a clean ChatGPT/Claude-like conversation with one composer and a slide-out thread rail.

- default state should be quiet: conversation centered, thread rail closed;
- current conversation state belongs in the global status/thread bar;
- active thread content gets the largest field on the page;
- composer is a simple bottom tool strip, not a generic form block;
- thread switching lives in an explicit slide-out rail, not an always-visible dashboard column;
- user messages right, in madder/clay tones;
- agent/system left, in walnut/indigo tones;
- preserve `role="log"` and polite live updates;
- attachments stay explicit and one-shot;
- do not switch sessions while an agent run is active.

### Planner

Planner is planner-backed, not wiki-task-backed.

The Planner tab uses the loopback `ownloom-planner` API proxied under `/api/planner/` and must stay honest about live state:

- show overdue, today, and upcoming items from CalDAV/iCalendar;
- support small CRUD actions without inventing a second planner store;
- keep loading/error status visible and never present cached data as current;
- copy should mention Ownloom Planner / CalDAV / iCalendar, not Markdown task pages.

### Access

Access should be clear and slightly more operator in tone.

- pairing creates a full-operator runtime client;
- token storage depends on Remember locally;
- revoke/delete/forget use danger styling;
- do not echo tokens into logs or normal text.

### Shell

Shell is powerful and advanced.

- keep loopback-only copy visible;
- lazy-load iframe only on the Shell tab;
- token copy should be local and short-lived;
- do not broaden frame/proxy/security assumptions.

### Trace

Trace is local trace, not durable memory.

- monospace;
- compact;
- readable wrapping;
- no token echoing beyond existing redaction assumptions.

## Motion

Motion should be short, purposeful, and optional.

Recommended use:

- hover/focus/press feedback;
- tab/panel transition;
- new message entry;
- one-shot status change feedback;
- loading state only when paired with text/`aria-busy`.

Rules:

- Animate `opacity` and `transform` where possible.
- Avoid parallax, animated backgrounds, bouncing, and decorative loops.
- Respect `prefers-reduced-motion`.
- Never require motion to understand state.

## Accessibility

Accessibility is part of the visual system.

- Keep semantic HTML first.
- Preserve skip link.
- Preserve ARIA tabs and keyboard support.
- Every interactive element needs visible `:focus-visible` styling.
- No color-only state.
- Respect reduced motion and forced-colors/high-contrast modes.
- Test 200% zoom and 320px width.
- Prefer text buttons over icon-only controls.
- Live regions should be polite and not noisy.

## Responsive behavior

- Desktop: sidebar + main content.
- Tablet/mobile: stack layout and settings controls.
- Tabs may scroll horizontally if needed.
- The page should not horizontally scroll except terminal/log/code-like content when unavoidable.
- Header status wraps above tabs.
- Button rows wrap cleanly; narrow cards may stack actions.

## Security and mobile boundaries

Design work must not weaken the operator security model.

- No external scripts/styles/fonts/icons.
- No inline scripts/styles that conflict with CSP.
- No broadening of `connect-src`, `frame-src`, or loopback assumptions without explicit approval.
- No PWA manifest or service worker for now; a proper mobile app can come later.
- Never cache API, planner, terminal, token, Authorization, WebSocket, or operator-data responses.
- If old PWA assets existed in a browser, the current app may unregister/clear them as a transitional cleanup only.

## Implementation order

1. Refine tokens additively.
2. Improve base controls, focus, typography, and reduced-motion coverage.
3. Polish cards, tabs, buttons, chips, messages, lists, terminal, and log.
4. Refresh static copy/classes in `index.html` without changing required IDs/data attributes.
5. Add dynamic button/status variants in JS only where needed.
6. Update smoke checks only for intentional changed strings/files/selectors.
7. Validate with JS checks, Nix builds, keyboard-only pass, contrast pass, reduced-motion pass, and mobile/zoom checks.

## Non-goals for now

- No framework.
- No build step.
- No Tailwind.
- No remote design assets.
- No custom animation engine.
- No theme marketplace.
- No rich calendar app beyond the small Ownloom Planner CRUD surface.
