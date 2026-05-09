import { DEFAULT_SESSION_KEY } from "./constants.js";

export function createAppState() {
  return {
    stagedAttachments: [],
    currentRun: null,
    agentRunning: false,
    activeChatId: null,
    terminalLoaded: false,
    radicaleLoaded: false,
  };
}

export function currentSessionKey(sessionKeyValue) {
  return String(sessionKeyValue ?? "").trim() || DEFAULT_SESSION_KEY;
}

export function currentChatId(state, sessionKeyValue) {
  return state.activeChatId || `client:${currentSessionKey(sessionKeyValue)}`;
}

export function clientSessionKey(chatId) {
  const value = String(chatId ?? "");
  return value.startsWith("client:") ? value.slice("client:".length) : null;
}

export function sessionTitle(chatId) {
  const value = String(chatId ?? "");
  if (value.startsWith("client:")) return `Web chat: ${value.slice("client:".length)}`;
  if (value.startsWith("whatsapp:")) return `WhatsApp chat: ${value.slice("whatsapp:".length)}`;
  if (value.startsWith("whatsapp-group:")) return `WhatsApp group: ${value.slice("whatsapp-group:".length)}`;
  return value || "conversation";
}

export function makeNewSessionKey() {
  const stamp = new Date().toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return `web-${stamp}-${crypto.randomUUID().slice(0, 8)}`;
}
