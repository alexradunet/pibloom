import { all, byId } from "./dom.js";
import { createTabController } from "./a11y.js";
import { createGatewayClient } from "./gateway-client.js";
import { createAppState, currentChatId, currentSessionKey, sessionTitle } from "./state.js";
import { getActiveTab, loadSettings, saveSettings, setActiveTab } from "./storage.js";
import { createChatController } from "./controllers/chat-controller.js";
import { createConfigController } from "./controllers/config-controller.js";
import { createLogController } from "./controllers/log-controller.js";
import { createOrganizerController } from "./controllers/organizer-controller.js";
import { createTerminalController } from "./controllers/terminal-controller.js";
import { renderClients } from "./components/organisms/clients-panel.js";
import { renderCommands } from "./components/organisms/commands-panel.js";
import { renderDeliveries } from "./components/organisms/deliveries-panel.js";
import { renderSessions } from "./components/organisms/sessions-panel.js";
import { setConnectionState, updateSendControls as renderSendControls } from "./components/organisms/settings-panel.js";
import { ensureTerminalLoaded } from "./components/organisms/terminal-panel.js";

export function startApp() {
  const state = createAppState();
  const els = collectElements();
  const log = createLogController(els.log);
  let chatController = null;
  let gatewayClient = null;

  function updateSendControls() {
    renderSendControls(els, {
      connected: Boolean(gatewayClient?.isConnected()) && els.connectionState.textContent === "connected",
      agentRunning: state.agentRunning,
    });
  }

  function setConnection(status, className = "", connected = status === "connected", connecting = status === "connecting") {
    setConnectionState(els, status, className, connected, connecting);
    updateSendControls();
  }

  function saveCurrentSettings() {
    chatController?.updateCurrentSession();
    if (!els.rememberSettings.checked) return;
    saveSettings({
      httpUrl: els.httpUrl.value,
      token: els.token.value,
      sessionKey: els.sessionKey.value,
      chatId: currentChatId(state, els.sessionKey.value),
      remember: true,
    });
  }

  async function refreshLists() {
    const [clients, sessions, deliveries, commands] = await Promise.all([
      gatewayClient.request("clients.list").catch((error) => ({ error: error.message, clients: [], current: null })),
      gatewayClient.request("sessions.list").catch((error) => ({ error: error.message, sessions: [] })),
      gatewayClient.request("deliveries.list").catch((error) => ({ error: error.message, deliveries: [] })),
      gatewayClient.request("commands.list").catch((error) => ({ error: error.message, commands: [] })),
    ]);
    renderClients(els.clients, clients);
    const admin = (clients.current?.scopes ?? []).includes("admin");
    renderSessions(els.sessions, sessions.sessions ?? [], {
      currentChatId: currentChatId(state, els.sessionKey.value),
      agentRunning: state.agentRunning,
      admin,
      sessionTitle,
    });
    renderDeliveries(els.deliveries, deliveries.deliveries ?? [], { admin });
    renderCommands(els.commands, commands.commands ?? []);
    log("lists refreshed");
  }

  function handleChangedEvent(event, payload) {
    log(`event:${event}`, payload);
    if (event === "clients.changed" || event === "sessions.changed" || event === "deliveries.changed") {
      refreshLists().catch((error) => log("auto-refresh failed", error.message));
    }
  }

  gatewayClient = createGatewayClient({
    getHttpUrl: () => els.httpUrl.value,
    getToken: () => els.token.value,
    onAgentEvent: (payload) => chatController?.handleAgentEvent(payload),
    onChangedEvent: handleChangedEvent,
    onConnectionChange: setConnection,
    log,
  });

  applyInitialSettings(els, state, log);
  if (!state.activeChatId) state.activeChatId = `client:${currentSessionKey(els.sessionKey.value)}`;

  chatController = createChatController({
    els,
    state,
    gatewayClient,
    log,
    saveCurrentSettings,
    refreshLists,
    updateSendControls,
  });
  chatController.updateCurrentSession();

  const configController = createConfigController({
    els,
    gatewayClient,
    log,
    addSystemMessage: chatController.addSystemMessage,
    saveCurrentSettings,
    refreshLists,
    setConnectionError: () => setConnection("error", "error", false, false),
  });
  createTerminalController({ els, gatewayClient });
  const organizerController = createOrganizerController({ els, log });
  setupThreadRail(els);

  function ensureRadicaleLoaded() {
    if (state.radicaleLoaded || !els.radicaleFrame) return;
    els.radicaleFrame.src = els.radicaleFrame.dataset.src;
    state.radicaleLoaded = true;
  }
  els.radicaleDetails?.addEventListener("toggle", () => {
    if (els.radicaleDetails.open) ensureRadicaleLoaded();
  });

  const requestedTab = new URLSearchParams(window.location.search).get("tab");
  createTabController({
    buttons: els.tabButtons,
    panels: els.tabPanels,
    initialTab: requestedTab || getActiveTab("chat"),
    onPersist: setActiveTab,
    onSelect: (tab) => {
      if (tab === "terminal") ensureTerminalLoaded(state, els.terminalFrame);
      if (tab === "organizer") organizerController.refresh();
    },
  });

  cleanupOldServiceWorkers(log);

  setConnection("disconnected");
  if (els.rememberSettings.checked && els.token.value.trim()) {
    configController.connect();
  }
}

