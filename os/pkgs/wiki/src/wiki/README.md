# ownloom Wiki core

ownloom Wiki stores structured frontmatter next to human-readable plain Markdown notes and keeps generated metadata indexes current.

It is intentionally only a wiki memory layer. It does not know about deployment-specific systems, client adapters, identity/voice layers, or prompt policy.

## Tools

Generic tools exposed by the CLI/dispatcher:

- `wiki_status`
- `wiki_search`
- `wiki_ensure_object`
- `wiki_daily`
- `wiki_ingest`
- `wiki_lint`
- `wiki_rebuild`
- `wiki_decay_pass`
- `wiki_session_capture`

## Initialize a root

```bash
ownloom-wiki init --root ~/wiki --workspace personal --domain personal
```

The command copies the bundled generic seed, creates canonical folders, writes generated metadata, and prints environment setup hints. Existing files are kept.

## Storage path

Use ownloom environment variables:

```text
OWNLOOM_WIKI_WORKSPACE=personal
OWNLOOM_WIKI_ROOT=/path/to/wiki
OWNLOOM_WIKI_DEFAULT_DOMAIN=personal
OWNLOOM_WIKI_HOST=ownloom-vps
```

No legacy `NIXPI_*` wiki environment variables are accepted. If no root is configured, the fallback root is:

```text
~/wiki
```

Ownloom hosts may expose split roots with:

```text
OWNLOOM_WIKI_ROOT_PERSONAL=/home/alex/wiki
OWNLOOM_WIKI_ROOT_TECHNICAL=/var/lib/ownloom/wiki
```

`domain=personal|technical` selects the matching root when those env vars are set. `OWNLOOM_WIKI_ROOT` remains the compatibility/default root for callers that do not select a domain.

## Canonical folders

```text
daily/                              daily notes
objects/                            typed object pages
sources/                            captured evidence and research
meta/about-alex/                    agent model/context
meta/audit/                         reviews and audit notes
types/                              type schemas
```

Live task/reminder/event state is not stored as wiki Markdown. Use the ownloom planner backend (CalDAV/iCalendar) for live planner items.

## Metadata

Generated metadata lives under `meta/` and can be rebuilt with:

```bash
ownloom-wiki mutate wiki_rebuild '{"domain":"personal"}'
```

Read tools rebuild missing generated metadata when needed. External WebDAV edits are normal file edits; run `ownloom-wiki mutate wiki_rebuild '{}'` when immediate search/backlink freshness matters. On NixOS hosts, `services.ownloom-webdav` can run the rebuild timer automatically.

## Safety model

- Read-only tools can run with `ownloom-wiki call`.
- Wiki writes should use `ownloom-wiki mutate` or `ownloom-wiki call ... --yes`.
- Protected raw/proposal paths are adapter policy; core tools expose structured mutation paths.
