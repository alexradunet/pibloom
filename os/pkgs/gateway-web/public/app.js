const $ = (id) => document.getElementById(id);

const SETTINGS_KEY = "ownloom.gatewayWeb.settings.v1";
const ACTIVE_TAB_KEY = "ownloom.gatewayWeb.activeTab.v1";
const BROWSER_CLIENT_ID_KEY = "ownloom.gatewayWeb.browserClientId.v1";

const state = {
  ws: null,
  nextId: 1,
  pending: new Map(),
  stagedAttachments: [],
  currentRun: null,
  agentRunning: false,
  terminalLoaded: false,
};

const els = {
  httpUrl: $("httpUrl"),
  token: $("token"),
  sessionKey: $("sessionKey"),
  connectionState: $("connectionState"),
  rememberSettings: $("rememberSettings"),
  connectButton: $("connectButton"),
  pairButton: $("pairButton"),
  disconnectButton: $("disconnectButton"),
  healthButton: $("healthButton"),
  refreshButton: $("refreshButton"),
  currentSession: $("currentSession"),
  newChatButton: $("newChatButton"),
  messageInput: $("messageInput"),
  attachmentInput: $("attachmentInput"),
  attachments: $("attachments"),
  sendButton: $("sendButton"),
  clearButton: $("clearButton"),
  clearSettingsButton: $("clearSettingsButton"),
  messages: $("messages"),
  clients: $("clients"),
  sessions: $("sessions"),
  deliveries: $("deliveries"),
  commands: $("commands"),
  log: $("log"),
  tabButtons: [...document.querySelectorAll("[data-tab-target]")],
  tabPanels: [...document.querySelectorAll("[data-tab-panel]")],
  terminalFrame: $("terminalFrame"),
};

function selectTab(tab) {
  const knownTabs = new Set(els.tabPanels.map((panel) => panel.dataset.tabPanel));
  const nextTab = knownTabs.has(tab) ? tab : "chat";
  for (const button of els.tabButtons) {
    button.classList.toggle("active", button.dataset.tabTarget === nextTab);
  }
  for (const panel of els.tabPanels) {
    const active = panel.dataset.tabPanel === nextTab;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  }
  localStorage.setItem(ACTIVE_TAB_KEY, nextTab);
  if (nextTab === "terminal" && !state.terminalLoaded) {
    els.terminalFrame.src = els.terminalFrame.dataset.src;
    state.terminalLoaded = true;
  }
}

function httpUrl() {
  return els.httpUrl.value.trim().replace(/\/$/, "");
}

function wsUrl() {
  return httpUrl().replace(/^http/, "ws");
}

function authHeaders() {
  const token = els.token.value.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function loadSettings() {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    if (typeof saved.httpUrl === "string") els.httpUrl.value = saved.httpUrl;
    if (typeof saved.token === "string") els.token.value = saved.token;
    if (typeof saved.sessionKey === "string") els.sessionKey.value = saved.sessionKey;
    if (typeof saved.remember === "boolean") els.rememberSettings.checked = saved.remember;
  } catch (error) {
    log("failed to load saved settings", error.message);
  }
}

function saveSettings() {
  updateCurrentSession();
  if (!els.rememberSettings.checked) return;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    httpUrl: els.httpUrl.value.trim(),
    token: els.token.value.trim(),
    sessionKey: els.sessionKey.value.trim(),
    remember: true,
  }));
}

function clearSettings() {
  localStorage.removeItem(SETTINGS_KEY);
  els.token.value = "";
  log("forgot local settings");
}

function browserClientId() {
  const existing = localStorage.getItem(BROWSER_CLIENT_ID_KEY);
  if (existing) return existing;
  const id = `browser-${crypto.randomUUID()}`;
  localStorage.setItem(BROWSER_CLIENT_ID_KEY, id);
  return id;
}

function browserDisplayName() {
  const platform = navigator.platform ? ` on ${navigator.platform}` : "";
  return `Ownloom web${platform}`;
}

function currentSessionKey() {
  return els.sessionKey.value.trim() || "web-main";
}

function currentChatId() {
  return `client:${currentSessionKey()}`;
}

function updateCurrentSession() {
  els.currentSession.textContent = `Session: ${currentSessionKey()}`;
}

function clearMessagesWithNotice(message) {
  els.messages.replaceChildren();
  state.currentRun = null;
  addMessage("system", message);
}

function makeNewSessionKey() {
  const stamp = new Date().toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return `web-${stamp}-${crypto.randomUUID().slice(0, 8)}`;
}

