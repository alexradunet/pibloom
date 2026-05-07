import { readFileSync } from "node:fs";
import { loadConfig } from "./config.js";
import type { AgentClient } from "./core/agent-client.js";
import { WhisperCliAudioTranscriber } from "./core/audio-transcriber.js";
import { DeliveryService } from "./core/delivery.js";
import { Router, type ChannelConfig } from "./core/router.js";
import { Store } from "./core/store.js";
import { PiClient } from "./core/pi-client.js";
import { noopHooks } from "./core/hooks.js";
import { CommandRegistry } from "./core/commands.js";
import { registerCoreCommands } from "./core/register-core-commands.js";
import { SimpleIdentityResolver, type IdentityEntry } from "./core/identity.js";
import { OwnloomPersonalHooks } from "./personal/hooks.js";
import { registerPersonalCommands } from "./personal/commands.js";
import { ReminderDeliveryWorker } from "./personal/reminder-delivery.js";
import { WhatsAppTransport } from "./transports/whatsapp/transport.js";
import { ClientTransport } from "./transport/client-transport.js";
import type { GatewayTransport } from "./transports/types.js";

// ── WhatsApp system prompt addendum ───────────────────────────────────────────
const WHATSAPP_SYSTEM_PROMPT_ADDENDUM = [
  "This prompt came from a trusted WhatsApp chat.",
  "Treat WhatsApp as a full-featured transport into Pi, equivalent to the TUI — all tools and extensions are available.",
  "Keep replies concise and mobile-friendly; avoid large code blocks or tables unless explicitly asked.",
  "Use domain=personal for personal life/wiki work; use domain=technical for ownloom/system work.",
  "Before executing privileged, destructive, or irreversible actions (rebuild, apply, reboot, push, delete), ask the user to confirm explicitly in the chat.",
].join(" ");

const WHATSAPP_RESET_HINT =
  "For anything that should survive future resets, ask naturally — for example: remember that …";

// ── Identity configuration ──────────────────────────────────────────────────
// Build identity entries from WhatsApp trusted/admin numbers.
// Each trusted number gets an identity with admin scope (single-user gateway).
// Future: load from a dedicated identity config section.

function buildIdentityEntries(config: ReturnType<typeof loadConfig>): IdentityEntry[] {
  const entries: IdentityEntry[] = [];
  const whatsapp = config.transports.whatsapp;
  if (whatsapp?.enabled) {
    const numbers = [...new Set([...whatsapp.trustedNumbers, ...whatsapp.adminNumbers])];
    if (numbers.length > 0) {
      entries.push({
        id: "alex",
        displayName: "Alex",
        scopes: ["read", "write", "admin"],
        keys: numbers.map((n) => `whatsapp:${n}`),
      });
    }
  }
  return entries;
}

