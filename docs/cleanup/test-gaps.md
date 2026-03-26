# Test Gaps

Missing test coverage that should be added.

---

## TEST-1: `ChatSessionManager.sendMessage` — untested core logic

**File:** `tests/chat-server/session.test.ts`

The `sendMessage` method is the main streaming API — it subscribes to events,
fires `prompt()`, yields `ChatEvent`s via async generator, and handles errors.
None of this is tested. Only `getOrCreate`, session reuse, eviction, and
`delete` are covered.

**Missing tests:**
- Happy path: send message, receive text events, receive done
- Error during prompt: verify error event is yielded
- Multiple concurrent messages to different sessions
- Abort/cancel mid-stream

---

## TEST-2: `chatEventsFromAgentEvent` translation — untested

**File:** `core/chat-server/session.ts:175-206`

This function translates upstream `AgentSessionEvent` into `ChatEvent[]`. It
handles `text`, `tool_use`, and `tool_result` block types. No direct tests.

**Missing tests:**
- `message_update` with text block
- `message_update` with tool_use block
- `message_update` with tool_result block
- `message_update` with unknown block type (should be skipped)
- Non-`message_update` event types (should return empty)

---

## TEST-3: Chat server edge cases

**File:** `tests/chat-server/server.test.ts`

**Missing tests:**
- Invalid JSON body → 400 response
- PUT/PATCH methods → 405 response
- Path traversal on static files (e.g., `GET /../../../etc/passwd`) → 403
- Streaming error events mid-response
- `GET /` currently asserts `expect([200, 404]).toContain(res.status)` — this
  is a no-op test that passes regardless

---

## TEST-4: Idle timeout eviction

**File:** `tests/chat-server/session.test.ts`

The `idleTimeoutMs` option is configured but never tested. Should verify
sessions are evicted after timeout.

---

## TEST-5: `exec.ts` parameter coverage

**File:** `tests/lib/exec.test.ts`

**Missing tests:**
- `signal` (AbortSignal) parameter — abort a running command
- `env` parameter — pass extra environment variables
- `input` parameter — pipe stdin to the process
- `maxBuffer` behavior — what happens with large output

---

## TEST-6: `retry.ts` comprehensive coverage

**File:** `tests/lib/retry.test.ts`

**Missing tests:**
- `retry_after_ms` extraction from error data (the `getRetryAfterMs` function)
- `maxDelayMs` cap behavior
- Jitter variance (always disabled in tests via `jitter: false`)
- `onRetry` callback invocation with correct arguments
- Default parameter values (all tests pass explicit options)

---

## TEST-7: `filesystem.ts` path resolver coverage

**File:** `tests/lib/filesystem.test.ts`

**Missing tests:**
- `ensureDir`, `atomicWriteFile`
- `safePathWithin` (only `safePath` is tested, which delegates to it)
- `getNixPiStateDir`, `getPiDir`, `getWizardStateDir`, `getSystemReadyPath`,
  `getPersonaDonePath`, `getQuadletDir`, `getUpdateStatusPath`, `getDaemonStateDir`
- `resolvePackageDir`, `readPackageVersion`

---

## TEST-8: `utils.ts` function coverage

**Files:** `tests/lib/shared.test.ts`

**Missing tests:**
- `truncate` — not tested at all
- `textToolResult` — not tested at all
- `registerTools` — not tested at all

---

## TEST-9: Objects path traversal in slugs

**File:** `tests/extensions/objects.test.ts`

**Missing test:** A slug like `../../escape` should be blocked by `safePath`.
No test verifies this for object CRUD operations.

---

## TEST-10: Persona `loadPersona` failure path

**File:** `tests/extensions/persona.test.ts`

**Missing tests:**
- `loadPersona()` when persona files are missing
- `saveContext` / `loadContext` persistence across calls
- `buildRestoredContextBlock` output format

---

## TEST-11: OS `apply` action in proposal handler

**File:** `tests/extensions/os-proposal.test.ts`

Tests cover `status`, `validate`, and `update_flake_lock` actions. The `apply`
action is not tested.

---

## TEST-12: `memory.ts` scoring unit tests

**File:** `core/pi/extensions/objects/memory.ts`

`normalizeScalar`, `normalizeFields`, `mergeObjectState`, `scoreRecord`,
`confidenceBonus`, `safeTimestamp`, etc. are only tested indirectly through
integration tests. Given the scoring algorithm's complexity (point weights,
metadata bonuses, scope preferences), dedicated unit tests would catch
regressions.

**Key test scenarios:**
- `scoreRecord` with each filter type individually
- `normalizeFields` with edge cases (undefined values, non-string tags)
- `mergeObjectState` field merging precedence
- `confidenceBonus` / `safeTimestamp` boundary values
