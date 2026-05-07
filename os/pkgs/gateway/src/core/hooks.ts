import type { InboundMessage } from "./types.js";
import type { Identity } from "./identity.js";

// ── ConversationHooks ────────────────────────────────────────────────────────
// Interface for side-effects that fire during a conversation turn.
// The Router calls these; concrete implementations do the actual work.
// This decouples the Router from wiki, journal, capture, and reminder logic.

export interface ConversationHooks {
  /** Called after the router accepts a user message and before agent invocation. */
  onUserMessage?(msg: InboundMessage, text: string, identity: Identity | null): void;

  /** Called after the agent produces a reply. */
  onAssistantReply?(msg: InboundMessage, text: string, identity: Identity | null): void;

  /** Called when a session is reset (e.g. /reset command). */
  onSessionReset?(chatId: string): void;
}

// ── No-op default ────────────────────────────────────────────────────────────

export const noopHooks: ConversationHooks = {};
