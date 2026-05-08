import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  type ConnectFrame,
  type ResponseFrame,
  type EventFrame,
  type ClientFrame,
  type ConnectOkPayload,
  EVENTS,
  type AgentAcceptedPayload,
  type AttachmentRef,
} from "../protocol/types.js";
import { MethodRegistry, registerV1Methods, type ConnectedClient, type MethodContext, type MethodResult } from "../protocol/methods.js";
import type { ClientTransportConfig } from "../config.js";
import type { DeliveryService } from "../core/delivery.js";
import type { InboundAttachment, InboundMessage } from "../core/types.js";
import type { GatewayTransport } from "../transports/types.js";
import type { Store } from "../core/store.js";
import type { CommandRegistry } from "../core/commands.js";
import type { IdentityResolver, Identity } from "../core/identity.js";
import type { Router } from "../core/router.js";

// ── ClientTransport ──────────────────────────────────────────────────────────
// First-party client transport. Speaks protocol/v1 only:
//   connect -> res hello-ok
//   req     -> res
//   event   <- server-pushed events
// No legacy web-chat protocol and no bundled static UI.

export class ClientTransport implements GatewayTransport {
  readonly name = "client";

  private readonly connections = new Map<string, { ws: WebSocket; client: ConnectedClient }>();
  private readonly methodRegistry = new MethodRegistry();
  private router!: Router;
  private delivery?: DeliveryService;
  private startedAtMs = Date.now();

  constructor(
    private readonly config: ClientTransportConfig,
    private readonly store: Store,
    private readonly commands: CommandRegistry,
    private readonly identityResolver?: IdentityResolver,
    private readonly agentName = "pi",
    private readonly transportNames: string[] = [],
  ) {
    registerV1Methods(this.methodRegistry, {
      store,
      commands,
      identityResolver,
      agentName,
      transportNames,
      startedAtMs: this.startedAtMs,
      handleAgent: (ctx) => this.handleAgentMethod(ctx),
      onDeliveryRetry: () => this.delivery?.drainQueuedDeliveries(),
      clients: (config.clients ?? []).map((client) => ({
        id: client.id,
        displayName: client.displayName,
        scopes: client.scopes,
      })),
    });
  }

  /** Must be called before startReceiving so the agent method can reach the Router. */
  setRouter(router: Router): void {
    this.router = router;
  }

  setDeliveryService(delivery: DeliveryService): void {
    this.delivery = delivery;
  }

  async healthCheck(): Promise<void> {
    // Server starts inside startReceiving; nothing to check before that.
  }

  startReceiving(_onMessage: (msg: InboundMessage, onChunk?: (chunk: string) => void) => Promise<void>): Promise<never> {
    return new Promise<never>((_, reject) => {
      const server = createServer((req, res) => {
        void this.serveHttp(req, res);
      });
      const wss = new WebSocketServer({ server });

      wss.on("connection", (ws) => this.handleConnection(ws));
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
    await this.sendTextToRecipient(`client:${message.chatId}`, text);
  }

  async sendTextToRecipient(recipientId: string, text: string): Promise<void> {
    const key = recipientId.startsWith("client:") ? recipientId.slice("client:".length) : recipientId;
    const connection = this.connections.get(key);
    if (!connection || connection.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`client: no active connection for recipient ${recipientId}`);
    }

    connection.client.seq += 1;
    connection.ws.send(JSON.stringify({
      type: "event",
      event: "message",
      payload: { text },
      seq: connection.client.seq,
    } satisfies EventFrame));
  }

  // ── HTTP REST API ────────────────────────────────────────────────────────

  private async serveHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? "/";
    if (url.startsWith("/api/v1/")) {
      await this.serveRestApi(req, res);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  private async serveRestApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsedUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = parsedUrl.pathname;
    const requiredScope = req.method === "POST" && path === "/api/v1/attachments" ? "write" : "read";
    const auth = this.authenticateRestRequest(req, requiredScope);
    if (!auth.ok) {
      res.writeHead(auth.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: auth.error }));
      return;
    }

