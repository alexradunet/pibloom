# Core Library

> Shared runtime primitives and helpers

## 🌱 Why Core Library Exists

The core library provides shared utilities used across all nixPI components. Centralizing these prevents duplication and ensures consistent behavior for common operations like filesystem access, Matrix formatting, and command execution.

## 🚀 What It Owns

| Concern | Files | Purpose |
|---------|-------|---------|
| Filesystem | `filesystem.ts` | Path operations, safe file writes |
| Execution | `exec.ts` | Shell command execution with guardrails |
| Matrix | `matrix.ts`, `matrix-format.ts` | Matrix client helpers, message formatting |
| Frontmatter | `frontmatter.ts` | YAML frontmatter parsing/generation |
| Setup | `setup.ts` | First-boot setup state management |
| Extension Tools | `extension-tools.ts` | Pi extension utilities |
| Shared | `shared.ts` | Common types and constants |

## 📋 File Inventory

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `core/lib/filesystem.ts` | Safe file operations | Path helpers, atomic writes, directory creation | Used by extensions for nixPI directory operations |
| `core/lib/exec.ts` | Guarded execution | Bash tool wrapper with guardrails validation | All shell commands go through here |
| `core/lib/matrix.ts` | Matrix client utils | Registration, login, room alias helpers | Used by daemon and extensions |
| `core/lib/matrix-format.ts` | Message formatting | HTML/markdown conversion for Matrix | Handles Matrix message rendering |
| `core/lib/frontmatter.ts` | Frontmatter handling | Parse and generate YAML frontmatter | Used by memory system |
| `core/lib/setup.ts` | Setup state | First-boot wizard state management | Reads/writes `~/.nixpi/setup-state.json` |
| `core/lib/extension-tools.ts` | Extension utils | Common extension helper functions | Used by Pi extensions |
| `core/lib/shared.ts` | Common code | Types, constants, utilities | Shared across all lib modules |

---

## 🔍 Important File Details

### `core/lib/filesystem.ts`

**Responsibility**: Safe filesystem operations with nixPI directory conventions.

**Key Exports**:
- `ensureDir(path)` - Create directory if missing
- `writeFileAtomic(path, content)` - Atomic file write
- `readFileUtf8(path)` - Read with encoding
- `nixpiPath(...segments)` - Build paths in `~/nixPI/`

**Inbound Dependencies**:
- All extensions that read/write nixPI files
- Daemon for state persistence

**Outbound Dependencies**:
- Node.js `fs` module
- Node.js `path` module

---

### `core/lib/exec.ts`

**Responsibility**: Execute shell commands with guardrails validation.

**Key Exports**:
- `exec(options)` - Main execution function
- `validateCommand(command)` - Guardrails check
- `ExecutionError` - Error type for failures

**Guardrails Integration**:
- Loads `~/nixPI/guardrails.yaml` (falls back to defaults)
- Blocks patterns defined in guardrails config
- Returns validation errors before execution

**Inbound Dependencies**:
- All extensions that run shell commands
- OS extension for NixOS operations

**Outbound Dependencies**:
- Node.js `child_process`
- `guardrails.yaml` defaults

---

### `core/lib/matrix.ts`

**Responsibility**: Matrix client utilities and helpers.

**Key Exports**:
- `registerUser(homeserver, options)` - Register new Matrix user
- `loginUser(homeserver, credentials)` - Authenticate existing user
- `resolveRoomAlias(homeserver, alias)` - Get room ID from alias
- `ensureRoomJoined(client, roomId)` - Join room if not member

**Inbound Dependencies**:
- Daemon for Matrix authentication
- Setup extension for account creation
- Tests for Matrix integration

**Outbound Dependencies**:
- `matrix-js-sdk`

---

### `core/lib/matrix-format.ts`

**Responsibility**: Format messages for Matrix display.

**Key Exports**:
- `markdownToHtml(markdown)` - Convert markdown to Matrix HTML
- `formatCodeBlock(code, language)` - Format code for display
- `stripHtml(html)` - Remove HTML tags

**Inbound Dependencies**:
- Daemon for message formatting
- Extensions for tool output display

---

### `core/lib/frontmatter.ts`

**Responsibility**: Parse and generate YAML frontmatter.

**Key Exports**:
- `parseFrontmatter(content)` - Extract frontmatter from markdown
- `stringifyFrontmatter(data, content)` - Add frontmatter to content
- `FrontmatterData` - Type for frontmatter objects

**Used By**:
- Episode extension for episode files
- Object extension for durable objects
- AGENTS.md parsing for agent overlays

**Outbound Dependencies**:
- `js-yaml` for YAML parsing

---

### `core/lib/setup.ts`

**Responsibility**: First-boot setup state management.

**Key Exports**:
- `loadSetupState()` - Read setup state from disk
- `saveSetupState(state)` - Persist setup state
- `getSetupStatus()` - Get current setup status
- `SetupState` - Type definition

**State File**: `~/.nixpi/setup-state.json`

**Setup Steps**:
- `wizard` - Bash wizard completion
- `persona` - Pi-guided persona setup

**Inbound Dependencies**:
- Setup extension for state tracking
- Daemon for setup-aware behavior

---

### `core/lib/extension-tools.ts`

**Responsibility**: Common utilities for Pi extensions.

**Key Exports**:
- Tool definition helpers
- Context access utilities
- Response formatting helpers

**Inbound Dependencies**:
- All Pi extensions

---

### `core/lib/shared.ts`

**Responsibility**: Common types and constants used across the codebase.

**Key Exports**:
- `NIXPI_DIR` - Base directory constant (`~/nixPI`)
- `AGENT_STATE_DIR` - Agent state directory (`/var/lib/nixpi`)
- Common type definitions
- Utility functions

---

## 🔄 Related Tests

| Test File | Coverage |
|-----------|----------|
| `tests/lib/filesystem.test.ts` | Filesystem operations |
| `tests/lib/exec.test.ts` | Command execution with guardrails |
| `tests/lib/matrix.test.ts` | Matrix client utilities |
| `tests/lib/matrix-format.test.ts` | Message formatting |
| `tests/lib/setup.test.ts` | Setup state management |
| `tests/lib/shared.test.ts` | Shared utilities |

---

## 🔗 Related

- [Pi Extensions](./pi-extensions) - Primary consumers of lib utilities
- [Daemon](./daemon) - Uses Matrix and filesystem utilities
- [Tests](./tests) - Test coverage details
