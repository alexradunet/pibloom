#!/usr/bin/env bash
# setup-lib.sh — Shared function library for setup-wizard.sh.
# Source this file; do not execute directly.
#
# Provides: checkpoint management, NetBird utilities, Matrix API/state,
#           built-in service runtime generation, and step_matrix.
#
# Required env vars (callers must set before sourcing):
#   WIZARD_STATE        — path to checkpoint directory (e.g. ~/.nixpi/wizard-state)
#   MATRIX_STATE_DIR    — path to matrix state directory
#   MATRIX_HOMESERVER   — Matrix homeserver URL (e.g. http://localhost:6167)
#   PI_DIR              — path to Pi config dir (e.g. /var/lib/nixpi/agent or ~/.pi)
#   NIXPI_CONFIG        — path to NixPI service config dir
#   NIXPI_DIR           — path to NixPI home dir

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

# --- Matrix state helpers ---

matrix_state_get() {
	[[ -f "$MATRIX_STATE_DIR/$1" ]] && cat "$MATRIX_STATE_DIR/$1" || true
}

matrix_state_set() {
	mkdir -p "$MATRIX_STATE_DIR"
	printf '%s' "$2" > "$MATRIX_STATE_DIR/$1"
}

matrix_state_clear() {
	rm -rf "$MATRIX_STATE_DIR"
}

# --- Matrix helpers ---

# Generate a secure random password (base64url, 32 chars)
generate_password() {
	openssl rand -base64 24 | tr '+/' '-_'
}


# Register a Matrix account.
# Usage: matrix_register <username> <password>
# Outputs: JSON with user_id and access_token on success, exits 1 on failure
matrix_register() {
	local username="$1" password="$2"
	local url="${MATRIX_HOMESERVER}/_matrix/client/v3/register"
	local step1
	step1=$(curl -s -X POST "$url" \
		-H "Content-Type: application/json" \
		-d "{\"username\":\"${username}\",\"password\":\"${password}\",\"inhibit_login\":false}")

	if echo "$step1" | grep -q '"access_token"'; then
		echo "$step1"
		return 0
	fi

	local session
	session=$(jq -r '.session // empty' <<< "$step1")
	if [[ -n "$session" ]]; then
		local step2
		step2=$(curl -s -X POST "$url" \
			-H "Content-Type: application/json" \
			-d "{\"username\":\"${username}\",\"password\":\"${password}\",\"inhibit_login\":false,\"auth\":{\"type\":\"m.login.dummy\",\"session\":\"${session}\"}}")
		if echo "$step2" | grep -q '"access_token"'; then
			echo "$step2"
			return 0
		fi
		echo "$step2"
		return 0
	fi

	if ! echo "$step1" | grep -q '"errcode"'; then
		echo "ERROR: Matrix registration failed for ${username}" >&2
		return 1
	fi

	echo "$step1"
	return 0
}

# Password-login an existing Matrix account.
# Usage: matrix_login <username> <password>
# Outputs: JSON with user_id and access_token on success, exits 1 on failure
matrix_login() {
	local username="$1" password="$2"
	local url="${MATRIX_HOMESERVER}/_matrix/client/v3/login"
	local result
	result=$(curl -s -X POST "$url" \
		-H "Content-Type: application/json" \
		-d "{\"type\":\"m.login.password\",\"identifier\":{\"type\":\"m.id.user\",\"user\":\"${username}\"},\"password\":\"${password}\"}")

	if ! echo "$result" | grep -q '"access_token"'; then
		return 1
	fi

	echo "$result"
	return 0
}

load_existing_matrix_credentials() {
	[[ -f "$PI_DIR/matrix-credentials.json" ]] || return 0
	local raw
	raw=$(cat "$PI_DIR/matrix-credentials.json" 2>/dev/null || true)
	[[ -n "$raw" ]] || return 0

	local bot_token bot_user_id bot_password user_user_id user_password username
	bot_token=$(jq -r '.botAccessToken // empty' <<< "$raw")
	bot_user_id=$(jq -r '.botUserId // empty' <<< "$raw")
	bot_password=$(jq -r '.botPassword // empty' <<< "$raw")
	user_user_id=$(jq -r '.userUserId // empty' <<< "$raw")
	user_password=$(jq -r '.userPassword // empty' <<< "$raw")
	if [[ -n "$bot_token" ]]; then matrix_state_set bot_token "$bot_token"; fi
	if [[ -n "$bot_user_id" ]]; then matrix_state_set bot_user_id "$bot_user_id"; fi
	if [[ -n "$bot_password" ]]; then matrix_state_set bot_password "$bot_password"; fi
	if [[ -n "$user_user_id" ]]; then matrix_state_set user_user_id "$user_user_id"; fi
	if [[ -n "$user_password" ]]; then matrix_state_set user_password "$user_password"; fi
	if [[ "$user_user_id" =~ ^@([^:]+): ]]; then
		username="${BASH_REMATCH[1]}"
		matrix_state_set username "$username"
	fi
}

