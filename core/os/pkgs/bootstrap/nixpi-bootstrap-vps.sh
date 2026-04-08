#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/srv/nixpi"
REPO_URL="${NIXPI_REPO_URL:-https://github.com/alexradunet/nixpi.git}"
BRANCH="${NIXPI_REPO_BRANCH:-main}"
HOSTNAME_VALUE="${NIXPI_HOSTNAME:-$(hostname -s)}"
TIMEZONE_VALUE="${NIXPI_TIMEZONE:-UTC}"
KEYBOARD_VALUE="${NIXPI_KEYBOARD:-us}"
FLAKE_NIX_CONFIG='experimental-features = nix-command flakes'

compose_nix_config() {
  if [ -n "${NIX_CONFIG:-}" ]; then
    printf '%s\n%s\n' "$FLAKE_NIX_CONFIG" "$NIX_CONFIG"
    return 0
  fi

  printf '%s\n' "$FLAKE_NIX_CONFIG"
}

log() {
  printf '[nixpi-bootstrap-vps] %s\n' "$*"
}

sanitize_mail_token() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | tr -cs 'a-z0-9._-' '-'
}

run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    if [ -x /run/wrappers/bin/sudo ]; then
      /run/wrappers/bin/sudo env "PATH=$PATH" "$@"
      return
    fi

    if command -v sudo >/dev/null 2>&1; then
      local SUDO_BIN
      SUDO_BIN="$(command -v sudo)"
      if [[ "$SUDO_BIN" == /nix/store/*/bin/sudo ]]; then
        log "Detected store-provided sudo at $SUDO_BIN (not setuid root)."
        log "Re-run as root, or use /run/wrappers/bin/sudo if available."
        return 1
      fi
      "$SUDO_BIN" env "PATH=$PATH" "$@"
      return
    fi

    if command -v doas >/dev/null 2>&1; then
      doas env "PATH=$PATH" "$@"
      return
    fi

    log "No usable privilege escalation tool found. Re-run this script as root."
    return 1
  fi
}

resolve_primary_user() {
  if [ -n "${NIXPI_PRIMARY_USER:-}" ]; then
    printf '%s\n' "$NIXPI_PRIMARY_USER"
    return 0
  fi

  if [ -n "${SUDO_USER:-}" ]; then
    printf '%s\n' "$SUDO_USER"
    return 0
  fi

  if [ "$(id -u)" -ne 0 ]; then
    id -un
    return 0
  fi

  if command -v logname >/dev/null 2>&1; then
    local login_name
    login_name="$(logname 2>/dev/null || true)"
    if [ -n "$login_name" ] && [ "$login_name" != "root" ]; then
      printf '%s\n' "$login_name"
      return 0
    fi
  fi

  local discovered_user
  discovered_user="$(
    getent passwd | awk -F: '$3 >= 1000 && $3 < 60000 && $1 != "nobody" { print $1; exit }'
  )"
  if [ -n "$discovered_user" ]; then
    printf '%s\n' "$discovered_user"
    return 0
  fi

  log "Could not infer the existing non-root user."
  log "Set NIXPI_PRIMARY_USER explicitly before running bootstrap as root."
  return 1
}

resolve_primary_group() {
  if getent group "$PRIMARY_USER_VALUE" >/dev/null 2>&1; then
    printf '%s\n' "$PRIMARY_USER_VALUE"
    return 0
  fi

  local discovered_group
  discovered_group="$(id -gn "$PRIMARY_USER_VALUE" 2>/dev/null || true)"
  if [ -n "$discovered_group" ]; then
    printf '%s\n' "$discovered_group"
    return 0
  fi

  log "Could not infer primary group for user $PRIMARY_USER_VALUE."
  log "Set up the primary user and group before running bootstrap."
  return 1
}

ensure_repo_permissions() {
  run_as_root chown -R "$PRIMARY_USER_VALUE:$PRIMARY_GROUP_VALUE" "$REPO_DIR"
}

default_git_email() {
  local mail_user host_label
  mail_user="$(sanitize_mail_token "$PRIMARY_USER_VALUE")"
  host_label="$(sanitize_mail_token "$HOSTNAME_VALUE")"

  if [ -z "$mail_user" ]; then
    mail_user="pi"
  fi
  if [ -z "$host_label" ]; then
    host_label="nixpi"
  fi

  printf '%s@%s.local\n' "$mail_user" "$host_label"
}

ensure_repo_git_identity_defaults() {
  local current_name current_email fallback_email
  current_name="$(run_as_root git -C "$REPO_DIR" config --get user.name 2>/dev/null || true)"
  if [ -z "$current_name" ]; then
    run_as_root git -C "$REPO_DIR" config user.name "$PRIMARY_USER_VALUE"
    log "Set default git user.name for $REPO_DIR to $PRIMARY_USER_VALUE"
  fi

  current_email="$(run_as_root git -C "$REPO_DIR" config --get user.email 2>/dev/null || true)"
  if [ -z "$current_email" ]; then
    fallback_email="$(default_git_email)"
    run_as_root git -C "$REPO_DIR" config user.email "$fallback_email"
    log "Set default git user.email for $REPO_DIR to $fallback_email"
  fi
}

PRIMARY_USER_VALUE="$(resolve_primary_user)"
PRIMARY_GROUP_VALUE="$(resolve_primary_group)"
COMBINED_NIX_CONFIG="$(compose_nix_config)"

if [ ! -d "$REPO_DIR/.git" ]; then
  log "Cloning $REPO_URL#$BRANCH into $REPO_DIR"
  run_as_root install -d -m 0755 /srv
  run_as_root git clone --branch "$BRANCH" "$REPO_URL" "$REPO_DIR"
else
  log "Updating existing checkout at $REPO_DIR"
fi

run_as_root git -C "$REPO_DIR" fetch origin "$BRANCH"
run_as_root git -C "$REPO_DIR" checkout "$BRANCH"
run_as_root git -C "$REPO_DIR" reset --hard "origin/$BRANCH"
ensure_repo_permissions
ensure_repo_git_identity_defaults

log "Initializing standard /etc/nixos flake"
run_as_root env \
  "NIX_CONFIG=$COMBINED_NIX_CONFIG" \
  "NIXPI_NIXPKGS_FLAKE_URL=${NIXPI_NIXPKGS_FLAKE_URL:-}" \
  bash "$REPO_DIR/core/scripts/nixpi-init-system-flake.sh" \
  "$REPO_DIR" \
  "$HOSTNAME_VALUE" \
  "$PRIMARY_USER_VALUE" \
  "$TIMEZONE_VALUE" \
  "$KEYBOARD_VALUE"

log "Running nixos-rebuild switch --flake /etc/nixos#nixos"
run_as_root env "NIX_CONFIG=$COMBINED_NIX_CONFIG" nixos-rebuild switch --flake /etc/nixos#nixos --impure
log "Bootstrap complete. /srv/nixpi is the canonical source checkout. Use 'nixpi-rebuild' to rebuild the current checkout or 'nixpi-rebuild-pull' to update and rebuild."
