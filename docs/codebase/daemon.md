# Daemon

> Matrix room runtime and multi-agent orchestration

## 🌱 Why The Daemon Exists

`nixpi-daemon.service` is nixPI's always-on room runtime. It exists to:

- Bridge Matrix rooms into Pi sessions
- Preserve room continuity outside interactive local sessions
- Support simple default-host deployments and optional multi-agent overlays
- Schedule proactive turns without external orchestration

## 🚀 What It Owns

| Concern | Files | Purpose |
|---------|-------|---------|
| Bootstrap | `index.ts`, `config.ts`, `lifecycle.ts` | Startup, config loading, retry logic |
| Runtime | `multi-agent-runtime.ts`, `agent-supervisor.ts` | Multi-agent orchestration |
| Routing | `router.ts` | Message routing decisions |
| State | `room-state.ts`, `agent-registry.ts` | Room and agent state management |
| Scheduling | `scheduler.ts`, `proactive.ts` | Proactive job execution |
| Bridge | `runtime/matrix-js-sdk-bridge.ts` | Matrix SDK transport |
| Sessions | `runtime/pi-room-session.ts` | Pi session lifecycle |
| Contracts | `contracts/matrix.ts`, `contracts/session.ts` | Interface definitions |
| Resilience | `rate-limiter.ts`, `ordered-cache.ts`, `metrics.ts` | Rate limiting, caching, observability |

## 📋 File Inventory

### Bootstrap and Config

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `core/daemon/index.ts` | Entry point | Bootstrap, mode selection, shutdown | Reads env vars, starts runtime |
| `core/daemon/config.ts` | Configuration | Config loading from env and files | Determines host/overlay mode |
| `core/daemon/lifecycle.ts` | Startup resilience | Retry/backoff for startup failures | Prevents crash loops |

### Runtime Core

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `core/daemon/multi-agent-runtime.ts` | Runtime orchestration | Manages all agents, rooms, sessions | Heart of the daemon |
| `core/daemon/agent-supervisor.ts` | Agent lifecycle | Supervises individual agent instances | Health monitoring, restart |
| `core/daemon/agent-registry.ts` | Agent discovery | Loads and validates agent overlays | Scans `~/nixPI/Agents/*/AGENTS.md` |

### Routing and State

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `core/daemon/router.ts` | Message routing | Decides which agent handles message | Mention detection, cooldowns |
| `core/daemon/room-state.ts` | Room tracking | Per-room message history, budgets | Bounded, pruned over time |

### Scheduling

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `core/daemon/scheduler.ts` | Job scheduling | Cron and interval job execution | Supports `@hourly`, `@daily`, cron |
| `core/daemon/proactive.ts` | Proactive dispatch | Dispatches proactive turns | Rate limiting, circuit breaker |
| `core/daemon/rate-limiter.ts` | Rate protection | Prevents proactive job flooding | Per-agent hourly budgets |

### Bridge and Sessions

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `core/daemon/runtime/matrix-js-sdk-bridge.ts` | Matrix transport | SDK integration, event handling | One client per agent |
| `core/daemon/runtime/pi-room-session.ts` | Session lifecycle | Pi SDK session per (room, agent) | Compaction, context management |

### Contracts

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `core/daemon/contracts/matrix.ts` | Matrix abstraction | Interface for Matrix operations | Allows testing without SDK |
| `core/daemon/contracts/session.ts` | Session abstraction | Interface for Pi sessions | Testable session mocking |

### Utilities

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `core/daemon/ordered-cache.ts` | Bounded caching | LRU cache with eviction | Duplicate detection |
| `core/daemon/metrics.ts` | Observability | Runtime metrics collection | Exportable metrics |

---

## 🔍 Important File Details

### `core/daemon/index.ts`

**Responsibility**: Daemon entry point and bootstrap coordination.

**Key Functions**:
- `main()` - Entry point
- `bootstrap()` - Config loading and runtime initialization
- `shutdown()` - Graceful shutdown handler

**Environment Variables**:
- `NIXPI_DAEMON_MODE` - `host-only` or `multi-agent`
- `NIXPI_MATRIX_HOMESERVER` - Matrix server URL
- `NIXPI_PRIMARY_USER` - Primary operator account

**Inbound Dependencies**:
- Systemd service startup
- `nixpi-daemon.service` unit

**Outbound Dependencies**:
- `multi-agent-runtime.ts` - Runtime initialization
- `lifecycle.ts` - Startup retry logic

---

### `core/daemon/multi-agent-runtime.ts`

**Responsibility**: Orchestrates all agents, rooms, and sessions. The heart of the daemon.

**Key Class**: `MultiAgentRuntime`

**Responsibilities**:
- Creates Matrix client per agent
- Manages room subscriptions
- Routes messages to appropriate sessions
- Handles agent overlay lifecycle

**Mode Behavior**:
- **Host-only mode**: Single synthesized agent from primary credentials
- **Multi-agent mode**: Loads all valid overlays from `~/nixPI/Agents/`

**Inbound Dependencies**:
- `index.ts` - Bootstrap
- `matrix-js-sdk-bridge.ts` - Event delivery

**Outbound Dependencies**:
- `agent-registry.ts` - Overlay loading
- `router.ts` - Message routing
- `room-state.ts` - State management
- `scheduler.ts` - Proactive job triggering

