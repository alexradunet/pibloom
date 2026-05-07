set -euo pipefail

format="markdown"
include_health=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --format)
      if [ "$#" -lt 2 ]; then
        echo "ownloom-context: --format requires markdown or json" >&2
        exit 2
      fi
      format="$2"
      shift 2
      ;;
    --health)
      include_health=1
      shift
      ;;
    --help|-h)
      cat <<'EOF'
Usage: ownloom-context [--format markdown|json] [--health]

Print the current ownloom agent context for prompt injection.

Compatibility: nixpi-context remains available as a temporary wrapper.
--health includes a composite health snapshot (OS gen, containers, disk, load).
EOF
      exit 0
      ;;
    *)
      echo "ownloom-context: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [ "$format" != "markdown" ] && [ "$format" != "json" ]; then
  echo "ownloom-context: unsupported format: $format" >&2
  exit 2
fi

current_host="${OWNLOOM_WIKI_HOST:-${NIXPI_WIKI_HOST:-}}"
if [ -z "$current_host" ] && [ -r /etc/hostname ]; then
  current_host="$(tr -d '\n' < /etc/hostname)"
fi
if [ -z "$current_host" ]; then
  current_host="${HOSTNAME:-nixos}"
fi

ownloom_root="${OWNLOOM_ROOT:-${NIXPI_ROOT:-${HOME:-/tmp}/ownloom}}"
if [ ! -d "$ownloom_root" ] && [ -d "${HOME:-/tmp}/NixPI" ]; then
  ownloom_root="${HOME:-/tmp}/NixPI"
fi
flake_dir="${OWNLOOM_FLAKE_DIR:-${NIXPI_FLAKE_DIR:-$ownloom_root}}"
wiki_root="${OWNLOOM_WIKI_ROOT:-${NIXPI_WIKI_ROOT:-${HOME:-/tmp}/wiki}}"
today="$(date +%F)"

