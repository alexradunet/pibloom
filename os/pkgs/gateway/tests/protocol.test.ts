import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CommandRegistry } from "../src/core/commands.js";
import { SimpleIdentityResolver } from "../src/core/identity.js";
import type { Scope } from "../src/core/identity.js";
import { MethodRegistry, registerV1Methods } from "../src/protocol/methods.js";
import { METHODS, PROTOCOL_VERSION } from "../src/protocol/types.js";
import { Store } from "../src/core/store.js";

function makeStore(): { store: Store; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gw-proto-"));
  return {
    store: new Store(path.join(dir, "state.json")),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function makeCtx(overrides?: Record<string, unknown>) {
  return {
    client: {
      connId: "test-conn",
      identity: null,
      role: "operator" as const,
      scopes: ["read", "write", "admin"] as Scope[],
      seq: 0,
      send: () => {},
    },
    params: { ...overrides },
    emit: () => {},
  };
}

test("MethodRegistry dispatches unknown methods", async () => {
  const registry = new MethodRegistry();
  const result = await registry.dispatch(makeCtx({ _method: "bogus" }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "UNKNOWN_METHOD");
});

test("MethodRegistry lists registered methods", () => {
  const registry = new MethodRegistry();
  registry.register("test.method", () => ({ ok: true }));
  assert.deepEqual(registry.listMethods(), ["test.method"]);
});

test("v1 health returns ok", async () => {
  const { store, cleanup } = makeStore();
  try {
    const commands = new CommandRegistry();
    commands.register({ name: "help", helpText: "show help", handler: () => "help!" });
    const registry = new MethodRegistry();
    registerV1Methods(registry, {
      store,
      commands,
      agentName: "pi",
      transportNames: ["whatsapp", "client"],
      startedAtMs: Date.now() - 1000,
      handleAgent: async () => ({ ok: true, payload: { runId: "r1", status: "accepted" } }),
    });

    const result = await registry.dispatch(makeCtx({ _method: METHODS.HEALTH }));
    assert.equal(result.ok, true);
    if (result.ok) {
      const p = result.payload as any;
      assert.equal(p.ok, true);
      assert.equal(p.agent, "pi");
      assert.deepEqual(p.transports, ["whatsapp", "client"]);
    }
  } finally {
    cleanup();
  }
});

test("v1 status returns agent info", async () => {
  const { store, cleanup } = makeStore();
  try {
    const commands = new CommandRegistry();
    const registry = new MethodRegistry();
    registerV1Methods(registry, {
      store,
      commands,
      agentName: "pi",
      transportNames: ["whatsapp", "client"],
      startedAtMs: Date.now() - 1000,
      handleAgent: async () => ({ ok: true, payload: { runId: "r1", status: "accepted" } }),
    });

    const result = await registry.dispatch(makeCtx({ _method: METHODS.STATUS }));
    assert.equal(result.ok, true);
    if (result.ok) {
      const p = result.payload as any;
      assert.equal(p.agent, "pi");
      assert.equal(p.identity, null);
    }
  } finally {
    cleanup();
  }
});

test("v1 commands.list returns registered commands", async () => {
  const { store, cleanup } = makeStore();
  try {
    const commands = new CommandRegistry();
    commands.register({ name: "help", helpText: "show help", handler: () => "help!" });
    const registry = new MethodRegistry();
    registerV1Methods(registry, {
      store,
      commands,
      agentName: "pi",
      transportNames: ["whatsapp", "client"],
      startedAtMs: Date.now() - 1000,
      handleAgent: async () => ({ ok: true, payload: { runId: "r1", status: "accepted" } }),
    });

    const result = await registry.dispatch(makeCtx({ _method: METHODS.COMMANDS_LIST }));
    assert.equal(result.ok, true);
    if (result.ok) {
      const p = result.payload as any;
      assert.ok(p.commands.includes("help"));
    }
  } finally {
    cleanup();
  }
});

test("v1 sessions.get requires chatId", async () => {
  const { store, cleanup } = makeStore();
  try {
    const commands = new CommandRegistry();
    const registry = new MethodRegistry();
    registerV1Methods(registry, {
      store,
      commands,
      agentName: "pi",
      transportNames: [],
      startedAtMs: Date.now(),
      handleAgent: async () => ({ ok: true, payload: { runId: "r1", status: "accepted" } }),
    });

    const result = await registry.dispatch(makeCtx({ _method: METHODS.SESSIONS_GET }));
    assert.equal(result.ok, false);
  } finally {
    cleanup();
  }
});

test("v1 sessions.reset resets a chat session", async () => {
  const { store, cleanup } = makeStore();
  try {
    const commands = new CommandRegistry();
    const registry = new MethodRegistry();
    registerV1Methods(registry, {
      store,
      commands,
      agentName: "pi",
      transportNames: [],
      startedAtMs: Date.now(),
      handleAgent: async () => ({ ok: true, payload: { runId: "r1", status: "accepted" } }),
    });

    store.upsertChatSession("test-chat", "sender", "/tmp/session");
    assert.notEqual(store.getChatSession("test-chat"), null);

    const result = await registry.dispatch(makeCtx({ _method: METHODS.SESSIONS_RESET, chatId: "test-chat" }));
    assert.equal(result.ok, true);
    assert.equal(store.getChatSession("test-chat"), null);
  } finally {
    cleanup();
  }
});

test("PROTOCOL_VERSION is 1", () => {
  assert.equal(PROTOCOL_VERSION, 1);
});

test("SimpleIdentityResolver resolves by channel:senderId", () => {
  const resolver = new SimpleIdentityResolver([
    {
      id: "alex",
      displayName: "Alex",
      scopes: ["read", "write", "admin"],
      keys: ["whatsapp:+40700123456", "token:web-abc"],
    },
  ]);

  const id = resolver.resolve("whatsapp", "+40700123456");
  assert.notEqual(id, null);
  assert.equal(id!.id, "alex");
  assert.equal(id!.source, "whatsapp");
});

test("SimpleIdentityResolver resolves by bare token", () => {
  const resolver = new SimpleIdentityResolver([
    {
      id: "alex",
      displayName: "Alex",
      scopes: ["read", "write", "admin"],
      keys: ["whatsapp:+40700123456", "token:web-abc"],
    },
  ]);

  const id = resolver.resolve("token", "web-abc");
  assert.notEqual(id, null);
  assert.equal(id!.id, "alex");
  assert.equal(id!.source, "token");
});

test("SimpleIdentityResolver returns null for unknown", () => {
  const resolver = new SimpleIdentityResolver([]);
  assert.equal(resolver.resolve("whatsapp", "+999999"), null);
});
