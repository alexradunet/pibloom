import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Store } from "../src/core/store.js";

test("Store records and replays idempotent request results", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ownloom-gateway-idempotency-"));
  try {
    const store = new Store(path.join(tmpDir, "gateway-state.json"));
    assert.deepEqual(store.beginIdempotentRequest("client:agent:k1", 1000), { status: "started" });
    assert.deepEqual(store.beginIdempotentRequest("client:agent:k1", 1000), { status: "pending" });

    const result = { ok: true, payload: { runId: "r1", status: "accepted" } };
    store.finishIdempotentRequest("client:agent:k1", result);
    assert.deepEqual(store.beginIdempotentRequest("client:agent:k1", 1000), { status: "duplicate", result });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Store deletes uploaded attachment metadata and file", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ownloom-gateway-attachments-"));
  try {
    const store = new Store(path.join(tmpDir, "gateway-state.json"));
    const attachment = store.saveAttachment({
      kind: "audio",
      mimeType: "audio/ogg",
      fileName: "voice.ogg",
      data: Buffer.from("ogg-bytes"),
    });

    assert.ok(existsSync(attachment.path));
    store.deleteAttachment(attachment.id);
    assert.equal(store.getAttachment(attachment.id), null);
    assert.equal(existsSync(attachment.path), false);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Store prunes stale uploaded attachments", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ownloom-gateway-attachments-"));
  try {
    const statePath = path.join(tmpDir, "gateway-state.json");
    const staleFile = path.join(tmpDir, "stale.bin");
    writeFileSync(staleFile, "stale");
    writeFileSync(statePath, JSON.stringify({
      attachments: {
        stale: {
          id: "stale",
          kind: "image",
          path: staleFile,
          mimeType: "image/png",
          sizeBytes: 5,
          createdAt: "2000-01-01T00:00:00.000Z",
        },
      },
    }), "utf-8");

    const store = new Store(statePath);
    assert.equal(store.pruneAttachments(24 * 60 * 60 * 1000), 1);
    assert.equal(store.getAttachment("stale"), null);
    assert.equal(existsSync(staleFile), false);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Store saves and resolves uploaded attachments", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ownloom-gateway-attachments-"));
  try {
    const store = new Store(path.join(tmpDir, "gateway-state.json"));
    const attachment = store.saveAttachment({
      kind: "image",
      mimeType: "image/png",
      fileName: "hello image.png",
      data: Buffer.from("png-bytes"),
    });

    assert.equal(attachment.kind, "image");
    assert.equal(attachment.mimeType, "image/png");
    assert.equal(attachment.fileName, "hello image.png");
    assert.equal(attachment.sizeBytes, 9);
    assert.ok(existsSync(attachment.path));
    assert.equal(readFileSync(attachment.path, "utf-8"), "png-bytes");

    const resolved = store.getAttachment(attachment.id);
    assert.deepEqual(resolved, attachment);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
