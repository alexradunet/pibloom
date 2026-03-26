#!/usr/bin/env bash
# NetBird, Matrix, and service-surface phase helpers for setup-wizard.sh.

print_service_access_summary() {
	local _installed_services="$1" mesh_ip="$2" mesh_fqdn="$3"
	local canonical_host=""
	canonical_host=$(canonical_service_host)
	local access_mode=""
	access_mode=$(canonical_access_mode)

	echo "  Service access:"
	if [[ -n "$canonical_host" ]]; then
		echo "    NixPI Home   - https://${canonical_host}/"
		echo "    Share this   - send other NetBird peers the NixPI Home URL"
		echo "    Element Web  - https://${canonical_host}/element/"
		echo "    Element Web  - preconfigured for this NixPI server"
		echo "    Matrix       - https://${canonical_host}"
	elif [[ "$access_mode" == "not-ready" ]]; then
		echo "    Canonical host - not ready yet (finish NetBird setup)"
	fi
	echo "    Recovery     - http://localhost/ (on-box only)"
}

step_netbird() {
	echo ""
	echo "--- NetBird Mesh Network ---"
	echo "NetBird creates a private mesh network so you can access this device from anywhere."
	echo ""

	if ! systemctl is-active --quiet netbird.service; then
		echo "Starting NetBird daemon..."
		root_command nixpi-bootstrap-netbird-systemctl start netbird.service 2>/dev/null || true
	fi
	local wait_count=0
	while [[ ! -S /var/run/netbird/sock ]]; do
		wait_count=$((wait_count + 1))
		if [[ $wait_count -ge 20 ]]; then
			echo "ERROR: NetBird daemon did not start. Run 'sudo systemctl status netbird' to debug."
			return 1
		fi
		sleep 0.5
	done

	echo "Connection options:"
	echo "  1) Web login (OAuth) - requires a desktop/browser session"
	echo "  2) Setup key - for headless/automated setup"
	echo "  3) Skip - configure later"
	echo ""

	if [[ "$NONINTERACTIVE_SETUP" -eq 1 && -z "${PREFILL_NETBIRD_KEY:-}" ]]; then
		echo "Skipping NetBird setup in noninteractive mode."
		mark_done netbird
		return
	fi

	while true; do
		read -rp "Select option [1/2/3]: " nb_choice
		case "$nb_choice" in
			1|web|oauth|login)
				echo ""
				if has_gui_session; then
					echo "Starting NetBird web login..."
					echo "If no browser opens, visit the URL shown below."
				else
					echo "No local desktop session is active."
					echo "NetBird may print a login URL, but it cannot open a browser window here."
					echo "Use option 2 with a setup key, or retry once the XFCE desktop is running."
				fi
				if root_command nixpi-bootstrap-netbird-up 2>&1; then
					for _ in $(seq 1 30); do
						sleep 1
						local status
						status=$(netbird status 2>/dev/null || true)
						if echo "$status" | grep -q "Connected"; then
							local mesh_ip
							mesh_ip=$(echo "$status" | grep -oP 'NetBird IP:\s+\K[\d.]+' || true)
							if [[ -n "$mesh_ip" ]]; then
								echo ""
								echo "Connected! Mesh IP: ${mesh_ip}"
								mark_done_with netbird "$mesh_ip"
								return
							fi
						fi
					done
					echo ""
					echo "Connection is taking longer than expected."
					echo "Check status with: netbird status"
					return 1
				fi
				echo ""
				echo "NetBird connection failed. Try again or use a setup key."
				;;
			2|key|setup-key)
				echo ""
				echo "Get a setup key from: https://app.netbird.io/setup-keys"
				while true; do
					if [[ -n "${PREFILL_NETBIRD_KEY:-}" ]]; then
						setup_key="$PREFILL_NETBIRD_KEY"
						echo "Setup key: [prefilled]"
					else
						read -rp "Setup key: " setup_key
					fi
					if [[ -z "$setup_key" ]]; then
						echo "Setup key cannot be empty."
						continue
					fi

					echo "Connecting to NetBird..."
					if root_command nixpi-bootstrap-netbird-up --setup-key "$setup_key" 2>&1; then
						sleep 3
						local status
						status=$(netbird status 2>/dev/null || true)

						if echo "$status" | grep -q "Connected"; then
							local mesh_ip
							mesh_ip=$(echo "$status" | grep -oP 'NetBird IP:\s+\K[\d.]+' || true)
							if [[ -n "$mesh_ip" ]]; then
								echo ""
								echo "Connected! Mesh IP: ${mesh_ip}"
								mark_done_with netbird "$mesh_ip"
								return
							fi
						fi
					fi
					echo ""
					echo "NetBird connection failed. Check your setup key and try again."
				done
				;;
			3|skip)
				echo "Skipping NetBird setup. You can configure later with: sudo netbird up"
				mark_done netbird
				return
				;;
			*)
				echo "Invalid option. Please enter 1, 2, or 3."
				;;
		esac
	done
}

