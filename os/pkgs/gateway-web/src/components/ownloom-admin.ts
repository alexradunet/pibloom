import { html } from "lit";
import "./ownloom-ui.js";
import { OwnloomLightElement } from "./ownloom-ui.js";

const navItemClass = "tab-button group flex w-full cursor-pointer items-center gap-3 rounded border border-transparent px-3 py-2 pl-2 text-left text-on-surface-variant transition-all hover:bg-surface-container hover:text-primary";
const navLabelClass = "font-label-md text-label-md";
const panelClass = "tab-panel flex-1 overflow-y-auto p-sm";
const shellClass = "loom-shell flex h-dvh flex-col overflow-hidden bg-background text-on-background";
const appRowClass = "loom-main-row flex min-h-0 flex-1 overflow-hidden";
const sideNavClass = "loom-sidebar flex h-full w-64 shrink-0 flex-col border-r border-dashed border-outline-variant bg-surface-container-lowest py-md";
const mainClass = "loom-content flex min-w-0 flex-1 flex-col overflow-hidden bg-surface";
const topbarClass = "loom-topbar flex h-16 w-full shrink-0 items-center justify-between gap-sm border-b border-outline-variant bg-surface px-margin";
const cardClass = "lit-stitch lit-notch relative rounded border border-outline-variant bg-surface-container p-md";
const railClass = "page-sidebar grid content-start gap-sm";

export class OwnloomAdminApp extends OwnloomLightElement {
  render() {
    return html`<main id="main" class=${shellClass}>
      <a class="skip-link" href="#cockpit-content">Skip to cockpit content</a>
      <ownloom-admin-topbar></ownloom-admin-topbar>
      <div class=${appRowClass}>
        <ownloom-admin-nav></ownloom-admin-nav>
        <div id="cockpit-content" class=${mainClass} tabindex="-1">
          <ownloom-workbench-panel></ownloom-workbench-panel>
          <ownloom-memory-panel></ownloom-memory-panel>
          <ownloom-planner-panel></ownloom-planner-panel>
          <ownloom-access-panel></ownloom-access-panel>
          <ownloom-shell-panel></ownloom-shell-panel>
          <ownloom-trace-panel></ownloom-trace-panel>
        </div>
      </div>
    </main>`;
  }
}

class OwnloomAdminNav extends OwnloomLightElement {
  render() {
    return html`<aside class=${sideNavClass} aria-label="Ownloom cockpit menu">
      <nav class="flex-1 space-y-2 overflow-y-auto px-4" role="tablist" aria-orientation="vertical" aria-label="Ownloom cockpit sections">
        ${this.renderTab("chat", "workbench", "Workbench", true)}
        ${this.renderTab("organizer", "planner", "Planner")}
        ${this.renderTab("memory", "memory", "Memory")}
        ${this.renderTab("config", "access", "Access")}
        ${this.renderTab("terminal", "shell", "Shell")}
        ${this.renderTab("log", "trace", "Trace")}
      </nav>

      <div class="mx-4 mt-auto space-y-2 border-t border-dashed border-outline-variant px-0 pt-4">
        <a class="group flex cursor-pointer items-center gap-3 rounded px-3 py-2 pl-2 text-on-surface-variant no-underline transition-all hover:bg-surface-container hover:text-primary" href="/admin?tab=config">
          <ownloom-icon name="settings"></ownloom-icon><span class=${navLabelClass}>Settings</span>
        </a>
        <a class="group flex cursor-pointer items-center gap-3 rounded px-3 py-2 pl-2 text-on-surface-variant no-underline transition-all hover:bg-surface-container hover:text-primary" href="/" aria-label="Open personal Ownloom">
          <ownloom-icon name="hearth"></ownloom-icon><span class=${navLabelClass}>Hearth</span>
        </a>
      </div>
    </aside>`;
  }

