import { html } from "lit";
import { createGatewayClient } from "../../public/js/gateway-client.js";
import { cleanupOldPwaState } from "../../public/js/pwa-cleanup.js";
import { browserDisplayName, getBrowserClientId, loadSettings, saveSettings } from "../../public/js/storage.js";
import "./ownloom-ui.js";
import { OwnloomLightElement } from "./ownloom-ui.js";

const PERSONAL_SESSION_KEY = "web-personal-main";
const PERSONAL_CHAT_ID = `client:${PERSONAL_SESSION_KEY}`;
const ADMIN_DEFAULT_SESSION_KEY = "web-main";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
};

const shellClass = "loom-shell flex h-dvh flex-col overflow-hidden bg-background text-on-background";
const appRowClass = "loom-main-row flex min-h-0 flex-1 overflow-hidden";
const sideNavClass = "loom-sidebar flex h-full w-64 shrink-0 flex-col border-r border-dashed border-outline-variant bg-surface-container-lowest py-md";
const mainClass = "loom-content flex min-w-0 flex-1 flex-col overflow-hidden bg-surface";
const topbarClass = "loom-topbar flex h-16 w-full shrink-0 items-center justify-between gap-sm border-b border-outline-variant bg-surface px-margin";
const navLinkClass = "group flex items-center gap-3 rounded border border-transparent px-3 py-2 pl-2 text-on-surface-variant no-underline transition-all hover:bg-surface-container hover:text-primary";

export class OwnloomPersonalApp extends OwnloomLightElement {
  render() {
    return html`<main id="main" class=${shellClass}>
      <a class="skip-link" href="#personal-content">Skip to personal content</a>
      <header class=${topbarClass}>
        <a class="topbar-brand flex shrink-0 items-center gap-base text-primary no-underline active:scale-95" href="/" aria-label="Ownloom personal home">
          <ownloom-icon name="shell"></ownloom-icon><span class="font-headline-md text-headline-md font-semibold tracking-tight">Ownloom</span>
        </a>
        <div class="topbar-search hidden max-w-lg flex-1 md:block">
          <label class="relative m-0 block"><span class="search-icon"><ownloom-icon name="search"></ownloom-icon></span><input aria-label="Search Atelier" class="w-full bg-surface-container border-b border-outline-variant border-l-0 border-r-0 border-t-0 py-2 pl-10 pr-4 font-label-md text-on-surface outline-none transition-colors focus:border-primary" placeholder="Search Atelier…" type="search" /></label>
        </div>
        <div class="topbar-actions flex shrink-0 items-center gap-4">
          <span class="chip chip-thread hidden xl:inline-flex">Conversation: web-personal-main</span>
          <a class="icon-button" href="/admin?tab=config" aria-label="Settings"><ownloom-icon name="settings"></ownloom-icon></a>
          <button class="icon-button notification-button" type="button" aria-label="Notifications"><ownloom-icon name="notify"></ownloom-icon></button>
          <a class="icon-button" href="/admin" aria-label="Open admin"><ownloom-icon name="mesh"></ownloom-icon></a>
          <a class="hearth-avatar" href="/admin" aria-label="Hearth status"><ownloom-icon name="hearth"></ownloom-icon></a>
        </div>
      </header>
      <div class=${appRowClass}>
        <aside class=${sideNavClass} aria-label="Ownloom personal menu">
          <nav class="flex-1 space-y-2 overflow-y-auto px-4" aria-label="Ownloom modes">
            <a class="${navLinkClass} border-l-2 border-primary bg-surface-container text-secondary" href="/" aria-current="page"><ownloom-icon name="workbench"></ownloom-icon><span class="font-label-md text-label-md">Workbench</span></a>
            <a class=${navLinkClass} href="/admin?tab=organizer"><ownloom-icon name="planner"></ownloom-icon><span class="font-label-md text-label-md">Planner</span></a>
            <a class=${navLinkClass} href="/admin?tab=memory"><ownloom-icon name="memory"></ownloom-icon><span class="font-label-md text-label-md">Memory</span></a>
            <a class=${navLinkClass} href="/admin?tab=config"><ownloom-icon name="access"></ownloom-icon><span class="font-label-md text-label-md">Access</span></a>
            <a class=${navLinkClass} href="/admin?tab=terminal"><ownloom-icon name="shell"></ownloom-icon><span class="font-label-md text-label-md">Shell</span></a>
            <a class=${navLinkClass} href="/admin?tab=log"><ownloom-icon name="trace"></ownloom-icon><span class="font-label-md text-label-md">Trace</span></a>
          </nav>
          <div class="mx-4 mt-auto space-y-2 border-t border-dashed border-outline-variant pt-4">
            <a class=${navLinkClass} href="/admin?tab=config"><ownloom-icon name="settings"></ownloom-icon><span class="font-label-md text-label-md">Settings</span></a>
            <a class=${navLinkClass} href="/admin"><ownloom-icon name="hearth"></ownloom-icon><span class="font-label-md text-label-md">Hearth</span></a>
          </div>
        </aside>

        <div id="personal-content" class=${mainClass} tabindex="-1">
          <section class="flex-1 overflow-hidden p-sm" aria-label="Personal Ownloom workspace">
          <div class="loom-personal-grid grid h-full grid-cols-[minmax(0,1fr)_minmax(17rem,20rem)] gap-sm">
            <ownloom-personal-chat></ownloom-personal-chat>
            <aside class="page-sidebar personal-notes" aria-label="Personal mode notes">
              <article><small class="section-kicker">Mode split</small><h2>Personal first</h2><p>This page is intentionally not the operator cockpit. Coding, config, trace, token, and shell controls stay behind the admin route.</p><ul class="rail-list"><li><strong>Personal</strong><br /><small>Today, planner, journal, people, documents.</small></li><li><strong>Admin</strong><br /><small>Workbench, access, shell, trace, and runtime controls.</small></li><li><strong>Shared</strong><br /><small>Same Ownloom gateway, CLIs, wiki, planner, and skills.</small></li></ul></article>
              <article><small class="section-kicker">Planner</small><h2>Live items stay in CalDAV</h2><p>Ask Ownloom to work with tasks, reminders, and events. Collection management stays available through the admin cockpit.</p><footer class="actions"><a class="secondary outline small-button" href="/admin?tab=organizer" role="button">Open planner admin</a></footer></article>
            </aside>
          </div>
        </section>
        </div>
      </div>
    </main>`;
  }
}

