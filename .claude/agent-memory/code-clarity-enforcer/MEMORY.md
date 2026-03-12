# Code Clarity Enforcer Memory

## Recurring Violations

- **Empty/stub types.ts files**: 4 extensions have stub types.ts with only `export {};`: bloom-setup, bloom-repo, bloom-objects, bloom-services.
- **Oversized files**: service-io.ts (272), netbird.ts (269), bloom-dev/index.ts (241), bloom-os/actions.ts (235).
- **High export count**: lib/netbird.ts has 19 exports, 10 of which are unused outside the file.
- **Missing JSDoc**: 13 exported symbols across 5 lib/ files lack JSDoc.

## Stale References (verified 2026-03-12)

### New since last audit:
- AGENTS.md:292 — references lib/nginx.ts which does not exist
- bloom.network deleted but referenced in 15+ files (CLAUDE.md, ARCHITECTURE.md, containers.md, services/README.md, skills/*, bloom-services/index.ts)
- services/README.md:47-53 — references services/examples/ directory which does not exist
- docs/service-architecture.md:91-93 — references nginx vhost functionality that no longer exists

### Carried from previous audit:
- docs/quick_deploy.md:119-120 — Sway/Wayland references (removed from OS)

### Fixed since last audit:
- README.md Unix socket/bloom-channels references: cleaned up
- .claude/agents/bloom-live-tester.md stale refs: cleaned up
- .pi/AGENTS.md element reference: cleaned up
- CLAUDE.md lib/containers.ts reference: cleaned up

## Dead Code (verified 2026-03-12)

- lib/netbird.ts: 10 exports never imported externally (netbirdEnvPath, listGroups, findAllGroupId, listZones, createZone, listRecords, createRecord, zoneCachePath, NetBirdGroup, NetBirdZone, NetBirdRecord, DnsResult)
- lib/service-routing.ts: RoutingResult type never imported externally

## Security Concern

- RESOLVED: os/bib-config.toml removed from tracking. Example file renamed to os/bib-config.example.toml with placeholder password. os/bib-config.toml is gitignored.

## CI/Workflow Notes

- build-os.yml uses docker/login-action@v3 (no podman equivalent for GitHub Actions)
- Template files (services/_template/) use console.log instead of createLogger (known exception)

## Resolved Issues (from previous audits)

- lib/services.ts barrel: split into services-catalog, services-install, services-manifest, services-validation
- bloom-services/actions.ts (760 lines): split into actions-apply, actions-bridges, etc.
- bloom-display extension: removed entirely
- bloom-channels extension: removed entirely (replaced by pi-daemon)
- build-iso.sh shebang: fixed
- README.md: bloom-channels/unix socket refs cleaned up

## Last Audit

- Date: 2026-03-12
- Files reviewed: ~118
- Auto-fixes applied: 0 (report-only)
- Critical: 1 (security — committed password)
- Stale documentation: 5 remaining items
- Dead code: 12 unused exports in lib/netbird.ts
- Convention violations: 13 missing JSDoc, 51 code blocks without language specifiers
- Oversized files: 4
- Stub files for deletion: 4
- Clean files: ~65