  private renderTab(tab: string, icon: string, label: string, active = false) {
    return html`<button
      id=${`tab-${tab}-button`}
      class=${`${navItemClass} ${active ? "active border-l-2 border-primary bg-surface-container pl-2 text-secondary" : ""}`}
      type="button"
      role="tab"
      data-tab-target=${tab}
      aria-controls=${`tab-${tab}`}
      aria-selected=${active ? "true" : "false"}
      tabindex=${active ? "0" : "-1"}
    >
      <ownloom-icon name=${icon}></ownloom-icon>
      <span class=${navLabelClass}>${label}</span>
    </button>`;
  }
}

class OwnloomAdminTopbar extends OwnloomLightElement {
  render() {
    return html`<header class=${topbarClass}>
      <a class="topbar-brand flex shrink-0 items-center gap-base text-primary no-underline active:scale-95" href="/admin" aria-label="Ownloom admin home">
        <ownloom-icon name="shell"></ownloom-icon>
        <span class="font-headline-md text-headline-md font-semibold tracking-tight">Ownloom</span>
      </a>

      <div class="topbar-search hidden max-w-lg flex-1 md:block">
        <label class="relative m-0 block"><span class="search-icon"><ownloom-icon name="search"></ownloom-icon></span><input aria-label="Search Atelier" class="w-full bg-surface-container border-b border-outline-variant border-l-0 border-r-0 border-t-0 py-2 pl-10 pr-4 font-label-md text-on-surface outline-none transition-colors focus:border-primary" placeholder="Search Atelier…" type="search" /></label>
      </div>

      <div class="topbar-actions flex shrink-0 items-center gap-4">
        <span id="currentSession" class="chip chip-thread hidden xl:inline-flex">Conversation: web-main</span>
        <span id="connectionState" class="pill" role="status" aria-live="polite">disconnected</span>
        <button id="threadRailToggle" class="icon-button" type="button" aria-controls="threadRail" aria-expanded="true">Threads</button>
        <a class="icon-button" href="/admin?tab=config" aria-label="Settings"><ownloom-icon name="settings"></ownloom-icon></a>
        <button class="icon-button notification-button" type="button" aria-label="Notifications"><ownloom-icon name="notify"></ownloom-icon></button>
        <a class="icon-button" href="/" aria-label="Open personal hearth"><ownloom-icon name="mesh"></ownloom-icon></a>
        <a class="hearth-avatar" href="/" aria-label="Hearth status"><ownloom-icon name="hearth"></ownloom-icon></a>
      </div>
    </header>`;
  }
}

