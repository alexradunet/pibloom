{
  lib,
  writeShellApplication,
  coreutils,
  findutils,
  gnugrep,
  jq,
  nixpi-planner,
  nixpi-wiki,
}:
writeShellApplication {
  name = "nixpi-context";

  runtimeInputs = [
    coreutils
    findutils
    gnugrep
    jq
    nixpi-planner
    nixpi-wiki
  ];

  text = ''
    set -euo pipefail

    format="markdown"
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --format)
          if [ "$#" -lt 2 ]; then
            echo "nixpi-context: --format requires markdown or json" >&2
            exit 2
          fi
          format="$2"
          shift 2
          ;;
        --help|-h)
          cat <<'EOF'
    Usage: nixpi-context [--format markdown|json]

    Print the current NixPI agent context for prompt injection.
    EOF
          exit 0
          ;;
        *)
          echo "nixpi-context: unknown argument: $1" >&2
          exit 2
          ;;
      esac
    done

    if [ "$format" != "markdown" ] && [ "$format" != "json" ]; then
      echo "nixpi-context: unsupported format: $format" >&2
      exit 2
    fi

    current_host="''${NIXPI_WIKI_HOST:-}"
    if [ -z "$current_host" ] && [ -r /etc/hostname ]; then
      current_host="$(tr -d '\n' < /etc/hostname)"
    fi
    if [ -z "$current_host" ]; then
      current_host="''${HOSTNAME:-nixos}"
    fi

    nixpi_root="''${NIXPI_ROOT:-''${HOME:-/tmp}/NixPI}"
    flake_dir="''${NIXPI_FLAKE_DIR:-$nixpi_root}"
    wiki_root="''${NIXPI_WIKI_ROOT:-''${HOME:-/tmp}/wiki}"
    today="$(date +%F)"

    fleet_hosts=""
    if [ -d "$nixpi_root/hosts" ]; then
      for host_dir in "$nixpi_root"/hosts/*; do
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

    planner_policy='[NIXPI PLANNER INFRASTRUCTURE]
    The canonical live task/reminder/calendar system is the standards-based NixPI planner backend: CalDAV/iCalendar VTODO/VEVENT/VALARM served by Radicale on nixpi-vps. Current safe endpoint is loopback-only at http://127.0.0.1:5232/. Direct phone CalDAV access is intentionally deferred; canonical access should be through WhatsApp, Pi, and the upcoming small NixPI web view/API. Do not create new wiki Markdown task/reminder pages as the source of truth for live operational items unless the user explicitly asks for a wiki/archive note. Use the wiki for summaries, reviews, decisions, and project context. Use nixpi-planner for live task/reminder/event operations.'

    cli_policy='[NIXPI CLI TOOLS]
    Prefer NixPI CLIs over harness-specific tools so the workflow stays agent-agnostic.
    - nixpi-context --format markdown|json: print live agent context.
    - nixpi-status [--json]: show runtime paths and host state.
    - nixpi-health [--json]: broad host health snapshot.
    - nixpi-config (use skill nixpi-config): inspect, validate, and apply this host config. Run validate before apply. Confirm with Alex before apply.
    - Use standard git commit/push for publishing changes.
    - nixpi-audit (use skill nixpi-audit): current-state baseline/config audit.
    - nixpi-wiki ...: structured wiki operations.
    - nixpi-planner ...: live CalDAV/iCalendar tasks, reminders, and events.'

    planner_digest=""
    if planner_json="$(nixpi-planner list upcoming --json 2>/dev/null)"; then
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

    wiki_context="$(nixpi-wiki context --format markdown 2>/dev/null || true)"

    memory_path="$wiki_root/memory/MEMORY.md"
    user_path="$wiki_root/memory/USER.md"
    agent_dir="''${NIXPI_AGENT_DIR:-''${PI_CODING_AGENT_DIR:-''${HOME:-/tmp}/.pi/agent}}"
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

    fleet_block="[NIXPI FLEET HOST MODE]
    Current host: $current_host
    Known fleet hosts: $fleet_hosts
    Current host is declared in fleet: $fleet_membership
    Every Pi agent and subagent must preserve this host identity when diagnosing, editing, rebuilding, or discussing NixPI state. Do not assume another fleet host unless the user explicitly names it.

    [OS CONTEXT]
    Current host: $current_host
    Canonical flake repo: $flake_dir
    Use nixpi-health for diagnosis. Use the nixpi-config skill for validate/apply."

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
        '{host: $host, fleetHosts: $fleetHosts, fleetMembership: $fleetMembership, flakeDir: $flakeDir, wikiRoot: $wikiRoot, blocks: {fleet: $fleetBlock, plannerPolicy: $plannerPolicy, cliPolicy: $cliPolicy, plannerDigest: $plannerDigest, wiki: $wikiContext, memory: $memoryBlock, restored: $restoredBlock}}'
      exit 0
    fi

    printf '%s\n' "$fleet_block"
    printf '\n%s\n' "$planner_policy"
    printf '\n%s\n' "$cli_policy"
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
  '';

  meta = {
    description = "Print the current NixPI agent context for prompt injection";
    license = lib.licenses.mit;
    mainProgram = "nixpi-context";
  };
}
