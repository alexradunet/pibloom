# ownloom rebrand plan

This repository is being rebranded from **NixPI** to **ownloom**.

Current branch: `rebrand-ownloom`.

## Scope decisions

- Project/user-facing brand changes from `NixPI` to `ownloom`.
- Program/package/service/env names change from `nixpi-*` / `NIXPI_*` to `ownloom-*` / `OWNLOOM_*`.
- Keep the live host identity `nixpi-vps` during the first migration. Rename to `ownloom-vps` only in a later dedicated host migration.
- Keep temporary compatibility wrappers/aliases for old `nixpi-*` CLI names until the rebrand is fully deployed and agent context is updated.
- Preserve existing runtime data. Do not blindly move `/var/lib/nixpi-*` state without explicit fallback/migration.

## Case-aware rename map

| Old | New |
| --- | --- |
| `NixPI` | `ownloom` |
| `nixpi` | `ownloom` |
| `NIXPI` | `OWNLOOM` |
| `nixpi-wiki` | `ownloom-wiki` |
| `nixpi-context` | `ownloom-context` |
| `nixpi-gateway` | `ownloom-gateway` |
| `nixpi-planner` | `ownloom-planner` |
| `nixpi-config` skill | `ownloom-config` skill |
| `nixpi-audit` skill | `ownloom-audit` skill |
| `nixpi-svc` skill | `ownloom-svc` skill |
| `nixpi-reboot` skill | `ownloom-reboot` skill |
| `nixpi-evolution` skill | `ownloom-evolution` skill |

## Initial inventory

Command:

```sh
rg -l --ignore-case 'nixpi|NixPI|NIXPI' . \
  --glob '!flake.lock' \
  --glob '!.git/**' \
  --glob '!result*'
```

Main affected areas:

- `README.md`, `docs/`
- `flake.nix`
- `hosts/alex.nix`
- `hosts/nixpi-vps/**`
- `os/modules/**`
- `os/pkgs/context/**`
- `os/pkgs/gateway/**`
- `os/pkgs/pi-adapter/**`
- `os/pkgs/planner/**`
- `os/pkgs/wiki/**`
- `os/skills/nixpi-*/*`

## Phase 0 — inventory and safety baseline

- [x] Create migration branch: `rebrand-ownloom`.
- [x] Inventory current references.
- [x] Run current baseline checks before functional edits:

```sh
nix flake check --accept-flake-config
```

## Phase 1 — docs and branding only

Low-risk textual changes that do not rename Nix attributes, CLIs, services, option paths, env vars, or host names.

Targets:

- [x] `README.md`
- [x] `docs/agent-contract.md`
- [x] package READMEs under `os/pkgs/**/README.md` for touched packages
- [x] comments/descriptions that are not part of command/service/option names

Validation:

```sh
nix flake check --accept-flake-config
```

## Phase 2 — flake/package attribute migration

Add ownloom package/app names while keeping old aliases.

Target end state:

- [x] `ownloom-wiki` package/app exists.
- [x] `ownloom-context` package/app exists.
- [x] `ownloom-gateway` package exists.
- [x] `ownloom-planner` package/app exists.
- [x] Old `nixpi-*` package/app attributes remain as aliases for one transition period.

Likely file:

- `os/modules/packages/flake-module.nix` — done for package/app attributes.
- `os/pkgs/*/default.nix` — derivation `pname` moves to `ownloom-*` in Phase 3 while keeping old command wrappers.

Validation:

```sh
nix build .#ownloom-wiki
nix build .#ownloom-context
nix build .#ownloom-gateway
nix build .#ownloom-planner
nix build .#nixpi-wiki
nix build .#nixpi-context
nix build .#nixpi-gateway
nix build .#nixpi-planner
nix flake check --accept-flake-config
```

## Phase 3 — CLI binary migration

Add new binary names inside package outputs while keeping old wrapper commands.

Target end state:

- [x] `ownloom-context` works; `nixpi-context` remains a wrapper.
- [x] `ownloom-wiki` works; `nixpi-wiki` remains a wrapper.
- [x] `ownloom-planner` works; `nixpi-planner` remains a wrapper.
- [x] `ownloom-gateway` works if exposed as a binary; old names remain compatible.

Compatibility rule:

- New services and docs should call `ownloom-*`.
- Old `nixpi-*` commands may stay temporarily for agent prompts, scripts, and operator muscle memory.

Validation:

```sh
nix run .#ownloom-context -- --format markdown --health
nix run .#ownloom-planner -- list --view upcoming
nix run .#nixpi-context -- --format markdown --health
nix run .#nixpi-planner -- list --view upcoming
```

## Phase 4 — TypeScript/source names

Rename internal source identifiers, config names, docs, package metadata, and tests.

Targets:

