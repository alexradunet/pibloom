# Ownloom operator surface

Ownloom is the AI/operator cockpit over standards-based local tools. It should not become a custom suite of planner, wiki, file, or config applications when an existing standard service already provides the needed surface.

## Product boundary

- **Main surface:** chat/workbench with action cards, approvals, traces, and operator context.
- **Human tabs:** embedded loopback web surfaces for existing services.
- **Machine surface:** small typed adapters over `ownloom-*` CLIs and standard Nix/Git/systemd commands.
- **Source of truth:** standards and plain files, not browser UI state.

## Planner boundary

- Source of truth: Radicale CalDAV/iCalendar (`VTODO`, `VEVENT`, `VALARM`).
- AI/CLI path: `ownloom-planner` remains the canonical machine interface for tasks, reminders, and events.
- Web admin path: Radicale's built-in web UI is embedded under `/radicale/` for collection management.
- Deferred: external CalDAV web clients such as InfCloud, Caldo, or Nextcloud. Add one only if the built-in Radicale management UI plus `ownloom-planner` is not enough.

Radicale's own UI manages calendars, address books, and task-capable collections. It is not a full planner client for editing every individual task/event. That is acceptable for now: individual item operations go through Ownloom chat/CLI and the small existing planner quick view.

The cockpit proxies Radicale under `/radicale/` instead of installing another web app. This is a deliberate same-origin trust choice so one loopback/SSH-tunneled Ownloom cockpit can embed the built-in UI. Treat Radicale as trusted local cockpit content, not as arbitrary third-party web content.

## Wiki boundary

- Source of truth: `/home/alex/wiki` plain Markdown files.
- AI/CLI path: `ownloom-wiki` remains the canonical machine interface for search, capture, lint, and structured updates.
- Web path: prefer a mature Markdown/Git web editor only when needed. Gollum is the first candidate if `/home/alex/wiki` becomes a Git repository.

## Config/Ops boundary

Configuration and operations should be exposed as explicit, typed actions rather than a large bespoke UI:

- `ownloom-context --health`
- `ownloom-config validate`
- `ownloom-audit`
- `git status` / `git diff`
- focused `systemctl status` / logs

Risky actions still require explicit approval: rebuild/switch, push, destructive deletes, public exposure, external sends, and secrets-affecting changes.
