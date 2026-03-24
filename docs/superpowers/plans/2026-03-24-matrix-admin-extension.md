# Matrix Admin Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `matrix_admin` Pi tool that lets the agent issue Continuwuity `!admin` commands via the Matrix admin room and capture the server bot's response.

**Architecture:** A self-contained Pi extension (`matrix-admin`) with three files: a commands module (catalogue + transformations), a client module (Matrix CS API calls, mutex serialisation, room discovery), and an index module (tool definition + registration). Credentials are loaded from the existing `~/.pi/matrix-credentials.json`. The admin room ID is discovered on first use and cached in `~/.pi/matrix-admin.json`.

**Tech Stack:** TypeScript (NodeNext ESM), `@sinclair/typebox` for parameter schemas, native `fetch` for Matrix CS API calls, Vitest for tests.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `core/pi/extensions/matrix-admin/commands.ts` | Dangerous command set and pre-send transformations |
| Create | `core/pi/extensions/matrix-admin/client.ts` | Matrix CS API: room discovery, sync token, send, poll, mutex |
| Create | `core/pi/extensions/matrix-admin/index.ts` | Tool definition, parameter schema, execute handler, registration |
| Create | `tests/extensions/matrix-admin/commands.test.ts` | Unit tests for commands module |
| Create | `tests/extensions/matrix-admin/client.test.ts` | Unit tests for client (mocked fetch) |
| Create | `tests/extensions/matrix-admin/index.test.ts` | Registration + execute handler tests |
| Modify | `package.json` | Add extension to `pi.extensions` array (extension loader reads this — no `index.ts` barrel needed) |

---

## Task 1: Commands module

**Files:**
- Create: `core/pi/extensions/matrix-admin/commands.ts`
- Create: `tests/extensions/matrix-admin/commands.test.ts`

- [ ] **Step 1.1: Write the failing tests**

Create `tests/extensions/matrix-admin/commands.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { DANGEROUS_COMMANDS, applyTransformations, isDangerous } from "../../../core/pi/extensions/matrix-admin/commands.js";

describe("DANGEROUS_COMMANDS", () => {
  it("includes destructive user commands", () => {
    expect(DANGEROUS_COMMANDS.has("users deactivate")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("users deactivate-all")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("users logout")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("users make-user-admin")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("users force-join-list-of-local-users")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("users force-join-all-local-users")).toBe(true);
  });

  it("includes destructive room commands", () => {
    expect(DANGEROUS_COMMANDS.has("rooms moderation ban-room")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("rooms moderation ban-list-of-rooms")).toBe(true);
  });

  it("includes dangerous server commands", () => {
    expect(DANGEROUS_COMMANDS.has("server restart")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("server shutdown")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("server show-config")).toBe(true);
  });

  it("includes dangerous federation and appservice commands", () => {
    expect(DANGEROUS_COMMANDS.has("federation disable-room")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("appservices unregister")).toBe(true);
  });

  it("includes dangerous media and token commands", () => {
    expect(DANGEROUS_COMMANDS.has("media delete-list")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("media delete-past-remote-media")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("media delete-all-from-user")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("media delete-all-from-server")).toBe(true);
    expect(DANGEROUS_COMMANDS.has("token destroy")).toBe(true);
  });

  it("does NOT include safe read commands", () => {
    expect(DANGEROUS_COMMANDS.has("users list-users")).toBe(false);
    expect(DANGEROUS_COMMANDS.has("rooms list-rooms")).toBe(false);
    expect(DANGEROUS_COMMANDS.has("server uptime")).toBe(false);
  });
});

describe("isDangerous", () => {
  it("returns true when command starts with a dangerous prefix", () => {
    expect(isDangerous("users deactivate @alice:nixpi")).toBe(true);
    expect(isDangerous("server restart")).toBe(true);
  });

  it("returns false for safe commands", () => {
    expect(isDangerous("users list-users")).toBe(false);
    expect(isDangerous("rooms list-rooms")).toBe(false);
  });
});

describe("check/debug/query pass-through namespaces", () => {
  it("debug commands are not dangerous", () => {
    expect(isDangerous("debug ping example.com")).toBe(false);
    expect(isDangerous("check")).toBe(false);
    expect(isDangerous("query globals signing-keys-for example.com")).toBe(false);
  });

  it("applyTransformations does not modify debug or query commands", () => {
    expect(applyTransformations("debug change-log-level debug")).toBe("debug change-log-level debug");
    expect(applyTransformations("query raw raw-del somekey")).toBe("query raw raw-del somekey");
  });
});

describe("applyTransformations", () => {
  it("appends --yes-i-want-to-do-this to force-join-list-of-local-users", () => {
    const result = applyTransformations("users force-join-list-of-local-users !room:nixpi");
    expect(result).toBe("users force-join-list-of-local-users !room:nixpi --yes-i-want-to-do-this");
  });

  it("does NOT duplicate the flag if already present", () => {
    const cmd = "users force-join-list-of-local-users !room:nixpi --yes-i-want-to-do-this";
    expect(applyTransformations(cmd)).toBe(cmd);
  });

  it("does not modify other commands", () => {
    expect(applyTransformations("users list-users")).toBe("users list-users");
    expect(applyTransformations("rooms list-rooms")).toBe("rooms list-rooms");
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
cd /home/alex/pi-bloom && npx vitest run tests/extensions/matrix-admin/commands.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 1.3: Implement `commands.ts`**

Create `core/pi/extensions/matrix-admin/commands.ts`:

```typescript
/**
 * Set of command prefixes that are dangerous/destructive.
 * isDangerous() checks whether a given command starts with any of these.
 */
