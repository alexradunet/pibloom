import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  type ConnectFrame,
  type ResponseFrame,
  type EventFrame,
  type ConnectOkPayload,
  type ClientFrame,
  METHODS,
  EVENTS,
  type Scope,
  type Role,
  type AgentAcceptedPayload,
} from "../protocol/types.js";
import { MethodRegistry, registerV1Methods, type ConnectedClient, type MethodContext, type MethodResult } from "../protocol/methods.js";
import type { WebSocketTransportConfig } from "../config.js";
import type { InboundMessage } from "../core/types.js";
import type { GatewayTransport } from "../transports/types.js";
import type { Store } from "../core/store.js";
import type { CommandRegistry } from "../core/commands.js";
import type { IdentityResolver, Identity } from "../core/identity.js";
import type { Router } from "../core/router.js";

// Bundled web UI shipped alongside this file: dist/ui/
const BUNDLED_UI_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "ui");

// ── Legacy wire protocol (for existing web UI) ───────────────────────────────
// The existing index.html sends { type: "message", text } and receives
// { type: "chunk"|"reply"|"done"|"error", text }. We detect these frames
// and translate them into protocol/v1 calls for backward compatibility.

type LegacyClientMessage =
  | { type: "auth"; token: string }
  | { type: "message"; text: string };

type LegacyServerMessage =
  | { type: "auth_ok" }
  | { type: "auth_fail" }
  | { type: "chunk"; text: string }
  | { type: "reply"; text: string }
  | { type: "done" }
  | { type: "error"; text: string };

// ── ClientTransport ──────────────────────────────────────────────────────────

export class ClientTransport implements GatewayTransport {
  readonly name = "client";

  private readonly connections = new Map<string, WebSocket>();
  private readonly methodRegistry = new MethodRegistry();
  private router!: Router;
  private startedAtMs = Date.now();

  constructor(
    private readonly config: WebSocketTransportConfig,
    private readonly store: Store,
    private readonly commands: CommandRegistry,
    private readonly identityResolver?: IdentityResolver,
    private readonly agentName = "pi",
    private readonly transportNames: string[] = [],
  ) {
    // Register v1 methods (agent method handler is bound later via setRouter).
    registerV1Methods(this.methodRegistry, {
      store,
      commands,
      identityResolver,
      agentName,
      transportNames,
      startedAtMs: this.startedAtMs,
      handleAgent: (ctx) => this.handleAgentMethod(ctx),
    });
  }

  /** Must be called before startReceiving so the agent method can reach the Router. */
  setRouter(router: Router): void {
    this.router = router;
  }

  async healthCheck(): Promise<void> {
    // Server starts inside startReceiving; nothing to check before that.
  }

  startReceiving(
    onMessage: (msg: InboundMessage, onChunk?: (chunk: string) => void) => Promise<void>,
  ): Promise<never> {
    return new Promise<never>((_, reject) => {
      const server = createServer((req, res) => {
        void this.serveHttp(req, res);
      });
      const wss = new WebSocketServer({ server });

      wss.on("connection", (ws) => this.handleConnection(ws, onMessage));
      wss.on("error", (err) => {
        console.error("client transport: server error:", err);
        reject(err);
      });

      server.listen(this.config.port, this.config.host, () => {
        console.log(`client transport: listening on ${this.config.host}:${this.config.port}`);
      });
    });
  }

