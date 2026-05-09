import { createGatewayClient } from "../../public/js/gateway-client.js";
import { cleanupOldPwaState } from "../../public/js/pwa-cleanup.js";
import { browserDisplayName, getBrowserClientId, loadSettings, saveSettings } from "../../public/js/storage.js";

const PERSONAL_SESSION_KEY = "web-personal-main";
const PERSONAL_CHAT_ID = `client:${PERSONAL_SESSION_KEY}`;
const ADMIN_DEFAULT_SESSION_KEY = "web-main";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
};

class OwnloomPersonalChat extends HTMLElement {
  private connectionState = "disconnected";
  private statusText = "Pair this browser or open admin access to start.";
  private token = "";
  private httpUrl = window.location.origin;
  private running = false;
  private pairing = false;
  private activeAssistantId: string | null = null;
  private initialized = false;
  private messages: ChatMessage[] = [
    {
      id: makeId(),
      role: "system",
      text: "Personal mode uses the same local Ownloom gateway and a dedicated personal web session.",
    },
  ];

  private gatewayClient = createGatewayClient({
    getHttpUrl: () => this.httpUrl,
    getToken: () => this.token,
    onAgentEvent: (payload) => this.handleAgentEvent(payload),
    onConnectionChange: (state, label) => {
      this.connectionState = state;
      this.statusText = label || state;
      this.updateChrome();
    },
    log: (message, detail) => console.debug("ownloom personal", message, detail ?? ""),
  });

  connectedCallback() {
    if (this.initialized) return;
    this.initialized = true;
    this.renderShell();
    cleanupOldPwaState((message, detail) => console.debug("ownloom personal", message, detail ?? ""));
    const saved = loadSettings((message, detail) => console.debug("ownloom personal", message, detail));
    this.httpUrl = saved.httpUrl || window.location.origin;
    this.token = saved.token || "";
    this.renderMessages();
    this.updateChrome();
    if (this.token) {
      this.connect().catch((error) => this.note(`Connect failed: ${error.message}`));
    }
  }

  private renderShell() {
    this.replaceChildren();
    const article = document.createElement("article");
    article.className = "lit-stitch lit-notch relative grid gap-ds-sm rounded-[var(--radius)] border border-border bg-card p-ds-md text-card-foreground shadow-none";
    article.setAttribute("aria-labelledby", "personal-chat-heading");
    article.innerHTML = `
      <header class="grid gap-ds-xs md:flex md:items-start md:justify-between">
        <div class="grid gap-ds-base">
          <small class="font-mono text-[12px] font-medium uppercase tracking-[0.05em] text-accent">Gateway-backed personal chat</small>
          <h2 id="personal-chat-heading" class="m-0 font-serif text-[28px] leading-tight text-foreground">Ask Ownloom</h2>
          <p class="m-0 max-w-[68ch] text-[16px] leading-relaxed text-muted-foreground">Text-only first pass. It streams through the existing Ownloom gateway into the personal web session.</p>
        </div>
        <div class="flex flex-wrap items-center gap-ds-xs">
          <span data-field="connection" class="inline-flex w-fit items-center gap-ds-base rounded-[var(--radius)] border px-ds-xs py-ds-base font-mono text-[12px] leading-none tracking-[0.02em]"></span>
          <button data-action="pair" class="border-primary bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center justify-center rounded-[var(--radius)] border px-ds-sm py-ds-xs font-mono text-[12px] uppercase tracking-[0.05em] disabled:opacity-50" type="button">Pair and remember</button>
          <button data-action="disconnect" class="border-accent/60 bg-secondary text-secondary-foreground hover:bg-accent/10 hover:text-foreground inline-flex hidden items-center justify-center rounded-[var(--radius)] border px-ds-sm py-ds-xs font-mono text-[12px] uppercase tracking-[0.05em]" type="button">Disconnect</button>
          <a class="border-accent/60 bg-secondary text-secondary-foreground hover:bg-accent/10 hover:text-foreground inline-flex items-center justify-center rounded-[var(--radius)] border px-ds-sm py-ds-xs font-mono text-[12px] uppercase tracking-[0.05em] no-underline" href="/admin">Admin</a>
        </div>
      </header>
      <p data-field="status" class="m-0 rounded-[var(--radius)] border border-border bg-muted/70 px-ds-sm py-ds-xs font-mono text-[12px] text-muted-foreground" role="status" aria-live="polite"></p>
      <section data-field="messages" class="grid max-h-[28rem] min-h-[18rem] content-start gap-ds-xs overflow-auto rounded-[var(--radius)] border border-border bg-[var(--ds-surface-container-lowest)] p-ds-sm" aria-label="Personal chat messages" aria-live="polite"></section>
      <form data-field="form" class="grid gap-ds-xs">
        <label class="grid gap-ds-base font-mono text-[12px] uppercase tracking-[0.05em] text-accent">
          Next instruction
          <textarea data-field="composer" class="min-h-[7rem] rounded-[var(--radius)] border border-input bg-[var(--ds-surface-container-lowest)] px-ds-sm py-ds-xs font-sans text-[16px] normal-case tracking-normal text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring" placeholder="Message Ownloom…"></textarea>
        </label>
        <footer class="flex flex-wrap items-center justify-between gap-ds-xs">
          <small class="font-mono text-[12px] text-muted-foreground">Session: ${PERSONAL_SESSION_KEY}. Attachments and artifacts come later.</small>
          <button data-action="send" class="border-primary bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center justify-center rounded-[var(--radius)] border px-ds-sm py-ds-xs font-mono text-[12px] uppercase tracking-[0.05em] disabled:pointer-events-none disabled:opacity-50" type="submit">Send</button>
        </footer>
      </form>
    `;
    this.append(article);

    this.pairButton?.addEventListener("click", () => this.pairAndConnect());
    this.disconnectButton?.addEventListener("click", () => this.disconnect());
    this.form?.addEventListener("submit", (event) => this.sendMessage(event));
    this.composer?.addEventListener("input", () => this.updateChrome());
    this.composer?.addEventListener("keydown", (event) => this.handleComposerKeydown(event));
  }

