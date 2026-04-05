This directory defines the high-level concepts, business logic, and architecture of this project using markdown. It is managed by [lat.md](https://www.npmjs.com/package/lat.md) — a tool that anchors source code to these definitions. Install the `lat` command with `npm i -g lat.md` and run `lat --help`.

# Chat Server

The chat server exposes a WebSocket API for the Bloom OS frontend. It manages Pi agent sessions and streams responses back to clients as structured `ChatEvent` objects.

## RpcClientManager

Wraps the Pi SDK's `RpcClient` to spawn Pi as a subprocess in RPC mode and stream structured `ChatEvent` objects to callers. Replaces the previous in-process agent session approach.

The manager tracks per-content-block text cursors to convert Pi's accumulated `message_update` snapshots into incremental text deltas. Cursors are cleared on `agent_start` so each new turn begins from zero.

See [[core/chat-server/rpc-client-manager.ts#RpcClientManager]].

### ChatEvent

A discriminated union emitted by `sendMessage` for each meaningful agent event. Variants: `text` (incremental delta), `tool_call`, `tool_result`, `done`, `error`.

### sendMessage

Yields `ChatEvent` objects via an async generator. Registers an event listener on the underlying `RpcClient`, drives a queue-based backpressure loop, and always calls `unsub()` in a `finally` block.