export const DANGEROUS_COMMANDS: Set<string> = new Set([
  // Users — destructive
  "users deactivate",
  "users deactivate-all",
  "users logout",
  "users make-user-admin",
  "users force-join-list-of-local-users",
  "users force-join-all-local-users",
  // Rooms — destructive
  "rooms moderation ban-room",
  "rooms moderation ban-list-of-rooms",
  // Server — disruptive
  "server restart",
  "server shutdown",
  "server show-config",
  // Federation — disruptive
  "federation disable-room",
  // Media — destructive
  "media delete-list",
  "media delete-past-remote-media",
  "media delete-all-from-user",
  "media delete-all-from-server",
  // Appservices — destructive
  "appservices unregister",
  // Tokens — destructive
  "token destroy",
]);

/** Returns true if the command starts with any dangerous prefix. */
export function isDangerous(command: string): boolean {
  for (const prefix of DANGEROUS_COMMANDS) {
    if (command === prefix || command.startsWith(prefix + " ")) {
      return true;
    }
  }
  return false;
}

/**
 * Apply pre-send mutations to a command string.
 * Owned here so client.ts doesn't need to know about command semantics.
 */
export function applyTransformations(command: string): string {
  const FLAG = "--yes-i-want-to-do-this";
  if (
    command.startsWith("users force-join-list-of-local-users") &&
    !command.includes(FLAG)
  ) {
    return `${command} ${FLAG}`;
  }
  return command;
}
```

- [ ] **Step 1.4: Run test to verify it passes**

```bash
cd /home/alex/pi-bloom && npx vitest run tests/extensions/matrix-admin/commands.test.ts
```
Expected: All tests PASS.

- [ ] **Step 1.5: Commit**

```bash
git add core/pi/extensions/matrix-admin/commands.ts tests/extensions/matrix-admin/commands.test.ts
git commit -m "feat(matrix-admin): add commands catalogue, dangerous set, and transformations"
```

---

## Task 2: Client module — room discovery and cache

**Files:**
- Create: `core/pi/extensions/matrix-admin/client.ts` (initial)
- Create: `tests/extensions/matrix-admin/client.test.ts` (initial)

- [ ] **Step 2.1: Write failing tests for room discovery**

Create `tests/extensions/matrix-admin/client.test.ts`:

```typescript
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatrixAdminClient } from "../../../core/pi/extensions/matrix-admin/client.js";

// Helper: create a temporary .pi directory
function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-test-"));
  return dir;
}

function makeClient(tmpDir: string, fetchImpl: typeof fetch) {
  return new MatrixAdminClient({
    homeserver: "http://localhost:6167",
    accessToken: "tok_test",
    botUserId: "@pi:nixpi",
    configPath: path.join(tmpDir, "matrix-admin.json"),
    fetch: fetchImpl,
  });
}

describe("admin room discovery", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves room ID via directory API and caches it", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ room_id: "!abc123:nixpi" }),
    } as Response);

    const client = makeClient(tmpDir, mockFetch);
    const roomId = await client.getAdminRoomId();

    expect(roomId).toBe("!abc123:nixpi");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:6167/_matrix/client/v3/directory/room/%23admins%3Anixpi",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer tok_test" }) }),
    );

    // Cache file written
    const cached = JSON.parse(fs.readFileSync(path.join(tmpDir, "matrix-admin.json"), "utf8"));
    expect(cached.adminRoomId).toBe("!abc123:nixpi");
  });

  it("uses cached room ID without calling the API", async () => {
    const configPath = path.join(tmpDir, "matrix-admin.json");
    fs.writeFileSync(configPath, JSON.stringify({ adminRoomId: "!cached:nixpi" }));

    const mockFetch = vi.fn();
    const client = makeClient(tmpDir, mockFetch);
    const roomId = await client.getAdminRoomId();

    expect(roomId).toBe("!cached:nixpi");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws when directory API returns non-200", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    const client = makeClient(tmpDir, mockFetch);
    await expect(client.getAdminRoomId()).rejects.toThrow("admin room not found");
  });

  it("re-discovers and updates cache when invalidateCache is called", async () => {
    const configPath = path.join(tmpDir, "matrix-admin.json");
    fs.writeFileSync(configPath, JSON.stringify({ adminRoomId: "!old:nixpi" }));

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ room_id: "!new:nixpi" }),
    } as Response);

    const client = makeClient(tmpDir, mockFetch);
    await client.invalidateRoomCache();
    const roomId = await client.getAdminRoomId();

    expect(roomId).toBe("!new:nixpi");
    const cached = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(cached.adminRoomId).toBe("!new:nixpi");
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
cd /home/alex/pi-bloom && npx vitest run tests/extensions/matrix-admin/client.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 2.3: Implement room discovery in `client.ts`**

Create `core/pi/extensions/matrix-admin/client.ts`:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";

export interface MatrixAdminClientOptions {
  homeserver: string;
  accessToken: string;
  botUserId: string; // e.g. "@pi:nixpi" — used to derive server name
  configPath: string; // path to matrix-admin.json cache
  fetch?: typeof globalThis.fetch;
}

interface AdminConfig {
  adminRoomId?: string;
}

/** Simple async mutex to serialise concurrent runCommand calls. */
class AsyncMutex {
  private _locked = false;
  private _queue: Array<() => void> = [];

