# Webchat Local-Only Hard Cleanup Design

**Date:** 2026-03-26
**Status:** Approved
**Scope:** Remove Matrix as an active runtime, setup, test, and documentation surface; simplify the codebase around the existing web-chat/local-only model without changing unrelated behavior.

---

## Overview

NixPI has already started moving away from the older Matrix and Element-based runtime toward a local web chat surface. The repository is now in a partially migrated state: major Matrix runtime pieces have been removed, but Matrix-specific concepts still remain in docs, tests, setup flows, flake wiring, and some extension code.

This cleanup finishes that migration with a hard removal strategy:

1. delete Matrix as a supported product capability
2. delete obsolete Matrix-specific docs, plans, and specs instead of archiving them
3. simplify adjacent abstractions only where they exist because of the removed Matrix surface

The target is a smaller, clearer repository whose active architecture matches the current product direction: web chat plus local host integration.

---

## Goals

- make web chat the only supported interaction surface
- remove Matrix-specific runtime, setup, configuration, and documentation paths
- reduce conceptual and maintenance overhead by deleting stale files and references
- preserve existing local functionality that does not depend on Matrix

## Non-Goals

- redesign the web chat architecture
- refactor unrelated modules just because they could be cleaner
- change the local proposal workflow, object store, episodes, persona system, or OS tools unless they contain direct Matrix-only residue

---

## Cleanup Strategy

The work is split into two layers.

### Layer 1: mandatory removal

This layer removes Matrix as a first-class concept from the active product:

- delete Matrix-specific docs, specs, and plans
- delete or rewrite active docs that still describe Matrix, Element, Continuwuity, homeservers, or Matrix ports
- remove Matrix-related tests, aliases, flake check names, and stale service references
- remove Matrix setup/configuration logic from shell scripts and extension code
- remove user-facing references that imply Matrix is still part of the supported flow

### Layer 2: bounded simplification

After Matrix removal, simplify only those code paths whose complexity exists because Matrix used to be one of several interaction surfaces.

Allowed examples:

- collapsing stale helper types or credential loaders used only for Matrix account handling
- removing dead agent provisioning branches that depended on Matrix identities
- simplifying setup steps or service-surface descriptions that were shaped around the removed messaging layer

Disallowed examples:

- broad refactors of the chat server for style alone
- renaming unrelated modules without a direct cleanup benefit
- introducing new product behavior during the cleanup pass

---

## Component Decisions

### Documentation

Active documentation will be rewritten to describe a web-chat/local-only system.

This includes:

- `README.md`
- active docs under `docs/` that still describe Matrix, Element, Continuwuity, or a Matrix-backed daemon

Historical Matrix-specific design docs will be deleted rather than archived. If a document is only useful for removed functionality, it should not remain in the active tree.

### Tests and flake wiring

Delete Matrix-specific test files, test registry entries, and smoke aliases. Remove stale flake references that still expose Matrix-labeled checks or test names.

The remaining test surface should describe the current product truth: web chat, local services, and local Pi behavior.

### Setup and scripts

Setup and support scripts should no longer mention or configure Matrix accounts, homeservers, or Element access. Any script phase whose purpose was Matrix-era setup should be removed or renamed to match the current web-chat/local-only flow.

### Extension and runtime code

Remove Matrix-only logic from extensions and shared code.

Primary candidate:

- `core/pi/extensions/nixpi/actions.ts`

This file still contains Matrix credential types, Matrix agent credential path helpers, provisioning stubs, registration-token loading, and agent creation behavior shaped around Matrix identities. For a local-only product, this should either be deleted outright or reduced to filesystem-only agent metadata behavior, depending on what the remaining extension interface still needs.

The cleanup should prefer deletion over replacement. If an agent-creation path has no valid local-only use today, remove it rather than preserving a dormant abstraction.

### Chat server and local runtime

The existing chat server and local runtime remain the supported path and should not be redesigned in this pass.

Keep:

- `core/chat-server/`
- non-Matrix extensions that support local workflows
- OS and broker/update flows unrelated to Matrix

---

## Target Runtime Model

After cleanup, the supported flow is:

1. NixPI installs and seeds the local workspace
2. local services start
3. the user interacts with Pi through the web chat surface
4. Pi operates through local extensions, local files, and local host tools

Removed from the runtime model:

- remote Matrix messaging
- Matrix credentials and homeserver configuration
- Element Web as a supported entry point
- Matrix-based agent identities and provisioning

---

## Error Handling

The cleanup should remove Matrix-specific error paths instead of translating them into new equivalents.

Examples:

- if setup text tells the user to configure Matrix, remove that step
- if an extension returns errors about missing Matrix credentials, remove the feature rather than leaving a dead branch
- if docs list Matrix or Element services that no longer exist, rewrite the docs to describe only live services

Where removal changes user-visible behavior, the replacement should be direct and simple: point the user to the local web chat path, not to another remote transport.

---

## Verification

Verification should prove two things:

1. Matrix residue is actually removed
2. the remaining local/web-chat functionality still works

Required checks:

- targeted unit and integration tests for the chat server and non-Matrix extensions
- at least one Nix or flake evaluation/build check covering current wiring
- a repository-wide residue search for terms such as `matrix`, `element`, `continuwuity`, `homeserver`, and similar names

Some historical references may remain in commit history, but not in the active repository contents after this cleanup.

---

## Risks and Constraints

### Main risk

The main risk is deleting code that still supports a hidden dependency in the local runtime.

### Mitigation

- remove in small, reviewable slices
- verify after each slice or cluster of related edits
- prefer deletion only when references and tests show the path is obsolete

### Constraint

This cleanup should not become a general architecture rewrite. If a module is ugly but not Matrix-shaped, it is out of scope for this pass.

---

## Expected Outcome

After this work:

- the repository is smaller
- the docs match the actual product
- active code no longer implies Matrix support
- setup and tests reflect a single supported interaction model
- future maintenance is easier because obsolete surfaces are gone instead of partially preserved