write_service_home_runtime() {
	local mesh_ip="$1" mesh_fqdn="$2"
	local mesh_host page_url generated_at
	mesh_host="${mesh_fqdn:-$mesh_ip}"
	[[ -n "$mesh_host" ]] || mesh_host="localhost"
	page_url="http://${mesh_host}:8080"
	generated_at=$(date -Iseconds)

	local template="/usr/local/share/nixpi/home-template.html"
	mkdir -p "$NIXPI_CONFIG/home"
	sed \
		-e "s|@@MESH_HOST@@|${mesh_host}|g" \
		-e "s|@@PAGE_URL@@|${page_url}|g" \
		-e "s|@@CHAT_URL@@|http://${mesh_host}:8081|g" \
		-e "s|@@MATRIX_URL@@|http://${mesh_host}:6167|g" \
		-e "s|@@GENERATED_AT@@|${generated_at}|g" \
		"$template" > "$NIXPI_CONFIG/home/index.html"
}

install_home_infrastructure() {
	mkdir -p "$NIXPI_CONFIG/home"
}

write_element_web_runtime_config() {
	local mesh_fqdn mesh_ip primary_host primary_matrix_url
	mesh_fqdn=$(netbird_fqdn)
	mesh_ip=$(netbird_ip)
	primary_host="${mesh_fqdn:-$mesh_ip}"
	primary_matrix_url="http://localhost:6167"

	if [[ -n "$primary_host" ]]; then
		primary_matrix_url="http://${primary_host}:6167"
	fi

	mkdir -p "$NIXPI_CONFIG/chat"
	cat > "$NIXPI_CONFIG/chat/config.json" <<-CONFIG
	{
	  "default_server_config": {
	    "m.homeserver": {
	      "base_url": "${primary_matrix_url}",
	      "server_name": "${primary_host:-localhost}"
	    }
	  },
	  "brand": "Element",
	  "disable_guests": true
	}
	CONFIG
}

start_matrix_homeserver() {
	if systemctl is-active --quiet matrix-synapse.service; then
		return 0
	fi

	if command -v nixpi-bootstrap-matrix-systemctl >/dev/null 2>&1; then
		root_command nixpi-bootstrap-matrix-systemctl start matrix-synapse.service >/dev/null 2>&1 || true
	else
		root_command systemctl start matrix-synapse.service >/dev/null 2>&1 || true
	fi
}

