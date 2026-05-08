import {
  PROTOCOL_VERSION,
  type ConnectFrame,
  type ResponseFrame,
  type EventFrame,
  type ConnectOkPayload,
  type HealthPayload,
  type SessionInfo,
  METHODS,
  EVENTS,
  type AgentParams,
  type AgentAcceptedPayload,
  type AgentDonePayload,
} from "./types.js";
import type { Store } from "../core/store.js";
import type { CommandRegistry } from "../core/commands.js";
import type { IdentityResolver, Identity, Scope } from "../core/identity.js";

// ── ConnectedClient ──────────────────────────────────────────────────────────
// State tracked per connected WS client.

export type ConnectedClient = {
  connId: string;
  /** Stable client-supplied id from the connect frame, if provided. */
  clientId?: string;
  identity: Identity | null;
  role: "operator" | "node";
  scopes: Scope[];
  seq: number;
  send: (frame: ResponseFrame | EventFrame) => void;
};

// ── MethodContext ────────────────────────────────────────────────────────────
// Passed to each method handler.

export type MethodContext = {
  client: ConnectedClient;
  params: Record<string, unknown>;
  /** Send an event frame to this client. */
  emit: (event: string, payload?: unknown) => void;
};

// ── MethodHandler ────────────────────────────────────────────────────────────

export type MethodResult = { ok: true; payload?: unknown } | { ok: false; error: { message: string; code?: string } };

export type MethodHandler = (ctx: MethodContext) => Promise<MethodResult> | MethodResult;

// ── MethodRegistry ──────────────────────────────────────────────────────────

export class MethodRegistry {
  private readonly handlers = new Map<string, MethodHandler>();

  register(method: string, handler: MethodHandler): void {
    this.handlers.set(method, handler);
  }

  has(method: string): boolean {
    return this.handlers.has(method);
  }

  async dispatch(ctx: MethodContext): Promise<MethodResult> {
    const handler = this.handlers.get(ctx.params["_method"] as string ?? "");
    if (!handler) {
      return { ok: false, error: { message: `Unknown method: ${ctx.params["_method"]}`, code: "UNKNOWN_METHOD" } };
    }
    return handler(ctx);
  }

  listMethods(): string[] {
    return [...this.handlers.keys()].sort();
  }

  listEvents(): string[] {
    return [EVENTS.AGENT, EVENTS.TICK, EVENTS.SHUTDOWN];
  }
}

// ── Register all v1 methods ──────────────────────────────────────────────────

export function registerV1Methods(
  registry: MethodRegistry,
  deps: {
    store: Store;
    commands: CommandRegistry;
    identityResolver?: IdentityResolver;
    agentName: string;
    transportNames: string[];
    startedAtMs: number;
    handleAgent: (ctx: MethodContext) => Promise<MethodResult>;
    onDeliveryRetry?: () => Promise<unknown> | unknown;
    clients?: Array<{ id: string; displayName: string; scopes: Scope[] }>;
  },
): void {
  // health
  registry.register(METHODS.HEALTH, (ctx) => {
    const payload: HealthPayload = {
      ok: true,
      agent: deps.agentName,
      transports: deps.transportNames,
      uptimeMs: Date.now() - deps.startedAtMs,
    };
    return { ok: true, payload };
  });

  // status
  registry.register(METHODS.STATUS, (ctx) => {
    return {
      ok: true,
      payload: {
        identity: ctx.client.identity
          ? { id: ctx.client.identity.id, displayName: ctx.client.identity.displayName, scopes: ctx.client.identity.scopes }
          : null,
        agent: deps.agentName,
        transports: deps.transportNames,
      },
    };
  });

  // commands.list
  registry.register(METHODS.COMMANDS_LIST, () => {
    return { ok: true, payload: { commands: deps.commands.listNames() } };
  });

  // sessions.list
  registry.register(METHODS.SESSIONS_LIST, () => {
    return { ok: true, payload: { sessions: deps.store.listChatSessions() } };
  });

  // sessions.get
  registry.register(METHODS.SESSIONS_GET, (ctx) => {
    const chatId = ctx.params["chatId"] as string | undefined;
    if (!chatId) return { ok: false, error: { message: "chatId is required", code: "INVALID_REQUEST" } };
    const session = deps.store.getChatSession(chatId);
    return { ok: true, payload: { session } };
  });

  // sessions.reset
  registry.register(METHODS.SESSIONS_RESET, (ctx) => {
    const chatId = ctx.params["chatId"] as string | undefined;
    if (!chatId) return { ok: false, error: { message: "chatId is required", code: "INVALID_REQUEST" } };
    deps.store.resetChatSession(chatId);
    return { ok: true, payload: { chatId } };
  });

  // deliveries.list
  registry.register(METHODS.DELIVERIES_LIST, () => {
    return { ok: true, payload: { deliveries: deps.store.listQueuedDeliveries(undefined, { includeDead: true }) } };
  });

  // deliveries.retry
  registry.register(METHODS.DELIVERIES_RETRY, async (ctx) => {
    const id = ctx.params["id"] as string | undefined;
    if (!id) return { ok: false, error: { message: "id is required", code: "INVALID_REQUEST" } };
    const delivery = deps.store.retryQueuedDelivery(id);
    if (!delivery) return { ok: false, error: { message: `Unknown or delivered delivery: ${id}`, code: "NOT_FOUND" } };
    const drain = await deps.onDeliveryRetry?.();
    return { ok: true, payload: { delivery, drain } };
  });

  // deliveries.delete
  registry.register(METHODS.DELIVERIES_DELETE, (ctx) => {
    const id = ctx.params["id"] as string | undefined;
    if (!id) return { ok: false, error: { message: "id is required", code: "INVALID_REQUEST" } };
    const deleted = deps.store.deleteQueuedDelivery(id);
    if (!deleted) return { ok: false, error: { message: `Unknown delivery: ${id}`, code: "NOT_FOUND" } };
    return { ok: true, payload: { id } };
  });

  // clients.list
  registry.register(METHODS.CLIENTS_LIST, (ctx) => {
    return {
      ok: true,
      payload: {
        current: {
          connId: ctx.client.connId,
          clientId: ctx.client.clientId ?? null,
          role: ctx.client.role,
          scopes: ctx.client.scopes,
          identity: ctx.client.identity
            ? { id: ctx.client.identity.id, displayName: ctx.client.identity.displayName, scopes: ctx.client.identity.scopes }
            : null,
        },
        clients: deps.clients ?? [],
      },
    };
  });

  // agent methods — delegate to the provided handler (which calls Router).
  // Today both methods wait for the local Pi run to complete and emit agent events;
  // keep both names so clients can opt into explicit wait semantics.
  registry.register(METHODS.AGENT, deps.handleAgent);
  registry.register(METHODS.AGENT_WAIT, deps.handleAgent);
}
