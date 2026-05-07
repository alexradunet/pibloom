---
name: nixpi-evolution
description: "Create or update a NixPI evolution note in the wiki using the nixpi-wiki CLI. Use when the user asks to record an architectural decision, system change, or evolution proposal. Keywords: evolution, decision, architecture, proposal, change, nixpi."
allowed-tools: shell
---

# NixPI Evolution Notes

Evolution notes capture architectural decisions and system changes in the NixPI wiki using the standard `wiki_ensure_object` mechanism.

## Important

Do **not** use the old `nixpi-evolution` CLI — it has been removed. It generated v1 frontmatter fields (`schema_version`, `object_type`, `validation_level`) that are invalid in the current wiki schema. Always use `nixpi-wiki` directly.

## Creating an evolution note

```bash
nixpi-wiki mutate wiki_ensure_object '{
  "type": "evolution",
  "title": "<title>",
  "domain": "technical",
  "areas": ["infrastructure", "ai"],
  "summary": "<one-line summary>",
  "confidence": "medium"
}'
```

After creating it, open the file in `wiki/objects/` and fill in the body sections:

- **Motivation** — why this change is needed
- **Plan** — concrete steps
- **Validation** — how to verify it worked
- **Rollout** — any staging/timing considerations
- **Rollback** — how to revert if needed

## Resolving / updating status

Use `nixpi-wiki` to read the object path, then edit the frontmatter `status` field:

```bash
nixpi-wiki call wiki_search '{"query":"<title>","type":"evolution"}'
# then edit the file directly
```

Valid `status` values: `proposed`, `planning`, `implementing`, `validating`, `reviewing`, `applied`, `rejected`.

## Frontmatter reference (v2)

```yaml
---
id: objects/<slug>
type: evolution
title: <title>
domain: technical
areas: [infrastructure]
confidence: medium
last_confirmed: <YYYY-MM-DD>
decay: slow
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
summary: <one-line>
---
```

Fields **not** used in v2: `schema_version`, `object_type`, `validation_level`, `aliases`, `review_cycle_days`.
