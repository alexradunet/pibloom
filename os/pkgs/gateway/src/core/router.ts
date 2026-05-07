import { rm } from "node:fs/promises";
import type { InboundAttachment, InboundMessage, RouterResult } from "./types.js";
import { Store } from "./store.js";
import type { AgentClient } from "./agent-client.js";
import { chunkText, normalizeReply } from "./formatter.js";
import { KeyedSerialQueue } from "./queue.js";
import type { AudioTranscriber } from "./audio-transcriber.js";
import type { ConversationHooks } from "./hooks.js";
import type { CommandRegistry, CommandContext } from "./commands.js";
import type { IdentityResolver, Identity } from "./identity.js";
import { isAdmin } from "./identity.js";

export type ChannelConfig = {
  /** Pi model selector, e.g. `synthetic/hf:moonshotai/Kimi-K2.6`. */
  model?: string;
  /** Allowlist of model ids the channel may switch to. */
  allowedModels?: string[];
  /** Appended to the system prompt for every message on this channel. */
  systemPromptAddendum?: string;
  /** Extra environment variables set during agent.prompt() for this channel. */
  env?: NodeJS.ProcessEnv;
  /** Extra text appended to the /reset acknowledgement on this channel. */
  resetHint?: string;
};

export class Router {
  private readonly queue = new KeyedSerialQueue();

  constructor(
    private readonly store: Store,
    private readonly agent: AgentClient,
    private readonly maxReplyChars: number,
    private readonly maxReplyChunks: number,
    private readonly channelConfigs: Record<string, ChannelConfig> = {},
    private readonly audioTranscriber?: AudioTranscriber,
    private readonly fallbackModel?: string,
    private readonly hooks: ConversationHooks = {},
    private readonly commands?: CommandRegistry,
    private readonly identityResolver?: IdentityResolver,
  ) {}

  handleMessage(msg: InboundMessage, onChunk?: (chunk: string) => void): Promise<RouterResult> {
    return this.queue.run(msg.chatId, () => this.handleMessageInner(msg, onChunk));
  }

