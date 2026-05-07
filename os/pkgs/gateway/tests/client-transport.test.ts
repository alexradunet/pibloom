import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CommandRegistry } from "../src/core/commands.js";
import { Store } from "../src/core/store.js";
import { ClientTransport } from "../src/transport/client-transport.js";
import type { InboundMessage } from "../src/core/types.js";
import type { MethodContext } from "../src/protocol/methods.js";
import type { Scope } from "../src/core/identity.js";

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(predicate());
}

function makeCtx(params: Record<string, unknown>): MethodContext {
  return {
    client: {
      connId: "conn-1",
      identity: null,
      role: "operator",
      scopes: ["read", "write", "admin"] as Scope[],
      seq: 0,
      send: () => {},
    },
    params,
    emit: () => {},
  };
}

test("ClientTransport agent uses protocol sessionKey as stable Pi chat session", async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "ownloom-client-transport-"));
  try {
    const store = new Store(path.join(tmp, "state.json"));
    const transport = new ClientTransport(
      { enabled: true, host: "127.0.0.1", port: 0 },
      store,
      new CommandRegistry(),
    );

    const seen: InboundMessage[] = [];
    transport.setRouter({
      handleMessage: async (msg: InboundMessage) => {
        seen.push(msg);
        return { replies: ["ok"], markProcessed: true };
      },
    } as any);

    const result = await (transport as any).handleAgentMethod(makeCtx({ message: "hello", sessionKey: "web-main" }));

    assert.equal(result.ok, true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.channel, "client");
    assert.equal(seen[0]?.chatId, "client:web-main");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("ClientTransport replays stored response for duplicate idempotencyKey", async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "ownloom-client-transport-"));
  try {
    const store = new Store(path.join(tmp, "state.json"));
    const transport = new ClientTransport(
      { enabled: true, host: "127.0.0.1", port: 0 },
      store,
      new CommandRegistry(),
    );

    let calls = 0;
    transport.setRouter({
      handleMessage: async () => {
        calls += 1;
        return { replies: [`ok-${calls}`], markProcessed: true };
      },
    } as any);

    const client = {
      connId: "conn-1",
      identity: null,
      role: "operator" as const,
      scopes: ["read", "write", "admin"] as Scope[],
      seq: 0,
      send: () => {},
    };
    const responses: any[] = [];
    const sendJson = (frame: any) => responses.push(frame);

    (transport as any).handleRequest({
      type: "req",
      id: "req-1",
      method: "agent.wait",
      params: { message: "hello", idempotencyKey: "same-request" },
    }, client, sendJson);
    await waitFor(() => responses.length === 2);

    (transport as any).handleRequest({
      type: "req",
      id: "req-2",
      method: "agent.wait",
      params: { message: "hello again", idempotencyKey: "same-request" },
    }, client, sendJson);
    await waitFor(() => responses.length === 3);

    assert.equal(calls, 1);
    assert.equal(responses[1].type, "res");
    assert.equal(responses[1].id, "req-1");
    assert.equal(responses[1].ok, true);
    assert.equal(responses[2].type, "res");
    assert.equal(responses[2].id, "req-2");
    assert.equal(responses[2].ok, true);
    assert.deepEqual(responses[2].payload, responses[1].payload);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("ClientTransport consumes attachment refs after successful agent run", async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "ownloom-client-transport-"));
  try {
    const store = new Store(path.join(tmp, "state.json"));
    const attachment = store.saveAttachment({
      kind: "image",
      mimeType: "image/png",
      fileName: "photo.png",
      data: Buffer.from("png-bytes"),
    });
    const transport = new ClientTransport(
      { enabled: true, host: "127.0.0.1", port: 0 },
      store,
      new CommandRegistry(),
    );

    let seen: InboundMessage | undefined;
    transport.setRouter({
      handleMessage: async (msg: InboundMessage) => {
        seen = msg;
        return { replies: ["ok"], markProcessed: true };
      },
    } as any);

    const result = await (transport as any).handleAgentMethod(makeCtx({
      message: "describe",
      attachments: [{ id: attachment.id, kind: "image", mimeType: "image/png", fileName: "photo.png" }],
    }));

    assert.equal(result.ok, true);
    assert.equal(seen?.attachments?.[0]?.path, attachment.path);
    assert.equal(store.getAttachment(attachment.id), null);
    assert.equal(existsSync(attachment.path), false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("ClientTransport agent falls back to connection id when sessionKey is absent", async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "ownloom-client-transport-"));
  try {
    const store = new Store(path.join(tmp, "state.json"));
    const transport = new ClientTransport(
      { enabled: true, host: "127.0.0.1", port: 0 },
      store,
      new CommandRegistry(),
    );

    let seen: InboundMessage | undefined;
    transport.setRouter({
      handleMessage: async (msg: InboundMessage) => {
        seen = msg;
        return { replies: [], markProcessed: true };
      },
    } as any);

    await (transport as any).handleAgentMethod(makeCtx({ message: "hello" }));

    assert.equal(seen?.chatId, "client:conn-1");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
