#!/usr/bin/env bash
# =============================================================================
# vana-dash: local dev CLI
#
# Usage:  ./dev <command>
#
# For local development only. The production deploy (compose.prod + Caddy) is separate
# and does not go through this script.
#
# To add a subcommand:
#   1. Define a function `cmd_<name>()`.
#   2. Put a `## help: <description>` comment on the line right above it.
#      The help screen is generated from these annotations at runtime.
# =============================================================================

set -euo pipefail

# ---- paths -------------------------------------------------------------------
_dev_source="${BASH_SOURCE[0]}"
while [[ -L "$_dev_source" ]]; do
  _dev_dir=$(cd -P "$(dirname -- "$_dev_source")" &> /dev/null && pwd)
  _dev_source=$(readlink "$_dev_source")
  [[ "$_dev_source" != /* ]] && _dev_source="$_dev_dir/$_dev_source"
done
SCRIPT_DIR=$(cd -P "$(dirname -- "$_dev_source")" &> /dev/null && pwd)
unset _dev_source _dev_dir
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$REPO_ROOT/infra/docker-compose.yml"
ENV_FILE="$REPO_ROOT/.env"

FRONTEND_PORT=5174
BACKEND_PORT=3001
POSTGRES_PORT=5433

# ---- colors ------------------------------------------------------------------
if [[ -t 1 ]] && [[ -z "${NO_COLOR:-}" ]]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_CYAN=$'\033[36m'; C_DIM=$'\033[2m'
else
  C_RESET=''; C_BOLD=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_CYAN=''; C_DIM=''
fi

log()  { printf '%s[dev]%s %s\n' "$C_CYAN" "$C_RESET" "$*"; }
ok()   { printf '%s[ ok]%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s[warn]%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
err()  { printf '%s[err]%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }

cleanup() {
  local rc=$?
  if [[ $rc -ne 0 ]]; then
    err "dev script exited with status $rc"
  fi
  exit $rc
}
trap cleanup EXIT

# ---- env helpers ---------------------------------------------------------------
read_env_var() {
  local key="$1" default="$2"
  if [[ -f "$ENV_FILE" ]]; then
    local line
    line=$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | tail -n 1 || true)
    if [[ -n "$line" ]]; then
      local value="${line#*=}"
      value="${value%%#*}"
      value="${value%\"}"; value="${value#\"}"
      value="${value%\'}"; value="${value#\'}"
      value="${value#"${value%%[![:space:]]*}"}"
      value="${value%"${value##*[![:space:]]}"}"
      if [[ -n "$value" ]]; then printf '%s' "$value"; return 0; fi
    fi
  fi
  printf '%s' "$default"
}

# ---- helpers -----------------------------------------------------------------
require_cmd() {
  local missing=()
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || missing+=("$c")
  done
  if (( ${#missing[@]} > 0 )); then
    err "missing required command(s): ${missing[*]}"
    exit 1
  fi
}

dc() {
  if [[ -f "$ENV_FILE" ]]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  else
    docker compose -f "$COMPOSE_FILE" "$@"
  fi
}

print_urls() {
  printf '\n%sService URLs%s\n' "$C_BOLD" "$C_RESET"
  printf '  Frontend  : %shttp://127.0.0.1:%s%s\n' "$C_GREEN" "$FRONTEND_PORT" "$C_RESET"
  printf '  Backend   : %shttp://127.0.0.1:%s%s\n' "$C_GREEN" "$BACKEND_PORT"  "$C_RESET"
  printf '  Postgres  : %s127.0.0.1:%s%s %s(vanadash/vanadash)%s\n' "$C_GREEN" "$POSTGRES_PORT" "$C_RESET" "$C_DIM" "$C_RESET"
  printf '\n'
}

print_dev_credentials() {
  local email
  email=$(read_env_var ADMIN_EMAIL 'admin@example.com')
  printf '%sLogin%s: %s / the password in .env (ADMIN_PASSWORD)\n\n' "$C_BOLD" "$C_RESET" "$email"
}

wait_for_pg_healthy() {
  local container deadline status
  container=$(dc ps -q postgres || true)
  if [[ -z "$container" ]]; then
    err "postgres container not found"
    return 1
  fi
  log "waiting for postgres to be healthy..."
  deadline=$(( $(date +%s) + 30 ))
  while (( $(date +%s) < deadline )); do
    status=$(docker inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null || echo "unknown")
    if [[ "$status" == "healthy" ]]; then
      ok "postgres healthy"
      return 0
    fi
    sleep 1
  done
  err "postgres did not become healthy within 30s (last status: ${status:-unknown})"
  return 1
}

wait_for_backend_http() {
  # The first start runs pnpm install in the container, which can take a while.
  local deadline url
  url="http://127.0.0.1:${BACKEND_PORT}/health"
  log "waiting for backend at ${url} (the first start installs dependencies, this can take a while)..."
  deadline=$(( $(date +%s) + 180 ))
  while (( $(date +%s) < deadline )); do
    if curl --silent --fail --max-time 2 "$url" >/dev/null 2>&1; then
      ok "backend reachable"
      return 0
    fi
    sleep 2
  done
  warn "backend did not respond on /health within 180s, see ./dev logs"
  return 0
}

# =============================================================================
# Subcommands
# =============================================================================

## help: Start the full stack (postgres, backend, frontend), migrate+seed, print URLs
cmd_start() {
  require_cmd docker pnpm curl
  if [[ ! -f "$ENV_FILE" ]]; then
    err ".env is missing: copy .env.example to .env and fill in the secrets"
    exit 1
  fi
  log "starting dev stack..."
  ( cd "$REPO_ROOT" && dc up -d )
  wait_for_pg_healthy
  # The backend runs the migrations at boot; the seed (idempotent) is run from the host.
  wait_for_backend_http
  cmd_db seed
  ok "stack is up"
  print_urls
  print_dev_credentials
}

## help: Stop the stack (preserves data volumes)
cmd_stop() {
  require_cmd docker
  log "stopping dev stack (volumes preserved)..."
  ( cd "$REPO_ROOT" && dc down )
  ok "stack stopped"
}

## help: Stop then start (preserves data)
cmd_restart() {
  cmd_stop
  cmd_start
}

## help: NUKE all local data (postgres + node_modules volumes) and restart fresh
cmd_reset() {
  require_cmd docker
  local force="${1:-}"
  if [[ "$force" != "--force" ]]; then
    printf '%sThis will DELETE all local dev data (postgres volume).%s\n' "$C_RED" "$C_RESET"
    printf "Type 'yes' to confirm full reset: "
    local answer
    read -r answer
    if [[ "$answer" != "yes" ]]; then
      warn "reset aborted"
      exit 0
    fi
  fi
  log "wiping volumes..."
  ( cd "$REPO_ROOT" && dc down -v )
  ok "volumes removed"
  cmd_start
}

## help: Fix ownership of backend/storage (container runs as root, bind mount inherits it)
cmd_fix_storage_perms() {
  require_cmd docker
  local container
  container=$(cd "$REPO_ROOT" && dc ps -q backend || true)
  if [[ -z "$container" ]]; then
    err "backend container not running, start it first (./dev start)"
    exit 1
  fi
  log "chown backend/storage to uid:gid 1000:1000 (host user / container 'node' user)..."
  docker exec "$container" chown -R 1000:1000 /app/backend/storage
  ok "backend/storage ownership fixed"
}

## help: Show running containers + reachable URLs
cmd_status() {
  require_cmd docker
  ( cd "$REPO_ROOT" && dc ps )
  print_urls
}

## help: Tail backend+frontend logs (Ctrl+C to exit)
cmd_logs() {
  require_cmd docker
  ( cd "$REPO_ROOT" && dc logs -f --tail=50 backend frontend )
}

## help: Run a DB command from host (migrate|seed|seed:demo [ro|en]|generate)
cmd_db() {
  require_cmd pnpm
  local subcmd="${1:-}"
  if [[ -z "$subcmd" ]]; then
    err "usage: ./dev db <migrate|seed|seed:demo [ro|en]|generate>"
    exit 1
  fi

  local script
  case "$subcmd" in
    migrate)  script="db:migrate" ;;
    seed)     script="db:seed" ;;
    seed:demo) script="db:seed:demo" ;;
    generate) script="db:generate" ;;
    *)
      err "unknown db subcommand: $subcmd"
      printf '  valid: migrate, seed, seed:demo, generate\n'
      exit 1
      ;;
  esac

  # Only seed:demo takes an argument: the language of the invented texts.
  local extra=()
  if [[ "$subcmd" == "seed:demo" && -n "${2:-}" ]]; then extra=("$2"); fi

  log "running $script ${extra[*]:-}"
  ( cd "$REPO_ROOT/backend" && pnpm "$script" "${extra[@]}" )
}

## help: Show this help
cmd_help() {
  printf '%svana-dash: local dev CLI%s\n' "$C_BOLD" "$C_RESET"
  printf '%sUsage:%s ./dev <command> [args]\n\n' "$C_BOLD" "$C_RESET"
  printf '%sCommands:%s\n' "$C_BOLD" "$C_RESET"
  awk '
    /^## help:[[:space:]]*/ {
      sub(/^## help:[[:space:]]*/, "");
      help_line = $0;
      next;
    }
    /^cmd_[A-Za-z0-9_]+\(\)/ {
      if (help_line != "") {
        name = $0;
        sub(/\(\).*/, "", name);
        sub(/^cmd_/, "", name);
        printf "  %-10s  %s\n", name, help_line;
        help_line = "";
      }
      next;
    }
    { help_line = "" }
  ' "${BASH_SOURCE[0]}"
  printf '\nEnvironment:\n'
  printf '  NO_COLOR=1   disable ANSI colors\n'
  printf '\n'
}

# =============================================================================
# Dispatcher
# =============================================================================

main() {
  local cmd="${1:-help}"
  shift || true
  case "$cmd" in
    start)   cmd_start "$@" ;;
    stop)    cmd_stop "$@" ;;
    restart) cmd_restart "$@" ;;
    reset)   cmd_reset "$@" ;;
    status)  cmd_status "$@" ;;
    logs)    cmd_logs "$@" ;;
    db)      cmd_db "$@" ;;
    fix-storage-perms|fix_storage_perms) cmd_fix_storage_perms "$@" ;;
    help|-h|--help) cmd_help ;;
    *)
      err "unknown command: $cmd"
      printf '\n'
      cmd_help
      exit 1
      ;;
  esac
}

main "$@"
