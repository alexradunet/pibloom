# Documentation Maintenance

> Keeping documentation in sync with code

## 🌱 Contributor Contract

**Rule**: Every new tracked file must be documented in the relevant subsystem inventory page.

## 📝 Why / What / How Template

For each major page or section, use this structure:

### Why

- What problem this thing solves
- Why it exists in this repo instead of elsewhere

### What

- Responsibilities
- Public interface or behavior
- Owned state, commands, types, side effects

### How

- Entrypoints
- Major collaborators
- Control flow
- Important implementation constraints

## 📋 File Responsibility Entry Format

Use this shape consistently in tables or sections:

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `path/to/file.ts` | Solves X | Owns Y | Entry point, key exports |

## 📄 Subsystem Page Format

Each subsystem page should include:

- Short overview
- Boundaries
- File inventory
- Key runtime flows
- Related tests
- Related docs

## 🔄 Maintenance Rules

1. **One owner per file**: One subsystem page owns each tracked file's responsibility entry
2. **Expanded sections for important files**: High-value files may have expanded subsections, but ownership stays with one subsystem page
3. **Behavior over line-by-line**: Docs should prefer behavior-level explanation over repeating code line-by-line
4. **Terse lockfile docs**: Lockfiles, config files, and templates should be documented tersely, not ignored

## 🏗️ Adding New Documentation

### New Subsystem

1. Create page in appropriate section
2. Add to VitePress config sidebar
3. Follow Why/What/How structure
4. Add to related pages

### New File in Existing Subsystem

1. Add to subsystem's file inventory table
2. If important, add expanded subsection
3. Update related tests section if applicable

### Updating Existing Docs

1. Keep Why/What/How structure intact
2. Update file paths if moved
3. Verify cross-links still work

## ✅ Pre-Commit Checklist

Before committing documentation changes:

- [ ] File inventory is alphabetically sorted
- [ ] Links to other pages use relative paths
- [ ] Code blocks have language tags
- [ ] Tables have aligned columns
- [ ] Emoji notation follows legend

## 🔗 Related

- [Codebase Guide](../codebase/)
- [Reference: Emoji Legend](../reference/emoji-legend)
