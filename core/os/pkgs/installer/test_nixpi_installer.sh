#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="${1:?installer script path required}"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

GUM_STUB="$TMPDIR/gum"
NMCLI_STUB="$TMPDIR/nmcli"
ONLINE_FLAG="$TMPDIR/online"
NMCLI_LOG="$TMPDIR/nmcli.log"

cat >"$GUM_STUB" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "${TEST_GUM_SELECTION:?missing TEST_GUM_SELECTION}"
EOF
chmod +x "$GUM_STUB"

cat >"$NMCLI_STUB" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"${TEST_NMCLI_LOG:?missing TEST_NMCLI_LOG}"
if [[ "${1:-}" == "--colors" && "${5:-}" == "rescan" ]]; then
  exit 0
fi
if [[ "${1:-}" == "--colors" && "${5:-}" == "list" ]]; then
  printf '%s\n' "SSID  SIGNAL"
  printf '%s\n' "TestNet  80"
  exit 0
fi
if [[ "${1:-}" == "--wait" && "${3:-}" == "device" && "${4:-}" == "wifi" && "${5:-}" == "connect" ]]; then
  : >"${TEST_ONLINE_FLAG:?missing TEST_ONLINE_FLAG}"
  exit 0
fi
printf '%s\n' "unexpected nmcli invocation: $*" >&2
exit 1
EOF
chmod +x "$NMCLI_STUB"

source "$SCRIPT_PATH"

require_tty() {
  :
}

network_online() {
  [[ -f "$ONLINE_FLAG" ]]
}

assert_contains() {
  local needle="$1"
  local path="$2"
  grep -F -- "$needle" "$path" >/dev/null
}

export TEST_GUM_SELECTION="Connect to WiFi with nmcli"
export TEST_NMCLI_LOG="$NMCLI_LOG"
export TEST_ONLINE_FLAG="$ONLINE_FLAG"
GUM_BIN="$GUM_STUB"
PATH="$TMPDIR:$PATH"
rm -f "$ONLINE_FLAG" "$NMCLI_LOG"

prompt_network_setup <<< $'TestNet\nsupersecret\n'

[[ -f "$ONLINE_FLAG" ]]
assert_contains "--colors no device wifi rescan" "$NMCLI_LOG"
assert_contains "--colors no device wifi list" "$NMCLI_LOG"
assert_contains "--wait 30 device wifi connect TestNet password supersecret" "$NMCLI_LOG"

export TEST_GUM_SELECTION="Continue without network"
rm -f "$ONLINE_FLAG" "$NMCLI_LOG"
prompt_network_setup </dev/null
[[ ! -f "$ONLINE_FLAG" ]]
