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

  test -f "$root/index.html"
  test -f "$root/app.js"
  test -f "$root/style.css"

  node --check "$root/app.js"
  node --check ${ownloom-gateway-web}/share/ownloom-gateway-web/server.mjs

  grep -qi 'Ownloom Cockpit' "$root/index.html"
  grep -q 'data-tab-target="terminal"' "$root/index.html"
  grep -q 'terminalFrame' "$root/index.html"
  grep -q 'pairButton' "$root/index.html"
  grep -q 'newChatButton' "$root/index.html"
  grep -q 'agent.wait' "$root/app.js"
  grep -q 'data-session-switch' "$root/app.js"
  grep -q '/api/v1/pair' "$root/app.js"
  grep -q '/api/v1/attachments' "$root/app.js"
  grep -q 'deliveries.list' "$root/app.js"
  grep -q 'clients.list' "$root/app.js"
  grep -q 'selectTab' "$root/app.js"

  OWNLOOM_GATEWAY_WEB_HOST=127.0.0.1 \
  OWNLOOM_GATEWAY_WEB_PORT=18090 \
  ${ownloom-gateway-web}/bin/ownloom-gateway-web >server.log 2>&1 &
  server_pid=$!
  trap 'kill $server_pid 2>/dev/null || true' EXIT

  for _ in $(seq 1 20); do
    if curl -fsS http://127.0.0.1:18090/ >/tmp/index.html; then
      break
    fi
    sleep 0.1
  done
  grep -qi 'Ownloom Cockpit' /tmp/index.html

  mkdir -p $out
  touch $out/passed
''
