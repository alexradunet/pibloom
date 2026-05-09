# Ownloom operator surface

Ownloom is the AI/operator cockpit over standards-based local tools. It should not become a custom suite of planner, wiki, file, or config applications when an existing standard service already provides the needed surface.

## Product boundary

- **Main surface:** chat/workbench with action cards, approvals, traces, and operator context.
- **Human tabs:** embedded loopback web surfaces for existing services.
- **Machine surface:** small typed adapters over `ownloom-*` CLIs and standard Nix/systemd commands.
- **Source of truth:** DAV standards and plain files, not browser UI state.

## DAV boundary

Ownloom's durable personal-data substrate is DAV-first and KISS:

- CalDAV/iCalendar: `VTODO`, `VEVENT`, `VALARM`, and eventually `VJOURNAL`.
- CardDAV/vCard: contacts and address books when contact tooling is added.
- WebDAV: Markdown wiki files, raw sources, attachments, imports, and exports.

Do not add a JMAP facade or parallel Ownloom sync API. DAV is the interoperability layer; Ownloom CLIs and chat tools hide the XML/protocol details.

## Planner boundary

- Source of truth: Radicale CalDAV/iCalendar (`VTODO`, `VEVENT`, `VALARM`).
- AI/CLI path: `ownloom-planner` remains the canonical machine interface for tasks, reminders, and events.
- Web admin path: Radicale's built-in web UI is embedded under `/radicale/` for collection management.

Radicale's own UI manages calendars, address books, and task-capable collections. It is not a full planner client for editing every individual task/event. That is acceptable: individual item operations go through Ownloom chat/CLI or a trusted DAV client over the loopback/SSH-tunneled DAV surface.

The cockpit proxies Radicale under `/radicale/` instead of installing another web app. This is a deliberate same-origin trust choice so one loopback/SSH-tunneled Ownloom cockpit can embed the built-in UI. The proxy sends dummy Basic auth to Radicale and replaces Radicale's web `main.js` with a tiny auto-login shim for the local Ownloom user using the same non-secret dummy password, avoiding an extra username/password prompt without changing Radicale's loopback-only `auth.type = none` setup. Treat Radicale as trusted local cockpit content, not as arbitrary third-party web content.

## Wiki boundary

Ownloom has two Markdown wiki roots:

- Personal/human wiki: `/home/alex/wiki` for Alex's life context, daily notes, reviews, people/projects, and personal source captures.
- Technical/operator wiki: `/var/lib/ownloom/wiki` for Ownloom host/service inventory, runbooks, incidents, audits, and architecture decisions.

Rules:

- AI/CLI path: `ownloom-wiki` remains the canonical machine interface for search, capture, lint, and structured updates; callers select the intended root through `domain=personal|technical` or the exported root env vars.
- WebDAV path: `services.ownloom-webdav` exposes `/` as the compatibility personal wiki root and `/personal/` + `/technical/` as explicit split-root paths for trusted file editors and sync tools through an SSH tunnel.
- Metadata path: WebDAV edits are ordinary file edits; generated registry/backlink/FTS metadata is rebuilt by `ownloom-wiki mutate wiki_rebuild` and the WebDAV rebuild timer per root.
- Live tasks/reminders/events stay in CalDAV/iCalendar. Wiki notes may summarize or reference DAV objects, but must not become a second planner database.

Git is for the Ownloom code/config repository (`/home/alex/ownloom`), not the live wiki substrate.

## Config/Ops boundary

Configuration and operations should be exposed as explicit, typed actions rather than a large bespoke UI:

- `ownloom-context --health`
- `ownloom-config validate`
- `ownloom-audit`
- repository `git status` / `git diff`
- focused `systemctl status` / logs

Risky actions still require explicit approval: rebuild/switch, push, destructive deletes, public exposure, external sends, and secrets-affecting changes.
