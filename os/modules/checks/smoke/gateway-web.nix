{
  nodejs,
  ownloom-gateway-web,
  runCommand,
}:
runCommand "ownloom-gateway-web-smoke" {
  nativeBuildInputs = [nodejs];
} ''
  root=${ownloom-gateway-web}/share/ownloom-gateway-web/public

  test -f "$root/index.html"
  test -f "$root/app.js"
  test -f "$root/style.css"

  node --check "$root/app.js"

  grep -qi 'protocol/v1' "$root/index.html"
  grep -q 'agent.wait' "$root/app.js"
  grep -q '/api/v1/attachments' "$root/app.js"
  grep -q 'deliveries.list' "$root/app.js"

  mkdir -p $out
  touch $out/passed
''