function switchSessionKey(sessionKey, reason = "Switched session") {
  if (state.agentRunning) {
    addMessage("system", "Wait for the current answer before switching sessions.");
    log("session switch blocked while agent is running", { sessionKey });
    return;
  }
  els.sessionKey.value = sessionKey;
  saveSettings();
  clearMessagesWithNotice(`${reason}: ${sessionKey}`);
  refreshLists().catch((error) => log("refresh failed", error.message));
}

function setConnection(status, className = "") {
  els.connectionState.textContent = status;
  els.connectionState.className = `pill ${className}`.trim();
  const connected = status === "connected";
  els.connectButton.disabled = connected;
  els.pairButton.disabled = connected || status === "connecting";
  els.disconnectButton.disabled = !connected;
  els.healthButton.disabled = !connected;
  els.refreshButton.disabled = !connected;
  updateSendButton();
}

function isConnected() {
  return state.ws?.readyState === WebSocket.OPEN && els.connectionState.textContent === "connected";
}

function updateSendButton() {
  els.sendButton.disabled = !isConnected() || state.agentRunning;
  els.sendButton.textContent = state.agentRunning ? "Waiting…" : "Send";
  els.newChatButton.disabled = state.agentRunning;
  els.sessionKey.disabled = state.agentRunning;
}

