{
  curl,
  nodejs,
  ownloom-gateway-web,
  runCommand,
}:
runCommand "ownloom-gateway-web-smoke" {
  nativeBuildInputs = [curl nodejs];
} ''
    root=${ownloom-gateway-web}/share/ownloom-gateway-web/public
    server=${ownloom-gateway-web}/share/ownloom-gateway-web/server.mjs

    test -f "$root/index.html"
    test -f "$root/components.html"
    test -f "$root/app.js"
    test -f "$root/style.css"
    test ! -e "$root/manifest.webmanifest"
    test ! -e "$root/sw.js"
    test ! -e "$root/js/pwa.js"
    test -f "$root/icons/icon.svg"
    test -f "$root/vendor/pico.min.css"
    test -f "$root/vendor/fonts/newsreader-var.ttf"
    test -f "$root/vendor/fonts/work-sans-var.ttf"
    test -f "$root/vendor/fonts/jetbrains-mono-var.woff2"
    test -f "$root/vendor/fonts/OFL.txt"
    grep -q 'Pico CSS' "$root/vendor/pico.min.css"
    grep -q './vendor/pico.min.css' "$root/style.css"
    grep -q 'Digital Scoarță' "$root/styles/tokens.css"
    grep -q 'Newsreader' "$root/styles/tokens.css"
    test -f "$root/styles/tokens.css"
    test -f "$root/styles/base.css"
    test -f "$root/styles/layout.css"
    test -f "$root/styles/components.css"
    test -f "$root/styles/utilities.css"
    test -f "$root/styles/responsive.css"
    test -f "$root/js/app.js"
    test -f "$root/js/gateway-client.js"
    test -f "$root/js/components/atoms.js"
    test -f "$root/js/components/molecules.js"
    test -f "$root/js/components/organisms/chat-panel.js"
    test -f "$root/js/controllers/chat-controller.js"

    find "$root" -name '*.js' -exec node --check {} \;
    node --check "$server"

    grep -qi 'Ownloom Cockpit' "$root/index.html"
    grep -qi 'Ownloom Component Loom' "$root/components.html"
    grep -q 'page-layout' "$root/index.html"
    grep -q 'page-sidebar' "$root/index.html"
    grep -q 'components.html' "$root/index.html"
    grep -q 'component-index' "$root/components.html"
    ! grep -q 'type="module"' "$root/components.html"
    ! grep -q 'rel="manifest"' "$root/index.html"
    ! grep -q 'pwaStatus' "$root/index.html"
    grep -q 'role="tablist"' "$root/index.html"
    grep -q 'role="tab"' "$root/index.html"
    grep -q 'aria-controls="tab-terminal"' "$root/index.html"
    grep -q 'terminalFrame' "$root/index.html"
    grep -q 'copyTerminalTokenButton' "$root/index.html"
    grep -q '/terminal/ownloom' "$root/index.html"
    grep -q 'pairButton' "$root/index.html"
    grep -q 'newChatButton' "$root/index.html"
    grep -q 'threadRailToggle' "$root/index.html"
    ! grep -q 'plannerRefreshButton' "$root/index.html"
    ! grep -q 'plannerOverdueList' "$root/index.html"
    ! grep -q 'plannerUndatedList' "$root/index.html"
    grep -q 'radicaleFrame' "$root/index.html"
    grep -q '/radicale/' "$root/index.html"
    grep -q 'Gateway access workspace' "$root/index.html"
    grep -q 'Trace rail' "$root/index.html"
    ! grep -R -q '/api/planner' "$root"
    grep -R -q 'agent.wait' "$root"
    grep -R -q 'data-session-switch-chat' "$root"
    grep -R -q '/api/v1/pair' "$root"
    grep -R -q '/api/v1/attachments' "$root"
    grep -R -q 'deliveries.list' "$root"
    grep -R -q 'clients.list' "$root"
    grep -R -q 'createTabController' "$root"
    grep -R -q 'copyTerminalToken' "$root"
    grep -R -q 'cleanupOldServiceWorkers' "$root"
    grep -R -q 'setupThreadRail' "$root"
    ! grep -R -q 'registerPwa' "$root"
    ! grep -q 'application/manifest+json' "$server"
    grep -q 'Content-Security-Policy' "$server"
    grep -q "font-src 'self'" "$server"
    grep -q 'font/woff2' "$server"
    grep -q 'wss://localhost' "$server"
    grep -q 'Misdirected request' "$server"
    grep -q 'Bad request' "$server"
    grep -q 'no-store, max-age=0' "$server"
    grep -q '/api/v1/terminal-token' "$server"
    grep -q 'stripTerminalPrefix' "$server"
    ! grep -q 'stripPlannerPrefix' "$server"
    grep -q 'stripRadicalePrefix' "$server"
    grep -q 'OWNLOOM_RADICALE_URL' "$server"
    grep -q 'OWNLOOM_RADICALE_USER' "$server"

    token_file=$(mktemp)
    printf '# smoke token\nsmoke-zellij-token\n' > "$token_file"

    cat > radicale-upstream.mjs <<'EOF'
    import { createServer } from "node:http";
    createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ url: req.url, scriptName: req.headers["x-script-name"] ?? "" }));
    }).listen(18083, "127.0.0.1");
  EOF
    node radicale-upstream.mjs >radicale-upstream.log 2>&1 &
    radicale_pid=$!

    OWNLOOM_GATEWAY_WEB_HOST=127.0.0.1 \
    OWNLOOM_GATEWAY_WEB_PORT=18090 \
    OWNLOOM_RADICALE_URL=http://127.0.0.1:18083 \
    OWNLOOM_RADICALE_USER=smoke-user \
    OWNLOOM_TERMINAL_TOKEN_FILE="$token_file" \
    ${ownloom-gateway-web}/bin/ownloom-gateway-web >server.log 2>&1 &
    server_pid=$!
    trap 'kill $server_pid $radicale_pid 2>/dev/null || true' EXIT

    for _ in $(seq 1 20); do
      if curl -fsS -D /tmp/index.headers http://127.0.0.1:18090/ >/tmp/index.html 2>/dev/null; then
        break
      fi
      sleep 0.1
    done
    grep -qi 'Ownloom Cockpit' /tmp/index.html
    grep -qi 'content-security-policy:' /tmp/index.headers
    grep -qi 'x-content-type-options: nosniff' /tmp/index.headers
    grep -qi 'referrer-policy: no-referrer' /tmp/index.headers

    curl -fsS -D /tmp/components.headers http://127.0.0.1:18090/components.html >/tmp/components.html
    grep -qi 'content-type: text/html' /tmp/components.headers
    grep -qi 'Ownloom Component Loom' /tmp/components.html
    grep -q 'Back to cockpit' /tmp/components.html

    curl -fsS -D /tmp/style.headers http://127.0.0.1:18090/style.css >/tmp/style.css
    grep -qi 'content-type: text/css' /tmp/style.headers
    grep -q './vendor/pico.min.css' /tmp/style.css

    curl -fsS -D /tmp/pico.headers http://127.0.0.1:18090/vendor/pico.min.css >/tmp/pico.min.css
    grep -qi 'content-type: text/css' /tmp/pico.headers
    grep -q 'Pico CSS' /tmp/pico.min.css

    curl -fsS -D /tmp/newsreader.headers http://127.0.0.1:18090/vendor/fonts/newsreader-var.ttf >/tmp/newsreader.ttf
    grep -qi 'content-type: font/ttf' /tmp/newsreader.headers
    curl -fsS -D /tmp/jetbrains.headers http://127.0.0.1:18090/vendor/fonts/jetbrains-mono-var.woff2 >/tmp/jetbrains.woff2
    grep -qi 'content-type: font/woff2' /tmp/jetbrains.headers

    curl -sS -D /tmp/manifest.headers http://127.0.0.1:18090/manifest.webmanifest >/tmp/manifest.webmanifest || true
    grep -q '404' /tmp/manifest.headers

    curl -sS -D /tmp/sw.headers http://127.0.0.1:18090/sw.js >/tmp/sw.js || true
    grep -q '404' /tmp/sw.headers

    curl -fsS -D /tmp/terminal-token.headers http://127.0.0.1:18090/api/v1/terminal-token >/tmp/terminal-token.json
    grep -q '"token":"smoke-zellij-token"' /tmp/terminal-token.json
    grep -qi 'cache-control: no-store' /tmp/terminal-token.headers

    curl -sS -D /tmp/proxy.headers http://127.0.0.1:18090/api/v1/status >/tmp/proxy.json || true
    grep -qi 'cache-control: no-store' /tmp/proxy.headers

    curl -sS -D /tmp/planner-removed.headers http://127.0.0.1:18090/api/planner/items >/tmp/planner-removed.txt || true
    grep -q '404' /tmp/planner-removed.headers

    curl -fsS -D /tmp/radicale.headers http://127.0.0.1:18090/radicale/.web/ >/tmp/radicale.json
    grep -qi 'cache-control: no-store' /tmp/radicale.headers
    grep -q '"url":"/.web/"' /tmp/radicale.json
    grep -q '"scriptName":"/radicale"' /tmp/radicale.json

    curl -fsS -D /tmp/radicale-js.headers http://127.0.0.1:18090/radicale/.web/js/main.js >/tmp/radicale-main.js
    grep -qi 'cache-control: no-store' /tmp/radicale-js.headers
    grep -q 'LoginScene' /tmp/radicale-main.js
    grep -q '_perform_login("smoke-user", "ownloom")' /tmp/radicale-main.js

    curl -sS -D /tmp/host.headers -H 'Host: evil.example' http://127.0.0.1:18090/ >/tmp/host.txt || true
    grep -q '421' /tmp/host.headers

    curl -sS -D /tmp/origin.headers -H 'Origin: http://evil.example' http://127.0.0.1:18090/ >/tmp/origin.txt || true
    grep -q '421' /tmp/origin.headers

    curl --path-as-is -sS -D /tmp/bad-path.headers http://127.0.0.1:18090/%E0%A4%A >/tmp/bad-path.txt || true
    grep -q '400' /tmp/bad-path.headers

    mkdir -p $out
    touch $out/passed
''
