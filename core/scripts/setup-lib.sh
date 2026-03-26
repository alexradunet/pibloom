#!/usr/bin/env bash
# setup-lib.sh — Shared function library for setup-wizard.sh.
# Source this file; do not execute directly.
#
# Provides: checkpoint management, NetBird utilities,
#           built-in service runtime generation.
#
# Required env vars (callers must set before sourcing):
#   WIZARD_STATE        — path to checkpoint directory (e.g. ~/.nixpi/wizard-state)
#   PI_DIR              — path to Pi config dir (typically ~/.pi)
#   NIXPI_CONFIG        — path to NixPI service config dir
#   NIXPI_DIR           — path to the user-editable NixPI workspace (typically ~/nixpi)

# --- Checkpoint helpers ---

mark_done() {
	mkdir -p "$WIZARD_STATE"
	echo "$(date -Iseconds)" > "$WIZARD_STATE/$1"
}

# Store data alongside a checkpoint (e.g., mesh IP)
mark_done_with() {
	mkdir -p "$WIZARD_STATE"
	printf '%s\n%s\n' "$(date -Iseconds)" "$2" > "$WIZARD_STATE/$1"
}

# Read stored data from a checkpoint (line 2+)
read_checkpoint_data() {
	[[ -f "$WIZARD_STATE/$1" ]] && sed -n '2p' "$WIZARD_STATE/$1" || echo ""
}

netbird_status_json() {
	netbird status --json 2>/dev/null || true
}

netbird_fqdn() {
	local status
	status=$(netbird_status_json)
	[[ -n "$status" ]] || return 0
	jq -r '.fqdn // empty' <<< "$status"
}

netbird_ip() {
	local status
	status=$(netbird_status_json)
	[[ -n "$status" ]] || return 0
	jq -r '.netbirdIp // empty | split("/")[0]' <<< "$status"
}

canonical_state_dir() {
	printf '%s/access-state' "$NIXPI_CONFIG"
}

stored_canonical_host() {
	local path
	path="$(canonical_state_dir)/canonical-host"
	[[ -f "$path" ]] && cat "$path" || true
}

current_canonical_host() {
	netbird_fqdn
}

record_canonical_host() {
	local host="$1"
	[[ -n "$host" ]] || return 0
	mkdir -p "$(canonical_state_dir)"
	printf '%s' "$host" > "$(canonical_state_dir)/canonical-host"
}

canonical_access_mode() {
	local current stored
	current=$(current_canonical_host)
	stored=$(stored_canonical_host)
	if [[ -n "$current" ]]; then
		echo "healthy"
	elif [[ -n "$stored" ]]; then
		echo "degraded"
	else
		echo "not-ready"
	fi
}

canonical_service_host() {
	local current stored
	current=$(current_canonical_host)
	if [[ -n "$current" ]]; then
		record_canonical_host "$current"
		printf '%s' "$current"
		return 0
	fi
	stored=$(stored_canonical_host)
	if [[ -n "$stored" ]]; then
		printf '%s' "$stored"
	fi
	return 0
}

root_command() {
	if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
		"$@"
		return
	fi

	local sudo_bin=""
	if command -v sudo >/dev/null 2>&1; then
		sudo_bin="$(command -v sudo)"
	elif [[ -x /run/wrappers/bin/sudo ]]; then
		sudo_bin="/run/wrappers/bin/sudo"
	fi

	if [[ -n "$sudo_bin" ]]; then
		"$sudo_bin" "$@"
	else
		"$@"
	fi
}

read_bootstrap_primary_password() {
	if command -v nixpi-bootstrap-read-primary-password >/dev/null 2>&1; then
		root_command nixpi-bootstrap-read-primary-password 2>/dev/null || true
	fi
}


write_service_home_runtime() {
	local _mesh_ip="$1" _mesh_fqdn="$2"
	local canonical_host mode page_url element_web_url generated_at access_message
	canonical_host=$(canonical_service_host)
	mode=$(canonical_access_mode)

	if [[ -n "$canonical_host" ]]; then
		page_url="https://${canonical_host}/"
		element_web_url="https://${canonical_host}/element/"
	else
		page_url="http://localhost/"
		element_web_url="http://localhost/"
	fi

	case "$mode" in
		healthy)
			access_message="Use the NetBird hostname below as the one canonical access path for Home, Element Web, and Matrix."
			;;
		degraded)
			access_message="Canonical NetBird access is temporarily unavailable on this box. Recover locally via http://localhost/ without changing the canonical host."
			;;
		*)
			access_message="Canonical NetBird access is not ready yet. Finish NetBird setup, then use localhost only as an on-box recovery path."
			;;
	esac
	generated_at=$(date -Iseconds)

	local template="/usr/local/share/nixpi/home-template.html"
	mkdir -p "$NIXPI_CONFIG/home"
	sed \
		-e "s|@@CANONICAL_HOST@@|${canonical_host:-not available}|g" \
		-e "s|@@PAGE_URL@@|${page_url}|g" \
		-e "s|@@ELEMENT_WEB_URL@@|${element_web_url}|g" \
		-e "s|@@ACCESS_MESSAGE@@|${access_message}|g" \
		-e "s|@@GENERATED_AT@@|${generated_at}|g" \
		"$template" > "$NIXPI_CONFIG/home/index.html"
}

install_home_infrastructure() {
	mkdir -p "$NIXPI_CONFIG/home"
}

write_element_web_runtime_config() {
	mkdir -p "$NIXPI_CONFIG/element-web"
	cat > "$NIXPI_CONFIG/element-web/config.json" <<'EOF'
{
  "default_server_config": {
    "m.homeserver": {
      "base_url": "https://matrix.org",
      "server_name": "matrix.org"
    }
  },
  "disable_custom_urls": true,
  "brand": "NixPI Element Web"
}
EOF
}