function log(message, data) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}${data === undefined ? "" : ` ${JSON.stringify(data)}`}`;
  els.log.textContent = `${line}\n${els.log.textContent}`.slice(0, 12000);
}

function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = `message ${role}`;
  div.textContent = text;
  els.messages.append(div);
  els.messages.scrollTop = els.messages.scrollHeight;
  return div;
}

function renderList(target, items, renderItem) {
  target.replaceChildren();
  if (!items.length) {
    target.className = "list empty";
    target.textContent = "None.";
    return;
  }
  target.className = "list";
  for (const item of items) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = renderItem(item);
    target.append(div);
  }
}

function request(method, params = {}) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("not connected"));
  }
  const id = `${method}-${state.nextId++}`;
  state.ws.send(JSON.stringify({ type: "req", id, method, params }));
  return new Promise((resolve, reject) => {
    state.pending.set(id, { resolve, reject });
    setTimeout(() => {
      const pending = state.pending.get(id);
      if (!pending) return;
      state.pending.delete(id);
      pending.reject(new Error(`${method} timed out`));
    }, 120000);
  });
}

function handleFrame(frame) {
  if (frame.type === "event") {
    if (frame.event === "agent") handleAgentEvent(frame.payload ?? {});
    else handleChangedEvent(frame.event, frame.payload);
    return;
  }
  if (frame.type !== "res") return;
  const pending = state.pending.get(frame.id);
  if (!pending) return;
  state.pending.delete(frame.id);
  if (frame.ok) pending.resolve(frame.payload);
  else {
    const error = new Error(frame.error?.message ?? "request failed");
    error.code = frame.error?.code ?? "ERROR";
    pending.reject(error);
  }
}

function handleChangedEvent(event, payload) {
  log(`event:${event}`, payload);
  if (event === "clients.changed" || event === "sessions.changed" || event === "deliveries.changed") {
    refreshLists().catch((error) => log("auto-refresh failed", error.message));
  }
}

function handleAgentEvent(payload) {
  log("agent event", payload);
  if (payload.stream === "start" || payload.status === "started") {
    state.currentRun = addMessage("agent", "");
    return;
  }
  if (payload.stream === "chunk" && typeof payload.text === "string") {
    if (!state.currentRun) state.currentRun = addMessage("agent", "");
    state.currentRun.textContent += payload.text;
    els.messages.scrollTop = els.messages.scrollHeight;
    return;
  }
  if (payload.stream === "result" && typeof payload.text === "string") {
    if (!state.currentRun) state.currentRun = addMessage("agent", "");
    if (!state.currentRun.textContent) state.currentRun.textContent = payload.text;
    else if (state.currentRun.textContent !== payload.text) state.currentRun.textContent += `\n${payload.text}`;
    els.messages.scrollTop = els.messages.scrollHeight;
    state.currentRun = null;
    return;
  }
  if (payload.stream === "done" || payload.status === "done") state.currentRun = null;
}

async function pairBrowser() {
  if (isConnected()) return;
  els.pairButton.disabled = true;
  try {
    const params = new URLSearchParams({
      clientId: browserClientId(),
      displayName: browserDisplayName(),
    });
    const response = await fetch(`${httpUrl()}/api/v1/pair?${params.toString()}`, { method: "POST" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `pairing failed: ${response.status}`);
    els.token.value = body.token;
    if (!els.rememberSettings.checked) els.rememberSettings.checked = true;
    saveSettings();
    log("paired browser", { id: body.client?.id, scopes: body.client?.scopes });
    addMessage("system", `Paired this browser as ${body.client?.id ?? "runtime client"}.`);
    await connect();
  } finally {
    updatePairButton();
  }
}

function updatePairButton() {
  els.pairButton.disabled = isConnected() || els.connectionState.textContent === "connecting";
}

async function connect() {
  disconnect();
  setConnection("connecting");
  const ws = new WebSocket(wsUrl());
  state.ws = ws;
  ws.addEventListener("message", (event) => handleFrame(JSON.parse(event.data)));
  ws.addEventListener("close", () => {
    if (state.ws === ws) {
      state.ws = null;
      setConnection("disconnected");
      log("socket closed");
    }
  });
  ws.addEventListener("error", () => {
    setConnection("error", "error");
    log("socket error");
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("socket failed to open")), { once: true });
  });

  const helloPromise = new Promise((resolve, reject) => {
    state.pending.set("connect", { resolve, reject });
  });
  ws.send(JSON.stringify({
    type: "connect",
    protocol: 1,
    role: "operator",
    scopes: ["read", "write", "admin"],
    auth: els.token.value.trim() ? { token: els.token.value.trim() } : {},
    client: { id: "web-main", version: "0.1.0", platform: "web" },
  }));
  const hello = await helloPromise;
  saveSettings();
  setConnection("connected", "connected");
  log("connected", hello);
  addMessage("system", "Connected to Ownloom Gateway.");
  await refreshLists();
}

function disconnect() {
  if (state.ws) state.ws.close();
  state.ws = null;
  for (const pending of state.pending.values()) pending.reject(new Error("disconnected"));
  state.pending.clear();
  setConnection("disconnected");
}

async function uploadAttachments(files) {
  const uploaded = [];
  for (const file of files) {
    const kind = file.type.startsWith("audio/") ? "audio" : "image";
    const response = await fetch(`${httpUrl()}/api/v1/attachments`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": file.type || "application/octet-stream",
        "x-ownloom-attachment-kind": kind,
        "x-ownloom-filename": file.name,
      },
      body: file,
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`upload failed: ${response.status} ${body.error?.message ?? JSON.stringify(body)}`);
    uploaded.push(body);
    log("uploaded attachment", body);
  }
  state.stagedAttachments.push(...uploaded);
  renderAttachments();
}

function renderAttachments() {
  els.attachments.replaceChildren();
  for (const attachment of state.stagedAttachments) {
    const span = document.createElement("span");
    span.className = "chip";
    span.textContent = `${attachment.kind}: ${attachment.fileName ?? attachment.id}`;
    els.attachments.append(span);
  }
}

async function sendMessage() {
  if (state.agentRunning) return;
  const message = els.messageInput.value.trim();
  if (!message && state.stagedAttachments.length === 0) return;
  const attachments = [...state.stagedAttachments];
  const sessionKey = currentSessionKey();
  state.agentRunning = true;
  updateSendButton();
  els.messageInput.value = "";
  addMessage("user", message || "[attachments]");
  state.currentRun = addMessage("agent", "");
  try {
    const payload = await request("agent.wait", {
      message: message || "Please inspect the attachment(s).",
      sessionKey,
      idempotencyKey: `web-${crypto.randomUUID()}`,
      ...(attachments.length ? { attachments } : {}),
    });
    state.stagedAttachments = state.stagedAttachments.filter((staged) => !attachments.some((sent) => sent.id === staged.id));
    renderAttachments();
    log("agent.wait response", payload);
  } finally {
    state.agentRunning = false;
    updateSendButton();
  }
}

async function refreshLists() {
  const [clients, sessions, deliveries, commands] = await Promise.all([
    request("clients.list").catch((error) => ({ error: error.message, clients: [], current: null })),
    request("sessions.list").catch((error) => ({ error: error.message, sessions: [] })),
    request("deliveries.list").catch((error) => ({ error: error.message, deliveries: [] })),
    request("commands.list").catch((error) => ({ error: error.message, commands: [] })),
  ]);
  renderClients(clients);
  const admin = (clients.current?.scopes ?? []).includes("admin");
  renderList(els.sessions, sessions.sessions ?? [], (s) => {
    const chatId = s.chatId ?? s.id ?? "session";
    const sessionKey = clientSessionKey(chatId);
    const current = chatId === currentChatId();
    const disabled = state.agentRunning ? " disabled" : "";
    const switchButton = sessionKey && !current ? `<button data-session-switch="${escapeHtml(sessionKey)}"${disabled}>Switch</button>` : "";
    const resetButton = admin ? `<button data-session-reset="${escapeHtml(chatId)}"${disabled}>Reset</button>` : "";
    const actions = switchButton || resetButton ? `<div class="row item-actions">${switchButton}${resetButton}</div>` : "";
    const badge = current ? " · current" : "";
    return `<strong>${escapeHtml(sessionTitle(chatId))}</strong><br><small>${escapeHtml(chatId)}${escapeHtml(badge)} · ${escapeHtml(s.updatedAt ?? s.createdAt ?? "")}</small>${actions}`;
  });
  renderList(els.deliveries, deliveries.deliveries ?? [], (d) => {
    const status = d.deadAt ? "dead" : d.nextAttemptAt ? "waiting" : "queued";
    const recipient = d.recipientId ?? d.target ?? d.recipient ?? "";
    const actions = admin ? `<div class="row item-actions"><button data-delivery-retry="${escapeHtml(d.id ?? "")}">Retry</button><button data-delivery-delete="${escapeHtml(d.id ?? "")}">Delete</button></div>` : "";
    return `<strong>${escapeHtml(status)}</strong> ${escapeHtml(d.id ?? "")}<br><small>${escapeHtml(recipient)}</small>${actions}`;
  });
  renderList(els.commands, commands.commands ?? [], (c) => {
    const name = typeof c === "string" ? c : c.name;
    const description = typeof c === "string" ? "" : c.description;
    return `<strong>/${escapeHtml(name ?? "command")}</strong><br><small>${escapeHtml(description ?? "")}</small>`;
  });
  log("lists refreshed");
}

function renderClients(payload) {
  const rows = (payload.clients ?? []).map((client) => ({ ...client }));
  const currentScopes = payload.current?.scopes ?? [];
  const admin = currentScopes.includes("admin");
  const currentIdentityId = payload.current?.identity?.id ?? null;
  const currentClientId = payload.current?.clientId ?? null;
  let markedCurrent = false;

  for (const row of rows) {
    if ((currentIdentityId && row.id === currentIdentityId) || (!currentIdentityId && currentClientId && row.id === currentClientId)) {
      row.current = true;
      markedCurrent = true;
      break;
    }
  }

  if (payload.current && !markedCurrent) {
    rows.unshift({
      id: currentIdentityId ?? currentClientId ?? payload.current.connId,
      displayName: payload.current.identity?.displayName ?? currentClientId ?? "Current connection",
      scopes: currentScopes,
      managedBy: "connection",
      current: true,
      connId: payload.current.connId,
    });
  }

  renderList(els.clients, rows, (client) => {
    const name = client.identity?.displayName ?? client.displayName ?? client.clientId ?? client.id ?? client.connId ?? "client";
    const scopes = (client.identity?.scopes ?? client.scopes ?? []).join(", ");
    const status = clientStatus(client);
    const rotateButton = admin && !client.current && client.canRotate ? `<button data-client-rotate="${escapeHtml(client.id)}">Rotate token</button>` : "";
    const revokeButton = admin && !client.current && client.canRevoke ? `<button data-client-revoke="${escapeHtml(client.id)}">Revoke</button>` : "";
    const actions = rotateButton || revokeButton ? `<div class="row item-actions">${rotateButton}${revokeButton}</div>` : "";
    return `<strong>${escapeHtml(name)}</strong><br><small>${escapeHtml(status)} · ${escapeHtml(scopes)}</small>${actions}`;
  });
}

async function health() {
  log("health", await request("health"));
}

function clientStatus(client) {
  const parts = [];
  if (client.current) parts.push("Current");
  if (client.revokedAt) parts.push("Revoked");
  else if (client.managedBy === "runtime") parts.push("Paired browser");
  else if (client.managedBy === "config") parts.push("Config-managed");
  else parts.push("Connection");
  if (client.tokenPreview && !client.revokedAt) parts.push(client.tokenPreview);
  return parts.join(" · ");
}

function sessionTitle(chatId) {
  const value = String(chatId);
  if (value.startsWith("client:")) return `Web chat: ${value.slice("client:".length)}`;
  if (value.startsWith("whatsapp:")) return "WhatsApp chat";
  return value;
}

function clientSessionKey(chatId) {
  const value = String(chatId);
  return value.startsWith("client:") ? value.slice("client:".length) : null;
}

function confirmAction(message) {
  return window.confirm(message);
}

function handleSendError(error) {
  if (state.currentRun && !state.currentRun.textContent) state.currentRun.remove();
  state.currentRun = null;
  const code = error?.code;
  const message = code === "AGENT_BUSY"
    ? "Agent is already working on this session. Wait for the current answer, then retry."
    : `Send failed: ${error.message}`;
  addMessage("system", message);
  log("send failed", { code: code ?? "ERROR", message: error.message });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[char]));
}

for (const button of els.tabButtons) {
  button.addEventListener("click", () => selectTab(button.dataset.tabTarget));
}

els.connectButton.addEventListener("click", () => connect().catch((error) => {
  setConnection("error", "error");
  log("connect failed", error.message);
}));
els.pairButton.addEventListener("click", () => pairBrowser().catch((error) => {
  setConnection("error", "error");
  addMessage("system", `Pairing failed: ${error.message}`);
  log("pairing failed", error.message);
}));
els.disconnectButton.addEventListener("click", disconnect);
els.clearSettingsButton.addEventListener("click", clearSettings);
els.httpUrl.addEventListener("change", saveSettings);
els.token.addEventListener("change", saveSettings);
els.sessionKey.addEventListener("input", updateCurrentSession);
els.sessionKey.addEventListener("change", saveSettings);
els.rememberSettings.addEventListener("change", () => {
  if (els.rememberSettings.checked) saveSettings();
  else localStorage.removeItem(SETTINGS_KEY);
});
els.healthButton.addEventListener("click", () => health().catch((error) => log("health failed", error.message)));
els.refreshButton.addEventListener("click", () => refreshLists().catch((error) => log("refresh failed", error.message)));
els.clients.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const rotateId = target.getAttribute("data-client-rotate");
  const revokeId = target.getAttribute("data-client-revoke");
  if (rotateId) {
    if (!confirmAction(`Rotate token for ${rotateId}? The old runtime token will stop working.`)) return;
    request("clients.rotateToken", { id: rotateId }).then((payload) => {
      log("client token rotated", { id: rotateId, token: payload.token });
      addMessage("system", `New token for ${rotateId}: ${payload.token}\nCopy it now; it will not be shown again.`);
      return refreshLists();
    }).catch((error) => log("client token rotate failed", error.message));
  } else if (revokeId) {
    if (!confirmAction(`Revoke client ${revokeId}? It will be disconnected and unable to reconnect.`)) return;
    request("clients.revoke", { id: revokeId }).then(refreshLists).catch((error) => log("client revoke failed", error.message));
  }
});
els.sessions.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const switchTo = target.getAttribute("data-session-switch");
  const chatId = target.getAttribute("data-session-reset");
  if (switchTo) {
    switchSessionKey(switchTo);
    return;
  }
  if (!chatId) return;
  if (!confirmAction(`Reset session ${chatId}? This clears its stored conversation history.`)) return;
  request("sessions.reset", { chatId }).then(() => {
    if (chatId === currentChatId()) clearMessagesWithNotice(`Reset current session: ${currentSessionKey()}`);
    return refreshLists();
  }).catch((error) => log("session reset failed", error.message));
});
els.deliveries.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const retryId = target.getAttribute("data-delivery-retry");
  const deleteId = target.getAttribute("data-delivery-delete");
  if (retryId) {
    request("deliveries.retry", { id: retryId }).then(refreshLists).catch((error) => log("delivery retry failed", error.message));
  } else if (deleteId) {
    if (!confirmAction(`Delete delivery ${deleteId}? This removes it from the retry queue.`)) return;
    request("deliveries.delete", { id: deleteId }).then(refreshLists).catch((error) => log("delivery delete failed", error.message));
  }
});
els.sendButton.addEventListener("click", () => sendMessage().catch(handleSendError));
els.newChatButton.addEventListener("click", () => switchSessionKey(makeNewSessionKey(), "Started new chat"));
els.clearButton.addEventListener("click", () => els.messages.replaceChildren());
els.attachmentInput.addEventListener("change", () => {
  uploadAttachments([...els.attachmentInput.files]).catch((error) => log("upload failed", error.message));
  els.attachmentInput.value = "";
});
els.messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) sendMessage().catch(handleSendError);
});

if (window.location.protocol === "http:" || window.location.protocol === "https:") {
  els.httpUrl.value = window.location.origin;
}
loadSettings();
updateCurrentSession();
selectTab(localStorage.getItem(ACTIVE_TAB_KEY) ?? "chat");

setConnection("disconnected");
if (els.rememberSettings.checked && els.token.value.trim()) {
  connect().catch((error) => {
    setConnection("error", "error");
    log("auto-connect failed", error.message);
  });
}