  private async handleMessageInner(
    msg: InboundMessage,
    onChunk?: (chunk: string) => void,
  ): Promise<RouterResult> {
    try {
      // Resolve identity for this message.
      const identity = this.identityResolver?.resolve(msg.channel, msg.senderId) ?? null;

      if (msg.access.selfSenderIds.includes(msg.senderId)) return { replies: [], markProcessed: false };

      // Access control: identity-based (preferred) or fallback to legacy access policy.
      if (identity) {
        // Identity-based: must have at least "read" scope.
        // (Future: finer-grained checks per command go here.)
      } else {
        // Legacy path: per-transport allowlist.
        if (!msg.access.allowedSenderIds.includes(msg.senderId)) return { replies: [], markProcessed: false };
        if (msg.access.directMessagesOnly && msg.isGroup) return { replies: [], markProcessed: false };
      }

      if (this.store.hasProcessedMessage(msg.messageId)) return { replies: [], markProcessed: false };

      const audioAttachments = (msg.attachments ?? []).filter((a) => a.kind === "audio");
      const imageAttachments = (msg.attachments ?? []).filter((a) => a.kind === "image");
      const transcribedAudio =
        audioAttachments.length > 0 ? await this.transcribeAudioAttachments(audioAttachments) : null;
      if (transcribedAudio?.error) {
        return {
          replies: chunkText(normalizeReply(transcribedAudio.error), this.maxReplyChars, this.maxReplyChunks),
          markProcessed: true,
        };
      }

      const text = this.buildEffectiveText(msg.text.trim(), transcribedAudio?.text ?? null).trim();
      if (!text && imageAttachments.length === 0) return { replies: [], markProcessed: true };

      // Try command registry first (if configured).
      const commandText = this.normalizeCommandText(text);
      if (this.commands) {
        const resolved = this.commands.resolve(commandText.startsWith("/") ? commandText : `/${commandText}`);
        if (resolved) {
          const { def, args } = resolved;
          if (def.adminOnly && identity && !isAdmin(identity)) {
            return {
              replies: chunkText("That command is admin-only.", this.maxReplyChars, this.maxReplyChunks),
              markProcessed: true,
            };
          }
          const cmdResult = def.handler({ msg, identity, args });
          if (cmdResult !== null) {
            return {
              replies: chunkText(normalizeReply(cmdResult), this.maxReplyChars, this.maxReplyChunks),
              markProcessed: true,
            };
          }
        }
      } else {
        // Fallback: legacy built-in command handling (preserves behavior if no registry).
        const builtin = this.handleBuiltin(msg, commandText);
        if (builtin !== null) {
          return {
            replies: chunkText(normalizeReply(builtin), this.maxReplyChars, this.maxReplyChunks),
            markProcessed: true,
          };
        }
      }

      this.hooks.onUserMessage?.(msg, text, identity);

      try {
        const channelCfg = this.channelConfigs[msg.channel];
        const existing = this.store.getChatSession(msg.chatId);

        // Privacy routing: messages prefixed with "/private" (or "private" after
        // normalizeCommandText strips the slash) must never leave this host.
        const PRIVATE_PREFIX = "private ";
        const isPrivate = commandText.toLowerCase().startsWith(PRIVATE_PREFIX);
        if (isPrivate && !this.fallbackModel) {
          return {
            replies: chunkText(
              "Privacy routing is not available: no local model is configured.",
              this.maxReplyChars,
              this.maxReplyChunks,
            ),
            markProcessed: true,
          };
        }
        const effectiveText = isPrivate ? text.slice(text.toLowerCase().indexOf(PRIVATE_PREFIX) + PRIVATE_PREFIX.length).trim() : text;

        const effectiveModel = isPrivate
          ? this.fallbackModel!
          : channelCfg?.model
            ? toSyntheticModelArg(channelCfg.model)
            : undefined;

        const reply = await this.agent.prompt(effectiveText, existing?.sessionPath ?? null, {
          systemPromptAddendum: channelCfg?.systemPromptAddendum,
          model: effectiveModel,
          env: channelCfg?.env,
          onChunk,
          attachments: imageAttachments.map((a) => ({
            kind: a.kind,
            path: a.path,
            mimeType: a.mimeType,
            fileName: a.fileName,
          })),
        });
        this.store.upsertChatSession(msg.chatId, msg.senderId, reply.sessionPath);
        const normalizedReply = normalizeReply(reply.text);
        this.hooks.onAssistantReply?.(msg, normalizedReply, identity);

        // When streaming, chunks were already delivered via onChunk — no text to re-send.
        if (onChunk) {
          return { replies: [], markProcessed: true };
        }
        return {
          replies: chunkText(normalizedReply, this.maxReplyChars, this.maxReplyChunks),
          markProcessed: true,
        };
      } catch (err) {
        console.error("router.handleMessageInner failed:", err);

        // Fallback: if no chunks were streamed yet and a local fallback model is
        // configured, retry once with that model.
        if (!onChunk && this.fallbackModel) {
          console.warn(
            `router: primary provider failed, retrying with fallback model ${this.fallbackModel}`,
          );
          try {
            const channelCfg = this.channelConfigs[msg.channel];
            const fallbackReply = await this.agent.prompt(text, null, {
              systemPromptAddendum: channelCfg?.systemPromptAddendum,
              model: this.fallbackModel,
              env: channelCfg?.env,
            });
            const normalizedFallback = normalizeReply(fallbackReply.text);
            this.hooks.onAssistantReply?.(msg, normalizedFallback, identity);
            return {
              replies: chunkText(
                `[⚡ local] ${normalizedFallback}`,
                this.maxReplyChars,
                this.maxReplyChunks,
              ),
              markProcessed: true,
            };
          } catch (fallbackErr) {
            console.error("router: fallback provider also failed:", fallbackErr);
          }
        }

        return {
          replies: chunkText(
            "I hit an internal error. Please try again in a moment.",
            this.maxReplyChars,
            this.maxReplyChunks,
          ),
          markProcessed: true,
        };
      }
    } finally {
      await this.cleanupInboundAttachments(msg);
    }
  }

