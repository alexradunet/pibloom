#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const httpUrl = process.env.OWNLOOM_GATEWAY_HTTP_URL ?? "http://127.0.0.1:8081";
const wsUrl = process.env.OWNLOOM_GATEWAY_WS_URL ?? httpUrl.replace(/^http/, "ws");
const token = process.env.OWNLOOM_GATEWAY_TOKEN ?? "";
const sessionKey = process.env.OWNLOOM_GATEWAY_SESSION ?? "example-main";
const message = process.env.OWNLOOM_GATEWAY_MESSAGE ?? "Reply with one short sentence confirming protocol/v1 works.";
const attachmentPath = process.env.OWNLOOM_GATEWAY_ATTACHMENT;
const attachmentKind = process.env.OWNLOOM_GATEWAY_ATTACHMENT_KIND ?? "image";
const attachmentMime = process.env.OWNLOOM_GATEWAY_ATTACHMENT_MIME ?? "application/octet-stream";

function authHeaders() {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function uploadAttachment() {
  if (!attachmentPath) return [];
  if (attachmentKind !== "image" && attachmentKind !== "audio") {
    throw new Error("OWNLOOM_GATEWAY_ATTACHMENT_KIND must be image or audio");
  }

  const data = await readFile(attachmentPath);
  const response = await fetch(`${httpUrl}/api/v1/attachments`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": attachmentMime,
      "x-ownloom-attachment-kind": attachmentKind,
      "x-ownloom-filename": basename(attachmentPath),
    },
    body: data,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`attachment upload failed: ${response.status} ${JSON.stringify(body)}`);
  console.log("uploaded attachment", body);
  return [body];
}

function openSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", () => reject(new Error(`failed to connect to ${wsUrl}`)), { once: true });
  });
}

function waitForResponse(ws, id) {
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const frame = JSON.parse(event.data.toString());
      if (frame.type === "event") {
        if (frame.event === "agent") console.log("agent event", frame.payload);
        return;
      }
      if (frame.type === "res" && frame.id === id) {
        ws.removeEventListener("message", onMessage);
        if (frame.ok) resolve(frame.payload);
        else reject(new Error(`${frame.error?.code ?? "ERROR"}: ${frame.error?.message ?? "request failed"}`));
      }
    };
    ws.addEventListener("message", onMessage);
  });
}

async function request(ws, method, params = {}) {
  const id = `${method}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const pending = waitForResponse(ws, id);
  ws.send(JSON.stringify({ type: "req", id, method, params }));
  return pending;
}

async function main() {
  const attachments = await uploadAttachment();
  const ws = await openSocket();

  const hello = waitForResponse(ws, "connect");
  ws.send(JSON.stringify({
    type: "connect",
    protocol: 1,
    role: "operator",
    scopes: ["read", "write"],
    auth: token ? { token } : {},
    client: { id: "example-client", version: "0.1.0", platform: "node" },
  }));
  console.log("connected", await hello);

  console.log("health", await request(ws, "health"));
  console.log("agent", await request(ws, "agent.wait", {
    message,
    sessionKey,
    idempotencyKey: `example-${sessionKey}-${message}`,
    ...(attachments.length ? { attachments } : {}),
  }));

  ws.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
