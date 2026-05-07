# NixPI PI Adapter

Thin PI harness adapter for NixPI.

PI remains the only shipped NixPI agent today, but this package should stay small and adapter-specific. Shared behavior belongs in `nixpi-*` CLIs and Markdown/context files, not here.

## Contents

- `extension/index.ts` — PI entrypoint, session hooks, `/nixpi` command, and the thin `nixpi_planner` registered tool wrapper.
- `extension/wiki/` — PI-specific wiki registered-tool UX and session hooks, delegating to the shared `nixpi-wiki` API.

## Design rules

- Keep PI code as adapter glue only.
- Prefer shared CLIs: `nixpi-context`, `nixpi-planner`, and `nixpi-wiki`. Removed operational CLIs have been replaced by skills in `os/skills/`.
- Critical safety/allowlist logic belongs in config (sudoers, systemd units), not in wrapper CLIs or PI hooks.
- Registered PI tools are UX affordances and should be thin wrappers over shared interfaces.
- Do not add new PI-only operational behavior unless a CLI would be awkward or impossible.