  private async transcribeAudioAttachments(
    attachments: InboundAttachment[],
  ): Promise<{ text: string | null; error?: string }> {
    if (!this.audioTranscriber) {
      return {
        text: null,
        error: "I received an audio message, but speech-to-text is not configured yet.",
      };
    }

    const transcripts: string[] = [];
    for (const [index, attachment] of attachments.entries()) {
      try {
        const transcript = (await this.audioTranscriber.transcribe(attachment)).trim();
        if (transcript) transcripts.push(transcript);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`router: failed to transcribe audio attachment ${index + 1}/${attachments.length}:`, err);
        return {
          text: null,
          error: `I couldn't transcribe that audio message: ${message}`,
        };
      }
    }

    return { text: transcripts.join("\n\n").trim() || null };
  }

  private buildEffectiveText(originalText: string, transcript: string | null): string {
    if (!transcript) return originalText;
    if (!originalText || originalText === "Please transcribe the attached audio.") return transcript;
    return `${originalText}\n\nTranscribed audio:\n${transcript}`;
  }

  private normalizeCommandText(text: string): string {
    const trimmed = text.trim();
    if (!trimmed.startsWith("/")) return trimmed;
    return trimmed.slice(1).trimStart();
  }

  /** Legacy built-in command handling — used when no CommandRegistry is provided. */
  private handleBuiltin(msg: InboundMessage, text: string): string | null {
    const lowered = text.toLowerCase();
    const isAdminSender = msg.access.adminSenderIds.includes(msg.senderId);

    if (lowered === "help") {
      return [
        `You can chat with Pi here through ${msg.channel}.`,
        "",
        "Commands: use plain text or slash form, e.g. help or /help.",
        "  /help              — show this message",
        "  /reset             — start a fresh conversation",
        "  /status            — show session info (admin)",
        "  /wiki <query>      — search the wiki",
        "  /wiki show <title> — preview a wiki page",
        "",
        "Everything else is passed straight to Pi SDK with the normal tool and extension registry.",
      ].join("\n");
    }

    if (lowered === "reset") {
      this.store.resetChatSession(msg.chatId);
      this.hooks.onSessionReset?.(msg.chatId);
      const hint = this.channelConfigs[msg.channel]?.resetHint;
      const base = `Started a fresh conversation for this ${msg.channel} chat.`;
      return hint ? `${base} ${hint}` : base;
    }

    if (lowered === "status") {
      if (!isAdminSender) return "That command is admin-only.";
      const existing = this.store.getChatSession(msg.chatId);
      return [
        `channel: ${msg.channel}`,
        `sender:  ${msg.senderId}`,
        `admin:   yes`,
        `chat_id: ${msg.chatId}`,
        `session: ${existing?.sessionPath ?? "none"}`,
      ].join("\n");
    }

    if (lowered === "wiki") {
      return "Usage: wiki <query>  |  wiki show <title>";
    }

    if (lowered.startsWith("wiki ")) {
      // Lazy import to keep wiki concerns out of the hot path.
      const { wikiSearch, wikiShowPage } = require("../personal/wiki.js") as typeof import("../personal/wiki.js");
      const rest = text.slice(5).trim();
      if (!rest) return "Usage: wiki <query>  |  wiki show <title>";
      if (rest.toLowerCase().startsWith("show ")) return wikiShowPage(rest.slice(5).trim());
      return wikiSearch(rest);
    }

    return null;
  }

  private async cleanupInboundAttachments(msg: InboundMessage): Promise<void> {
    for (const attachment of msg.attachments ?? []) {
      await rm(attachment.path, { force: true }).catch((err) => {
        console.error(`router: failed to remove inbound attachment ${attachment.path}:`, err);
      });
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toSyntheticModelArg(model: string): string {
  const trimmed = model.trim();
  const id = trimmed.startsWith("synthetic/") ? trimmed.slice("synthetic/".length) : trimmed;
  return `synthetic/${id}`;
}
