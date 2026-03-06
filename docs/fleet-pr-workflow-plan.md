# Fleet PR Workflow Plan (Source-of-Truth GitOps)

> 📖 [Emoji Legend](LEGEND.md)

This plan defines how Bloom devices contribute fixes while keeping one canonical repository as the only source of truth.

## 🌱 Goals

1. Keep `upstream/main` as the canonical state (no direct device pushes to main).
2. Let every Bloom host submit fixes through PRs with minimal friction.
3. Make setup reproducible on a fresh machine.
4. Provide clear recovery paths when auth/remotes/PR creation fail.

## 🌱 Desired End State

- Every device has a local clone at `~/.bloom/pi-bloom`.
- Remotes are standardized:
  - `upstream` → canonical repo (read target for sync + PR base)
  - `origin` → device/user fork (write target for branch pushes)
- PR checks run on every pull request.
- Branch protection requires PR + passing checks.
- Bloom can submit fixes through one tool call (`bloom_repo_submit_pr`).

## 🚀 Phase Plan

### 🛡️ Phase 0 — Governance (GitHub settings)

- [ ] Protect `main` (no direct push, no force push, no branch deletion).
- [ ] Require pull request before merge.
- [ ] Require status checks to pass.
- [ ] Require at least one review.
- [ ] Add CODEOWNERS (optional but recommended).

Owner: repo admin

### 💻 Phase 1 — Device bootstrap tooling

- [x] Add `bloom_repo_configure` tool:
  - clone repo if missing
  - configure `upstream`
  - configure `origin` (fork URL or gh-assisted)
  - set repo-local git identity
- [x] Add `bloom_repo_status` PR readiness view.
- [x] Add `bloom_repo_sync` fast-forward sync helper.

Owner: Bloom extension code

### 🚀 Phase 2 — PR submission automation

- [x] Add `bloom_repo_submit_pr` tool:
  - branch creation
  - staging + commit
  - push to origin
  - open PR against upstream
- [x] Add clear errors for missing auth/remotes/changes.

Owner: Bloom extension code

### 🚀 Phase 3 — CI + templates

- [x] Add PR validation workflow (`build` + `check`).
- [x] Add PR template oriented around device-submitted fixes.

Owner: repository

### 📜 Phase 4 — Skill/documentation alignment

- [x] Update `skills/first-boot` with tool-first repo setup flow.
- [x] Update `skills/self-evolution` with tool-first PR submission flow.
- [x] Add operational docs (`docs/fleet-pr-workflow.md`).

Owner: docs + skills

## 🚀 Acceptance Criteria

A fresh Bloom device can:

1. Authenticate GitHub (`gh auth login`).
2. Run `bloom_repo_configure` once.
3. Run `bloom_repo_status` and see PR-ready state.
4. Make a small change and run `bloom_repo_submit_pr`.
5. Produce a PR URL targeting upstream `main`.

## 🛡️ Risks + Mitigations

- **Missing GitHub auth** → explicit status/error from tools.
- **No writable fork** → `fork_url` parameter or gh-assisted fork creation.
- **Repo mismatch (wrong upstream URL)** → explicit `repo_url` override at setup.
- **Merge conflicts/drift** → `bloom_repo_sync` before branching.
- **Unchecked PR merges** → enforce branch protection + required checks.

## 🚀 Rollout Notes

- Start with one test device and one maintainer account.
- Validate full loop (setup → fix → PR → merge → update on second device).
- After validation, treat this as standard first-boot policy.

## 🔗 Related

- [Emoji Legend](LEGEND.md) — Notation reference
- [Fleet PR Workflow](fleet-pr-workflow.md) — Full contribution workflow
- [Fleet Bootstrap Checklist](fleet-bootstrap-checklist.md) — Per-device setup steps