class OwnloomPersonalChat extends OwnloomLightElement {
  private connectionState = "disconnected";
  private statusText = "Pair this browser or open admin access to start.";
  private token = "";
  private httpUrl = window.location.origin;
  private running = false;
  private pairing = false;
  private activeAssistantId: string | null = null;
  private initialized = false;
  private draft = "";
  private messages: ChatMessage[] = [
    { id: makeId(), role: "system", text: "Personal mode uses the same local Ownloom gateway and a dedicated personal web session." },
  ];

  private gatewayClient = createGatewayClient({
    getHttpUrl: () => this.httpUrl,
    getToken: () => this.token,
    onAgentEvent: (payload) => this.handleAgentEvent(payload),
    onConnectionChange: (state, label) => {
      this.connectionState = state;
      this.statusText = label || state;
      this.requestUpdate();
    },
    log: (message, detail) => console.debug("ownloom personal", message, detail ?? ""),
  });

  connectedCallback() {
    super.connectedCallback();
    if (this.initialized) return;
    this.initialized = true;
    cleanupOldPwaState((message, detail) => console.debug("ownloom personal", message, detail ?? ""));
    const saved = loadSettings((message, detail) => console.debug("ownloom personal", message, detail));
    this.httpUrl = saved.httpUrl || window.location.origin;
    this.token = saved.token || "";
    if (this.token) this.connect().catch((error) => this.note(`Connect failed: ${error.message}`));
  }

  protected updated() {
    const list = this.querySelector<HTMLElement>("[data-field='messages']");
    if (list) list.scrollTop = list.scrollHeight;
  }