class OwnloomWorkbenchPanel extends OwnloomLightElement {
  render() {
    return html`<section id="tab-chat" class=${`${panelClass} active p-0`} role="tabpanel" data-tab-panel="chat" aria-labelledby="tab-chat-button" tabindex="0">
      <div class="page-layout workbench-shell thread-rail-open" data-workbench-shell>
        <article class="workbench-card" aria-labelledby="chat-heading">
          <h2 id="chat-heading" class="sr-only">Active thread</h2>
          <div id="messages" class="messages" role="log" aria-live="polite" aria-relevant="additions text" aria-busy="false" aria-label="Active thread messages"></div>

          <section class="composer" aria-label="Thread composer">
            <textarea id="messageInput" rows="3" placeholder="Direct the Atelier…" spellcheck="false"></textarea>
            <div class="composer-footer">
              <div class="composer-tools">
                <label class="icon-button small-button" aria-label="Attach material"><ownloom-icon name="attach"></ownloom-icon><input id="attachmentInput" class="sr-only" type="file" multiple accept="image/*,audio/*" /></label>
                <button class="icon-button small-button" type="button" aria-label="Attach dataset"><ownloom-icon name="dataset"></ownloom-icon></button>
                <div id="attachments" class="attachments" role="list" aria-label="Staged attachments"></div>
              </div>
              <div class="composer-actions">
                <button id="newChatButton" class="secondary outline small-button" type="button">New thread</button>
                <button id="clearButton" class="secondary outline small-button" type="button">Clear view</button>
                <button id="sendButton" type="button" disabled>Send <ownloom-icon name="send"></ownloom-icon></button>
              </div>
            </div>
          </section>
        </article>

        <aside id="threadRail" class="thread-rail" aria-labelledby="sessions-heading" aria-hidden="false">
          <article>
            <header class="telemetry-header">
              <div><h2 id="sessions-heading" class="font-label-md text-label-md text-on-surface">Telemetry</h2><p class="font-label-sm text-label-sm text-on-surface-variant">local workbench</p></div>
              <button id="threadRailClose" class="icon-button small-button" type="button" aria-label="Close threads"><ownloom-icon name="close"></ownloom-icon></button>
            </header>
            <div class="telemetry-tabs" role="tablist" aria-label="Workbench context rail"><button class="active" type="button">Context</button><button type="button">Thread List</button><button type="button">Node Status</button></div>
            <section class="telemetry-block" aria-labelledby="active-nodes-heading"><h3 id="active-nodes-heading"><ownloom-icon name="mesh"></ownloom-icon> Active Nodes</h3><div class="node-list"><div><span>ownloom-vps</span><strong>Operational</strong></div><div><span>Gateway</span><strong>Loopback</strong></div><div><span>Planner</span><strong>CalDAV</strong></div></div></section>
            <section class="telemetry-block" aria-label="Threads"><h3><ownloom-icon name="workbench"></ownloom-icon> Threads</h3><ul id="sessions" class="list empty" aria-label="Threads"><li>Connect and refresh.</li></ul></section>
            <section class="telemetry-block" aria-labelledby="diagnostics-heading"><h3 id="diagnostics-heading"><ownloom-icon name="trace"></ownloom-icon> Diagnostics</h3><div class="metric metric-gateway"><span>Gateway</span><strong>standby</strong><i></i></div><div class="metric metric-memory"><span>Memory</span><strong>local</strong><i></i></div></section>
          </article>
        </aside>
      </div>
    </section>`;
  }
}

class OwnloomMemoryPanel extends OwnloomLightElement {
  render() {
    return html`<section id="tab-memory" class=${panelClass} role="tabpanel" data-tab-panel="memory" aria-labelledby="tab-memory-button" tabindex="0" hidden>
      <div class="page-layout">
        <article class=${cardClass} aria-labelledby="memory-heading"><header class="split-header"><div><small class="section-kicker">Memory</small><h2 id="memory-heading">Local knowledge loom</h2><p>Use the conversation to search, capture, and update Markdown wiki memory. Live tasks stay in the planner.</p></div><span class="chip chip-private">Markdown / Git</span></header><p class="warning-banner" role="note">Memory remains file-backed and local-first. This panel is a quiet placeholder for the dedicated memory atelier.</p></article>
        <aside class=${railClass} aria-label="Memory context rail"><article><small class="section-kicker">Boundary</small><h2>Memory rail</h2><p>Durable context belongs in the wiki; operational tasks and reminders belong in CalDAV.</p></article></aside>
      </div>
    </section>`;
  }
}

class OwnloomPlannerPanel extends OwnloomLightElement {
  render() {
    return html`<section id="tab-organizer" class=${panelClass} role="tabpanel" data-tab-panel="organizer" aria-labelledby="tab-organizer-button" tabindex="0" hidden>
      <div class="page-layout">
        <article class=${cardClass} aria-labelledby="planner-heading">
          <header class="split-header">
            <div><small class="section-kicker">Planner</small><h2 id="planner-heading">Radicale management</h2><p>Built-in CalDAV/CardDAV collection management. Individual tasks, reminders, and events stay in Ownloom chat/CLI.</p></div>
            <div class="actions"><a class="secondary outline small-button" href="/radicale/" target="_blank" rel="noopener noreferrer" role="button">Open Radicale</a></div>
          </header>
          <p class="warning-banner" role="note"><strong>No extra planner app.</strong> This trusted local frame uses Radicale's own management UI and auto-opens as the local Ownloom user.</p>
          <iframe id="radicaleFrame" class="service-frame radicale-frame" title="Radicale collection management" data-src="/radicale/"></iframe>
        </article>
        <aside class=${railClass} aria-label="Planner context rail">
          <article><small class="section-kicker">Live source</small><h2>Planner rail</h2><p>Radicale stores canonical CalDAV/iCalendar data. Ownloom chat and ownloom-planner operate individual tasks and events.</p><ul class="rail-list"><li><strong>Canonical</strong><br /><small>Do not mirror live tasks as wiki task pages.</small></li><li><strong>Collections</strong><br /><small>Create or inspect calendars/task-capable collections here.</small></li><li><strong>No duplicate UI</strong><br /><small>The old custom planner app/API stays removed.</small></li></ul></article>
        </aside>
      </div>
    </section>`;
  }
}