// ── Startup ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Resolve Synthetic API key from credential file before any SDK usage.
  // The pi-synthetic extension reads process.env.SYNTHETIC_API_KEY; it falls
  // back to the literal string "SYNTHETIC_API_KEY" if the env var is unset,
  // causing 401 errors. PI_SYNTHETIC_API_KEY_FILE is set by the systemd service
  // via LoadCredential.
  if (!process.env.SYNTHETIC_API_KEY) {
    const keyFile = process.env.PI_SYNTHETIC_API_KEY_FILE;
    if (keyFile) {
      try {
        const key = readFileSync(keyFile, "utf-8").trim();
        if (key) process.env.SYNTHETIC_API_KEY = key;
      } catch (err) {
        console.warn(`gateway: could not read PI_SYNTHETIC_API_KEY_FILE (${keyFile}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const configPath = process.argv[2] ?? "./ownloom-gateway.yml";
  const config = loadConfig(configPath);

  const store = new Store(config.gateway.statePath);
  const transports: GatewayTransport[] = [];
  const channelConfigs: Record<string, ChannelConfig> = {};

  if (config.transports.whatsapp?.enabled) {
    transports.push(new WhatsAppTransport(config.transports.whatsapp));
    channelConfigs.whatsapp = {
      model: config.transports.whatsapp.model,
      allowedModels: config.transports.whatsapp.allowedModels,
      systemPromptAddendum: WHATSAPP_SYSTEM_PROMPT_ADDENDUM,
      env: {},
      resetHint: WHATSAPP_RESET_HINT,
    };
  }

  // ── Identity resolver ────────────────────────────────────────────────────
  const identityEntries = buildIdentityEntries(config);
  const identityResolver = new SimpleIdentityResolver(identityEntries);
  if (identityEntries.length > 0) {
    console.log(`identity: resolved ${identityEntries.length} identity entry/entries`);
  }

  // ── Conversation hooks ──────────────────────────────────────────────────
  const hooks = new OwnloomPersonalHooks();

  // ── Command registry ────────────────────────────────────────────────────
  const commands = new CommandRegistry();
  registerCoreCommands(commands, store, channelConfigs, { onSessionReset: (chatId) => hooks.onSessionReset?.(chatId) });
  registerPersonalCommands(commands);
  console.log(`commands: registered ${commands.listNames().length} commands: ${commands.listNames().join(", ")}`);

  // Client transport: versioned protocol v1 + legacy web UI compat + REST API.
  // Replaces the old WebSocketTransport. SetRouter must be called after
  // the Router is constructed (below).
  let clientTransport: ClientTransport | undefined;
  if (config.transports.websocket?.enabled) {
    clientTransport = new ClientTransport(
      config.transports.websocket,
      store,
      commands,
      identityResolver,
      "pi",
      ["whatsapp", "client"],
    );
    transports.push(clientTransport);
    channelConfigs.client = {
      // No model override for web/chat apps; let the user choose in Pi settings.
    };
  }

  if (transports.length === 0) {
    throw new Error("No transports enabled in ownloom-gateway config. Enable at least one transport.");
  }

  const agent: AgentClient = new PiClient({
    sessionDir: config.gateway.sessionDir,
    cwd: config.pi.cwd,
    agentDir: config.pi.agentDir,
    timeoutMs: config.pi.timeoutMs,
  });

  const audioTranscriber = config.audioTranscription?.enabled
    ? new WhisperCliAudioTranscriber(config.audioTranscription)
    : undefined;

  const router = new Router(
    store,
    agent,
    config.gateway.maxReplyChars,
    config.gateway.maxReplyChunks,
    channelConfigs,
    audioTranscriber,
    process.env.OWNLOOM_LOCAL_PROVIDER_MODEL || undefined,
    hooks,
    commands,
    identityResolver,
  );

  // Wire the client transport to the router (circular dep: router needs
  // clientTransport as a transport, clientTransport needs router for agent calls).
  clientTransport?.setRouter(router);

  const delivery = new DeliveryService(transports);

  await agent.healthCheck();
  console.log(`${agent.name} agent health check OK`);

  await audioTranscriber?.healthCheck();
  if (audioTranscriber) console.log("audio transcription health check OK");

  for (const transport of transports) {
    await transport.healthCheck();
    console.log(`${transport.name} transport health check OK`);
  }

  if (config.transports.whatsapp?.enabled) {
    const recipientIds = config.transports.whatsapp.trustedNumbers.map((n) => `whatsapp:${n}`);
    new ReminderDeliveryWorker(store, delivery, recipientIds).start();
    console.log("WhatsApp reminder delivery worker started");
  }

  console.log(`ownloom gateway started with agent=${agent.name} transports: ${transports.map((t) => t.name).join(", ")}`);

  await Promise.all(
    transports.map((transport) =>
      transport.startReceiving(async (msg, onChunk) => {
        console.log(`router: handling ${msg.channel} message ${msg.messageId} from ${msg.senderId}`);

        const result = await router.handleMessage(msg, onChunk);
        console.log(
          `router: result for ${msg.messageId} -> replies=${result.replies.length} markProcessed=${result.markProcessed}`,
        );

        if (result.markProcessed) {
          // Send all replies before marking processed so a delivery failure
          // won't suppress a retry.
          for (const [index, reply] of result.replies.entries()) {
            console.log(`router: sending reply ${index + 1}/${result.replies.length} for ${msg.messageId}`);
            await transport.sendText(msg, reply);
            console.log(`router: sent reply ${index + 1}/${result.replies.length} for ${msg.messageId}`);
          }

          store.markProcessed(msg.messageId, msg.chatId, msg.senderId, msg.timestamp);
          console.log(`router: marked processed ${msg.messageId}`);
        } else {
          // No processing mark means we still deliver whatever the router returned.
          for (const [index, reply] of result.replies.entries()) {
            console.log(`router: sending reply ${index + 1}/${result.replies.length} for ${msg.messageId}`);
            await transport.sendText(msg, reply);
            console.log(`router: sent reply ${index + 1}/${result.replies.length} for ${msg.messageId}`);
          }
        }
      }),
    ),
  );
}

main().catch((err) => {
  console.error("ownloom-gateway fatal:", err);
  process.exit(1);
});