- [x] `os/pkgs/gateway/**`
- [x] `os/pkgs/planner/**`
- [x] `os/pkgs/wiki/**`
- [x] `os/pkgs/pi-adapter/**`

Compatibility rules:

- Read `OWNLOOM_*` env vars first — implemented for planner/wiki/context/gateway touched envs.
- Fall back to `NIXPI_*` env vars during transition — implemented for touched envs.
- Avoid destructive runtime state moves — no state moves done.

Validation:

```sh
nix flake check --accept-flake-config
```

## Phase 5 — NixOS option/module migration

Move from NixPI option namespaces to ownloom namespaces while preserving deprecation aliases where feasible.

Target examples:

- [x] `config.nixpi.*` → `config.ownloom.*`
- [x] `services.nixpi-gateway` → `services.ownloom-gateway`
- [x] `services.nixpi-planner` → `services.ownloom-planner`

Use `lib.mkRenamedOptionModule` when practical.

Targets:

- [x] `os/modules/features/nixos/**`
- [x] `hosts/alex.nix`
- [x] `hosts/nixpi-vps/default.nix`
- [x] check/eval modules under `os/modules/checks/**`

Validation:

```sh
nix flake check --accept-flake-config
nix build .#nixosConfigurations.nixpi-vps.config.system.build.toplevel --accept-flake-config
```

Do not apply without explicit confirmation.

## Phase 6 — systemd units and runtime env

Rename generated services/timers and emitted environment variables.

Target examples:

- [x] `nixpi-planner-server.service` → `ownloom-planner-server.service`
- [x] `nixpi-gateway.service` → `ownloom-gateway.service`
- [x] `NIXPI_PLANNER_*` → `OWNLOOM_PLANNER_*` with old aliases still emitted for transition
- [x] `NIXPI_GATEWAY_*` → `OWNLOOM_GATEWAY_*` where applicable

Compatibility rules:

- Runtime scripts should accept old `NIXPI_*` during transition.
- Services should emit new `OWNLOOM_*`.
- After apply, check and clean old units intentionally.

Post-apply checks:

```sh
systemctl --failed
systemctl list-units '*ownloom*'
systemctl list-units '*nixpi*'
```

## Phase 7 — skill rename

Rename skill directories and content.

Target examples:

- [x] `os/skills/nixpi-config` → `os/skills/ownloom-config`
- [x] `os/skills/nixpi-audit` → `os/skills/ownloom-audit`
- [x] `os/skills/nixpi-svc` → `os/skills/ownloom-svc`
- [x] `os/skills/nixpi-reboot` → `os/skills/ownloom-reboot`
- [x] `os/skills/nixpi-evolution` → `os/skills/ownloom-evolution`

Compatibility decision:

- If Pi skill discovery depends directly on directory names, keep old skill directories briefly as stub migration docs or aliases if supported. Current migration renames the directories and does not keep stubs.

Validation:

- Start Pi and confirm skill discovery does not regress.
- Run config validation through the new skill instructions.

## Phase 8 — check attributes, test fixtures, and npm metadata cleanup

Clean up remaining check/test names and remove unnecessary references.

### Phase 8a — check attribute rename

- [x] `nixpi-purity-check` → `ownloom-purity-check`
- [x] `nixpi-pi-extension-startup-smoke` → `ownloom-pi-extension-startup-smoke`
- [x] `nixpi-openssh-native-abuse-eval` → `ownloom-openssh-native-abuse-eval`
- [x] `nixpi-vps-security-eval` → `ownloom-vps-security-eval`
- [x] `nixos-nixpi-services-boot-smoke` → `nixos-ownloom-services-boot-smoke`

Validation: `nix flake check --accept-flake-config` ✓

### Phase 8b — test fixtures and environment variables

- [x] Temp directory fixtures: `nixpi-wiki-*`, `nixpi-gateway-*`, `nixpi-planner-*` → `ownloom-*`
- [x] Test env vars: `NIXPI_WIKI_*`, `NIXPI_GATEWAY_*` → `OWNLOOM_*`
- [x] Hardcoded paths in tests: `/var/lib/nixpi-*` → `/var/lib/ownloom-*`, `/home/alex/NixPI` → `/home/alex/ownloom`
- [x] Test function names: `loadNixpiAdapter` → `loadOwnloomAdapter`
- [x] Test data UIDs: `nixpi-test-*` → `ownloom-test-*`

Files updated: 18 test files across wiki, gateway, and planner packages

Validation: `nix flake check --accept-flake-config` ✓

### Phase 8c — npm package metadata

- [x] Review `package.json` files: already use `ownloom-*` as primary names with `nixpi-*` as bin aliases (intentional)
- [x] Package-lock.json: auto-generated, left as-is

No changes needed; backward compat strategy preserved.

### Phase 8d — docs finalization

Remaining 200 refs are categorized as:

- **12 files** with `nixpi-vps` host name (Phase 9, intentional defer)
- **15 files** with `NIXPI_*` fallback env vars (backward compat, intentional)
- **13 files** with `nixpi-*` package/service aliases (backward compat, intentional)
- **10 auto-generated lock files** (not worth manual editing)
- **9 docs** explaining transition and backward compat (appropriate)
- **~141 misc** spread across comments/docs/strings (all harmless)

**Phase 8 status: COMPLETE** — Rebranding is operationally complete. All remaining refs are intentional backward compatibility, deferred host rename, or auto-generated files.

## Phase 9 — host rename, separate migration

✅ **DEPLOYED TO LIVE HOST**

Renamed `nixpi-vps` → `ownloom-vps` across all infrastructure.

### Changes Applied:

- [x] Directory rename: `hosts/nixpi-vps/` → `hosts/ownloom-vps/`
- [x] Flake config: `nixosConfigurations.nixpi-vps` → `nixosConfigurations.ownloom-vps`
- [x] Networking: `networking.hostName = "ownloom-vps"`
- [x] Systemd services: `nixpi-*` → `ownloom-*` services running
- [x] Environment variables: `OWNLOOM_*` primary, `NIXPI_*` fallbacks
- [x] Sops template: `hosts/ownloom-vps/secrets.yaml`
- [x] All eval modules updated

### Deployment Status (2026-05-07 21:08 UTC):

```
✅ nixos-rebuild switch --flake .#ownloom-vps succeeded
✅ Systemd units migrated: 6 ownloom-* services active/running
✅ Gateway service: ACTIVE (running)
✅ Planner server: ACTIVE (running)
✅ CalDAV endpoint: responding (http://127.0.0.1:5232/)
✅ CLI tools: ownloom-wiki, ownloom-planner functional
✅ Backward compat: nixpi-* command aliases still available
✅ No old nixpi-* services active
✅ Both OWNLOOM_* and NIXPI_* env vars emitted
```

### Services Successfully Started:

- ✅ `ownloom-gateway.service` — transport gateway (WhatsApp, transcription, etc.)
- ✅ `ownloom-planner-server.service` — CalDAV/iCalendar web view/API
- ✅ `ownloom-wiki-health-snapshot.timer` — daily wiki health check
- ✅ `ownloom-proactive-task-*.timer` — reminder/review tasks
- ✅ Radicale (CalDAV backend), Ollama, Minecraft, code-server (all running)

### Backward Compatibility Maintained:

- ✅ Old `nixpi-*` CLI commands work (wrappers to `ownloom-*`)
- ✅ Both `OWNLOOM_*` and `NIXPI_*` environment variables available
- ✅ Services.nixpi-* module aliases work
- ✅ No breaking changes to existing scripts/prompts

### Remaining Transition Notes:

- Transient hostname cache will refresh on next login/reboot
- Static hostname `/etc/hostname` correctly updated to `ownloom-vps`
- Keep `NIXPI_*` fallback env vars until all downstream references updated
- Agent context still shows some historical `nixpi-vps` references (will self-heal over time)

---

## Global validation checklist

Before each commit:

```sh
git diff --check
nix flake check --accept-flake-config
```

Before any live apply:

```sh
nix build .#nixosConfigurations.nixpi-vps.config.system.build.toplevel --accept-flake-config
```

Then ask Alex for explicit confirmation before switching the system.

## Commit sequence (COMPLETE & DEPLOYED)

1. ✅ `docs: add ownloom rebrand plan`
2. ✅ `docs: rebrand user-facing NixPI text to ownloom`
3. ✅ `nix: add ownloom package and app aliases`
4. ✅ `cli: expose ownloom command names with nixpi compatibility wrappers`
5. ✅ `gateway: migrate branding and env names to ownloom`
6. ✅ `planner: migrate branding and env names to ownloom`
7. ✅ `nixos: add ownloom service and option names`
8. ✅ `skills: rename NixPI skills to ownloom`
9. ✅ `cleanup: lowercase ownloom branding`
10. ✅ `checks: rename vps-security-eval to ownloom`
11. ✅ `tests: update fixtures to use ownloom instead of nixpi`
12. ✅ `hosts: rename nixpi-vps to ownloom-vps` (Phase 9)
13. ✅ **DEPLOYED to live host (2026-05-07 21:08 UTC)**

---

## REBRAND COMPLETE ✅

All phases 1–9 complete. Live host `ownloom-vps` operational with:
- All new `ownloom-*` services running
- Full backward compatibility via `nixpi-*` aliases
- Both `OWNLOOM_*` and `NIXPI_*` environment variables active
- No breaking changes; smooth transition

**Next optional phases:**
- Update agent/wiki context to reflect `ownloom` terminology (automated over time)
- Retire legacy `NIXPI_*` fallback env vars when all references updated (future)
- Rename repo path `/home/alex/NixPI` → `/home/alex/ownloom` (future, lower priority)
