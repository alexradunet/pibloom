# Matrix Multi-Agent Rooms Design

Date: 2026-03-12

## Goal

Allow multiple Bloom agents to join the same Matrix room as distinct bot accounts, each with its own behavior and instruction overlay, while preserving Bloom's current daemon architecture and keeping the implementation simple enough to maintain.

## Summary

Extend `pi-daemon` from a single-bot room relay into a multi-agent supervisor:

- one `pi-daemon.service`
- one Matrix account per configured Bloom agent
- one central router that decides which agent should respond
- one `pi --mode rpc` subprocess per `(roomId, agentId)`
- one `AGENTS.md` file per agent under `~/Bloom/Agents/`

Bloom's shared persona in `~/Bloom/Persona/` remains the base identity. Each agent's `AGENTS.md` acts as an overlay, not a full persona replacement.

## Motivation

Bloom currently supports one Matrix bot identity (`@pi:bloom`) per room. That works well for direct messaging, but it cannot represent multiple specialized personas in the same room. The desired user experience is:

- invite multiple Bloom agents into a room
- talk to them individually by mentioning them
- optionally let them respond to each other in bounded, user-visible ways
- keep normal Bloom conversation intact for users who never configure extra agents

## Non-Goals

The MVP explicitly does **not** include:

- Matrix appservice virtual users
- autonomous swarm-style debates among agents in public rooms
- separate systemd units per agent
- separate private object stores per agent
- a custom non-markdown agent definition format

## Why This Approach

This design reuses the strongest parts of Bloom's current architecture:

- `matrix-bot-sdk` remains the Matrix transport
- `pi --mode rpc` remains the execution primitive
- `pi-daemon` remains the single long-lived supervisor
- markdown with frontmatter remains the user-editable config surface

Alternatives considered:

### 1. Matrix appservice / virtual users

Rejected for MVP. It adds homeserver-specific complexity and more moving parts than needed for a local home system with a small number of agents.

### 2. One daemon/service per bot

Rejected. This duplicates routing and sync logic, complicates lifecycle management, and makes failures harder to reason about.

### 3. Fully custom agent config format

Rejected. `AGENTS.md` is already a reasonable and human-readable instruction format. Bloom only needs a small amount of frontmatter on top.

## User-Editable Layout

New directory:

```text
~/Bloom/Agents/
  host/
    AGENTS.md
  planner/
    AGENTS.md
  critic/
    AGENTS.md
```

Each agent gets exactly one instruction file in v1.

## AGENTS.md Format

Use markdown with YAML frontmatter.

Example:

```md
---
id: planner
name: Planner
matrix:
  username: planner
  autojoin: true
model: anthropic/claude-sonnet-4-5
thinking: medium
respond:
  mode: mentioned
  allow_agent_mentions: true
  max_public_turns_per_root: 2
  cooldown_ms: 1500
description: Breaks problems into steps and proposes plans.
---

# Planner

You are Bloom's planning specialist.

Focus on:
- decomposition
- sequencing
- assumptions
- clarifying questions when requirements are fuzzy
```

### Required frontmatter fields

- `id: string`
- `name: string`
- `matrix.username: string`

### Optional frontmatter fields

- `matrix.autojoin: boolean`
- `model: string`
- `thinking: off|minimal|low|medium|high|xhigh`
- `description: string`
- `respond.mode: host|mentioned|silent`
- `respond.allow_agent_mentions: boolean`
- `respond.max_public_turns_per_root: number`
- `respond.cooldown_ms: number`
- `tools.allow: string[]`
- `tools.deny: string[]`

## Base Persona + Overlay Model

All agents inherit the normal Bloom persona from `~/Bloom/Persona/`.

Each agent's `AGENTS.md` is appended as an instruction overlay. This avoids maintaining four persona files per agent and keeps global Bloom identity changes DRY.

Prompt layers for a spawned agent session:

1. Bloom base persona
2. Agent `AGENTS.md` overlay
3. Runtime room preamble

Example preamble:

```text
[system]
You are the Bloom agent "Planner".
Your Matrix identity is @planner:bloom.
You are participating in room #family:bloom.
Other Bloom agents may also be present.
Respond only as yourself.
Do not continue agent-to-agent back-and-forth unless explicitly addressed.
Prioritize being helpful to the human.
```

## Architecture

```text
Matrix clients (one per agent account)
  -> Matrix client pool
  -> event dedupe
  -> central router
  -> agent session pool keyed by (roomId, agentId)
  -> pi --mode rpc subprocesses
  -> reply as the correct Matrix bot account
```

## Core Runtime Types

```ts
interface AgentDefinition {
  id: string;
  name: string;
  description?: string;
  instructionsPath: string;
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

## Storage Layout

### Matrix credentials

Use one standard local Matrix account per agent.

Suggested path:

```text
~/.pi/matrix-agents/
  host.json
  planner.json
  critic.json
