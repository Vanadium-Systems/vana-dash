#!/usr/bin/env bash
# Creates or updates the vanadash_app role (infra/rls-role.sql) in the production Postgres.
# Idempotent; deploy-prod.sh runs it when APP_DB_PASSWORD is set in .env.
#   APP_DB_PASSWORD=<hex> scripts/rls-role.sh
# Locally, against another database: PSQL="docker exec -i <container> psql -U vanadash" DB=vanadash_rls OWNER=vanadash
set -euo pipefail
cd "$(dirname "$0")/.."

: "${APP_DB_PASSWORD:?APP_DB_PASSWORD missing (openssl rand -hex 24)}"
# Only [A-Za-z0-9]: the value is written into a psql \set and into DATABASE_URL_APP unescaped.
if [[ ! "$APP_DB_PASSWORD" =~ ^[A-Za-z0-9]{24,}$ ]]; then
  echo "APP_DB_PASSWORD must be at least 24 letters or digits" >&2
  exit 1
fi

DB=${DB:-${POSTGRES_DB:-vanadash}}
OWNER=${OWNER:-${POSTGRES_USER:?POSTGRES_USER missing}}
PSQL=${PSQL:-docker compose -f infra/docker-compose.prod.yml --env-file .env exec -T postgres psql -U $OWNER}

# The password goes through stdin, not argv, so it does not show up in the process list.
{
  printf "\\\\set app_password '%s'\n" "$APP_DB_PASSWORD"
  cat infra/rls-role.sql
} | $PSQL -d "$DB" -v db="$DB" -v owner="$OWNER" -q
