# Bloom Service Packages

Bundled service packages live in `services/`.

## Current Packages

| Path | Role |
|------|------|
| `services/cinny/` | packaged web chat client using a pinned upstream image |
| `services/dufs/` | packaged service using a pinned upstream image |
| `services/code-server/` | packaged service built as a local image when needed |
| `services/_template/` | scaffold template for new packages |
| `services/catalog.yaml` | service and bridge metadata catalog |

Reference-only infrastructure docs:

| Path | Role |
|------|------|
| `services/matrix/SKILL.md` | Matrix infrastructure notes |
| `services/netbird/SKILL.md` | NetBird infrastructure notes |

## Package Shape

Typical package:

```text
services/{name}/
  SKILL.md
  quadlet/
    bloom-{name}.container
  Containerfile     optional, for locally built images
```

## Installation Flow

`service_install` and `manifest_apply` operate on these packages. Bridge tools use the `bridges:` section in `services/catalog.yaml` but do not require a per-bridge package directory under `services/`.

Current install behavior:

1. find the package in the repo, system share, or current working tree
2. copy Quadlet files into user runtime locations
3. copy `SKILL.md` into `~/Bloom/Skills/{name}/`
4. create default env/config files in `~/.config/bloom/`
5. build local images for `localhost/*` refs when needed
6. reload and optionally start the user unit

## Scaffold Source

`services/_template/` is the scaffold basis for generated service packages.

Current scaffold output from `service_scaffold` is intentionally lightweight:

- Quadlet container unit
- optional socket unit
- `SKILL.md`

It does not yet expand into a full template-generated source tree automatically.