  async sendText(message: InboundMessage, text: string): Promise<void> {
    const ws = this.connections.get(message.chatId);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "reply", text } satisfies LegacyServerMessage));
    }
  }

  async sendTextToRecipient(recipientId: string, text: string): Promise<void> {
    const key = recipientId.startsWith("client:") ? recipientId.slice("client:".length) : recipientId;
    const ws = this.connections.get(key);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "reply", text } satisfies LegacyServerMessage));
      return;
    }
    console.warn(`client: no active connection for recipient ${recipientId}`);
  }

  // ── HTTP: static file serving + REST API ─────────────────────────────────

  private async serveHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? "/";

    // REST API routes
    if (url.startsWith("/api/v1/")) {
      return this.serveRestApi(req, res);
    }

    // Static file serving
    const uiDir = resolve(this.config.staticDir ?? BUNDLED_UI_DIR);
    let filePath: string;
    try {
      filePath = decodeURIComponent(url.split("?")[0] ?? "/");
    } catch {
      res.writeHead(400);
      res.end("Bad request");
      return;
    }
    if (filePath === "/" || filePath === "") filePath = "/index.html";

    if (filePath.includes("..") || filePath.includes("\0")) {
      res.writeHead(400);
      res.end("Bad request");
      return;
    }

    const fullPath = resolve(join(uiDir, filePath));
    if (!fullPath.startsWith(uiDir + "/") && fullPath !== uiDir) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    try {
      const data = await readFile(fullPath);
      res.writeHead(200, { "Content-Type": guessMime(filePath) });
      res.end(data);
    } catch {
      // SPA fallback
      try {
        const fallbackPath = resolve(join(uiDir, "index.html"));
        const data = await readFile(fallbackPath);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
    }
  }

  // ── REST API ────────────────────────────────────────────────────────────

  private serveRestApi(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    // Auth: Bearer token
    const authHeader = req.headers["authorization"];
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    // If gateway auth is configured, validate token
    if (this.config.authToken && token !== this.config.authToken) {
      // Allow local requests without token when no auth mode
      const isLocal = req.socket.remoteAddress === "127.0.0.1" || req.socket.remoteAddress === "::1";
      if (!isLocal || !token) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;

    let result: unknown;
    try {
      if (path === "/api/v1/health") {
        result = {
          ok: true,
          agent: this.agentName,
          transports: this.transportNames,
          uptimeMs: Date.now() - this.startedAtMs,
        };
      } else if (path === "/api/v1/status") {
        result = {
          ok: true,
          agent: this.agentName,
          transports: this.transportNames,
          connections: this.connections.size,
          commands: this.commands.listNames(),
        };
      } else if (path === "/api/v1/commands") {
        result = { commands: this.commands.listNames() };
      } else if (path === "/api/v1/sessions") {
        // Store doesn't support listing all sessions yet; return empty.
        result = { sessions: [] };
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  }

  // ── WebSocket: per-connection handling ───────────────────────────────────

  private handleConnection(
    ws: WebSocket,
    onMessage: (msg: InboundMessage, onChunk?: (chunk: string) => void) => Promise<void>,
  ): void {
    const connId = `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const sendJson = (data: ResponseFrame | EventFrame | LegacyServerMessage): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
    };

    const close = (reason: string): void => {
      console.log(`client: closing ${connId} — ${reason}`);
      this.connections.delete(connId);
      if (ws.readyState === WebSocket.OPEN) ws.close();
    };

    ws.on("close", () => {
      this.connections.delete(connId);
      console.log(`client: client ${connId} disconnected`);
    });

    ws.on("error", (err) => close(`ws error: ${err.message}`));

    // ── Auth phase ──────────────────────────────────────────────────────────
    // The existing web UI sends { type: "auth", token } first when authToken
    // is configured. New protocol/v1 clients send { type: "connect", ... }.
    // We detect which one and switch modes.

    const { authToken } = this.config;

    // State: how this connection speaks
    let protocolMode: "legacy" | "v1" | null = null;
    let identity: Identity | null = null;
    let chatId: string | null = null;
    let v1Client: ConnectedClient | null = null;
    let messageChain = Promise.resolve();

    // For legacy mode: serialize messages within a connection.
    const handleLegacyMessage = (text: string) => {
      if (!chatId) chatId = `ws-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const senderId = `client:${chatId}`;

      const inbound: InboundMessage = {
        channel: "client",
        chatId,
        senderId,
        messageId: `cmsg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        timestamp: new Date().toISOString(),
        text,
        isGroup: false,
        access: {
          allowedSenderIds: [senderId],
          adminSenderIds: [senderId],
          directMessagesOnly: false,
          selfSenderIds: [],
        },
      };

      const onChunk = (chunk: string): void => sendJson({ type: "chunk", text: chunk });

      messageChain = messageChain
        .catch(() => undefined)
        .then(async () => {
          try {
            await onMessage(inbound, onChunk);
            sendJson({ type: "done" });
          } catch (err) {
            const errText = err instanceof Error ? err.message : String(err);
            console.error(`client: message handler failed for ${connId}:`, err);
            sendJson({ type: "error", text: errText });
          }
        });
    };

    const handleV1Frame = (frame: ClientFrame) => {
      if (frame.type === "connect") {
        // Process connect frame
        const connectFrame = frame as ConnectFrame;
        const resolvedIdentity = this.resolveTokenIdentity(connectFrame.auth.token);

        chatId = `v1-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        this.connections.set(chatId, ws);

        v1Client = {
          connId,
          identity: resolvedIdentity,
          role: connectFrame.role ?? "operator",
          scopes: connectFrame.scopes ?? (resolvedIdentity ? resolvedIdentity.scopes : ["read"]),
          seq: 0,
          send: (f) => sendJson(f),
        };

        const helloOk: ConnectOkPayload = {
          type: "hello-ok",
          protocol: PROTOCOL_VERSION,
          server: { version: "1.0.0", connId },
          features: {
            methods: this.methodRegistry.listMethods(),
            events: this.methodRegistry.listEvents(),
          },
          auth: {
            role: v1Client.role,
            scopes: v1Client.scopes,
          },
          policy: {
            maxPayload: 25 * 1024 * 1024,
            tickIntervalMs: 15_000,
          },
        };

        sendJson({ type: "res", id: "connect", ok: true, payload: helloOk });
        return;
      }

      if (frame.type === "req") {
        if (!v1Client) {
          sendJson({ type: "res", id: frame.id, ok: false, error: { message: "Not connected. Send connect frame first.", code: "NOT_CONNECTED" } });
          return;
        }

        const ctx: MethodContext = {
          client: v1Client,
          params: { ...frame.params, _method: frame.method },
          emit: (event, payload) => {
            v1Client!.seq++;
            sendJson({ type: "event", event, payload, seq: v1Client!.seq });
          },
        };

        void (async () => {
          try {
            const result = await this.methodRegistry.dispatch(ctx);
            sendJson({
              type: "res",
              id: frame.id,
              ok: result.ok,
              ...(result.ok ? { payload: (result as any).payload } : { error: (result as any).error }),
            } as ResponseFrame);
          } catch (err) {
            sendJson({
              type: "res",
              id: frame.id,
              ok: false,
              error: { message: err instanceof Error ? err.message : String(err) },
            } as ResponseFrame);
          }
        })();
        return;
      }
    };

    // ── First-frame detection ───────────────────────────────────────────────
    // Wait for the first frame to determine protocol mode (legacy auth, v1
    // connect, or legacy message). After the first frame, all subsequent
    // frames follow the detected mode.

    ws.on("message", (rawData) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(rawData.toString()) as Record<string, unknown>;
      } catch {
        console.warn("client: invalid JSON from client, ignoring");
        return;
      }

      // First frame — detect protocol
      if (protocolMode === null) {
        if (parsed["type"] === "connect") {
          protocolMode = "v1";
          handleV1Frame(parsed as unknown as ClientFrame);
          return;
        }

        // Legacy: auth or message
        if (authToken && parsed["type"] === "auth") {
          if (parsed["token"] === authToken) {
            protocolMode = "legacy";
            chatId = `ws-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            this.connections.set(chatId, ws);
            sendJson({ type: "auth_ok" });
            identity = this.resolveTokenIdentity(undefined); // legacy mode has no token-to-identity yet
          } else {
            sendJson({ type: "auth_fail" });
            close("auth failed");
          }
          return;
        }

        // No auth required → legacy message mode
        protocolMode = "legacy";
        chatId = `ws-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        this.connections.set(chatId, ws);
        // Fall through to handle as legacy message
      }

      // Subsequent frames
      if (protocolMode === "v1") {
        handleV1Frame(parsed as unknown as ClientFrame);
        return;
      }

      // Legacy mode
      if (parsed["type"] === "message" && typeof parsed["text"] === "string") {
        handleLegacyMessage(parsed["text"] as string);
      }
    });
  }

  // ── Agent method handler ────────────────────────────────────────────────

  private async handleAgentMethod(ctx: MethodContext): Promise<MethodResult> {
    if (!this.router) {
      return { ok: false, error: { message: "Router not initialized", code: "UNAVAILABLE" } };
    }

    const message = ctx.params["message"] as string | undefined;
    if (!message) {
      return { ok: false, error: { message: "message is required", code: "INVALID_REQUEST" } };
    }

    const runId = randomUUID();
    const chatId = `agent-${runId}`;
    const senderId = ctx.client.identity ? `client:${ctx.client.identity.id}` : `client:${ctx.client.connId}`;

    const inbound: InboundMessage = {
      channel: "client",
      chatId,
      senderId,
      messageId: runId,
      timestamp: new Date().toISOString(),
      text: message,
      isGroup: false,
      access: {
        allowedSenderIds: [senderId],
        adminSenderIds: ctx.client.identity?.scopes?.includes("admin") ? [senderId] : [],
        directMessagesOnly: false,
        selfSenderIds: [],
      },
    };

    const onChunk = (chunk: string): void => {
      ctx.emit(EVENTS.AGENT, { runId, stream: "chunk", text: chunk });
    };

    try {
      const result = await this.router.handleMessage(inbound, onChunk);

      // Send result text as event
      for (const reply of result.replies) {
        ctx.emit(EVENTS.AGENT, { runId, stream: "result", text: reply });
      }

      return {
        ok: true,
        payload: { runId, status: "accepted" } as AgentAcceptedPayload,
      };
    } catch (err) {
      return {
        ok: false,
        error: { message: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  // ── Identity helpers ────────────────────────────────────────────────────

  private resolveTokenIdentity(token?: string): Identity | null {
    if (!token || !this.identityResolver) return null;
    // Try "token:<value>" as a key
    return this.identityResolver.resolve("token", token);
  }
}

// ── MIME helpers ───────────────────────────────────────────────────────────────

function guessMime(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "application/javascript";
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".ico")) return "image/x-icon";
  if (path.endsWith(".woff2")) return "font/woff2";
  if (path.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}
