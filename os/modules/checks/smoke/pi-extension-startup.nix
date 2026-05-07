{
  pi,
  runCommand,
}:
runCommand "ownloom-pi-extension-startup-smoke" {
  nativeBuildInputs = [pi];
} ''
  set -euo pipefail

  export HOME="$TMPDIR/home"
  export PI_CODING_AGENT_DIR="$TMPDIR/agent"
  export PI_OFFLINE=1
  export OWNLOOM_WIKI_ROOT="$TMPDIR/wiki"
  export OWNLOOM_WIKI_WORKSPACE=smoke
  export OWNLOOM_WIKI_DEFAULT_DOMAIN=technical
  export NODE_PATH=${pi}/lib/node_modules/@mariozechner/pi-coding-agent/node_modules:${pi}/lib/node_modules
  mkdir -p "$HOME" "$PI_CODING_AGENT_DIR" "$OWNLOOM_WIKI_ROOT"

  set +e
  repo=${../../../..}
  pi \
    --extension "$repo/os/pkgs/pi-adapter/extension" \
    --provider nonexistent \
    --model fake \
    --print \
    --no-tools \
    --no-session \
    'extension load smoke' >stdout.log 2>stderr.log
  status=$?
  set -e

  if grep -q 'Failed to load extension' stderr.log stdout.log; then
    cat stderr.log
    cat stdout.log
    exit 1
  fi
  grep -q 'Unknown provider' stderr.log
  test "$status" -ne 0

  touch $out
''
