// ── Protocol v1 ──────────────────────────────────────────────────────────────
// Versioned client protocol for ownloom gateway.
// All clients (web, Flutter, WearOS, CLI-over-network) speak this protocol
// over WebSocket. Read-only queries also available over HTTP REST.

export const PROTOCOL_VERSION = 1;

// ── Roles & scopes ──────────────────────────────────────────────────────────

export type Role = "operator" | "node";

export type Scope =
  | "read"     // can query status, sessions, models
  | "write"    // can send messages, invoke agent
  | "admin";   // can reset sessions, run admin commands

// ── Frames ───────────────────────────────────────────────────────────────────

export type ClientFrame =
  | ConnectFrame
  | RequestFrame;

export type ServerFrame =
  | ResponseFrame
  | EventFrame;

/** First frame from client. Must be sent before any other frames. */
export type ConnectFrame = {
  type: "connect";
  protocol: number;
  role: Role;
  scopes: Scope[];
  auth: { token?: string };
  /** Client metadata for logging. */
  client?: { id?: string; version?: string; platform?: string };
};

/** RPC request. */
export type RequestFrame = {
  type: "req";
  id: string;
  method: string;
  params: Record<string, unknown>;
};

/** RPC response. */
export type ResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { message: string; code?: string };
};

/** Server-pushed event. */
export type EventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
};

// ── Connect response ────────────────────────────────────────────────────────

export type ConnectOkPayload = {
  type: "hello-ok";
  protocol: number;
  server: { version: string; connId: string };
  features: { methods: string[]; events: string[] };
  auth: { role: Role; scopes: Scope[] };
  policy: { maxPayload: number; tickIntervalMs: number };
};

// ── Methods ─────────────────────────────────────────────────────────────────

export const METHODS = {
  // Agent
  AGENT: "agent",
  AGENT_WAIT: "agent.wait",

  // Sessions
  SESSIONS_LIST: "sessions.list",
  SESSIONS_GET: "sessions.get",
  SESSIONS_RESET: "sessions.reset",

  // System
  HEALTH: "health",
  STATUS: "status",
  COMMANDS_LIST: "commands.list",
} as const;

export type MethodName = (typeof METHODS)[keyof typeof METHODS];

// ── Events ──────────────────────────────────────────────────────────────────

export const EVENTS = {
  AGENT: "agent",
  TICK: "tick",
  SHUTDOWN: "shutdown",
} as const;

// ── Agent method params & result ────────────────────────────────────────────

export type AgentParams = {
  message: string;
  sessionKey?: string;
  /** If true, deliver the reply through the transport (e.g. WhatsApp). */
  deliver?: boolean;
};

export type AgentAcceptedPayload = {
  runId: string;
  status: "accepted";
};

export type AgentDonePayload = {
  runId: string;
  status: "ok" | "error" | "timeout";
  summary?: string;
  error?: string;
};

// ── Agent event payloads ────────────────────────────────────────────────────

export type AgentChunkPayload = {
  runId: string;
  stream: "chunk";
  text: string;
};

export type AgentResultPayload = {
  runId: string;
  stream: "result";
  text: string;
};

// ── Sessions ─────────────────────────────────────────────────────────────────

export type SessionInfo = {
  chatId: string;
  senderId: string;
  sessionPath: string;
  createdAt: string;
  updatedAt: string;
};

// ── Health ───────────────────────────────────────────────────────────────────

export type HealthPayload = {
  ok: boolean;
  agent: string;
  transports: string[];
  uptimeMs: number;
};