class OwnloomAccessPanel extends OwnloomLightElement {
  render() {
    return html`<section id="tab-config" class=${panelClass} role="tabpanel" data-tab-panel="config" aria-labelledby="tab-config-button" tabindex="0" hidden>
      <div class="page-layout">
        <article class=${cardClass} aria-label="Gateway access workspace">
          <header class="split-header access-hero">
            <div><small class="section-kicker">Access</small><h2>Gateway access</h2><p>Pair this browser to the local operator gateway. Runtime tokens remain masked and local when remembered.</p></div>
            <div><span class="chip chip-private">Full-operator runtime client</span><button id="pairButton" type="button">Pair this browser</button><p><small>Best path for trusted loopback or SSH-tunneled browsers.</small></p></div>
          </header>
          <details>
            <summary>Advanced connection controls</summary>
            <div class="grid access-grid">
              <label>Gateway HTTP URL<input id="httpUrl" value="http://127.0.0.1:8081" autocomplete="off" /></label>
              <label>Bearer token<input id="token" type="password" placeholder="paste named client token" autocomplete="off" /></label>
              <label>Session key<input id="sessionKey" value="web-main" autocomplete="off" /></label>
              <label><input id="rememberSettings" type="checkbox" role="switch" checked /> Remember locally</label>
            </div>
            <footer class="actions end"><button id="connectButton" class="secondary outline" type="button">Connect manually</button><button id="disconnectButton" class="secondary outline" type="button" disabled>Disconnect</button><button id="healthButton" class="secondary outline" type="button" disabled>Health</button><button id="refreshButton" class="secondary outline" type="button" disabled>Refresh lists</button></footer>
          </details>
          <section class="grid access-lists" aria-label="Gateway runtime state">
            <article aria-labelledby="clients-heading"><header><small class="section-kicker">Runtime</small><h2 id="clients-heading">Runtime clients</h2><p>Current, paired browser, config-managed, and revoked clients.</p></header><ul id="clients" class="list empty" aria-label="Clients"><li>Connect and refresh.</li></ul></article>
            <article aria-labelledby="queues-heading"><header><small class="section-kicker">Gateway queues</small><h2 id="queues-heading">Delivery and command queue</h2><p>Live gateway lists; admin actions appear only when authorized.</p></header><h3 id="deliveries-heading">Delivery queue</h3><ul id="deliveries" class="list empty" aria-labelledby="deliveries-heading"><li>Connect and refresh.</li></ul><h3 id="commands-heading">Command queue</h3><ul id="commands" class="list empty" aria-labelledby="commands-heading"><li>Connect and refresh.</li></ul></article>
          </section>
          <article class="danger-zone" aria-labelledby="danger-heading"><div><small class="section-kicker">Danger zone</small><h2 id="danger-heading">Forget local browser settings</h2><p>Clears remembered token/settings from local storage and the token field. It does not revoke clients.</p></div><button id="clearSettingsButton" class="button-danger" type="button">Forget local settings</button></article>
        </article>
        <aside class=${railClass} aria-label="Access context rail"><article><small class="section-kicker">Boundary</small><h2>Access rail</h2><p>This browser is an operator surface. Keep access loopback or tunneled unless the network model changes explicitly.</p><ul class="rail-list"><li><strong>Pair</strong><br /><small>Creates a runtime client for this browser.</small></li><li><strong>Remember</strong><br /><small>Stores token/settings only in this browser.</small></li><li><strong>Forget</strong><br /><small>Clears local storage; it does not revoke server clients.</small></li></ul></article><article><small class="section-kicker">Token rule</small><p>Tokens stay masked and should never be echoed into trace output or copied into notes.</p></article></aside>
      </div>
    </section>`;
  }
}

