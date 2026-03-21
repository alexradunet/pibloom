#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT_DIR="${NIXPI_DESKTOP_INTERACTION_ARTIFACT_DIR:-/tmp/nixpi-desktop-interaction}"
VM_DISK="${NIXPI_DESKTOP_INTERACTION_VM_DISK:-/tmp/nixpi-desktop-interaction.qcow2}"
VM_LOG="${NIXPI_DESKTOP_INTERACTION_VM_LOG:-/tmp/nixpi-desktop-interaction.log}"
SSH_PORT="${NIXPI_DESKTOP_INTERACTION_SSH_PORT:-2222}"

SSH_OPTS=(
    -o StrictHostKeyChecking=no
    -o UserKnownHostsFile=/dev/null
    -o ConnectTimeout=5
    -p "${SSH_PORT}"
)
SCP_OPTS=(
    -o StrictHostKeyChecking=no
    -o UserKnownHostsFile=/dev/null
    -o ConnectTimeout=5
    -P "${SSH_PORT}"
)

cleanup() {
    local pid
    pid="$(pgrep -f "[q]emu-system-x86_64.*${VM_DISK}" || true)"
    if [[ -n "${pid}" ]]; then
        kill "${pid}" >/dev/null 2>&1 || true
        sleep 2
        kill -9 "${pid}" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT

mkdir -p "${ARTIFACT_DIR}"
rm -f "${ARTIFACT_DIR}/result.json" "${ARTIFACT_DIR}/root.png"
cleanup

pushd "${ROOT_DIR}" >/dev/null
nix build .#nixosConfigurations.desktop-vm.config.system.build.vm

NIXPI_VM_DISK_PATH="${VM_DISK}" \
NIXPI_VM_LOG_PATH="${VM_LOG}" \
tools/run-qemu.sh --mode daemon

for _ in $(seq 1 90); do
    if ssh "${SSH_OPTS[@]}" pi@localhost "echo ready" >/dev/null 2>&1; then
        break
    fi
    sleep 2
done

ssh "${SSH_OPTS[@]}" pi@localhost "echo ready" >/dev/null

scp "${SCP_OPTS[@]}" "${ROOT_DIR}/tools/desktop-probe.sh" pi@localhost:/tmp/desktop-probe.sh >/dev/null
ssh "${SSH_OPTS[@]}" pi@localhost "chmod +x /tmp/desktop-probe.sh && /tmp/desktop-probe.sh >/tmp/nixpi-desktop-probe.stdout"
scp "${SCP_OPTS[@]}" pi@localhost:/tmp/nixpi-desktop-probe/result.json "${ARTIFACT_DIR}/result.json" >/dev/null
scp "${SCP_OPTS[@]}" pi@localhost:/tmp/nixpi-desktop-probe/root.png "${ARTIFACT_DIR}/root.png" >/dev/null

jq -e '.status == "pass"' "${ARTIFACT_DIR}/result.json" >/dev/null
echo "Desktop interaction probe passed."
echo "Artifacts:"
echo "  ${ARTIFACT_DIR}/result.json"
echo "  ${ARTIFACT_DIR}/root.png"
popd >/dev/null