  render() {
    const connected = this.gatewayClient.isConnected();
    const canSend = connected && !this.running && this.draft.trim().length > 0;
    const connectionClass = connected ? "border-secondary/40 bg-hearth text-hearth-foreground" : "border-outline-variant bg-muted text-muted-foreground";

    return html`<article class="lit-stitch lit-notch grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-sm rounded border border-outline-variant bg-surface-container p-md text-on-surface">
      <header class="grid gap-xs md:flex md:items-start md:justify-between">
        <div class="grid gap-base">
          <small class="section-kicker">Gateway-backed personal chat</small>
          <h2 id="personal-chat-heading" class="m-0">Ask Ownloom</h2>
          <p class="m-0 max-w-[68ch]">Text-only first pass. It streams through the existing Ownloom gateway into the personal web session.</p>
        </div>
        <div class="flex flex-wrap items-center gap-xs">
          <span class="inline-flex w-fit items-center gap-base rounded border px-xs py-base font-label-md text-label-sm leading-none tracking-[0.02em] ${connectionClass}">${this.connectionState}</span>
          <button @click=${this.pairAndConnect} ?hidden=${connected} ?disabled=${this.pairing} type="button">${this.pairing ? "Pairing…" : "Pair and remember"}</button>
          <button @click=${this.disconnect} class="secondary outline" ?hidden=${!connected} type="button">Disconnect</button>
          <a class="secondary outline small-button" href="/admin?tab=config" role="button">Admin access</a>
        </div>
      </header>
      <p class="m-0 rounded border border-outline-variant bg-surface-container-lowest px-sm py-xs font-label-sm text-label-sm text-on-surface-variant" role="status" aria-live="polite">${this.statusText}${this.token ? "" : " Pairing stores this trusted local browser token; open admin if pairing is unavailable."}</p>
      <section data-field="messages" class="grid min-h-0 content-start gap-xs overflow-auto rounded border border-outline-variant bg-surface-container-lowest p-sm" aria-label="Personal chat messages" aria-live="polite">
        ${this.messages.map((message) => this.renderMessage(message))}
      </section>
      <form class="grid gap-xs" @submit=${this.sendMessage}>
        <label class="grid gap-base font-label-sm text-label-sm uppercase tracking-[0.05em] text-secondary">Next instruction
          <textarea class="min-h-28 rounded border border-outline-variant bg-surface-container-lowest px-sm py-xs font-body-md text-body-md normal-case tracking-normal text-on-surface outline-none focus:border-primary" .value=${this.draft} ?disabled=${this.running} placeholder="Direct the Atelier…" @input=${this.handleInput} @keydown=${this.handleComposerKeydown}></textarea>
        </label>
        <footer class="flex flex-wrap items-center justify-between gap-xs border-t border-dashed border-outline-variant pt-xs">
          <small class="font-label-sm text-label-sm text-on-surface-variant">Session: ${PERSONAL_SESSION_KEY}. Attachments and artifacts come later.</small>
          <button type="submit" ?disabled=${!canSend}>${this.running ? "Working…" : "Send"} <ownloom-icon name="send"></ownloom-icon></button>
        </footer>
      </form>
    </article>`;
  }

  private renderMessage(message: ChatMessage) {
    const roleClass = {
      user: "ml-auto border-primary/40 bg-on-primary text-on-primary-container",
      assistant: "border-outline-variant bg-surface-container-high text-on-surface",
      system: "max-w-full border-tertiary/40 bg-terminal text-on-surface-variant",
    }[message.role];
    const label = message.role === "user" ? "Alex" : message.role === "assistant" ? "Ownloom" : "Hearth";
    return html`<div class="grid max-w-[42rem] gap-base rounded border px-sm py-xs ${roleClass}"><small class="font-label-sm text-label-sm uppercase tracking-[0.05em] text-secondary">${label}</small><p class="m-0 whitespace-pre-wrap text-[15px] leading-relaxed text-inherit">${message.text || (message.role === "assistant" ? "…" : "")}</p></div>`;
  }