---

### `core/daemon/router.ts`

**Responsibility**: Decides which agent handles each incoming message.

**Routing Rules** (in order):
1. Host mode only → Route to default agent
2. Explicit mention → Route to mentioned agent
3. First eligible → Route to first non-cooldown agent
4. Budget exhausted → Queue or drop

**Cooldown Logic**:
- Prevents agent spam
- Configurable per-agent cooldown periods
- Tracks per-room reply budgets

**Inbound Dependencies**:
- `multi-agent-runtime.ts` - Routing requests
- `room-state.ts` - Historical context

**Outbound Dependencies**:
- `pi-room-session.ts` - Session delivery

---

### `core/daemon/scheduler.ts`

**Responsibility**: Executes proactive jobs on schedules.

**Supported Schedules**:
| Expression | Description |
|------------|-------------|
| `@hourly` | Every hour at :00 |
| `@daily` | Midnight UTC daily |
| `@weekly` | Midnight UTC Sundays |
| `MM HH * * *` | Daily at specific time |
| `MM HH * * D` | Weekly on specific day |

**Not Supported**:
- Day-of-month fields
- Month fields
- Sub-hour intervals (`*/5`)

**Job Definition** (from AGENTS.md frontmatter):
```yaml
proactive:
  jobs:
    - id: daily-heartbeat
      kind: heartbeat
      room: "!ops:nixpi"
      interval_minutes: 1440
      prompt: "Review room and host state"
      quiet_if_noop: true
      no_op_token: "HEARTBEAT_OK"
```

**Inbound Dependencies**:
- `multi-agent-runtime.ts` - Job registration
- `agent-registry.ts` - Job discovery from overlays

**Outbound Dependencies**:
- `proactive.ts` - Job dispatch
- `rate-limiter.ts` - Rate limit checking

---

### `core/daemon/proactive.ts`

**Responsibility**: Dispatches proactive jobs with rate limiting and circuit breaking.

**Rate Limiting**:
- Default: 60 jobs/hour per agent
- Configurable: `NIXPI_PROACTIVE_MAX_JOBS_PER_HOUR`

**Circuit Breaker**:
- Threshold: 5 consecutive failures
- Reset: 60 seconds
- States: closed (normal), open (rejected), half-open (testing)

**Quiet if Noop**:
- When `quiet_if_noop: true` and response matches `no_op_token`
- Reply is suppressed

**Inbound Dependencies**:
- `scheduler.ts` - Job triggers

**Outbound Dependencies**:
- `pi-room-session.ts` - Session for dispatch
- `rate-limiter.ts` - Limit checking

---

### `core/daemon/agent-registry.ts`

**Responsibility**: Loads and validates agent overlays from `~/nixPI/Agents/`.

**Directory Structure**:
```
~/nixPI/Agents/
├── agent-a/
│   └── AGENTS.md
├── agent-b/
│   └── AGENTS.md
└── ...
```

**AGENTS.md Format**:
```yaml
---
id: agent-id
name: Agent Name
matrix:
  user_id: "@agent:nixpi"
  access_token: "..."
proactive:
  jobs: [...]
---
```

**Validation**:
- Required fields: `id`, `name`, `matrix.user_id`
- Malformed overlays are skipped with warnings (not fatal)

**Inbound Dependencies**:
- `multi-agent-runtime.ts` - Registry queries

**Outbound Dependencies**:
- `lib/frontmatter.ts` - Frontmatter parsing

---

### `core/daemon/room-state.ts`

**Responsibility**: Tracks per-room state including message history and reply budgets.

**State Tracked**:
- Message history (bounded)
- Agent reply counts
- Cooldown timestamps
- Duplicate event IDs

**Pruning**:
- Old entries evicted automatically
- Prevents unbounded memory growth

**Inbound Dependencies**:
- `router.ts` - State queries
- `multi-agent-runtime.ts` - State updates

---

## 🔄 Related Tests

| Test File | Coverage |
|-----------|----------|
| `tests/daemon/index.test.ts` | Bootstrap and lifecycle |
| `tests/daemon/multi-agent-runtime.test.ts` | Runtime orchestration |
| `tests/daemon/agent-supervisor.test.ts` | Agent supervision |
| `tests/daemon/agent-registry.test.ts` | Overlay loading |
| `tests/daemon/router.test.ts` | Message routing |
| `tests/daemon/room-state.test.ts` | Room state management |
| `tests/daemon/scheduler.test.ts` | Job scheduling |
| `tests/daemon/proactive.test.ts` | Proactive dispatch |
| `tests/daemon/rate-limiter.test.ts` | Rate limiting |
| `tests/daemon/lifecycle.test.ts` | Startup retry |
| `tests/daemon/matrix-js-sdk-bridge.test.ts` | Matrix transport |
| `tests/daemon/pi-room-session.test.ts` | Session lifecycle |
| `tests/daemon/ordered-cache.test.ts` | Caching |
| `tests/daemon/session-events.test.ts` | Session events |

---

## 🔗 Related

- [Reference: Daemon Architecture](../reference/daemon-architecture) - Detailed daemon docs
- [Architecture: Runtime Flows](../architecture/runtime-flows) - End-to-end flows
- [Tests](./tests) - Test coverage details