step_matrix() {
	echo ""
	echo "--- Matrix Messaging ---"
	echo "Setting up Matrix messaging..."
	echo ""

	# Wait for Matrix homeserver
	echo "Waiting for Matrix homeserver..."
	start_matrix_homeserver
	local attempts=0
	while ! systemctl is-active --quiet matrix-synapse.service; do
		attempts=$((attempts + 1))
		if [[ $attempts -eq 30 ]]; then
			start_matrix_homeserver
		fi
		if [[ $attempts -ge 120 ]]; then
			echo "ERROR: matrix-synapse.service did not start within 120 seconds." >&2
			if command -v nixpi-bootstrap-matrix-journal >/dev/null 2>&1; then
				echo "Recent matrix-synapse logs:" >&2
				root_command nixpi-bootstrap-matrix-journal >&2 || true
			else
				root_command journalctl -u matrix-synapse --no-pager >&2 || true
			fi
			echo "Run 'systemctl status matrix-synapse' to debug." >&2
			return 1
		fi
		sleep 1
	done
	echo "Matrix homeserver is running."

	# Read registration token
	load_existing_matrix_credentials

	# Prompt for username
	local username
	username=$(matrix_state_get username)
	if [[ -z "$username" ]]; then
		if [[ -n "${PREFILL_USERNAME:-}" ]]; then
			username="$PREFILL_USERNAME"
			echo "Username: [prefilled as ${username}]"
			matrix_state_set username "$username"
		else
			while true; do
				read -rp "Choose a username for your Matrix account (cannot be changed later): " username
				if [[ -z "$username" ]]; then
					echo "Username cannot be empty."
					continue
				fi
				if [[ ! "$username" =~ ^[a-z][a-z0-9._-]*$ ]]; then
					echo "Username must start with a lowercase letter and contain only a-z, 0-9, '.', '_', '-'."
					continue
				fi
				matrix_state_set username "$username"
				break
			done
		fi
	else
		echo "Resuming Matrix setup for @${username}:nixpi"
	fi

	# Register bot account
	local bot_password bot_token bot_user_id bot_result
	bot_password=$(matrix_state_get bot_password)
	bot_token=$(matrix_state_get bot_token)
	bot_user_id=$(matrix_state_get bot_user_id)
	if [[ -z "$bot_password" ]]; then
		bot_password=$(generate_password)
		matrix_state_set bot_password "$bot_password"
	fi
	if [[ -z "$bot_token" || -z "$bot_user_id" ]]; then
		echo "Creating or resuming Pi bot account..."
		bot_result=$(matrix_login "pi" "$bot_password" 2>/dev/null || true)
		if [[ -z "$bot_result" ]]; then
			bot_result=$(matrix_register "pi" "$bot_password" 2>/dev/null || true)
		fi
		if [[ -z "$bot_result" ]]; then
			bot_result=$(matrix_register "pi" "$bot_password") || {
				echo "ERROR: Failed to register or recover @pi:nixpi bot account." >&2
				return 1
			}
		fi
		bot_token=$(jq -r '.access_token // empty' <<< "$bot_result")
		bot_user_id=$(jq -r '.user_id // empty' <<< "$bot_result")
		matrix_state_set bot_token "$bot_token"
		matrix_state_set bot_user_id "$bot_user_id"
	fi

	# Register user account
	local user_password user_token user_user_id user_result
	user_password=$(matrix_state_get user_password)
	user_token=$(matrix_state_get user_token)
	user_user_id=$(matrix_state_get user_user_id)
	if [[ -z "$user_password" ]]; then
		if [[ -n "${PREFILL_MATRIX_PASSWORD:-}" ]]; then
			user_password="$PREFILL_MATRIX_PASSWORD"
		else
			user_password=$(generate_password)
		fi
		matrix_state_set user_password "$user_password"
	fi
	if [[ -z "$user_token" || -z "$user_user_id" ]]; then
		echo "Creating or resuming your account (@${username}:nixpi)..."
		user_result=$(matrix_login "$username" "$user_password" 2>/dev/null || true)
		if [[ -z "$user_result" ]]; then
			user_result=$(matrix_register "$username" "$user_password") || {
				echo "ERROR: Failed to register or recover @${username}:nixpi account." >&2
				return 1
			}
		fi
		user_token=$(jq -r '.access_token // empty' <<< "$user_result")
		user_user_id=$(jq -r '.user_id // empty' <<< "$user_result")
		matrix_state_set user_token "$user_token"
		matrix_state_set user_user_id "$user_user_id"
	fi

	# Store credentials
	mkdir -p "$PI_DIR"
	cat > "$PI_DIR/matrix-credentials.json" <<-CREDS
	{
	  "homeserver": "${MATRIX_HOMESERVER}",
	  "botUserId": "${bot_user_id}",
	  "botAccessToken": "${bot_token}",
	  "botPassword": "${bot_password}",
	  "userUserId": "${user_user_id}",
	  "userPassword": "${user_password}"
	}
	CREDS
	chmod 600 "$PI_DIR/matrix-credentials.json"

	# Create #general:nixpi room (bot creates, invites user)
	echo "Creating #general:nixpi room..."
	curl -sf -X POST "${MATRIX_HOMESERVER}/_matrix/client/v3/createRoom" \
		-H "Authorization: Bearer ${bot_token}" \
		-H "Content-Type: application/json" \
		-d "{\"room_alias_name\":\"general\",\"invite\":[\"${user_user_id}\"]}" \
		>/dev/null 2>&1 || echo "  (room may already exist)"

	# User joins the room
	curl -sf -X POST "${MATRIX_HOMESERVER}/_matrix/client/v3/join/%23general%3Anixpi" \
		-H "Authorization: Bearer ${user_token}" \
		-H "Content-Type: application/json" \
		-d '{}' \
		>/dev/null 2>&1 || true

	echo ""
	echo "Matrix ready."
	echo "  Username: ${username}"
	echo "  Password: ${user_password}"
	echo ""
	matrix_state_clear
	mark_done_with matrix "$username"
}
