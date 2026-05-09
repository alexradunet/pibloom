{
  jq,
  ownloom-wiki,
  runCommand,
}:
runCommand "ownloom-wiki-cli-smoke" {
  nativeBuildInputs = [ownloom-wiki jq];
} ''
  set -euo pipefail
  unset OWNLOOM_WIKI_ROOT
  export OWNLOOM_WIKI_ROOT_PERSONAL="$TMPDIR/wiki-personal"
  export OWNLOOM_WIKI_ROOT_TECHNICAL="$TMPDIR/wiki-technical"
  export OWNLOOM_WIKI_HOST="smoke-host"
  mkdir -p "$OWNLOOM_WIKI_ROOT_TECHNICAL/objects"
  cat > "$OWNLOOM_WIKI_ROOT_TECHNICAL/objects/smoke.md" <<'EOF'
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
  ownloom-wiki call wiki_status '{"domain":"personal"}' | grep "Wiki not initialized"
  ownloom-wiki context --format json | jq -e '.host == "smoke-host" and .wikiRoots.technical == env.OWNLOOM_WIKI_ROOT_TECHNICAL and .wikiRoots.personal == env.OWNLOOM_WIKI_ROOT_PERSONAL'
  ownloom-wiki doctor --json > doctor.json || true
  jq -e '.checks[] | select(.name == "wiki-status") | .ok == true' doctor.json
  touch $out
''
