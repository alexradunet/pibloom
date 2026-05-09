# ownloom Wiki

Portable plain-Markdown LLM wiki CLI and core tools.

ownloom Wiki is a memory substrate only. It stores, searches, lints, ingests, captures session summaries, and rebuilds wiki knowledge. It does not own identity, voice, client-session policy, or deployment-specific tools.

## CLI

```bash
ownloom-wiki list
ownloom-wiki init --root ~/ownloom/work-wiki --workspace work --domain work
ownloom-wiki context --format markdown
ownloom-wiki call wiki_status '{"domain":"work"}'
ownloom-wiki call wiki_search '{"query":"memory","domain":"work"}'
ownloom-wiki mutate wiki_ingest '{"content":"note","channel":"journal"}'
ownloom-wiki mutate wiki_session_capture '{"summary":"Worked on ownloom wiki docs."}'
```

## Environment

```text
OWNLOOM_WIKI_ROOT=/path/to/default-wiki
OWNLOOM_WIKI_ROOT_PERSONAL=/home/alex/wiki
OWNLOOM_WIKI_ROOT_TECHNICAL=/var/lib/ownloom/wiki
OWNLOOM_WIKI_WORKSPACE=work
OWNLOOM_WIKI_DEFAULT_DOMAIN=technical
OWNLOOM_WIKI_HOST=workstation
OWNLOOM_WIKI_BODY_SEARCH_BIN=rga
```

If `OWNLOOM_WIKI_ROOT` is not set, ownloom Wiki uses the configured default-domain split root, then falls back to:

```text
~/wiki
```

## Install standalone

From a local checkout or packed tarball:

```bash
cd os/pkgs/wiki
npm run build
npm pack
npm install -g ./ownloom-wiki-0.3.0.tgz
ownloom-wiki init --root ~/work-wiki --workspace work --domain work
```

Local project usage:

```bash
npm install @ownloom/wiki
npx ownloom-wiki init --root ./wiki --workspace work --domain work
```

## Initialize a wiki

```bash
ownloom-wiki init --root ~/ownloom/work-wiki --workspace work --domain work
export OWNLOOM_WIKI_ROOT="$HOME/ownloom/work-wiki"
export OWNLOOM_WIKI_WORKSPACE="work"
export OWNLOOM_WIKI_DEFAULT_DOMAIN="work"
ownloom-wiki doctor --json
```

`init` is idempotent. It copies only missing seed files, creates canonical folders, and rebuilds generated metadata.

## Tool boundary

Generic tools:

```text
wiki_status
wiki_search
wiki_ensure_object
wiki_daily
wiki_ingest
wiki_lint
wiki_rebuild
wiki_decay_pass
wiki_session_capture
```

Deployment-specific audits, system operations, identity/voice layers, and client adapters belong in packages that depend on ownloom Wiki.
