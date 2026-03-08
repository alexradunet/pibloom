# Architecture Alignment Design

Date: 2026-03-08

## Problem

The codebase went through three major refactors (EU sovereignty, service stack, slimdown + display) in rapid succession. The meta-layer — bloom-architect agent, docs, conventions — hasn't kept pace. The ports-and-adapters dogma doesn't match reality. The project is 70% AI-driven and needs conventions optimized for that.

## Goals

1. Align architecture docs and tooling with how the codebase actually works
2. Optimize structure for 70% AI / 30% human development
3. Keep extensibility simple and modular through clear conventions
4. Fully leverage bootc and Pi extensions as primary building blocks

## Decisions

### 1. Extension Directory Structure (Always)

Every extension becomes a directory, no exceptions — even thin ones:

```
extensions/bloom-{name}/
  index.ts       # tool/hook registration only — no business logic
  actions.ts     # handler functions that orchestrate lib/ calls
  types.ts       # extension-specific types (optional file, mandatory directory)
  tests/         # colocated tests
```

**Rationale:** AI always knows the structure. One pattern, zero judgment calls. Reviewers check one rule: "is there logic in index.ts?"

### 2. lib/ Organized by Capability

```
lib/
  shared.ts        # generic utilities (createLogger, nowIso, truncate, errorResult)
  frontmatter.ts   # parseFrontmatter, stringifyFrontmatter
  filesystem.ts    # safePath, file operations, Bloom dir resolution
  containers.ts    # podman/Quadlet parsing, container status, health checks
  exec.ts          # command execution helpers
  networking.ts    # socket utilities, channel protocol helpers
  persona.ts       # guardrail compilation, persona loading
  services.ts      # catalog parsing, service metadata, manifest logic
```

**Rules:**
- Every lib/ file must be pure — no side effects, no global state, no I/O at module level
- Named by what they do, not who uses them
- shared.ts is last resort, not first choice

**Rationale:** Multiple extensions share underlying systems (containers, filesystem). Capability-based organization avoids "write, discover sharing, move" churn.

### 3. Service Scaffold Template (No Shared Runtime)

No shared service library. `service_scaffold` generates complete, independent services from a template at `services/_template/`.

```
services/{name}/
  Containerfile
  package.json
  src/
    index.ts          # entry: health server, channel client, main loop
    transport.ts      # service-specific send/receive (stubbed)
    utils.ts          # service-specific helpers (stubbed)
  tests/
    transport.test.ts
    utils.test.ts
  quadlet/
    bloom-{name}.container
```

**Rules:**
- Template is single source of truth for "how to build a Bloom service"
- After generation, each service evolves independently
- Pattern improvements update the template; backporting is deliberate and separate

**Rationale:** Services are containers — independence is the point. No coupling, no versioning headaches. AI scaffolds and focuses on service-specific logic.

### 4. ARCHITECTURE.md as Canonical Rulebook

New `ARCHITECTURE.md` at repo root. Contains:
- Philosophy: containers-first, Pi-native, lightest tier wins, convention over cleverness
- Structure rules for extensions, lib/, services
- Enforcement checklist for humans, AI, and bloom-architect

CLAUDE.md stays focused on build/test/workflow and points to ARCHITECTURE.md.

### 5. Bloom-Architect Agent Redesign

**Persona:** Pragmatic enforcer + teaching mentor (replaces "elite systems architect" with hexagonal dogma).

**Behavior:**
- Knows ARCHITECTURE.md cold, applies it consistently
- Explains *why* rules exist when flagging violations
- Decision framework: containers-first → Pi-native → lightest tier → convention-driven → testable

**Memory expands to track:**
- Convention violations seen (recurring patterns, systemic issues)
- Decisions and rationale (settled choices, never re-litigated)

## Implementation Plan

1. Write `ARCHITECTURE.md`
2. Update bloom-architect agent (`bloom-architect.md` + memory)
3. Update `CLAUDE.md` to reference ARCHITECTURE.md
4. (Future, separate work) Migrate extensions to directory structure
5. (Future, separate work) Reorganize lib/ by capability
6. (Future, separate work) Create service scaffold template

Steps 4-6 are code changes tracked as separate tasks. This design doc covers only the documentation and agent updates (steps 1-3).
