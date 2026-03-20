# Pi Extensions

> Pi-facing tools, commands, and hooks

## 🌱 Why Pi Extensions Exist

Extensions provide Pi with tools to interact with the nixPI system. They bridge the gap between Pi's reasoning and actual system operations like NixOS management, memory operations, and setup tasks.

## 🚀 What They Own

| Extension | Purpose | Location |
|-----------|---------|----------|
| `nixpi` | NixOS operations, blueprints, proposals | `core/pi/extensions/nixpi/` |
| `os` | OS health, systemd, updates, proposals | `core/pi/extensions/os/` |
| `objects` | Durable memory object management | `core/pi/extensions/objects/` |
| `episodes` | Episodic memory capture | `core/pi/extensions/episodes/` |
| `setup` | First-boot setup state | `core/pi/extensions/setup/` |
| `persona` | Persona injection and guardrails | `core/pi/extensions/persona/` |
| `localai` | Local AI integration | `core/pi/extensions/localai/` |

## 📋 Extension Inventory

### NixPI Extension (`core/pi/extensions/nixpi/`)

**Purpose**: Core nixPI platform operations.

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `index.ts` | Extension entry | Tool registration, context setup | Exports extension manifest |
| `actions.ts` | Core actions | `nixpi_status`, `nixos_update`, etc. | Main tool implementations |
| `actions-blueprints.ts` | Blueprint actions | Seed/copy directory blueprints | Template management |
| `types.ts` | Type definitions | Shared types for extension | TypeScript interfaces |

**Key Tools**:
| Tool | Purpose |
|------|---------|
| `nixpi_status` | Get system status |
| `nixos_update` | Update NixOS configuration |
| `nixos_rollback` | Rollback to previous generation |
| `nixos_proposal` | Propose config changes (local only) |
| `nixpi_seed` | Seed nixPI directory |
| `nixpi_blueprint` | Copy blueprint to nixPI directory |

---

### OS Extension (`core/pi/extensions/os/`)

**Purpose**: Operating system management tools.

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `index.ts` | Extension entry | Tool registration | Exports extension manifest |
| `actions.ts` | Core actions | `systemd_control`, `observe_host`, etc. | Main tool implementations |
| `actions-health.ts` | Health actions | Host health observation | System status gathering |
| `actions-proposal.ts` | Proposal actions | Local change proposals | Git-based change prep |
| `types.ts` | Type definitions | Shared types | TypeScript interfaces |

**Key Tools**:
| Tool | Purpose |
|------|---------|
| `systemd_control` | Start/stop/restart/status services |
| `observe_host` | Get host state and metrics |
| `observe_system` | Get system information |
| `host_health` | Health check aggregation |
| `os_propose_change` | Propose local changes |

---

### Objects Extension (`core/pi/extensions/objects/`)

**Purpose**: Durable memory object management.

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `index.ts` | Extension entry | Tool registration | Exports extension manifest |
| `actions.ts` | Core actions | `object_create`, `object_update`, etc. | CRUD operations |
| `actions-query.ts` | Query actions | `object_find`, `object_list` | Search and list |
| `memory.ts` | Memory logic | Object persistence | File operations |
| `digest.ts` | Digest generation | Context compaction | Summarization |

**Key Tools**:
| Tool | Purpose |
|------|---------|
| `object_create` | Create durable object |
| `object_read` | Read object by slug |
| `object_update` | Update existing object |
| `object_find` | Search objects |
| `object_list` | List all objects |

**Object Schema** (required fields):
- `type` - Object type (fact, preference, project, etc.)
- `slug` - Unique identifier
- `title` - Human-readable title
- `summary` - Brief description
- `scope` - Global, host, project, room, agent
- `confidence` - low, medium, high
- `status` - active, stale, superseded, archived
- `created` - ISO timestamp
- `modified` - ISO timestamp

---

### Episodes Extension (`core/pi/extensions/episodes/`)

