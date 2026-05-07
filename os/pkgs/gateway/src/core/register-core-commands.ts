import type { CommandRegistry } from "./commands.js";
import type { Store } from "./store.js";
import type { ChannelConfig } from "./router.js";

// ── Register core commands ───────────────────────────────────────────────────
// These are always available regardless of personal features.

export function registerCoreCommands(
  registry: CommandRegistry,
  store: Store,
  channelConfigs: Record<string, ChannelConfig>,
  hooks?: { onSessionReset?(chatId: string): void },
): void {
  registry.register({
    name: "help",
    aliases: ["?"],
    helpText: "show available commands",
    handler(ctx) {
      return registry.helpText(ctx.msg.channel);
    },
  });

  registry.register({
    name: "reset",
    helpText: "start a fresh conversation",
    handler(ctx) {
      store.resetChatSession(ctx.msg.chatId);
      hooks?.onSessionReset?.(ctx.msg.chatId);
      const hint = channelConfigs[ctx.msg.channel]?.resetHint;
      const base = `Started a fresh conversation for this ${ctx.msg.channel} chat.`;
      return hint ? `${base} ${hint}` : base;
    },
  });

  registry.register({
    name: "status",
    adminOnly: true,
    helpText: "show session info",
    handler(ctx) {
      const existing = store.getChatSession(ctx.msg.chatId);
      return [
        `channel: ${ctx.msg.channel}`,
        `sender:  ${ctx.msg.senderId}`,
        `admin:   ${ctx.identity ? "yes" : "unknown"}`,
        `chat_id: ${ctx.msg.chatId}`,
        `session: ${existing?.sessionPath ?? "none"}`,
      ].join("\n");
    },
  });
}