  async acquire(): Promise<() => void> {
    if (!this._locked) {
      this._locked = true;
      return () => this._release();
    }
    return new Promise<() => void>((resolve) => {
      this._queue.push(() => {
        this._locked = true;
        resolve(() => this._release());
      });
    });
  }

  private _release(): void {
    const next = this._queue.shift();
    if (next) {
      next();
    } else {
      this._locked = false;
    }
  }
}

export class MatrixAdminClient {
  private readonly homeserver: string;
  private readonly accessToken: string;
  private readonly serverName: string; // e.g. "nixpi"
  private readonly botUserId: string; // the server bot, e.g. "@conduit:nixpi"
  private readonly configPath: string;
  private readonly _fetch: typeof globalThis.fetch;
  private readonly _mutex = new AsyncMutex();
  private _cachedRoomId: string | undefined;

  constructor(options: MatrixAdminClientOptions) {
    this.homeserver = options.homeserver.replace(/\/$/, "");
    this.accessToken = options.accessToken;
    this.serverName = options.botUserId.split(":")[1] ?? "nixpi";
    this.botUserId = `@conduit:${this.serverName}`;
    this.configPath = options.configPath;
    this._fetch = options.fetch ?? globalThis.fetch;
    this._loadCachedRoomId();
  }

  private _loadCachedRoomId(): void {
    try {
      const raw = fs.readFileSync(this.configPath, "utf8");
      const config = JSON.parse(raw) as AdminConfig;
      this._cachedRoomId = config.adminRoomId;
    } catch {
      // file doesn't exist or is malformed — will discover on first use
    }
  }

  private _saveCachedRoomId(roomId: string): void {
    const config: AdminConfig = { adminRoomId: roomId };
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), "utf8");
    this._cachedRoomId = roomId;
  }

  async invalidateRoomCache(): Promise<void> {
    this._cachedRoomId = undefined;
    try {
      fs.unlinkSync(this.configPath);
    } catch {
      // file may not exist
    }
  }

  async getAdminRoomId(): Promise<string> {
    if (this._cachedRoomId) return this._cachedRoomId;

    const alias = `#admins:${this.serverName}`;
    const encodedAlias = encodeURIComponent(alias);
    const url = `${this.homeserver}/_matrix/client/v3/directory/room/${encodedAlias}`;

    const resp = await this._fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!resp.ok) {
      throw new Error("admin room not found");
    }

    const data = (await resp.json()) as { room_id: string };
    this._saveCachedRoomId(data.room_id);
    return data.room_id;
  }

  // Further methods added in Task 3 and 4
}
```

- [ ] **Step 2.4: Run test to verify it passes**

```bash
cd /home/alex/pi-bloom && npx vitest run tests/extensions/matrix-admin/client.test.ts
```
Expected: All discovery tests PASS.

- [ ] **Step 2.5: Commit**

```bash
git add core/pi/extensions/matrix-admin/client.ts tests/extensions/matrix-admin/client.test.ts
git commit -m "feat(matrix-admin): add MatrixAdminClient with room discovery and cache"
```

---

## Task 3: Client module — since token capture and command send

**Files:**
- Modify: `core/pi/extensions/matrix-admin/client.ts`
- Modify: `tests/extensions/matrix-admin/client.test.ts`

- [ ] **Step 3.1: Add failing tests for token capture and send**

Append to `tests/extensions/matrix-admin/client.test.ts`:

```typescript
describe("getSinceToken", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("calls /sync?timeout=0 with room filter and returns next_batch", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ next_batch: "s123_456" }),
    } as Response);

    const client = makeClient(tmpDir, mockFetch);
    const token = await client.getSinceToken("!room:nixpi");

    expect(token).toBe("s123_456");
    const callUrl = mockFetch.mock.calls[0][0] as string;
    expect(callUrl).toContain("timeout=0");
    expect(callUrl).toContain(encodeURIComponent("!room:nixpi"));
  });

  it("throws SyncError on non-200 response", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    const client = makeClient(tmpDir, mockFetch);
    await expect(client.getSinceToken("!room:nixpi")).rejects.toThrow("sync failed: 500");
  });
});