**Purpose**: Episodic memory capture and promotion.

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `index.ts` | Extension entry | Tool registration | Exports extension manifest |
| `actions.ts` | Core actions | `episode_create`, `episode_promote`, etc. | Episode operations |

**Key Tools**:
| Tool | Purpose |
|------|---------|
| `episode_create` | Create episode file |
| `episode_promote` | Promote to durable object |
| `episode_consolidate` | Merge episodes into object |
| `episode_list` | List recent episodes |

**Episode Storage**: `~/nixPI/Episodes/YYYY-MM-DD/<slug>.md`

---

### Setup Extension (`core/pi/extensions/setup/`)

**Purpose**: First-boot setup state management.

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `index.ts` | Extension entry | Tool registration | Exports extension manifest |
| `actions.ts` | Core actions | `setup_status`, `setup_advance`, etc. | Setup operations |
| `step-guidance.ts` | Persona guidance | Setup step instructions | Pi-facing guidance |

**Key Tools**:
| Tool | Purpose |
|------|---------|
| `setup_status` | Get current setup state |
| `setup_advance` | Mark step complete |
| `setup_reset` | Reset setup state |

**Setup Steps**:
1. `wizard` - Bash wizard completion
2. `persona` - Pi-guided persona setup

---

### Persona Extension (`core/pi/extensions/persona/`)

**Purpose**: Persona injection and shell guardrails.

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `index.ts` | Extension entry | Tool registration | Exports extension manifest |
| `actions.ts` | Core actions | Persona and guardrail operations | Injection and validation |
| `types.ts` | Type definitions | Shared types | TypeScript interfaces |

**Key Tools**:
| Tool | Purpose |
|------|---------|
| `persona_status` | Get current persona |
| `guardrails_check` | Validate command against guardrails |

---

### LocalAI Extension (`core/pi/extensions/localai/`)

**Purpose**: Local AI integration.

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `index.ts` | Extension entry | Tool registration | Exports extension manifest |

**Purpose**: Integrates with local AI providers for offline operation.

---

## 🔄 Extension Registration

Extensions are registered in `package.json`:

```json
{
  "pi": {
    "extensions": [
      "./core/pi/extensions/persona",
      "./core/pi/extensions/localai",
      "./core/pi/extensions/os",
      "./core/pi/extensions/episodes",
      "./core/pi/extensions/objects",
      "./core/pi/extensions/nixpi",
      "./core/pi/extensions/setup"
    ]
  }
}
```

Each extension exports a manifest with:
- `name` - Extension identifier
- `version` - Extension version
- `tools` - Array of tool definitions
- `hooks` - Lifecycle hooks (optional)

## 🔍 Common Extension Patterns

### Tool Definition Pattern

```typescript
export const myTool = {
  name: "tool_name",
  description: "What this tool does",
  parameters: Type.Object({
    param: Type.String(),
  }),
  async execute(context, args) {
    // Implementation
    return { result: "success" };
  },
};
```

### Extension Entry Pattern

```typescript
export default {
  name: "my-extension",
  version: "0.1.0",
  tools: [myTool, anotherTool],
  async onLoad(context) {
    // Initialization
  },
};
```

## 🔄 Related Tests

| Test File | Coverage |
|-----------|----------|
| `tests/extensions/nixpi.test.ts` | NixPI extension |
| `tests/extensions/os.test.ts` | OS extension |
| `tests/extensions/os-update.test.ts` | OS update operations |
| `tests/extensions/os-proposal.test.ts` | OS proposal flow |
| `tests/extensions/objects.test.ts` | Objects extension |
| `tests/extensions/episodes.test.ts` | Episodes extension |
| `tests/extensions/setup.test.ts` | Setup extension |
| `tests/extensions/persona.test.ts` | Persona extension |
| `tests/extensions/localai.test.ts` | LocalAI extension |

---

## 🔗 Related

- [Core Library](./core-lib) - Utilities used by extensions
- [Tests](./tests) - Test coverage details