    if (req.method === "POST" && path === "/api/v1/attachments") {
      await this.handleAttachmentUpload(req, res);
      return;
    }

    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    let result: unknown;
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
      result = { sessions: this.store.listChatSessions() };
    } else if (path === "/api/v1/deliveries") {
      result = { deliveries: this.store.listQueuedDeliveries(undefined, { includeDead: true }) };
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  }

  private async handleAttachmentUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const kind = req.headers["x-ownloom-attachment-kind"];
    if (kind !== "image" && kind !== "audio") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "x-ownloom-attachment-kind must be image or audio" }));
      return;
    }

    const mimeType = req.headers["content-type"]?.split(";")[0]?.trim() || "application/octet-stream";
    const fileNameHeader = req.headers["x-ownloom-filename"];
    const fileName = Array.isArray(fileNameHeader) ? fileNameHeader[0] : fileNameHeader;
    let data: Buffer;
    try {
      data = await readRequestBody(req, 25 * 1024 * 1024);
    } catch (err) {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      return;
    }
    if (data.length === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "attachment body must not be empty" }));
      return;
    }

    this.store.pruneAttachments(24 * 60 * 60 * 1000);
    const attachment = this.store.saveAttachment({ kind, mimeType, fileName, data });
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      id: attachment.id,
      kind: attachment.kind,
      mimeType: attachment.mimeType,
      fileName: attachment.fileName,
      sizeBytes: attachment.sizeBytes,
    }));
  }

  // ── WebSocket protocol/v1 ────────────────────────────────────────────────

  private handleConnection(ws: WebSocket): void {
    const connId = `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let client: ConnectedClient | null = null;
    let chatId: string | null = null;

    const sendJson = (frame: ResponseFrame | EventFrame): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
    };

    const close = (reason: string): void => {
      console.log(`client: closing ${connId} — ${reason}`);
      if (chatId) this.connections.delete(chatId);
      if (ws.readyState === WebSocket.OPEN) ws.close();
    };

    ws.on("close", () => {
      if (chatId) this.connections.delete(chatId);
      console.log(`client: client ${connId} disconnected`);
    });

    ws.on("error", (err) => close(`ws error: ${err.message}`));

    ws.on("message", (rawData) => {
      let frame: ClientFrame;
      try {
        frame = JSON.parse(rawData.toString()) as ClientFrame;
      } catch {
        close("invalid JSON");
        return;
      }

      if (!client) {
        if (frame.type !== "connect") {
          sendJson({
            type: "res",
            id: "connect",
            ok: false,
            error: { message: "First frame must be connect", code: "CONNECT_REQUIRED" },
          });
          close("non-connect first frame");
          return;
        }
        this.handleConnect(ws, connId, frame, sendJson, close, (newChatId, newClient) => {
          chatId = newChatId;
          client = newClient;
        });
        return;
      }

      if (frame.type === "connect") {
        sendJson({
          type: "res",
          id: "connect",
          ok: false,
          error: { message: "Already connected", code: "ALREADY_CONNECTED" },
        });
        return;
      }

      this.handleRequest(frame, client, sendJson);
    });
  }

  private handleConnect(
    ws: WebSocket,
    connId: string,
    frame: ConnectFrame,
    sendJson: (frame: ResponseFrame | EventFrame) => void,
    close: (reason: string) => void,
    onConnected: (chatId: string, client: ConnectedClient) => void,
  ): void {
    if (frame.protocol !== PROTOCOL_VERSION) {
      sendJson({
        type: "res",
        id: "connect",
        ok: false,
        error: { message: `Unsupported protocol: ${frame.protocol}`, code: "UNSUPPORTED_PROTOCOL" },
      });
      close("unsupported protocol");
      return;
    }

    const identity = this.resolveTokenIdentity(frame.auth.token);
    const hasClientIdentities = (this.config.clients?.length ?? 0) > 0;
    const tokenMatchesGlobalAuth = !!this.config.authToken && frame.auth.token === this.config.authToken;
    if ((this.config.authToken || hasClientIdentities) && !tokenMatchesGlobalAuth && !identity) {
      sendJson({
        type: "res",
        id: "connect",
        ok: false,
        error: { message: "Unauthorized", code: "UNAUTHORIZED" },
      });
      close("auth failed");
      return;
    }

    const chatId = `v1-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const client: ConnectedClient = {
      connId,
      ...(typeof frame.client?.id === "string" && frame.client.id.trim() ? { clientId: frame.client.id.trim() } : {}),
      identity,
      role: frame.role ?? "operator",
      scopes: identity?.scopes ?? frame.scopes ?? ["read", "write", "admin"],
      seq: 0,
      send: (f) => sendJson(f),
    };

    this.connections.set(chatId, { ws, client });
    onConnected(chatId, client);

    const helloOk: ConnectOkPayload = {
      type: "hello-ok",
      protocol: PROTOCOL_VERSION,
      server: { version: "1.0.0", connId },
      features: {
        methods: this.methodRegistry.listMethods(),
        events: this.methodRegistry.listEvents(),
      },
      auth: {
        role: client.role,
        scopes: client.scopes,
      },
      policy: {
        maxPayload: 25 * 1024 * 1024,
        tickIntervalMs: 15_000,
      },
    };

    sendJson({ type: "res", id: "connect", ok: true, payload: helloOk });
  }

  private handleRequest(frame: ClientFrame, client: ConnectedClient, sendJson: (frame: ResponseFrame | EventFrame) => void): void {
    if (frame.type !== "req") {
      sendJson({
        type: "res",
        id: "unknown",
        ok: false,
        error: { message: `Unsupported frame type: ${frame.type}`, code: "INVALID_FRAME" },
      });
      return;
    }

    const requiredScope = requiredScopeForMethod(frame.method);
    if (requiredScope && !client.scopes.includes(requiredScope)) {
      sendJson({
        type: "res",
        id: frame.id,
        ok: false,
        error: { message: `Method ${frame.method} requires ${requiredScope} scope`, code: "FORBIDDEN" },
      });
      return;
    }

    const ctx: MethodContext = {
      client,
      params: { ...frame.params, _method: frame.method },
      emit: (event, payload) => {
        client.seq += 1;
        sendJson({ type: "event", event, payload, seq: client.seq });
      },
    };

    void (async () => {
      const idempotencyKey = typeof frame.params["idempotencyKey"] === "string"
        ? frame.params["idempotencyKey"].trim()
        : "";
      const storeKey = idempotencyKey ? this.makeIdempotencyStoreKey(client, frame.method, idempotencyKey) : "";

      if (idempotencyKey.length > 200) {
        sendJson({
          type: "res",
          id: frame.id,
          ok: false,
          error: { message: "idempotencyKey must be at most 200 characters", code: "INVALID_REQUEST" },
        });
        return;
      }

      if (storeKey) {
        const begin = this.store.beginIdempotentRequest(storeKey, 7 * 24 * 60 * 60 * 1000);
        if (begin.status === "duplicate") {
          sendJson({
            type: "res",
            id: frame.id,
            ok: begin.result.ok,
            ...(begin.result.ok ? { payload: begin.result.payload } : { error: begin.result.error }),
          } as ResponseFrame);
          return;
        }
        if (begin.status === "pending") {
          sendJson({
            type: "res",
            id: frame.id,
            ok: false,
            error: { message: "Request with this idempotencyKey is already running", code: "REQUEST_PENDING" },
          });
          return;
        }
      }

      try {
        const result = await this.methodRegistry.dispatch(ctx);
        if (storeKey) this.store.finishIdempotentRequest(storeKey, result);
        sendJson({
          type: "res",
          id: frame.id,
          ok: result.ok,
          ...(result.ok ? { payload: result.payload } : { error: result.error }),
        } as ResponseFrame);
      } catch (err) {
        const result: MethodResult = {
          ok: false,
          error: { message: err instanceof Error ? err.message : String(err) },
        };
        if (storeKey) this.store.finishIdempotentRequest(storeKey, result);
        sendJson({
          type: "res",
          id: frame.id,
          ok: false,
          error: result.error,
        });
      }
    })();
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

    const attachmentRefs = Array.isArray(ctx.params["attachments"])
      ? (ctx.params["attachments"] as AttachmentRef[])
      : [];
    const attachments = this.resolveAttachmentRefs(attachmentRefs);

    const runId = randomUUID();
    const sessionKey = typeof ctx.params["sessionKey"] === "string" && ctx.params["sessionKey"].trim()
      ? ctx.params["sessionKey"].trim()
      : ctx.client.connId;
    const chatId = `client:${sessionKey}`;
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
      ...(attachments.length > 0 ? { attachments } : {}),
    };

    const onChunk = (chunk: string): void => {
      ctx.emit(EVENTS.AGENT, { runId, stream: "chunk", text: chunk });
    };

    try {
      const result = await this.router.handleMessage(inbound, onChunk);
      for (const ref of attachmentRefs) this.store.deleteAttachment(ref.id);
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

  private resolveAttachmentRefs(refs: AttachmentRef[]): InboundAttachment[] {
    const attachments: InboundAttachment[] = [];
    for (const ref of refs) {
      const stored = this.store.getAttachment(ref.id);
      if (!stored) throw new Error(`Unknown attachment id: ${ref.id}`);
      attachments.push({
        kind: stored.kind,
        path: stored.path,
        mimeType: stored.mimeType,
        ...(stored.fileName ? { fileName: stored.fileName } : {}),
      });
    }
    return attachments;
  }

  private resolveTokenIdentity(token?: string): Identity | null {
    if (!token || !this.identityResolver) return null;
    return this.identityResolver.resolve("token", token);
  }

  private authenticateRestRequest(req: IncomingMessage, requiredScope: "read" | "write" | "admin"):
    | { ok: true }
    | { ok: false; status: 401 | 403; error: string } {
    const authHeader = req.headers["authorization"];
    const header = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const hasClientIdentities = (this.config.clients?.length ?? 0) > 0;
    const authRequired = !!this.config.authToken || hasClientIdentities;
    if (!authRequired) return { ok: true };

    if (this.config.authToken && token === this.config.authToken) return { ok: true };

    const identity = this.resolveTokenIdentity(token);
    if (!identity) return { ok: false, status: 401, error: "Unauthorized" };
    if (!identity.scopes.includes(requiredScope)) return { ok: false, status: 403, error: "Forbidden" };
    return { ok: true };
  }

  private makeIdempotencyStoreKey(client: ConnectedClient, method: string, idempotencyKey: string): string {
    const owner = client.identity
      ? `identity:${client.identity.id}`
      : client.clientId
        ? `client:${client.clientId}`
        : `conn:${client.connId}`;
    return `${owner}:${method}:${idempotencyKey}`;
  }
}

function requiredScopeForMethod(method: string): "read" | "write" | "admin" | null {
  if (method === "health" || method === "status" || method === "commands.list" || method === "clients.list" || method === "sessions.list" || method === "sessions.get" || method === "deliveries.list") {
    return "read";
  }
  if (method === "agent" || method === "agent.wait") return "write";
  if (method === "sessions.reset" || method === "deliveries.retry" || method === "deliveries.delete") return "admin";
  return null;
}

function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;

    req.on("data", (chunk: Buffer) => {
      if (done) return;
      total += chunk.length;
      if (total > maxBytes) {
        done = true;
        chunks.length = 0;
        req.resume();
        reject(new Error(`request body exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (!done) resolve(Buffer.concat(chunks));
    });
    req.on("error", (err) => {
      if (!done) reject(err);
    });
  });
}