class OwnloomShellPanel extends OwnloomLightElement {
  render() {
    return html`<section id="tab-terminal" class=${panelClass} role="tabpanel" data-tab-panel="terminal" aria-labelledby="tab-terminal-button" tabindex="0" hidden>
      <div class="page-layout">
        <article class=${cardClass}>
          <header class="split-header"><div><small class="section-kicker">Shell</small><h2>Interactive shell</h2><p>Advanced Zellij shell for Pi TUI and coding sessions. The iframe loads only when this tab is selected.</p></div><div class="actions end"><button id="copyTerminalTokenButton" class="secondary outline" type="button">Copy Zellij token</button><a id="openTerminalLink" href="/terminal/ownloom" target="_blank" rel="noopener noreferrer" role="button" class="secondary outline">Open full terminal</a><span id="terminalTokenStatus" class="chip" role="status" aria-live="polite">Token stays local.</span></div></header>
          <p class="warning-banner" role="note"><strong>Local shell boundary.</strong> Use through loopback or an SSH tunnel. The terminal proxy remains same-origin and no-store.</p>
          <iframe id="terminalFrame" class="terminal-frame" title="Ownloom terminal" data-src="/terminal/ownloom"></iframe>
        </article>
        <aside class=${railClass} aria-label="Shell context rail"><article><small class="section-kicker">Power tool</small><h2>Shell rail</h2><p>The shell is intentionally advanced and local. It is for direct operator work when chat is not enough.</p><ul class="rail-list"><li><strong>Lazy load</strong><br /><small>The iframe loads only after opening this tab.</small></li><li><strong>No-store</strong><br /><small>Terminal proxy responses stay uncached.</small></li><li><strong>Loopback</strong><br /><small>Use SSH tunnel or local browser access.</small></li></ul></article></aside>
      </div>
    </section>`;
  }
}

class OwnloomTracePanel extends OwnloomLightElement {
  render() {
    return html`<section id="tab-log" class=${panelClass} role="tabpanel" data-tab-panel="log" aria-labelledby="tab-log-button" tabindex="0" hidden>
      <div class="page-layout">
        <article class=${cardClass}>
          <header class="split-header"><div><small class="section-kicker">Trace</small><h2>Local event trace</h2><p>Redacted browser-side gateway events, useful for operator diagnosis.</p></div><span class="chip chip-system">textContent only</span></header>
          <pre id="log" class="log" aria-label="Local event trace"></pre>
        </article>
        <aside class=${railClass} aria-label="Trace context rail"><article><small class="section-kicker">Ephemeral</small><h2>Trace rail</h2><p>This is browser-side operator trace, not durable memory and not a wiki source.</p><ul class="rail-list"><li><strong>Redacted</strong><br /><small>Keep tokens and secrets out of normal logs.</small></li><li><strong>Local</strong><br /><small>Useful for diagnosing this cockpit session.</small></li><li><strong>Temporary</strong><br /><small>Reloading clears the visible trace.</small></li></ul></article></aside>
      </div>
    </section>`;
  }
}


customElements.define("ownloom-admin-app", OwnloomAdminApp);
customElements.define("ownloom-admin-nav", OwnloomAdminNav);
customElements.define("ownloom-admin-topbar", OwnloomAdminTopbar);
customElements.define("ownloom-workbench-panel", OwnloomWorkbenchPanel);
customElements.define("ownloom-memory-panel", OwnloomMemoryPanel);
customElements.define("ownloom-planner-panel", OwnloomPlannerPanel);
customElements.define("ownloom-access-panel", OwnloomAccessPanel);
customElements.define("ownloom-shell-panel", OwnloomShellPanel);
customElements.define("ownloom-trace-panel", OwnloomTracePanel);
