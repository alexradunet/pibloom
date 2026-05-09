import { ACTIVE_TAB_KEY, BROWSER_CLIENT_ID_KEY, SETTINGS_KEY } from "./constants.js";

export function loadSettings(log = () => {}) {
  const raw = safeGet(SETTINGS_KEY);
  if (!raw) return {};
  try {
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return {};
    return {
      httpUrl: typeof saved.httpUrl === "string" ? saved.httpUrl : undefined,
      token: typeof saved.token === "string" ? saved.token : undefined,
      sessionKey: typeof saved.sessionKey === "string" ? saved.sessionKey : undefined,
      chatId: typeof saved.chatId === "string" ? saved.chatId : undefined,
      remember: typeof saved.remember === "boolean" ? saved.remember : undefined,
    };
  } catch (error) {
    safeRemove(SETTINGS_KEY);
    log("failed to load saved settings", error.message);
    return {};
  }
}

export function saveSettings(settings) {
  if (!settings.remember) return;
  safeSet(SETTINGS_KEY, JSON.stringify({
    httpUrl: String(settings.httpUrl ?? "").trim(),
    token: String(settings.token ?? "").trim(),
    sessionKey: String(settings.sessionKey ?? "").trim(),
    chatId: String(settings.chatId ?? "").trim(),
    remember: true,
  }));
}

export function forgetSettings() {
  safeRemove(SETTINGS_KEY);
}

export function getActiveTab(defaultTab = "chat") {
  return safeGet(ACTIVE_TAB_KEY) || defaultTab;
}

export function setActiveTab(tab) {
  safeSet(ACTIVE_TAB_KEY, tab);
}

export function getBrowserClientId() {
  const existing = safeGet(BROWSER_CLIENT_ID_KEY);
  if (existing) return existing;
  const id = makeId("browser");
  safeSet(BROWSER_CLIENT_ID_KEY, id);
  return id;
}

export function browserDisplayName() {
  const platform = navigator.platform ? ` on ${navigator.platform}` : "";
  return `Ownloom web${platform}`;
}

function makeId(prefix) {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (typeof randomUuid === "function") return `${prefix}-${randomUuid.call(globalThis.crypto)}`;
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Local storage can be disabled; the app still works for this session.
  }
}

function safeRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore unavailable local storage.
  }
}
