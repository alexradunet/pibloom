# Bloom Codebase Review

Date: 2026-03-19
Scope: Architecture, overengineering risk, standards, testing foundation, and stability-first cleanup
Bias: Moderate cleanup, balanced between personal-device stability and template/fork maintainability

## Executive Summary

Bloom is not under-tested, and the core runtime is in materially better shape than the README's "AI slop" warning implies. The daemon, core library helpers, persona guardrails, and main extension registration paths have a credible automated safety net. The repository's main problem is not random fragility. The problem is breadth.

The base platform currently exposes too much optional capability for a system that says it wants to stay minimal and inspectable:

- 53 extension tools across the active Pi extensions
- 477 passing TypeScript tests
- strong daemon and `core/lib` coverage
- much weaker coverage and much higher product ambiguity in `bloom-dev`, `bloom-repo`, `bloom-services`, and parts of `os`

The codebase is therefore in a mixed state:

- the core is defensible
- the outer product surface is too broad for the current maturity level
- the biggest simplification wins come from reducing feature surface, not rewriting the daemon

## Baseline Collected

Current automated baseline:

- `npm run test:unit`: passed
- `npm run test:integration`: passed
- `npm run test:e2e`: passed
- `npm run test:coverage`: passed

Coverage snapshot:

- all files: 63.12% statements, 49.9% branches, 72.83% functions, 65.59% lines
- `core/daemon/**`: 83.91% statements, 79.94% branches, 76.72% functions, 85.68% lines
- `core/lib/**`: 81.91% statements, 68.55% branches, 90.55% functions, 85.46% lines
- `core/pi/extensions/os/**`: 10.25% statements, 5% branches, 11.11% functions, 10.71% lines
- `core/pi/extensions/bloom-repo/**`: 1.74% statements, 0% branches, 3.22% functions, 2.03% lines
- `core/pi/extensions/bloom-services/**`: 44.71% statements, 30.97% branches, 52.63% functions, 47.49% lines
- `core/pi/extensions/bloom-dev/**`: 39.6% statements, 24.13% branches, 60.52% functions, 40.25% lines

System-test posture:

- the TypeScript fast suites are healthy and useful
- the only `tests/e2e` check is extension registration, not a user-visible workflow
- the NixOS VM tests are meaningful, but they are not a guaranteed everyday gate because KVM-dependent jobs can be skipped in CI

## Prioritized Findings

### 1. The shipped runtime surface is broader than the current stability goal

Severity: High

The project claims a minimal, inspectable OS, but the runtime extension surface still includes a large amount of self-hosting and developer workflow logic:

- `bloom-dev` exposes 14 tools for local builds, switching, rollback, PR submission, and artifact pushing
- `bloom-repo` adds repo bootstrap, sync, and PR submission flows
- `bloom-services` adds 10 tools spanning scaffolding, install, test, manifest management, and bridge lifecycle

This is too much mutable surface for the current stage. The stable OS path should not depend on repo mutation, PR creation, service scaffolding, or bridge lifecycle management being first-class runtime capabilities.

Why this matters:

- it increases user-visible command surface and maintenance cost
- it blurs the line between operating the OS and developing Bloom
- some of the broadest tools are also among the least protected by realistic tests

Recommendation:

- remove `bloom-dev` from the default runtime path and keep it as explicitly opt-in developer functionality
- freeze or remove `bloom-repo` from the base OS image; keep it as maintainer tooling only
- reduce `bloom-services` in the base runtime to the operator essentials only

### 2. Service management currently has too many overlapping control planes

Severity: High

There are multiple ways to affect service state:

- `bloom-services`: install, test, scaffold, manifest show/sync/set/apply, bridge create/remove/status
- `os`: container status/logs/deploy and systemd start/stop/restart/status
- shell and Nix workflows outside the extension surface

This overlap is manageable for maintainers, but it is not minimal and it is not especially inspectable for operators. It also mixes stable operations with clearly optional or experimental workflows such as service scaffolding and Matrix bridge lifecycle.

Recommendation:

- keep one declarative service path as the primary operator interface
- keep read-only inspection helpers
- move scaffolding, smoke-test helpers, and bridge lifecycle out of the base runtime
- avoid having both manifest-driven control and imperative deployment pathways as peer first-class surfaces

### 3. The testing foundation is strong on core logic, but weak on real stability gates for optional surface

Severity: High

The repository has good TypeScript regression coverage, especially around daemon routing, session state, guardrails, manifest parsing, and registration behavior. That is a real strength.

The weakness is elsewhere:

- `tests/e2e` does not currently validate an operator journey; it validates extension registration
- some low-coverage areas are exactly the areas that mutate repo state, system state, or remote integrations
- the NixOS test suite is valuable but not a guaranteed default gate in CI because VM runs depend on KVM availability

Recommendation:

- treat the current daemon/lib/unit coverage as a strong base
- stop broadening low-value runtime features until there is at least one required system-level smoke path for setup, daemon, and manifest-driven service state
- define a smaller but stricter stability gate instead of relying on breadth alone

### 4. Developer workflow logic is mixed into runtime-critical extension packaging

Severity: Medium

The repo has a clear architectural statement that Skills, Extensions, and Services should each solve different problems. In practice, several runtime extensions still bundle responsibilities that are not part of the stable appliance:

