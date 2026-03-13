# Matrix Multi-Agent Rooms Implementation Plan

> Design reference: `docs/superpowers/specs/2026-03-12-matrix-multi-agent-rooms-design.md`

## Goal

Implement true multi-agent Matrix rooms in Bloom by extending the existing `pi-daemon` into a multi-agent supervisor.

## Target Architecture

- one `pi-daemon.service`
- one Matrix client/account per configured agent
- one central router for reply selection
- one Pi RPC session per `(roomId, agentId)`
- one `AGENTS.md` file per agent under `~/Bloom/Agents/`

## Principles

- keep normal single-agent behavior intact when only the host agent exists
- centralize routing and safety in the daemon
- use `AGENTS.md` as the agent overlay format
- preserve Bloom's shared base persona
- build this incrementally behind tests

---

## Task 1: Add agent definition loading from `~/Bloom/Agents/*/AGENTS.md`

### Files

Create:
- `daemon/agent-registry.ts`
- `tests/daemon/agent-registry.test.ts`

Potential helper updates:
- `lib/paths.ts` or an existing path helper file if needed for `~/Bloom/Agents`

### Requirements

Implement a loader that:
- discovers `~/Bloom/Agents/*/AGENTS.md`
- parses YAML frontmatter and markdown body
- validates required fields (`id`, `name`, `matrix.username`)
- applies sensible defaults for optional response fields
- derives `matrix.userId` using the local homeserver name (`bloom` for now)
- returns normalized `AgentDefinition[]`

Suggested normalized shape:

```ts
interface AgentDefinition {
  id: string;
  name: string;
  description?: string;
  instructionsPath: string;
  instructionsBody: string;
  matrix: {
    username: string;
    userId: string;
    autojoin: boolean;
  };
  model?: string;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  respond: {
    mode: "host" | "mentioned" | "silent";
    allowAgentMentions: boolean;
    maxPublicTurnsPerRoot: number;
    cooldownMs: number;
  };
  tools?: {
    allow?: string[];
    deny?: string[];
  };
}
```

### Tests

- valid file parses successfully
- missing `id` is rejected
- missing `name` is rejected
- missing `matrix.username` is rejected
- defaults are applied when optional `respond` fields are omitted
- files are loaded from multiple agent directories

### Acceptance

- Bloom can discover agent definitions from disk without side effects
- parsing and validation are fully unit-tested

---

## Task 2: Add pure routing logic and room state safeguards

### Files

Create:
- `daemon/router.ts`
- `daemon/room-state.ts`
- `tests/daemon/router.test.ts`
- `tests/daemon/room-state.test.ts`

### Requirements

Implement pure logic for:
- mention extraction from message bodies
- sender classification (`human`, `agent`, `self`, `unknown`)
- route target selection
- processed-event dedupe
- per-root reply budgets
- per-agent cooldown tracking

Suggested event shape:

```ts
interface RoomEnvelope {
  roomId: string;
  eventId: string;
  senderUserId: string;
  body: string;
  senderKind: "human" | "agent" | "self" | "unknown";
  senderAgentId?: string;
  mentions: string[];
  timestamp: number;
}
```

Suggested decision shape:

```ts
interface RouteDecision {
  targets: string[];
  reason:
    | "host-default"
    | "explicit-mention"
    | "agent-mention"
    | "ignored-self"
    | "ignored-duplicate"
    | "ignored-policy"
    | "ignored-budget"
    | "ignored-cooldown";
}
```

### Routing rules

- human + no mention -> host only
- human + explicit mention(s) -> mentioned agents only
- agent + explicit mention(s) -> mentioned peer agents only
- agent + no mention -> no targets
- `silent` agents are never auto-targeted

### Tests

- no mention routes only to host
- explicit mention routes only to planner
- explicit mention of multiple agents routes to both
- agent-to-agent routing requires explicit mention
- duplicate event ids are rejected
- cooldown blocks rapid repeat replies
- per-root budgets are enforced

### Acceptance

- routing decisions are deterministic and testable without Matrix SDK mocks
- all loop-prevention logic exists outside the agent prompt

---

## Task 3: Replace single Matrix listener wiring with a multi-client pool

### Files

Create:
- `daemon/matrix-client-pool.ts`
- `tests/daemon/matrix-client-pool.test.ts`