describe("sendAdminCommand", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("sends !admin prefixed message to the room", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ event_id: "$evt1" }),
    } as Response);

    const client = makeClient(tmpDir, mockFetch);
    await client.sendAdminCommand("!room:nixpi", "users list-users", undefined);

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/_matrix/client/v3/rooms/");
    expect(url).toContain("/send/m.room.message/");
    const body = JSON.parse(opts.body as string);
    expect(body.body).toBe("!admin users list-users");
    expect(body.msgtype).toBe("m.text");
  });

  it("appends a codeblock when body is provided", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ event_id: "$evt2" }),
    } as Response);

    const client = makeClient(tmpDir, mockFetch);
    await client.sendAdminCommand("!room:nixpi", "rooms moderation ban-list-of-rooms", "!bad:nixpi\n!worse:nixpi");

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.body).toContain("!admin rooms moderation ban-list-of-rooms");
    expect(body.body).toContain("!bad:nixpi");
    expect(body.body).toContain("!worse:nixpi");
  });

  it("throws on HTTP error", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 403 } as Response);
    const client = makeClient(tmpDir, mockFetch);
    await expect(client.sendAdminCommand("!room:nixpi", "users list-users", undefined))
      .rejects.toThrow("send failed: 403");
  });
});
```

- [ ] **Step 3.2: Run test to verify new tests fail**

```bash
cd /home/alex/pi-bloom && npx vitest run tests/extensions/matrix-admin/client.test.ts
```
Expected: New tests FAIL — `getSinceToken` and `sendAdminCommand` not defined.

- [ ] **Step 3.3: Add `getSinceToken` and `sendAdminCommand` to `client.ts`**

Add these methods to the `MatrixAdminClient` class (after `getAdminRoomId`):

```typescript
  async getSinceToken(roomId: string): Promise<string> {
    const filter = encodeURIComponent(
      JSON.stringify({
        room: { rooms: [roomId], timeline: { limit: 1 } },
        presence: { not_types: ["*"] },
        account_data: { not_types: ["*"] },
      }),
    );
    const url = `${this.homeserver}/_matrix/client/v3/sync?timeout=0&filter=${filter}`;
    const resp = await this._fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!resp.ok) throw new Error(`sync failed: ${resp.status}`);
    const data = (await resp.json()) as { next_batch: string };
    return data.next_batch;
  }

  async sendAdminCommand(
    roomId: string,
    command: string,
    body: string | undefined,
  ): Promise<void> {
    // Compose message text
    let text = `!admin ${command}`;
    if (body) {
      text = `${text}\n\`\`\`\n${body}\n\`\`\``;
    }

    const txnId = `matrix-admin-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const encodedRoomId = encodeURIComponent(roomId);
    const url = `${this.homeserver}/_matrix/client/v3/rooms/${encodedRoomId}/send/m.room.message/${txnId}`;

    const resp = await this._fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ msgtype: "m.text", body: text }),
    });

    if (!resp.ok) throw new Error(`send failed: ${resp.status}`);
  }
```

- [ ] **Step 3.4: Run test to verify it passes**

```bash
cd /home/alex/pi-bloom && npx vitest run tests/extensions/matrix-admin/client.test.ts
```
Expected: All tests PASS.

- [ ] **Step 3.5: Commit**

```bash
git add core/pi/extensions/matrix-admin/client.ts tests/extensions/matrix-admin/client.test.ts
git commit -m "feat(matrix-admin): add getSinceToken and sendAdminCommand methods"
```

---

## Task 4: Client module — long-poll response capture

**Files:**
- Modify: `core/pi/extensions/matrix-admin/client.ts`
- Modify: `tests/extensions/matrix-admin/client.test.ts`

- [ ] **Step 4.1: Add failing tests for response polling**

Append to `tests/extensions/matrix-admin/client.test.ts`:

```typescript
describe("pollForResponse", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("returns the first message body from the server bot", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        next_batch: "s2",
        rooms: {
          join: {
            "!room:nixpi": {
              timeline: {
                events: [
                  {
                    type: "m.room.message",
                    sender: "@conduit:nixpi",
                    content: { body: "Listed 3 users." },
                  },
                ],
              },
            },
          },
        },
      }),
    } as Response);

    const client = makeClient(tmpDir, mockFetch);
    const response = await client.pollForResponse("!room:nixpi", "s1", 5000);

    expect(response).toBe("Listed 3 users.");
  });

  it("ignores messages from other senders and advances since token between polls", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          next_batch: "s2",
          rooms: {
            join: {
              "!room:nixpi": {
                timeline: {
                  events: [
                    { type: "m.room.message", sender: "@pi:nixpi", content: { body: "not the bot" } },
                  ],
                },
              },
            },
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          next_batch: "s3",
          rooms: {
            join: {
              "!room:nixpi": {
                timeline: {
                  events: [
                    { type: "m.room.message", sender: "@conduit:nixpi", content: { body: "Real reply" } },
                  ],
                },
              },
            },
          },
        }),
      } as Response);

    const client = makeClient(tmpDir, mockFetch);
    const response = await client.pollForResponse("!room:nixpi", "s1", 5000);

    expect(response).toBe("Real reply");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Second call must use the next_batch from first response as its since token
    const secondCallUrl = mockFetch.mock.calls[1][0] as string;
    expect(secondCallUrl).toContain("since=s2");
  });

  it("returns null on timeout (no response before deadline)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ next_batch: "sN", rooms: {} }),
    } as Response);

    const client = makeClient(tmpDir, mockFetch);
    // 50ms timeout so test is fast
    const response = await client.pollForResponse("!room:nixpi", "s1", 50);

    expect(response).toBeNull();
  });

  it("throws on sync HTTP error", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 429 } as Response);
    const client = makeClient(tmpDir, mockFetch);
    await expect(client.pollForResponse("!room:nixpi", "s1", 5000)).rejects.toThrow("sync error: 429");
  });
});
```

- [ ] **Step 4.2: Run test to verify new tests fail**

```bash
cd /home/alex/pi-bloom && npx vitest run tests/extensions/matrix-admin/client.test.ts
```
Expected: New tests FAIL — `pollForResponse` not defined.

- [ ] **Step 4.3: Add `pollForResponse` to `client.ts`**

Add this type and method to `client.ts`:

```typescript
// Add near the top of the file after imports:
interface SyncResponse {
  next_batch: string;
  rooms?: {
    join?: Record<string, {
      timeline?: {
        events?: Array<{
          type: string;
          sender: string;
          content: { body: string };
        }>;
      };
    }>;
  };
}
```

Add method to `MatrixAdminClient`:

```typescript
  async pollForResponse(
    roomId: string,
    since: string,
    timeoutMs: number,
  ): Promise<string | null> {
    const filter = encodeURIComponent(
      JSON.stringify({
        room: { rooms: [roomId], timeline: { limit: 50 } },
        presence: { not_types: ["*"] },
        account_data: { not_types: ["*"] },
      }),
    );

    const deadline = Date.now() + timeoutMs;
    let currentSince = since;

    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const syncTimeout = Math.min(remaining, 15000);

      const url = `${this.homeserver}/_matrix/client/v3/sync?since=${currentSince}&timeout=${syncTimeout}&filter=${filter}`;
      const resp = await this._fetch(url, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      if (!resp.ok) throw new Error(`sync error: ${resp.status}`);

      const data = (await resp.json()) as SyncResponse;
      const roomData = data.rooms?.join?.[roomId];
      if (roomData?.timeline?.events) {
        for (const event of roomData.timeline.events) {
          if (event.type === "m.room.message" && event.sender === this.botUserId) {
            return event.content.body;
          }
        }
      }

      currentSince = data.next_batch;
    }

    return null;
  }
```

- [ ] **Step 4.4: Run test to verify it passes**

```bash
cd /home/alex/pi-bloom && npx vitest run tests/extensions/matrix-admin/client.test.ts
```
Expected: All tests PASS.

- [ ] **Step 4.5: Commit**

```bash
git add core/pi/extensions/matrix-admin/client.ts tests/extensions/matrix-admin/client.test.ts
git commit -m "feat(matrix-admin): add pollForResponse with long-poll sync"
```

---

## Task 5: Client module — `runCommand` with mutex orchestration

**Files:**
- Modify: `core/pi/extensions/matrix-admin/client.ts`
- Modify: `tests/extensions/matrix-admin/client.test.ts`

- [ ] **Step 5.1: Add failing tests for `runCommand`**

Append to `tests/extensions/matrix-admin/client.test.ts`:

```typescript
describe("runCommand", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function makeClientWithRoom(tmpDir: string, mockFetch: ReturnType<typeof vi.fn>) {
    const configPath = path.join(tmpDir, "matrix-admin.json");
    fs.writeFileSync(configPath, JSON.stringify({ adminRoomId: "!admin:nixpi" }));
    return new MatrixAdminClient({
      homeserver: "http://localhost:6167",
      accessToken: "tok",
      botUserId: "@pi:nixpi",
      configPath,
      fetch: mockFetch,
    });
  }

  it("returns ok:true with response text on success", async () => {
    const mockFetch = vi.fn()
      // getSinceToken
      .mockResolvedValueOnce({ ok: true, json: async () => ({ next_batch: "s1" }) } as Response)
      // sendAdminCommand
      .mockResolvedValueOnce({ ok: true, json: async () => ({ event_id: "$e1" }) } as Response)
      // pollForResponse
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          next_batch: "s2",
          rooms: { join: { "!admin:nixpi": { timeline: { events: [
            { type: "m.room.message", sender: "@conduit:nixpi", content: { body: "Done." } },
          ] } } } },
        }),
      } as Response);

    const client = makeClientWithRoom(tmpDir, mockFetch);
    const result = await client.runCommand({ command: "server uptime" });

    expect(result).toEqual({ ok: true, response: "Done." });
  });

  it("returns ok:false with error:timeout when no response arrives", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ next_batch: "s1" }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ event_id: "$e1" }) } as Response)
      .mockResolvedValue({ ok: true, json: async () => ({ next_batch: "s2", rooms: {} }) } as Response);

    const client = makeClientWithRoom(tmpDir, mockFetch);
    const result = await client.runCommand({ command: "server uptime", timeoutMs: 50 });

    expect(result).toEqual({ ok: false, error: "timeout" });
  });

  it("returns ok:true immediately when awaitResponse is false", async () => {
    const mockFetch = vi.fn()
      // only the sendAdminCommand call — no sync calls
      .mockResolvedValueOnce({ ok: true, json: async () => ({ event_id: "$e1" }) } as Response);

    const client = makeClientWithRoom(tmpDir, mockFetch);
    const result = await client.runCommand({ command: "server admin-notice hi", awaitResponse: false });

    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("serialises concurrent calls — responses are not cross-contaminated", async () => {
    const call1Response = "Response for call 1";
    const call2Response = "Response for call 2";

    let callIndex = 0;
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      const idx = callIndex++;
      // Pairs: [sinceToken, send, poll] × 2
      if (idx === 0 || idx === 3) return { ok: true, json: async () => ({ next_batch: `s${idx}` }) };
      if (idx === 1 || idx === 4) return { ok: true, json: async () => ({ event_id: "$e" }) };
      // poll responses
      const body = idx === 2 ? call1Response : call2Response;
      return {
        ok: true,
        json: async () => ({
          next_batch: `s${idx}`,
          rooms: { join: { "!admin:nixpi": { timeline: { events: [
            { type: "m.room.message", sender: "@conduit:nixpi", content: { body } },
          ] } } } },
        }),
      };
    });

    const client = makeClientWithRoom(tmpDir, mockFetch);
    const [r1, r2] = await Promise.all([
      client.runCommand({ command: "server uptime" }),
      client.runCommand({ command: "server memory-usage" }),
    ]);

    expect(r1).toEqual({ ok: true, response: call1Response });
    expect(r2).toEqual({ ok: true, response: call2Response });
  });

  it("re-discovers admin room on 403 send error", async () => {
    const mockFetch = vi.fn()
      // getSinceToken
      .mockResolvedValueOnce({ ok: true, json: async () => ({ next_batch: "s1" }) } as Response)
      // sendAdminCommand — 403 triggers re-discovery
      .mockResolvedValueOnce({ ok: false, status: 403 } as Response)
      // re-discover room
      .mockResolvedValueOnce({ ok: true, json: async () => ({ room_id: "!newadmin:nixpi" }) } as Response)
      // retry getSinceToken
      .mockResolvedValueOnce({ ok: true, json: async () => ({ next_batch: "s2" }) } as Response)
      // retry send
      .mockResolvedValueOnce({ ok: true, json: async () => ({ event_id: "$e1" }) } as Response)
      // poll
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          next_batch: "s3",
          rooms: { join: { "!newadmin:nixpi": { timeline: { events: [
            { type: "m.room.message", sender: "@conduit:nixpi", content: { body: "OK" } },
          ] } } } },
        }),
      } as Response);

    const client = makeClientWithRoom(tmpDir, mockFetch);
    const result = await client.runCommand({ command: "server uptime" });

    expect(result).toEqual({ ok: true, response: "OK" });
  });
});
```

- [ ] **Step 5.2: Run test to verify new tests fail**

```bash
cd /home/alex/pi-bloom && npx vitest run tests/extensions/matrix-admin/client.test.ts
```
Expected: New tests FAIL — `runCommand` not defined.

- [ ] **Step 5.3: Add `runCommand` and `RunCommandOptions` to `client.ts`**

Add to `client.ts` (after the existing imports):

```typescript
export interface RunCommandResult {
  ok: boolean;
  response?: string;
  error?: string;
}

export interface RunCommandOptions {
  command: string;
  body?: string;
  awaitResponse?: boolean;
  timeoutMs?: number;
}
```

Add method to `MatrixAdminClient`:

```typescript
  async runCommand(options: RunCommandOptions): Promise<RunCommandResult> {
    const { body, awaitResponse = true, timeoutMs = 15000 } = options;
    const command = applyTransformations(options.command);

    const release = await this._mutex.acquire();
    try {
      if (!awaitResponse) {
        const roomId = await this.getAdminRoomId();
        await this.sendAdminCommand(roomId, command, body);
        return { ok: true };
      }

      let roomId = await this.getAdminRoomId();

      // Capture since token before sending
      let since = ""; // initialised to satisfy TS control-flow; always assigned before use
      try {
        since = await this.getSinceToken(roomId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }

      // Send — retry once with room re-discovery on 403/404
      try {
        await this.sendAdminCommand(roomId, command, body);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("403") || msg.includes("404")) {
          await this.invalidateRoomCache();
          try {
            roomId = await this.getAdminRoomId();
          } catch {
            return { ok: false, error: "admin room not found" };
          }
          since = await this.getSinceToken(roomId);
          await this.sendAdminCommand(roomId, command, body);
        } else {
          return { ok: false, error: msg };
        }
      }

      // Poll for response
      try {
        const response = await this.pollForResponse(roomId, since, timeoutMs);
        if (response === null) return { ok: false, error: "timeout" };
        return { ok: true, response };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    } finally {
      release();
    }
  }
```

Also add the import for `applyTransformations` at the top of `client.ts`:

```typescript
import { applyTransformations } from "./commands.js";
```

- [ ] **Step 5.4: Run test to verify it passes**

```bash
cd /home/alex/pi-bloom && npx vitest run tests/extensions/matrix-admin/client.test.ts
```
Expected: All tests PASS.

- [ ] **Step 5.5: Commit**

```bash
git add core/pi/extensions/matrix-admin/client.ts tests/extensions/matrix-admin/client.test.ts
git commit -m "feat(matrix-admin): add runCommand with mutex serialisation and retry logic"
```

---

## Task 6: Index module — tool definition and registration

**Files:**
- Create: `core/pi/extensions/matrix-admin/index.ts`
- Create: `tests/extensions/matrix-admin/index.test.ts`

- [ ] **Step 6.1: Write failing tests**

Create `tests/extensions/matrix-admin/index.test.ts`:

```typescript
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockExtensionAPI } from "../../helpers/mock-extension-api.js";
import { createMockExtensionContext } from "../../helpers/mock-extension-context.js";

// Helper to create a temp .pi dir with credentials
function makeTempPiDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-test-"));
  const credentials = {
    homeserver: "http://localhost:6167",
    botUserId: "@pi:nixpi",
    botAccessToken: "tok_test",
    botPassword: "pw",
  };
  fs.writeFileSync(path.join(dir, "matrix-credentials.json"), JSON.stringify(credentials));
  return dir;
}

function toolNames(api: ReturnType<typeof createMockExtensionAPI>): string[] {
  return (api._registeredTools as Array<{ name: string }>).map((t) => t.name);
}

async function executeTool(
  api: ReturnType<typeof createMockExtensionAPI>,
  toolName: string,
  params: Record<string, unknown>,
) {
  const tool = (api._registeredTools as Array<{ name: string; execute: Function }>).find(
    (t) => t.name === toolName,
  );
  if (!tool) throw new Error(`Tool ${toolName} not found`);
  return tool.execute("test-id", params, undefined, undefined, createMockExtensionContext());
}

describe("matrix-admin extension registration", () => {
  let tmpDir: string;
  const originalHome = os.homedir();

  beforeEach(() => {
    tmpDir = makeTempPiDir();
    vi.spyOn(os, "homedir").mockReturnValue(tmpDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("registers the matrix_admin tool", async () => {
    const mod = await import("../../../core/pi/extensions/matrix-admin/index.js");
    const api = createMockExtensionAPI();
    mod.default(api as never);
    expect(toolNames(api)).toContain("matrix_admin");
  });
});

describe("matrix_admin tool execute", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempPiDir();
    vi.spyOn(os, "homedir").mockReturnValue(tmpDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns error for dangerous commands without confirmation", async () => {
    const mod = await import("../../../core/pi/extensions/matrix-admin/index.js");
    const api = createMockExtensionAPI();
    mod.default(api as never);

    const result = await executeTool(api, "matrix_admin", { command: "server shutdown" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/dangerous/i);
  });

  it("calls runCommand and returns response text on success", async () => {
    // Pre-populate admin room cache so no discovery fetch is needed
    fs.writeFileSync(
      path.join(tmpDir, "matrix-admin.json"),
      JSON.stringify({ adminRoomId: "!admin:nixpi" }),
    );

    // Mock global fetch for this test
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ next_batch: "s1" }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ event_id: "$e1" }) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          next_batch: "s2",
          rooms: { join: { "!admin:nixpi": { timeline: { events: [
            { type: "m.room.message", sender: "@conduit:nixpi", content: { body: "User list: @alex:nixpi" } },
          ] } } } },
        }),
      } as Response);

    vi.stubGlobal("fetch", mockFetch);

    const mod = await import("../../../core/pi/extensions/matrix-admin/index.js");
    const api = createMockExtensionAPI();
    mod.default(api as never);

    const result = await executeTool(api, "matrix_admin", { command: "users list-users" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("User list: @alex:nixpi");

    vi.unstubAllGlobals();
  });

  it("returns error when runCommand returns ok:false", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "matrix-admin.json"),
      JSON.stringify({ adminRoomId: "!admin:nixpi" }),
    );

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ next_batch: "s1" }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ event_id: "$e1" }) } as Response)
      // Poll returns empty repeatedly → timeout
      .mockResolvedValue({ ok: true, json: async () => ({ next_batch: "sN", rooms: {} }) } as Response);

    vi.stubGlobal("fetch", mockFetch);

    const mod = await import("../../../core/pi/extensions/matrix-admin/index.js");
    const api = createMockExtensionAPI();
    mod.default(api as never);

    const result = await executeTool(api, "matrix_admin", { command: "users list-users", timeout_ms: 50 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("timeout");

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 6.2: Run test to verify it fails**

```bash
cd /home/alex/pi-bloom && npx vitest run tests/extensions/matrix-admin/index.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 6.2b: Verify import paths exist**

```bash
ls /home/alex/pi-bloom/core/lib/extension-tools.ts
ls /home/alex/pi-bloom/core/lib/matrix.ts
```
Expected: both files exist. If either is missing, check the actual path with `find /home/alex/pi-bloom/core -name "extension-tools.ts"` and update the imports in Step 6.3 accordingly.

- [ ] **Step 6.3: Implement `index.ts`**

Create `core/pi/extensions/matrix-admin/index.ts`:

```typescript
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { defineTool, registerTools } from "../../lib/extension-tools.js";
import { matrixCredentialsPath, type MatrixCredentials } from "../../../lib/matrix.js";
import { isDangerous } from "./commands.js";
import { MatrixAdminClient } from "./client.js";

function matrixAdminConfigPath(homeDir = os.homedir()): string {
  return path.join(homeDir, ".pi", "matrix-admin.json");
}

function loadClient(): MatrixAdminClient {
  const credsPath = matrixCredentialsPath();
  let creds: MatrixCredentials;
  try {
    creds = JSON.parse(fs.readFileSync(credsPath, "utf8")) as MatrixCredentials;
  } catch (err) {
    throw new Error(`matrix-admin: credentials unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }

  return new MatrixAdminClient({
    homeserver: creds.homeserver,
    accessToken: creds.botAccessToken,
    botUserId: creds.botUserId,
    configPath: matrixAdminConfigPath(),
  });
}