```

Credential file shape:

```json
{
  "homeserver": "http://localhost:6167",
  "userId": "@planner:bloom",
  "accessToken": "...",
  "password": "...",
  "username": "planner"
}
```

### Session directories

Each agent gets an independent room session:

```text
~/.pi/agent/sessions/bloom-rooms/<room>/<agent>/
```

Examples:

```text
~/.pi/agent/sessions/bloom-rooms/family/host/
~/.pi/agent/sessions/bloom-rooms/family/planner/
~/.pi/agent/sessions/bloom-rooms/family/critic/
```

## Routing Policy

The daemon is the only authority for deciding which agent may answer a public room message.

### Default rules

1. Human message with no bot mention -> route only to the host agent
2. Human message with explicit agent mentions -> route only to those agents
3. Agent message -> route only to explicitly mentioned peer agents
4. Silent agents never auto-respond publicly

### Why these defaults

They keep the room understandable and prevent bot storms while still enabling true multi-agent conversation when the user asks for it.

## Mention Parsing

For MVP, support exact Matrix user-id mentions in the message body, for example:

- `@planner:bloom`
- `@critic:bloom`

Alias parsing (`planner`, `Planner`) can come later.

## Loop Prevention and Safety

Because every bot client in the room may observe the same Matrix event, the daemon must provide strong protections.

### Required safeguards

- dedupe all events by Matrix `event_id`
- ignore self-events per Matrix client
- per-root total reply budget (default 4)
- per-agent reply budget from `AGENTS.md` (default 2)
- per-agent public cooldown (default 1500ms)
- no agent-to-agent public replies unless explicitly mentioned

These protections live centrally in the daemon, not in agent prompts.

## Room Modes

Room modes are useful, but only one should be active in the MVP.

Supported model:

- `host-only`
- `addressed`
- `team`

### MVP mode

Use `addressed` behavior by default:

- no mention -> host responds
- mention -> addressed agents respond
- agents may only reply to other agents when explicitly mentioned

### Defer `team`

Do not implement autonomous team discussions initially. Add later if the addressed model proves stable.

## Typing Indicators

Reuse the current typing model, but per `(roomId, agentId)`:

- on `agent_start` -> set typing for that agent account
- refresh while streaming
- on `agent_end` or error -> clear typing

## Proposed Modules

### `daemon/agent-registry.ts`

Responsibilities:
- load `~/Bloom/Agents/*/AGENTS.md`
- parse and validate frontmatter
- derive `userId`
- return normalized `AgentDefinition[]`

### `daemon/matrix-client-pool.ts`

Responsibilities:
- start one Matrix client per agent account
- autojoin rooms
- emit normalized room events
- send replies and typing updates using the correct account
- dedupe duplicate event deliveries across clients

### `daemon/router.ts`

Pure logic only.

Responsibilities:
- parse mentions
- classify sender kind
- select target agents
- enforce cooldowns and budgets
- emit a `RouteDecision`

### `daemon/room-state.ts`

Responsibilities:
- track processed event ids
- track root event budgets
- track per-agent cooldowns
- reserve space for future room mode state

### `daemon/agent-session.ts`

Responsibilities:
- spawn one `pi --mode rpc` subprocess per `(roomId, agentId)`
- manage socket, idle timeout, and streaming state
- forward `agent_end` text back to the daemon for Matrix sending

### `daemon/index.ts`

Responsibilities:
- load agents
- start Matrix client pool
- receive normalized events
- ask the router for targets
- get or create target sessions
- inject runtime preamble and user message
- send final text reply through the correct Matrix account

## Failure Handling

### Agent session crash

If one `(room, agent)` session exits unexpectedly:
- clean up that session only
- keep daemon alive
- keep other agents alive
- next eligible message recreates the session

### Matrix auth failure for one agent

If one Matrix account fails auth:
- mark that agent offline
- continue serving other agents
- only restart the whole daemon for systemic failures

## Testing Strategy

### Unit tests

- parse valid and invalid `AGENTS.md`
- no mention routes to host only
- explicit mention routes to the correct agents only
- agent-to-agent routing requires explicit mention
- duplicate event ids are ignored
- cooldowns and reply budgets are enforced

### Integration tests

- multiple Matrix clients observe the same event and it is processed once
- separate sessions exist for `(room, host)` and `(room, planner)`
- replies go out through the correct Matrix identity
- typing state is set and cleared per agent session

## MVP Agent Set

Ship with three suggested roles:

- `host` — room-facing default Bloom identity
- `planner` — responds when mentioned, focuses on decomposition
- `critic` — responds when mentioned, focuses on challenge and review

This preserves the current feel of Bloom while making specialized roles available on demand.

## Migration / Rollout Plan

### Phase 1 — pure logic

- add agent registry
- add router
- add room-state tracking
- test parsing, routing, dedupe, cooldown, budgets

### Phase 2 — Matrix multi-client pool

- replace single-listener usage with a pool of per-agent clients
- dedupe events across clients
- preserve current single-bot behavior when only `host` exists

### Phase 3 — per-room/per-agent sessions

- spawn sessions keyed by `(roomId, agentId)`
- keep typing and send-back behavior per agent

### Phase 4 — provisioning UX

- add helper flow for creating Matrix bot accounts and writing credential files
- optionally add a Bloom tool later for agent creation

### Phase 5 — optional enhancements

- alias mentions
- thread affinity
- team mode
- richer presence/status

## Success Criteria

- multiple Bloom bot accounts can join the same Matrix room
- each addressed agent responds with distinct behavior
- duplicate replies from one incoming Matrix event do not occur
- bot-to-bot loops do not occur under default settings
- users who only use the host agent experience no regression

## Decision

Proceed with one enhanced `pi-daemon`, one standard Matrix account per agent, one `AGENTS.md` overlay per agent, and one Pi session per `(room, agent)` pair.