Refactor:
- `daemon/matrix-listener.ts` (either keep as a single-client wrapper or extract reusable per-agent client logic)
- `daemon/index.ts`
- `lib/matrix.ts`

### Requirements

Support one Matrix client per configured agent account.

The pool should:
- load credentials from a per-agent location such as `~/.pi/matrix-agents/<agent>.json`
- start all configured clients
- autojoin rooms when configured
- normalize incoming events into `RoomEnvelope`
- dedupe identical Matrix `event_id`s across all clients before routing
- expose helpers to send text and typing updates as a specific agent

Important: when multiple clients are in the same room, they will all observe the same human event. The pool must ensure the daemon sees it exactly once.

### Tests

- multiple clients start successfully
- duplicate room event seen by multiple clients is emitted once
- `sendText(agentId, roomId, text)` uses the correct underlying client
- `setTyping(agentId, roomId, typing)` uses the correct underlying client

### Acceptance

- the daemon can run with multiple bot accounts at once
- one incoming human message triggers only one routing pass

---

## Task 4: Add per-room/per-agent Pi sessions

### Files

Create:
- `daemon/agent-session.ts`
- `tests/daemon/agent-session.test.ts`

Refactor:
- `daemon/index.ts`
- optionally `daemon/room-process.ts` if code can be shared instead of duplicated

### Requirements

Spawn and manage one Pi RPC subprocess per `(roomId, agentId)`.

Session behavior:
- session directory: `~/.pi/agent/sessions/bloom-rooms/<room>/<agent>/`
- idle timeout logic preserved
- streaming state tracked per session
- typing indicator updates emitted per agent
- `agent_end` text routed back through the matching Matrix account

Prompt input should include:
- Bloom base persona
- agent `AGENTS.md` overlay
- room runtime preamble
- the user or agent message content

### Tests

- separate sessions are created for `(roomA, host)` and `(roomA, planner)`
- typing state toggles per session
- final text is returned via the correct Matrix identity
- idle cleanup removes only the expired `(room, agent)` session

### Acceptance

- host and planner can maintain separate histories in the same room
- responses appear as the correct Matrix bot account

---

## Task 5: Add local agent provisioning helpers

### Files

Refactor / create as needed:
- `lib/matrix.ts`
- `tests/lib/matrix-registration.test.ts`
- possibly a new helper module for multi-agent credential paths

Optional follow-up tool later:
- Bloom extension action/tool for creating an agent

### Requirements

Add helpers for creating and storing additional local Matrix bot accounts.

Minimum scope:
- generate username/password
- register the account using the existing registration-token flow
- write credential file to `~/.pi/matrix-agents/<agent>.json`
- optionally write starter `~/Bloom/Agents/<id>/AGENTS.md`

This task does not need to include a polished end-user tool if that slows delivery. Helper functions and tests are enough for first implementation.

### Tests

- credential path generation
- successful registration helper output shape
- duplicate username error handling
- starter file generation if implemented

### Acceptance

- new bot accounts can be provisioned predictably for development and rollout

---

## Task 6: Update documentation and architecture notes

### Files

Update:
- `ARCHITECTURE.md`
- `AGENTS.md`
- daemon-related docs as needed
- setup or Matrix docs if provisioning changes surface there

### Requirements

Document:
- `~/Bloom/Agents/` layout
- multi-agent daemon model
- default routing behavior
- credential storage location
- loop prevention rules
- migration path from single-bot to multi-agent rooms

### Acceptance

- a contributor can understand the architecture from repo docs without reading the entire implementation

---

## Recommended Delivery Order

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 6
6. Task 5

Rationale:
- parsing and routing can be built and tested first
- multi-client Matrix transport comes before session fan-out
- docs should land alongside architecture changes
- provisioning UX can lag slightly behind the core runtime

---

## MVP Exit Criteria

The feature is MVP-complete when:

- `host`, `planner`, and `critic` can exist as separate Matrix accounts
- all three can join the same Matrix room
- no mention -> host responds
- `@planner:bloom` mention -> planner responds
- `@critic:bloom` mention -> critic responds
- one incoming event never produces duplicate routing
- agent-to-agent public loops are blocked by default behavior
- single-agent users are unaffected

---

## Rollback / Safety

If multi-agent mode is unstable:
- run only the `host` agent definition
- keep the multi-client pool capable of operating with a single client
- do not remove current single-agent behavior until multi-agent tests are green