  private handleInput(event: Event) {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement) {
      this.draft = target.value;
      this.requestUpdate();
    }
  }

  private async pairAndConnect() {
    this.pairing = true;
    this.requestUpdate();
    try {
      const result = await this.gatewayClient.pairBrowser({ clientId: getBrowserClientId(), displayName: `${browserDisplayName()} personal` });
      this.token = result.token || "";
      const saved = loadSettings((message, detail) => console.debug("ownloom personal", message, detail));
      saveSettings({ httpUrl: this.httpUrl, token: this.token, sessionKey: saved.sessionKey || ADMIN_DEFAULT_SESSION_KEY, chatId: saved.chatId || "", remember: true });
      this.note("Browser paired and remembered locally for personal mode.");
      await this.connect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.statusText = `Pairing failed: ${message}. Open admin access if needed.`;
      this.note(this.statusText);
    } finally {
      this.pairing = false;
      this.requestUpdate();
    }
  }

  private async connect() {
    await this.gatewayClient.connect();
    this.statusText = "Connected to local Ownloom gateway.";
    this.requestUpdate();
  }

  private disconnect() {
    this.gatewayClient.disconnect();
    this.statusText = "Disconnected from local Ownloom gateway.";
    this.requestUpdate();
  }

  private async sendMessage(event: Event) {
    event.preventDefault();
    if (this.running || !this.draft.trim() || !this.gatewayClient.isConnected()) return;
    const text = this.draft.trim();
    this.draft = "";
    this.running = true;
    this.addMessage("user", text);
    const assistantId = this.addMessage("assistant", "");
    this.activeAssistantId = assistantId;
    this.requestUpdate();

    try {
      const payload = await this.gatewayClient.request("agent.wait", { message: text, sessionKey: PERSONAL_SESSION_KEY, chatId: PERSONAL_CHAT_ID, idempotencyKey: makeId("web-personal") });
      const resultText = typeof payload?.text === "string" ? payload.text : "";
      if (resultText && this.activeAssistantId) this.replaceMessageText(this.activeAssistantId, resultText);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.note(`Send failed: ${message}`);
      if (this.activeAssistantId) this.replaceMessageText(this.activeAssistantId, `Send failed: ${message}`);
    } finally {
      this.running = false;
      this.activeAssistantId = null;
      this.requestUpdate();
    }
  }

  private handleComposerKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) this.sendMessage(event);
  }

  private handleAgentEvent(payload: any) {
    if (payload?.stream === "start" || payload?.status === "started") {
      if (!this.activeAssistantId) this.activeAssistantId = this.addMessage("assistant", "");
    } else if (payload?.stream === "chunk" && typeof payload.text === "string") {
      if (!this.activeAssistantId) this.activeAssistantId = this.addMessage("assistant", "");
      this.appendMessageText(this.activeAssistantId, payload.text);
    } else if (payload?.stream === "result" && typeof payload.text === "string") {
      if (!this.activeAssistantId) this.activeAssistantId = this.addMessage("assistant", "");
      this.replaceMessageText(this.activeAssistantId, payload.text);
    } else if (payload?.stream === "done" || payload?.status === "done") {
      this.activeAssistantId = null;
    }
    this.requestUpdate();
  }

  private note(text: string) { this.addMessage("system", text); }

  private addMessage(role: ChatMessage["role"], text: string) {
    const id = makeId();
    this.messages = [...this.messages, { id, role, text }];
    this.requestUpdate();
    return id;
  }

  private replaceMessageText(id: string, text: string) {
    this.messages = this.messages.map((message) => (message.id === id ? { ...message, text } : message));
    this.requestUpdate();
  }

  private appendMessageText(id: string, text: string) {
    this.messages = this.messages.map((message) => (message.id === id ? { ...message, text: `${message.text}${text}` } : message));
    this.requestUpdate();
  }
}

function makeId(prefix = "message") {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

customElements.define("ownloom-personal-app", OwnloomPersonalApp);
customElements.define("ownloom-personal-chat", OwnloomPersonalChat);