function collectElements() {
  return {
    httpUrl: byId("httpUrl"),
    token: byId("token"),
    sessionKey: byId("sessionKey"),
    connectionState: byId("connectionState"),
    rememberSettings: byId("rememberSettings"),
    connectButton: byId("connectButton"),
    pairButton: byId("pairButton"),
    disconnectButton: byId("disconnectButton"),
    healthButton: byId("healthButton"),
    refreshButton: byId("refreshButton"),
    currentSession: byId("currentSession"),
    workbenchShell: document.querySelector("[data-workbench-shell]"),
    threadRail: byId("threadRail"),
    threadRailToggle: byId("threadRailToggle"),
    threadRailClose: byId("threadRailClose"),
    newChatButton: byId("newChatButton"),
    messageInput: byId("messageInput"),
    attachmentInput: byId("attachmentInput"),
    attachments: byId("attachments"),
    sendButton: byId("sendButton"),
    clearButton: byId("clearButton"),
    clearSettingsButton: byId("clearSettingsButton"),
    messages: byId("messages"),
    clients: byId("clients"),
    sessions: byId("sessions"),
    deliveries: byId("deliveries"),
    commands: byId("commands"),
    log: byId("log"),
    tabButtons: all("[data-tab-target]"),
    tabPanels: all("[data-tab-panel]"),
    terminalFrame: byId("terminalFrame"),
    radicaleDetails: byId("radicaleDetails"),
    radicaleFrame: byId("radicaleFrame"),
    copyTerminalTokenButton: byId("copyTerminalTokenButton"),
    terminalTokenStatus: byId("terminalTokenStatus"),
    plannerStatus: byId("plannerStatus"),
    plannerRefreshButton: byId("plannerRefreshButton"),
    plannerForm: byId("plannerForm"),
    plannerKind: byId("plannerKind"),
    plannerTitle: byId("plannerTitle"),
    plannerWhenText: byId("plannerWhenText"),
    plannerWhen: byId("plannerWhen"),
    plannerEndLabel: byId("plannerEndLabel"),
    plannerEnd: byId("plannerEnd"),
    plannerPriorityLabel: byId("plannerPriorityLabel"),
    plannerPriority: byId("plannerPriority"),
    plannerRepeat: byId("plannerRepeat"),
    plannerDescription: byId("plannerDescription"),
    plannerCategories: byId("plannerCategories"),
    plannerOverdueList: byId("plannerOverdueList"),
    plannerTodayList: byId("plannerTodayList"),
    plannerUpcomingList: byId("plannerUpcomingList"),
    plannerUndatedList: byId("plannerUndatedList"),
  };
}

function setupThreadRail(els) {
  const shell = els.workbenchShell;
  if (!shell) return;

  function setOpen(open) {
    if (open) els.threadRail.hidden = false;
    shell.classList.toggle("thread-rail-open", open);
    els.threadRailToggle.setAttribute("aria-expanded", open ? "true" : "false");
    els.threadRail.setAttribute("aria-hidden", open ? "false" : "true");
    els.threadRail.inert = !open;
    if (open) {
      els.threadRailClose.focus();
    } else {
      const active = document.activeElement;
      if (active instanceof HTMLElement && els.threadRail.contains(active)) els.threadRailToggle.focus();
      els.threadRail.hidden = true;
    }
  }

  els.threadRailToggle.addEventListener("click", () => {
    setOpen(!shell.classList.contains("thread-rail-open"));
  });
  els.threadRailClose.addEventListener("click", () => setOpen(false));
  els.sessions.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.hasAttribute("data-session-switch-chat")) setOpen(false);
  });
  shell.addEventListener("click", (event) => {
    if (event.target === shell) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && shell.classList.contains("thread-rail-open")) setOpen(false);
  });
}

function cleanupOldServiceWorkers(log) {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .then((results) => {
        if (results.some(Boolean)) log("old service workers unregistered");
      })
      .catch((error) => log("service worker cleanup failed", error.message));
  }

  if (!("caches" in window)) return;
  caches.keys()
    .then((names) => Promise.all(names
      .filter((name) => name.startsWith("ownloom-gateway-web-"))
      .map((name) => caches.delete(name))))
    .then((results) => {
      if (results.some(Boolean)) log("old pwa caches cleared");
    })
    .catch((error) => log("pwa cache cleanup failed", error.message));
}

function applyInitialSettings(els, state, log) {
  if (window.location.protocol === "http:" || window.location.protocol === "https:") {
    els.httpUrl.value = window.location.origin;
  }

  const saved = loadSettings(log);
  if (typeof saved.httpUrl === "string") els.httpUrl.value = saved.httpUrl;
  if (typeof saved.token === "string") els.token.value = saved.token;
  if (typeof saved.sessionKey === "string") els.sessionKey.value = saved.sessionKey;
  if (typeof saved.chatId === "string") state.activeChatId = saved.chatId;
  if (typeof saved.remember === "boolean") els.rememberSettings.checked = saved.remember;
}