fleet_hosts=""
if [ -d "$ownloom_root/hosts" ]; then
  for host_dir in "$ownloom_root"/hosts/*; do
    if [ -d "$host_dir" ] && [ -f "$host_dir/default.nix" ]; then
      name="$(basename "$host_dir")"
      if [ -z "$fleet_hosts" ]; then
        fleet_hosts="$name"
      else
        fleet_hosts="$fleet_hosts, $name"
      fi
    fi
  done
fi
if [ -z "$fleet_hosts" ]; then
  fleet_hosts="unknown"
fi

fleet_membership="no"
case ", $fleet_hosts," in
  *", $current_host,"*) fleet_membership="yes" ;;
esac

planner_policy='[OWNLOOM PLANNER INFRASTRUCTURE]
The canonical live task/reminder/calendar system is the standards-based ownloom planner backend: CalDAV/iCalendar VTODO/VEVENT/VALARM served by Radicale on nixpi-vps. Current safe endpoint is loopback-only at http://127.0.0.1:5232/. Direct phone CalDAV access is intentionally deferred; canonical access should be through WhatsApp, Pi, and the upcoming small ownloom web view/API. Do not create new wiki Markdown task/reminder pages as the source of truth for live operational items unless the user explicitly asks for a wiki/archive note. Use the wiki for summaries, reviews, decisions, and project context. Use ownloom-planner for live task/reminder/event operations.'

cli_policy='[OWNLOOM CLI TOOLS]
Prefer ownloom CLIs over harness-specific tools so the workflow stays agent-agnostic.
- ownloom-context --format markdown|json [--health]: print live agent context with optional health snapshot.
- ownloom-config (use skill ownloom-config): inspect, validate, and apply this host config. Run validate before apply. Confirm with Alex before apply.
- Use standard git commit/push for publishing changes.
- ownloom-audit (use skill ownloom-audit): current-state baseline/config audit.
- ownloom-wiki ...: structured wiki operations.
- ownloom-planner ...: live CalDAV/iCalendar tasks, reminders, and events.
- Transitional nixpi-* command aliases may exist during the rebrand; prefer ownloom-* for new work.'

planner_digest=""
if planner_json="$(ownloom-planner list upcoming --json 2>/dev/null)"; then
  planner_lines="$(printf '%s' "$planner_json" | jq -r --arg host "$current_host" --arg today "$today" '
    if type == "array" and length > 0 then
      (["[PLANNER DIGEST — \($host) — \($today)]"] +
        ([.[0:12][] |
          "- " + (if .status == "done" then "✓" else "•" end) + " " + ((.kind // "item") | ascii_upcase) + ": " + (.title // "(untitled)") + " (" + (((.due // .start // "no-date") | tostring)[0:10]) + ")"
        ])) | join("\n")
    else "" end
  ' 2>/dev/null || true)"
  if [ -n "$planner_lines" ]; then
    planner_digest="$planner_lines"
  fi
fi

wiki_context="$(ownloom-wiki context --format markdown 2>/dev/null || true)"

memory_path="$wiki_root/memory/MEMORY.md"
user_path="$wiki_root/memory/USER.md"
agent_dir="${OWNLOOM_AGENT_DIR:-${NIXPI_AGENT_DIR:-${PI_CODING_AGENT_DIR:-${HOME:-/tmp}/.pi/agent}}}"
context_path="$agent_dir/context.json"
memory_block=""
if [ -s "$memory_path" ]; then
  memory_block="[MEMORY — edit: $memory_path]
$(cat "$memory_path")"
fi
if [ -s "$user_path" ]; then
  user_block="[USER PROFILE — edit: $user_path]
$(cat "$user_path")"
  if [ -n "$memory_block" ]; then
    memory_block="$memory_block

$user_block"
  else
    memory_block="$user_block"
  fi
fi

restored_block=""
if [ -s "$context_path" ]; then
  restored_block="$(jq -r '
    if type == "object" then
      ["[RESTORED CONTEXT]",
       "Saved at: " + (.savedAt // "unknown"),
       (if .host then "Previous host: " + .host else empty end),
       (if .cwd then "Previous cwd: " + .cwd else empty end)] | join("\n")
    else "" end
  ' "$context_path" 2>/dev/null || true)"
fi

fleet_block="[OWNLOOM FLEET HOST MODE]
Current host: $current_host
Known fleet hosts: $fleet_hosts
Current host is declared in fleet: $fleet_membership
Every Pi agent and subagent must preserve this host identity when diagnosing, editing, rebuilding, or discussing ownloom state. Do not assume another fleet host unless the user explicitly names it.

[OS CONTEXT]
Current host: $current_host
Canonical flake repo: $flake_dir"

health_block=""
if [ "$include_health" -eq 1 ]; then
  current_generation_line() {
    awk '
      BEGIN { found = 0 }
      NR == 1 && $1 ~ /^Generation$/ { next }
      /True[[:space:]]*$/ {
        sub(/[[:space:]]+True[[:space:]]*$/, " (current)")
        print
        found = 1
        exit
      }
      /\(current\)|current/ && found == 0 {
        print
        found = 1
        exit
      }
      found == 0 && NF > 0 {
        first = $0
        found = 2
      }
      END {
        if (found == 2) print first
        if (found == 0) print "No generation info available."
      }
    '
  }

  sections_file="$(mktemp)"
  trap 'rm -f "$sections_file"' EXIT

  if generations="$(nixos-rebuild list-generations 2>/dev/null)"; then
    current_line="$(printf '%s\n' "$generations" | current_generation_line)"
    printf '## OS\nNixOS — %s\n\n' "$current_line" >> "$sections_file"
  else
    printf '## OS\n(nixos-rebuild unavailable)\n\n' >> "$sections_file"
  fi

  if containers_json="$(podman ps --format json --filter name=ownloom- 2>/dev/null)"; then
    containers_text="$(printf '%s' "$containers_json" | jq -r '
      if type == "array" and length > 0 then
        .[] | "- " + (((.Names // []) | join(", ")) // "unknown") + ": " + (.Status // .State // "unknown")
      else
        "No ownloom-* containers running."
      end
    ' 2>/dev/null || printf '%s' '(parse error)')"
    printf '## Containers\n%s\n\n' "$containers_text" >> "$sections_file"
  fi

  if disk="$(df -h / /var /home 2>/dev/null)"; then
    {
      printf '## Disk Usage\n'
      printf '%s\n' '```'
      printf '%s\n' "$disk"
      printf '%s\n\n' '```'
    } >> "$sections_file"
  fi

  system_lines=""
  if [ -r /proc/loadavg ]; then
    read -r load1 load5 load15 _ < /proc/loadavg || true
    system_lines="${system_lines}- Load: $load1 $load5 $load15\n"
  fi
  if uptime_text="$(uptime -p 2>/dev/null)"; then
    system_lines="${system_lines}- Uptime: $uptime_text\n"
  fi
  if mem_line="$(free -h --si 2>/dev/null | grep '^Mem:' || true)"; then
    if [ -n "$mem_line" ]; then
      total="$(printf '%s\n' "$mem_line" | awk '{print $2}')"
      used="$(printf '%s\n' "$mem_line" | awk '{print $3}')"
      system_lines="${system_lines}- Memory: $used used / $total total\n"
    fi
  fi
  if [ -n "$system_lines" ]; then
    printf '## System\n%b\n' "$system_lines" >> "$sections_file"
  fi

  health_block="[HEALTH SNAPSHOT]
$(sed -e ':a' -e '/^$/N; /\n$/ba' -e 's/[[:space:]]*$//' "$sections_file")"
  rm -f "$sections_file"
fi

if [ "$format" = "json" ]; then
  jq -n \
    --arg host "$current_host" \
    --arg fleetHosts "$fleet_hosts" \
    --arg fleetMembership "$fleet_membership" \
    --arg flakeDir "$flake_dir" \
    --arg wikiRoot "$wiki_root" \
    --arg fleetBlock "$fleet_block" \
    --arg plannerPolicy "$planner_policy" \
    --arg cliPolicy "$cli_policy" \
    --arg plannerDigest "$planner_digest" \
    --arg wikiContext "$wiki_context" \
    --arg memoryBlock "$memory_block" \
    --arg restoredBlock "$restored_block" \
    --arg healthBlock "$health_block" \
    '{host: $host, fleetHosts: $fleetHosts, fleetMembership: $fleetMembership, flakeDir: $flakeDir, wikiRoot: $wikiRoot, blocks: {fleet: $fleetBlock, plannerPolicy: $plannerPolicy, cliPolicy: $cliPolicy, plannerDigest: $plannerDigest, wiki: $wikiContext, memory: $memoryBlock, restored: $restoredBlock, health: $healthBlock}}'
  exit 0
fi

printf '%s\n' "$fleet_block"
printf '\n%s\n' "$planner_policy"
printf '\n%s\n' "$cli_policy"
if [ -n "$health_block" ]; then
  printf '\n%s\n' "$health_block"
fi
if [ -n "$planner_digest" ]; then
  printf '\n%s\n' "$planner_digest"
fi
if [ -n "$wiki_context" ]; then
  printf '\n%s\n' "$wiki_context"
fi
if [ -n "$memory_block" ]; then
  printf '\n%s\n' "$memory_block"
fi
if [ -n "$restored_block" ]; then
  printf '\n%s\n' "$restored_block"
fi
