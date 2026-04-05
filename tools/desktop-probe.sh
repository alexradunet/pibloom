#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_DIR="${NIXPI_DESKTOP_PROBE_DIR:-/tmp/nixpi-desktop-probe}"
WINDOW_TITLE="${NIXPI_DESKTOP_PROBE_WINDOW_TITLE:-NixPIDesktopProbe}"
SCREENSHOT_PATH="${ARTIFACT_DIR}/root.png"
RESULT_PATH="${ARTIFACT_DIR}/result.json"
PRIMARY_HOME="${NIXPI_DESKTOP_PROBE_HOME:-/home/human}"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-${PRIMARY_HOME}/.Xauthority}"

mkdir -p "${ARTIFACT_DIR}"

wait_for() {
    local description="$1"
    shift
    for _ in $(seq 1 120); do
        if "$@" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done
    echo "Timed out waiting for ${description}" >&2
    return 1
}

cleanup() {
    if [[ -n "${probe_pid:-}" ]]; then
        kill "${probe_pid}" >/dev/null 2>&1 || true
        wait "${probe_pid}" 2>/dev/null || true
    fi
}
trap cleanup EXIT

wait_for "X authority" test -f "${XAUTHORITY}"
wait_for "desktop window manager" wmctrl -m

xterm -title "${WINDOW_TITLE}" -e "sleep 300" >/tmp/nixpi-desktop-probe-xterm.log 2>&1 &
probe_pid=$!

wait_for "probe window" sh -c "wmctrl -l | grep -q '${WINDOW_TITLE}'"

window_id="$(wmctrl -lx | awk '/'"${WINDOW_TITLE}"'/ { print $1; exit }')"
wm_name="$(wmctrl -m | sed -n 's/^Name: //p' | head -n1)"

xdotool search --name "${WINDOW_TITLE}" windowactivate --sync
wmctrl -r "${WINDOW_TITLE}" -e 0,120,140,700,420

wait_for "window geometry update" sh -c \
    "[ \"\$(wmctrl -lG | awk '/${WINDOW_TITLE}/ { print \$3\",\"\$4\",\"\$5\",\"\$6; exit }')\" = '120,140,700,420' ]"

geometry="$(wmctrl -lG | awk '/'"${WINDOW_TITLE}"'/ { print $3\",\"$4\",\"$5\",\"$6; exit }')"
scrot "${SCREENSHOT_PATH}"

jq -n \
    --arg status "pass" \
    --arg window_title "${WINDOW_TITLE}" \
    --arg window_id "${window_id}" \
    --arg wm_name "${wm_name}" \
    --arg geometry "${geometry}" \
    --arg screenshot "${SCREENSHOT_PATH}" \
    '{
      status: $status,
      window_title: $window_title,
      window_id: $window_id,
      wm_name: $wm_name,
      geometry: $geometry,
      screenshot: $screenshot
    }' > "${RESULT_PATH}"

cat "${RESULT_PATH}"
