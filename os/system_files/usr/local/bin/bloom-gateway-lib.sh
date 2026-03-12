#!/usr/bin/env bash
# bloom-gateway-lib.sh — Gateway route registry and Caddyfile generation (bash).
# Sourced by bloom-wizard.sh and available for manual use.

GATEWAY_ROUTES="${BLOOM_CONFIG:-$HOME/.config/bloom}/gateway-routes.json"
GATEWAY_CADDYFILE="${BLOOM_CONFIG:-$HOME/.config/bloom}/Caddyfile"

# Add a route to the gateway registry.
# Usage: gateway_add_route <path> <port> <strip_prefix: true|false>
gateway_add_route() {
	local path="$1" port="$2" strip="$3"
	mkdir -p "$(dirname "$GATEWAY_ROUTES")"
	local routes="{}"
	[[ -f "$GATEWAY_ROUTES" ]] && routes=$(cat "$GATEWAY_ROUTES")

	# Use python3 (available in Fedora) for reliable JSON manipulation
	routes=$(python3 -c "
import json, sys
r = json.loads(sys.argv[1])
if 'routes' not in r: r['routes'] = {}
r['routes'][sys.argv[2]] = {'port': int(sys.argv[3]), 'strip_prefix': sys.argv[4] == 'true'}
print(json.dumps(r, indent='\t'))
" "$routes" "$path" "$port" "$strip")

	echo "$routes" > "$GATEWAY_ROUTES"
}

# Generate and write the Caddyfile from the route registry.
gateway_regenerate() {
	local routes="{\"routes\":{}}"
	[[ -f "$GATEWAY_ROUTES" ]] && routes=$(cat "$GATEWAY_ROUTES")

	python3 -c "
import json, sys

r = json.loads(sys.argv[1])
routes = r.get('routes', {})

lines = [':18810 {']
for path, route in routes.items():
    directive = 'handle_path' if route.get('strip_prefix', False) else 'handle'
    lines.append(f'\t{directive} {path}/* {{')
    lines.append(f'\t\treverse_proxy localhost:{route[\"port\"]}')
    lines.append('\t}')
    lines.append('')

lines.append('\thandle /.well-known/matrix/client {')
lines.append('\t\theader Content-Type application/json')
lines.append('\t\trespond \x60{\"m.homeserver\": {\"base_url\": \"/\"}}\x60 200')
lines.append('\t}')
lines.append('')
lines.append('\thandle {')
lines.append('\t\troot * /srv/cinny')
lines.append('\t\tfile_server')
lines.append('\t\ttry_files {path} /index.html')
lines.append('\t}')
lines.append('}')
lines.append('')
print('\n'.join(lines))
" "$routes" > "$GATEWAY_CADDYFILE"
}

# Restart the gateway service (if running).
gateway_restart() {
	systemctl --user restart bloom-gateway.service 2>/dev/null || true
}