  private get connectionBadge() { return this.querySelector<HTMLElement>("[data-field='connection']"); }
  private get statusLine() { return this.querySelector<HTMLElement>("[data-field='status']"); }
  private get messageList() { return this.querySelector<HTMLElement>("[data-field='messages']"); }
  private get composer() { return this.querySelector<HTMLTextAreaElement>("[data-field='composer']"); }
  private get form() { return this.querySelector<HTMLFormElement>("[data-field='form']"); }
  private get pairButton() { return this.querySelector<HTMLButtonElement>("[data-action='pair']"); }
  private get disconnectButton() { return this.querySelector<HTMLButtonElement>("[data-action='disconnect']"); }
  private get sendButton() { return this.querySelector<HTMLButtonElement>("[data-action='send']"); }

  private updateChrome() {
    const connected = this.gatewayClient.isConnected();
    if (this.connectionBadge) {
      this.connectionBadge.textContent = this.connectionState;
      this.connectionBadge.className = `inline-flex w-fit items-center gap-ds-base rounded-[var(--radius)] border px-ds-xs py-ds-base font-mono text-[12px] leading-none tracking-[0.02em] ${connected ? "border-accent/40 bg-hearth text-hearth-foreground" : "border-border bg-muted text-muted-foreground"}`;
    }
    if (this.statusLine) {
      this.statusLine.textContent = `${this.statusText}${this.token ? "" : " Pairing stores this trusted local browser token; open admin if pairing is unavailable."}`;
    }
    if (this.pairButton) {
      this.pairButton.hidden = connected;
      this.pairButton.disabled = this.pairing;
      this.pairButton.textContent = this.pairing ? "Pairing…" : "Pair and remember";
    }
    if (this.disconnectButton) this.disconnectButton.hidden = !connected;
    if (this.composer) this.composer.disabled = this.running;
    if (this.sendButton) {
      this.sendButton.disabled = !connected || this.running || !this.composer?.value.trim();
      this.sendButton.textContent = this.running ? "Working…" : "Send";
    }
  }

  private renderMessages() {
    if (!this.messageList) return;
    this.messageList.replaceChildren(...this.messages.map((message) => this.renderMessage(message)));
    this.messageList.scrollTop = this.messageList.scrollHeight;
  }

  private renderMessage(message: ChatMessage) {
    const node = document.createElement("div");
    const roleClass = {
      user: "ml-auto border-primary/40 bg-[var(--ds-on-primary)] text-primary-foreground",
      assistant: "border-border bg-card text-card-foreground",
      system: "max-w-full border-hearth/40 bg-terminal text-muted-foreground",
    }[message.role];
    const label = message.role === "user" ? "Alex" : message.role === "assistant" ? "Ownloom" : "Hearth";
    node.className = `grid max-w-[42rem] gap-ds-base rounded-[var(--radius)] border px-ds-sm py-ds-xs shadow-none ${roleClass}`;
    const labelNode = document.createElement("small");
    labelNode.className = "font-mono text-[12px] uppercase tracking-[0.05em] text-accent";
    labelNode.textContent = label;
    const textNode = document.createElement("p");
    textNode.className = "m-0 whitespace-pre-wrap text-[15px] leading-relaxed";
    textNode.textContent = message.text || (message.role === "assistant" ? "…" : "");
    node.append(labelNode, textNode);
    return node;
  }

