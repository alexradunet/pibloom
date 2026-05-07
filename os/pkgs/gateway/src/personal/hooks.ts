import type { ConversationHooks } from "../core/hooks.js";
import type { Identity } from "../core/identity.js";
import type { InboundMessage } from "../core/types.js";
import { PersonalConversationCaptureService } from "./conversation-capture.js";

// ── OwnloomPersonalHooks ──────────────────────────────────────────────────────
// Concrete ConversationHooks implementation that wires personal services
// (journal capture, etc.) into the Router. Keeps personal concerns out of core.

export class OwnloomPersonalHooks implements ConversationHooks {
  private readonly capture: PersonalConversationCaptureService;

  constructor(capture?: PersonalConversationCaptureService) {
    this.capture = capture ?? new PersonalConversationCaptureService();
  }

  onUserMessage(msg: InboundMessage, text: string, _identity: Identity | null): void {
    try {
      this.capture.captureUserMessage(msg, text);
    } catch (err) {
      console.error("hooks: failed to capture user message:", err);
    }
  }

  onAssistantReply(msg: InboundMessage, text: string, _identity: Identity | null): void {
    try {
      this.capture.captureAssistantReply(msg, text);
    } catch (err) {
      console.error("hooks: failed to capture assistant reply:", err);
    }
  }

  onSessionReset(_chatId: string): void {
    // No-op for now. Future: log session resets to journal.
  }
}
