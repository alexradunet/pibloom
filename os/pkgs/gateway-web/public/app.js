const $ = (id) => document.getElementById(id);

const state = {
  ws: null,
  nextId: 1,
  pending: new Map(),
  stagedAttachments: [],
  currentRun: null,
};

const els = {
  httpUrl: $("httpUrl"),
  token: $("token"),
  sessionKey: $("sessionKey"),
  connectionState: $("connectionState"),
  connectButton: $("connectButton"),
  disconnectButton: $("disconnectButton"),
  healthButton: $("healthButton"),
  refreshButton: $("refreshButton"),
  messageInput: $("messageInput"),
  attachmentInput: $("attachmentInput"),
  attachments: $("attachments"),
  sendButton: $("sendButton"),
  clearButton: $("clearButton"),
  messages: $("messages"),
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

function setConnection(status, className = "") {
  els.connectionState.textContent = status;
  els.connectionState.className = `pill ${className}`.trim();
  const connected = status === "connected";
  els.connectButton.disabled = connected;
  els.disconnectButton.disabled = !connected;
  els.healthButton.disabled = !connected;
  els.refreshButton.disabled = !connected;
  els.sendButton.disabled = !connected;
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
    else log(`event:${frame.event}`, frame.payload);
    return;
  }
  if (frame.type !== "res") return;
  const pending = state.pending.get(frame.id);
  if (!pending) return;
  state.pending.delete(frame.id);
  if (frame.ok) pending.resolve(frame.payload);
  else pending.reject(new Error(`${frame.error?.code ?? "ERROR"}: ${frame.error?.message ?? "request failed"}`));
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
  const message = els.messageInput.value.trim();
  if (!message && state.stagedAttachments.length === 0) return;
  const attachments = state.stagedAttachments.splice(0);
  renderAttachments();
  els.messageInput.value = "";
  addMessage("user", message || "[attachments]");
  state.currentRun = addMessage("agent", "");
  const payload = await request("agent.wait", {
    message: message || "Please inspect the attachment(s).",
    sessionKey: els.sessionKey.value.trim() || "web-main",
    idempotencyKey: `web-${crypto.randomUUID()}`,
    ...(attachments.length ? { attachments } : {}),
  });
  log("agent.wait response", payload);
}

async function refreshLists() {
  const [sessions, deliveries, commands] = await Promise.all([
    request("sessions.list").catch((error) => ({ error: error.message, sessions: [] })),
    request("deliveries.list").catch((error) => ({ error: error.message, deliveries: [] })),
    request("commands.list").catch((error) => ({ error: error.message, commands: [] })),
  ]);
  renderList(els.sessions, sessions.sessions ?? [], (s) => `<strong>${escapeHtml(s.chatId ?? s.id ?? "session")}</strong><br><small>${escapeHtml(s.updatedAt ?? s.createdAt ?? "")}</small>`);
  renderList(els.deliveries, deliveries.deliveries ?? [], (d) => `<strong>${escapeHtml(d.status ?? "queued")}</strong> ${escapeHtml(d.id ?? "")}<br><small>${escapeHtml(d.target ?? d.recipient ?? "")}</small>`);
  renderList(els.commands, commands.commands ?? [], (c) => `<strong>/${escapeHtml(c.name ?? "command")}</strong><br><small>${escapeHtml(c.description ?? "")}</small>`);
  log("lists refreshed");
}

async function health() {
  log("health", await request("health"));
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
els.healthButton.addEventListener("click", () => health().catch((error) => log("health failed", error.message)));
els.refreshButton.addEventListener("click", () => refreshLists().catch((error) => log("refresh failed", error.message)));
els.sendButton.addEventListener("click", () => sendMessage().catch((error) => {
  state.currentRun = null;
  addMessage("system", `Send failed: ${error.message}`);
  log("send failed", error.message);
}));
els.clearButton.addEventListener("click", () => els.messages.replaceChildren());
els.attachmentInput.addEventListener("change", () => {
  uploadAttachments([...els.attachmentInput.files]).catch((error) => log("upload failed", error.message));
  els.attachmentInput.value = "";
});
els.messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) sendMessage().catch((error) => log("send failed", error.message));
});

setConnection("disconnected");
