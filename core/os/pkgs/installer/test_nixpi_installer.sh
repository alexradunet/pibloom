#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="${1:?installer script path required}"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

NMCLI_STUB="$TMPDIR/nmcli"
ONLINE_FLAG="$TMPDIR/online"
NMCLI_LOG="$TMPDIR/nmcli.log"

cat >"$NMCLI_STUB" <<EOF
#!$BASH
set -euo pipefail
printf '%s\n' "\$*" >>"\${TEST_NMCLI_LOG:?missing TEST_NMCLI_LOG}"
if [[ "\${1:-}" == "--colors" && "\${5:-}" == "rescan" ]]; then
  exit 0
fi
if [[ "\${1:-}" == "--colors" && "\${5:-}" == "list" ]]; then
  printf '%s\n' "SSID  SIGNAL"
  printf '%s\n' "TestNet  80"
  exit 0
fi
if [[ "\${1:-}" == "--wait" && "\${3:-}" == "device" && "\${4:-}" == "wifi" && "\${5:-}" == "connect" ]]; then
  : >"\${TEST_ONLINE_FLAG:?missing TEST_ONLINE_FLAG}"
  exit 0
fi
printf '%s\n' "unexpected nmcli invocation: \$*" >&2
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

export TEST_NMCLI_LOG="$NMCLI_LOG"
export TEST_ONLINE_FLAG="$ONLINE_FLAG"
PATH="$TMPDIR:$PATH"
rm -f "$ONLINE_FLAG" "$NMCLI_LOG"

prompt_network_setup <<< $'2\nTestNet\nsupersecret\n'

[[ -f "$ONLINE_FLAG" ]]
assert_contains "--colors no device wifi rescan" "$NMCLI_LOG"
assert_contains "--colors no device wifi list" "$NMCLI_LOG"
assert_contains "--wait 30 device wifi connect TestNet password supersecret" "$NMCLI_LOG"

rm -f "$ONLINE_FLAG" "$NMCLI_LOG"
prompt_network_setup <<< $'3\n'
[[ ! -f "$ONLINE_FLAG" ]]