export default function (pi: ExtensionAPI) {
  let client: MatrixAdminClient;
  try {
    client = loadClient();
  } catch (err) {
    console.error(`[matrix-admin] Failed to initialise:`, err);
    return; // do not register tool if credentials unavailable
  }

  registerTools(pi, [
    defineTool({
      name: "matrix_admin",
      label: "Matrix Admin",
      description:
        "Send a Continuwuity admin command to the Matrix admin room and return the server's response. " +
        "Pass the command string without the '!admin' prefix. " +
        "Commands marked dangerous require explicit user confirmation before calling this tool.",
      parameters: Type.Object({
        command: Type.String({
          description:
            "Admin command without the '!admin' prefix. E.g. 'users list-users', 'rooms list-rooms', 'server uptime'.",
        }),
        body: Type.Optional(
          Type.String({
            description:
              "Newline-delimited list for bulk codeblock commands (e.g. deactivate-all, ban-list-of-rooms).",
          }),
        ),
        await_response: Type.Optional(
          Type.Boolean({
            description: "Whether to wait for the server's reply. Defaults to true.",
          }),
        ),
        timeout_ms: Type.Optional(
          Type.Number({
            description: "How long to wait for a reply in milliseconds. Defaults to 15000.",
          }),
        ),
      }),
      async execute(_toolCallId, rawParams, _signal, _onUpdate, _ctx) {
        const params = rawParams as {
          command: string;
          body?: string;
          await_response?: boolean;
          timeout_ms?: number;
        };

        // Guard: dangerous commands must not be called without prior confirmation.
        // The agent is instructed to confirm with the user first; this is a safety net.
        if (isDangerous(params.command)) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `Command '${params.command}' is dangerous (destructive or irreversible). ` +
                  `Confirm with the user before running this command.`,
              },
            ],
            details: { command: params.command },
            isError: true,
          };
        }

        const result = await client.runCommand({
          command: params.command,
          body: params.body,
          awaitResponse: params.await_response,
          timeoutMs: params.timeout_ms,
        });

        if (!result.ok) {
          return {
            content: [{ type: "text" as const, text: `matrix_admin error: ${result.error}` }],
            details: { command: params.command, error: result.error },
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: result.response ?? "Command sent." }],
          details: { command: params.command, response: result.response },
        };
      },
    }),
  ]);
}
```

- [ ] **Step 6.4: Run test to verify it passes**

```bash
cd /home/alex/pi-bloom && npx vitest run tests/extensions/matrix-admin/index.test.ts
```
Expected: All tests PASS.

- [ ] **Step 6.5: Commit**

```bash
git add core/pi/extensions/matrix-admin/index.ts tests/extensions/matrix-admin/index.test.ts
git commit -m "feat(matrix-admin): add tool definition, execute handler, and registration"
```

---

## Task 7: Register extension and full test run

**Files:**
- Modify: `package.json`

- [ ] **Step 7.1: Add the extension to `package.json`**

In `package.json`, add `"./core/pi/extensions/matrix-admin"` to the `pi.extensions` array:

```json
"pi": {
  "extensions": [
    "./core/pi/extensions/persona",
    "./core/pi/extensions/os",
    "./core/pi/extensions/episodes",
    "./core/pi/extensions/objects",
    "./core/pi/extensions/nixpi",
    "./core/pi/extensions/matrix-admin"
  ],
  ...
}
```

- [ ] **Step 7.2: Run the full test suite**

```bash
cd /home/alex/pi-bloom && npm test
```
Expected: All tests PASS, no regressions.

- [ ] **Step 7.3: Build to verify TypeScript compiles cleanly**

```bash
cd /home/alex/pi-bloom && npm run build
```
Expected: Build succeeds with no type errors.

- [ ] **Step 7.4: Commit**

```bash
git add package.json
git commit -m "feat(matrix-admin): register extension in package.json"
```

---

## Task 8: Add agent instructions to host AGENTS.md

**Files:**
- Modify: `~/nixpi/Agents/<host-agent>/AGENTS.md` (or the default host agent instructions, wherever they live)

- [ ] **Step 8.1: Find the host agent instructions file**

```bash
ls ~/nixpi/Agents/
```
Identify the agent with `respond.mode: host` in its frontmatter.

- [ ] **Step 8.2: Append the Matrix Admin section to AGENTS.md**

Add the following to the body of the host agent's `AGENTS.md` (after existing instructions):

```markdown
## Matrix Admin Commands

