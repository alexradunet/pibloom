{
  jq,
  ownloom-wiki,
  runCommand,
}:
runCommand "ownloom-wiki-cli-smoke" {
  nativeBuildInputs = [ownloom-wiki jq];
} ''
  set -euo pipefail
  export OWNLOOM_WIKI_ROOT="$TMPDIR/wiki"
  export OWNLOOM_WIKI_HOST="smoke-host"
  mkdir -p "$OWNLOOM_WIKI_ROOT/objects"
  cat > "$OWNLOOM_WIKI_ROOT/objects/smoke.md" <<'EOF'
  ---
  type: concept
  title: Smoke Page
  domain: technical
  areas: [tests]
  hosts: []
  status: active
  updated: 2026-04-27
  source_ids: []
  summary: Smoke page.
  ---
  # Smoke Page
  EOF
  ownloom-wiki list --json | jq -e 'all(.[]; .name | startswith("wiki_"))'
  ownloom-wiki list | grep wiki_status
  ownloom-wiki describe wiki_status | grep "Wiki Status"
  ownloom-wiki call wiki_status '{"domain":"technical"}' | grep "Pages: 1 total"
  ownloom-wiki context --format json | jq -e '.host == "smoke-host"'
  ownloom-wiki doctor --json > doctor.json || true
  jq -e '.checks[] | select(.name == "wiki-status") | .ok == true' doctor.json
  touch $out
''