  private async pairAndConnect() {
    this.pairing = true;
    this.updateChrome();
    try {
      const result = await this.gatewayClient.pairBrowser({
        clientId: getBrowserClientId(),
        displayName: `${browserDisplayName()} personal`,
      });
      this.token = result.token || "";
      const saved = loadSettings((message, detail) => console.debug("ownloom personal", message, detail));
      saveSettings({
        httpUrl: this.httpUrl,
        token: this.token,
        sessionKey: saved.sessionKey || ADMIN_DEFAULT_SESSION_KEY,
        chatId: saved.chatId || "",
        remember: true,
      });
      this.note("Browser paired and remembered locally for personal mode.");
      await this.connect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.statusText = `Pairing failed: ${message}. Open admin access if needed.`;
      this.note(this.statusText);
    } finally {
      this.pairing = false;
      this.updateChrome();
    }
  }

  private async connect() {
    await this.gatewayClient.connect();
    this.statusText = "Connected to local Ownloom gateway.";
    this.updateChrome();
  }

  private disconnect() {
    this.gatewayClient.disconnect();
    this.statusText = "Disconnected from local Ownloom gateway.";
    this.updateChrome();
  }

  private async sendMessage(event: Event) {
    event.preventDefault();
    if (this.running || !this.composer?.value.trim() || !this.gatewayClient.isConnected()) return;

    const text = this.composer.value.trim();
    this.composer.value = "";
    this.running = true;
    this.addMessage("user", text);
    const assistantId = this.addMessage("assistant", "");
    this.activeAssistantId = assistantId;
    this.updateChrome();

    try {
      const payload = await this.gatewayClient.request("agent.wait", {
        message: text,
        sessionKey: PERSONAL_SESSION_KEY,
        chatId: PERSONAL_CHAT_ID,
        idempotencyKey: makeId("web-personal"),
      });
      const resultText = typeof payload?.text === "string" ? payload.text : "";
      if (resultText && this.activeAssistantId) this.replaceMessageText(this.activeAssistantId, resultText);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.note(`Send failed: ${message}`);
      if (this.activeAssistantId) this.replaceMessageText(this.activeAssistantId, `Send failed: ${message}`);
    } finally {
      this.running = false;
      this.activeAssistantId = null;
      this.updateChrome();
    }
  }

  private handleComposerKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      this.sendMessage(event);
    }
  }

  private handleAgentEvent(payload: any) {
    if (payload?.stream === "start" || payload?.status === "started") {
      if (!this.activeAssistantId) this.activeAssistantId = this.addMessage("assistant", "");
      return;
    }
    if (payload?.stream === "chunk" && typeof payload.text === "string") {
      if (!this.activeAssistantId) this.activeAssistantId = this.addMessage("assistant", "");
      this.appendMessageText(this.activeAssistantId, payload.text);
      return;
    }
    if (payload?.stream === "result" && typeof payload.text === "string") {
      if (!this.activeAssistantId) this.activeAssistantId = this.addMessage("assistant", "");
      this.replaceMessageText(this.activeAssistantId, payload.text);
      return;
    }
    if (payload?.stream === "done" || payload?.status === "done") {
      this.activeAssistantId = null;
    }
  }

  private note(text: string) {
    this.addMessage("system", text);
  }

  private addMessage(role: ChatMessage["role"], text: string) {
    const id = makeId();
    this.messages = [...this.messages, { id, role, text }];
    this.renderMessages();
    return id;
  }

  private appendMessageText(id: string, text: string) {
    this.messages = this.messages.map((message) => message.id === id ? { ...message, text: `${message.text}${text}` } : message);
    this.renderMessages();
  }

  private replaceMessageText(id: string, text: string) {
    this.messages = this.messages.map((message) => message.id === id ? { ...message, text } : message);
    this.renderMessages();
  }
}

customElements.define("ownloom-personal-chat", OwnloomPersonalChat);

function makeId(prefix = "personal") {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (typeof randomUuid === "function") return `${prefix}-${randomUuid.call(globalThis.crypto)}`;
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}