Use the `matrix_admin` tool to manage the Continuwuity homeserver.
Pass the command string without the `!admin` prefix.

### Rules
- Commands marked ⚠️ are dangerous (destructive or irreversible). Always confirm with the user before running them. The tool will refuse to run them without confirmation.
- For bulk operations, pass a newline-delimited list in the `body` field.
- If a command returns an error, report it verbatim and ask the user how to proceed.
- `server show-config` contains secrets — do not display the full output unless the user explicitly asks.

### Common commands

**Users**
- `users list-users` — list all local users
- `users create-user --username <u> --password <p>` — create a user
- `users reset-password <@u:nixpi> --password <p>` — reset password
- `users deactivate <@u:nixpi>` — deactivate user ⚠️
- `users make-user-admin <@u:nixpi>` — grant admin ⚠️
- `users suspend <@u:nixpi>` / `users unsuspend <@u:nixpi>` — suspend/unsuspend
- `users lock <@u:nixpi>` / `users unlock <@u:nixpi>` — lock/unlock
- `users force-join-room <@u:nixpi> <roomId>` — force join
- `users list-joined-rooms <@u:nixpi>` — list user's rooms

**Rooms**
- `rooms list-rooms` — list all rooms
- `rooms info <roomId>` — room details
- `rooms info list-joined-members <roomId>` — list members
- `rooms alias set <#alias:nixpi> <roomId>` — set alias
- `rooms alias list` — list all aliases
- `rooms directory publish <roomId>` — publish to directory
- `rooms moderation ban-room <roomId>` — ban room ⚠️