- `bloom-dev` mixes environment gating, build/test loops, OS switching, package installation, PR creation, and artifact copying
- `bloom-services` mixes user operations with package authoring concerns
- `garden` mixes Bloom-home management with blueprint seeding, interactive command routing, and agent/persona authoring workflows

This is not a code-style issue. It is a packaging issue. The code often reads clearly enough, but the deployed extension surface is doing too many classes of work.

Recommendation:

- split "runtime/operator" concerns from "maintainer/developer" concerns more aggressively
- keep the stable image focused on host operation, persona safety, memory, and the daemon
- make authoring and self-evolution workflows explicit opt-ins

### 5. The core daemon is not the part that should be simplified first

Severity: Medium

The daemon is one of the more complex subsystems, but it is also one of the best-tested and most internally coherent parts of the repository. The code in `core/daemon` has clear invariants, dedicated tests, and a consistent runtime model.

Recommendation:

- do not spend the next cleanup pass rewriting daemon structure
- only trim daemon-adjacent features if they are clearly non-essential product surface
- prioritize platform-surface reduction over core-runtime redesign

### 6. Several low-value features should be frozen before they accumulate more coupling

Severity: Medium

Features that look useful but are not essential to current OS stability:

- runtime PR submission and repo workflow tooling
- service scaffolding from the running system
- bridge create/remove management from the running system
- developer artifact push flows
- interactive blueprint/update convenience flows beyond the minimal Bloom directory bootstrap

Recommendation:

- freeze these features now
- do not add new capabilities in these areas until the stability core is smaller and the system-level test gate is stricter

## Subsystem Scorecard

| Subsystem | Value to stable OS | Complexity | Test protection | Recommendation |
|---|---|---:|---:|---|
| `core/daemon` | High | High | Strong | Keep as-is, only narrow optional surface |
| `core/lib` | High | Medium | Strong | Keep, continue small refactors only |
| `persona` | High | Medium | Good | Keep |
| `setup` | High | Medium | Moderate | Keep, strengthen system-level tests |
| `os` | High | Medium | Weak in coverage | Keep, narrow tool semantics and raise tests |
| `objects` | Medium-High | Medium | Good | Keep |
| `episodes` | Medium | Medium | Good | Keep for now, no expansion |
| `garden` | Medium | Medium-High | Moderate | Simplify, keep only bootstrap essentials |
| `bloom-services` | Medium | High | Weak-Moderate | Reduce to operator essentials |
| `bloom-dev` | Low for stable OS | High | Weak | Remove from base runtime or hard-gate out |
| `bloom-repo` | Low for stable OS | Medium | Very weak | Remove from base runtime |
| NixOS VM tests | High | Medium | Not always enforced | Promote a small required smoke subset |

## Recommended Reduction Roadmap

### Immediate reductions

- Remove `bloom-dev` from the default runtime extension set.
- Remove `bloom-repo` from the default runtime extension set.
- Stop exposing service scaffolding as a runtime capability.
- Stop exposing bridge create/remove as a base-OS capability unless bridges are a declared near-term product priority.
- Keep `bloom-services` only for manifest-driven service management and read-only service status.

### Next-pass simplifications

- Split `garden` into a minimal bootstrap/status surface and a separate authoring/evolution surface.
- Collapse overlapping service-control paths so operators have one primary model.
- Review whether `episodes` remains worth carrying as a separate concept versus a simpler object-first memory model.
- Tighten `os` so the tool surface maps directly to the minimum host operations you actually intend to support long term.

### Keep and avoid churn

- Keep the unified daemon runtime path.
- Keep the current guardrail and persona flow.
- Keep `core/lib` as the shared home for reusable host-aware helpers.
- Keep the current TypeScript test organization; it is already readable and useful.

## Stability Gate To Adopt

Recommended required gate for cleanup work:

- `npm run build`
- `npm run check`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e`

Recommended stronger required gate before removing runtime features:

- one NixOS smoke test for first boot
- one NixOS smoke test for daemon startup
- one NixOS or integration-level smoke test for manifest-driven service apply

Recommended test strategy by layer:

- unit tests for pure helpers, routing, parsing, and state machines
- integration tests for extension behavior and filesystem/process boundaries
- e2e tests for actual operator workflows, not registration shape
- NixOS tests for image and service orchestration only where VM realism matters

## Concrete Cleanup Priorities

### Priority 1

- shrink the default extension set
- define what the stable appliance actually ships
- stop treating maintainer workflows as appliance features

### Priority 2

- reduce service-management overlap
- keep a single primary declarative operator path
- move authoring and experimental lifecycle tools out of the appliance core

### Priority 3

- upgrade the end-to-end stability gate
- make one real user journey mandatory in CI
- treat KVM-only suites as reinforcing coverage, not the only system proof

## Bottom Line

Bloom is not overengineered in its core runtime nearly as much as it is over-scoped in its shipped capability surface.

The right move now is not a major rewrite. The right move is to cut product surface:

- fewer default extensions
- fewer runtime mutation tools
- one service-control story
- stronger required system smoke tests

If that reduction happens first, the existing daemon, library, and guardrail foundation is strong enough to support a much more stable Bloom without dramatic architectural churn.
