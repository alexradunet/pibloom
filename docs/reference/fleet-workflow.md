# Fleet Change Workflow

> Local proposal workflow for system changes

## 🌱 Audience

Maintainers using nixPI to prepare local repo changes for later human review and external publish.

## 🌱 Why This Flow Exists

nixPI should be able to propose code and configuration changes locally without being able to publish them autonomously.

This keeps the useful part of agentic development:

- Inspect the repo
- Edit files locally
- Run validation
- Prepare a reviewable diff

While forcing the approval boundary to stay with the human and the external controller:

- Human reviews the diff in VS Code or another editor
- Human decides whether to commit and open a PR
- CI or a separate controller handles publish, merge, and rollout

## 🚀 Local Proposal Flow

nixPI assumes the local working clone lives at:

- `~/.nixpi/pi-nixpi`

Recommended workflow:

1. Ask nixPI to inspect the repo and prepare a local change
2. Let nixPI edit files and run local validation such as:
   - `npm run build`
   - `npm run test:unit`
   - `npm run test:integration`
   - `npm run test:e2e`
3. Review the resulting diff in VS Code
4. Decide whether to keep, revise, commit, or discard the change
5. Use your normal git/GitHub workflow outside nixPI to publish the change

## 📚 Reference

### nixPI's Role

- Propose local edits
- Explain what changed and why
- Run local checks
- Prepare code for human review

### nixPI Does Not Publish

- No remote push
- No PR creation
- No merge
- No rollout trigger

### Current Repo Assumptions

- Local path is `~/.nixpi/pi-nixpi`
- The clone is a working area for proposals and review
- Remote publishing is handled by the human or an external controller

## 🔗 Related

- [Codebase: Pi Extensions - OS](../codebase/pi-extensions)
