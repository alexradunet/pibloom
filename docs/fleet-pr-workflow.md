# Fleet Change Workflow

> 📖 [Emoji Legend](LEGEND.md)

Audience: maintainers using Garden to prepare local repo changes for later human review and external publish.

## 🌱 Why This Flow Exists

Garden should be able to propose code and configuration changes locally without being able to publish them autonomously.

This keeps the useful part of agentic development:

- inspect the repo
- edit files locally
- run validation
- prepare a reviewable diff

while forcing the approval boundary to stay with the human and the external controller:

- human reviews the diff in VS Code or another editor
- human decides whether to commit and open a PR
- CI or a separate controller handles publish, merge, and rollout

## 🚀 Local Proposal Flow

Garden assumes the local working clone lives at:

- `~/.garden/pi-garden`

Recommended workflow:

1. Ask Garden to inspect the repo and prepare a local change.
2. Let Garden edit files and run local validation such as:
   - `npm run build`
   - `npm run test:unit`
   - `npm run test:integration`
   - `npm run test:e2e`
3. Review the resulting diff in VS Code.
4. Decide whether to keep, revise, commit, or discard the change.
5. Use your normal git/GitHub workflow outside Garden to publish the change.

## 📚 Reference

Garden's role in this model:

- propose local edits
- explain what changed and why
- run local checks
- prepare code for human review

Garden does not publish in this model:

- no remote push
- no PR creation
- no merge
- no rollout trigger

Current repo assumptions:

- local path is `~/.garden/pi-garden`
- the clone is a working area for proposals and review
- remote publishing is handled by the human or an external controller

## 🔗 Related

- [../README.md](../README.md)
- [../AGENTS.md](../AGENTS.md)
