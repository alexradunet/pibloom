const $ = (id) => document.getElementById(id);

const SETTINGS_KEY = "ownloom.gatewayWeb.settings.v1";

const state = {
  ws: null,
  nextId: 1,
  pending: new Map(),
  stagedAttachments: [],
  currentRun: null,
  agentRunning: false,
};

const els = {
  httpUrl: $("httpUrl"),
  token: $("token"),
  sessionKey: $("sessionKey"),
  connectionState: $("connectionState"),
  rememberSettings: $("rememberSettings"),
  connectButton: $("connectButton"),
  disconnectButton: $("disconnectButton"),
  healthButton: $("healthButton"),
  refreshButton: $("refreshButton"),
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
};

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

function setConnection(status, className = "") {
  els.connectionState.textContent = status;
  els.connectionState.className = `pill ${className}`.trim();
  const connected = status === "connected";
  els.connectButton.disabled = connected;
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
    scopes: ["read", "write"],
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
  state.agentRunning = true;
  updateSendButton();
  els.messageInput.value = "";
  addMessage("user", message || "[attachments]");
  state.currentRun = addMessage("agent", "");
  try {
    const payload = await request("agent.wait", {
      message: message || "Please inspect the attachment(s).",
      sessionKey: els.sessionKey.value.trim() || "web-main",
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
  renderList(els.sessions, sessions.sessions ?? [], (s) => {
    const chatId = s.chatId ?? s.id ?? "session";
    return `<strong>${escapeHtml(chatId)}</strong><br><small>${escapeHtml(s.updatedAt ?? s.createdAt ?? "")}</small><div class="row item-actions"><button data-session-reset="${escapeHtml(chatId)}">Reset</button></div>`;
  });
  renderList(els.deliveries, deliveries.deliveries ?? [], (d) => {
    const status = d.deadAt ? "dead" : d.nextAttemptAt ? "waiting" : "queued";
    const recipient = d.recipientId ?? d.target ?? d.recipient ?? "";
    return `<strong>${escapeHtml(status)}</strong> ${escapeHtml(d.id ?? "")}<br><small>${escapeHtml(recipient)}</small><div class="row item-actions"><button data-delivery-retry="${escapeHtml(d.id ?? "")}">Retry</button><button data-delivery-delete="${escapeHtml(d.id ?? "")}">Delete</button></div>`;
  });
  renderList(els.commands, commands.commands ?? [], (c) => {
    const name = typeof c === "string" ? c : c.name;
    const description = typeof c === "string" ? "" : c.description;
    return `<strong>/${escapeHtml(name ?? "command")}</strong><br><small>${escapeHtml(description ?? "")}</small>`;
  });
  log("lists refreshed");
}

function renderClients(payload) {
  const rows = [];
  const currentScopes = payload.current?.scopes ?? [];
  const admin = currentScopes.includes("admin");
  if (payload.current) rows.push({ ...payload.current, current: true });
  for (const client of payload.clients ?? []) rows.push(client);
  renderList(els.clients, rows, (client) => {
    const current = client.current ? "Current connection" : client.displayName;
    const name = client.identity?.displayName ?? client.displayName ?? client.clientId ?? client.id ?? client.connId ?? "client";
    const scopes = (client.identity?.scopes ?? client.scopes ?? []).join(", ");
    const status = client.revokedAt
      ? "revoked"
      : client.rotatedAt
        ? `runtime token ${client.tokenPreview ?? ""}`
        : client.managedBy === "runtime"
          ? "runtime token"
          : "config-managed";
    const rotateButton = admin && client.canRotate ? `<button data-client-rotate="${escapeHtml(client.id)}">Rotate token</button>` : "";
    const revokeButton = admin && client.canRevoke ? `<button data-client-revoke="${escapeHtml(client.id)}">Revoke</button>` : "";
    const actions = !client.current && (rotateButton || revokeButton) ? `<div class="row item-actions">${rotateButton}${revokeButton}</div>` : "";
    return `<strong>${escapeHtml(name)}</strong><br><small>${escapeHtml(current ?? status)} · ${escapeHtml(scopes)}</small>${actions}`;
  });
}

async function health() {
  log("health", await request("health"));
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

els.connectButton.addEventListener("click", () => connect().catch((error) => {
  setConnection("error", "error");
  log("connect failed", error.message);
}));
els.disconnectButton.addEventListener("click", disconnect);
els.clearSettingsButton.addEventListener("click", clearSettings);
els.httpUrl.addEventListener("change", saveSettings);
els.token.addEventListener("change", saveSettings);
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
  const chatId = target.getAttribute("data-session-reset");
  if (!chatId) return;
  if (!confirmAction(`Reset session ${chatId}? This clears its stored conversation history.`)) return;
  request("sessions.reset", { chatId }).then(refreshLists).catch((error) => log("session reset failed", error.message));
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

setConnection("disconnected");