**Server**
- `server uptime` — uptime
- `server memory-usage` — memory stats
- `server clear-caches` — clear caches
- `server show-config` — show config (contains secrets) ⚠️
- `server restart` — restart server ⚠️
- `server shutdown` — shutdown server ⚠️

**Appservices & Tokens**
- `appservices list-registered` — list bridges
- `appservices unregister <id>` — remove bridge ⚠️
- `token list` — list registration tokens
- `token create --uses-allowed <n>` — create limited-use token
- `token destroy --token <t>` — delete token ⚠️

**Bulk operations (use `body` field)**
- `users deactivate-all` — bulk deactivate (newline list of usernames) ⚠️
- `rooms moderation ban-list-of-rooms` — bulk ban (newline list of room IDs) ⚠️
- `media delete-list` — bulk delete MXC URLs ⚠️
```

- [ ] **Step 8.3: Commit**

Use the actual directory name identified in Step 8.1. Example (substitute `<agent-dir>` with the real name):

```bash
# Find the host agent directory if needed:
grep -rl 'mode: host' ~/nixpi/Agents/

git add ~/nixpi/Agents/<actual-agent-dir>/AGENTS.md
git commit -m "feat(matrix-admin): add agent instructions for matrix_admin tool"
```

---

## Done

After all tasks pass, the pi agent can:
- List, create, deactivate users
- Manage rooms, aliases, and the room directory
- Check server health, clear caches, view config
- Manage appservices and registration tokens
- Run bulk operations via the `body` field
- All with response capture and mutex-safe serialisation