step_matrix() {
	echo ""
	echo "--- Matrix Credentials ---"
	echo "Pi uses a bot account on matrix.org to send you messages."
	echo "Register a bot account at https://app.element.io and generate an access token."
	echo ""

	if [[ "$NONINTERACTIVE_SETUP" -eq 1 ]]; then
		if [[ -n "${PREFILL_MATRIX_BOT_USER_ID:-}" && -n "${PREFILL_MATRIX_BOT_ACCESS_TOKEN:-}" ]]; then
			local bot_user_id="$PREFILL_MATRIX_BOT_USER_ID"
			local bot_access_token="$PREFILL_MATRIX_BOT_ACCESS_TOKEN"
		else
			echo "Skipping Matrix credentials in noninteractive mode."
			mark_done_with matrix "skipped"
			return
		fi
	else
		local bot_user_id bot_access_token
		while true; do
			read -rp "Bot Matrix user ID (e.g. @mypi:matrix.org): " bot_user_id
			if [[ -z "$bot_user_id" ]]; then
				echo "User ID cannot be empty."
				continue
			fi
			if [[ ! "$bot_user_id" =~ ^@[^:]+:.+$ ]]; then
				echo "User ID must be in the format @username:server (e.g. @mypi:matrix.org)."
				continue
			fi
			break
		done
		while true; do
			read -rsp "Bot access token: " bot_access_token
			echo ""
			if [[ -z "$bot_access_token" ]]; then
				echo "Access token cannot be empty."
				continue
			fi
			break
		done
	fi

	mkdir -p "$PI_DIR"
	cat > "$PI_DIR/matrix-credentials.json" <<-CREDS
	{
	  "homeserver": "https://matrix.org",
	  "botUserId": "${bot_user_id}",
	  "botAccessToken": "${bot_access_token}"
	}
	CREDS
	chmod 600 "$PI_DIR/matrix-credentials.json"

	echo ""
	echo "Matrix credentials saved."
	echo "DM ${bot_user_id} from any Matrix client to talk to Pi."
	mark_done_with matrix "$bot_user_id"
}

step_services() {
	echo ""
	echo "--- Built-In Services ---"
	if ! has_service_stack; then
		echo "Built-in service stack is not installed in this profile. Skipping."
		mark_done_with services "skipped"
		return
	fi
	local mesh_ip mesh_fqdn
	mesh_ip=$(read_checkpoint_data netbird)
	mesh_fqdn=$(netbird_fqdn)

	echo "  Refreshing built-in service configs..."
	write_element_web_runtime_config
	write_service_home_runtime "$mesh_ip" "$mesh_fqdn"
	if install_home_infrastructure; then
		echo "  NixPI Home ready."
	else
		echo "  NixPI Home setup failed."
	fi
	root_command nixpi-bootstrap-service-systemctl restart nixpi-home.service || echo "  home restart failed."
	root_command nixpi-bootstrap-service-systemctl restart nixpi-element-web.service || echo "  element restart failed."
	write_service_home_runtime "$mesh_ip" "$mesh_fqdn"
	mark_done_with services "home element-web"
}
