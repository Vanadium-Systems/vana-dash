#!/usr/bin/env bash
# Deploy, run on the server itself (GitHub Actions calls it over SSH after building).
# Nothing is built here: the backend image comes from GHCR and the SPA as a tarball.
# Expects BACKEND_IMAGE (ghcr.io/...:<sha>) and FRONTEND_TARBALL; GHCR_USER / GHCR_TOKEN log
# in for the pull when the package is private. The production .env sits at the repository root.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${BACKEND_IMAGE:?BACKEND_IMAGE missing}"
: "${FRONTEND_TARBALL:?FRONTEND_TARBALL missing}"
export BACKEND_IMAGE

if [ "${SKIP_GIT_PULL:-0}" != "1" ]; then
  git fetch origin main
  git reset --hard origin/main
fi

if [ -n "${GHCR_TOKEN:-}" ]; then
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USER:?}" --password-stdin
  trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
fi
docker pull "$BACKEND_IMAGE"

# Caddy bind-mounts frontend/dist by path, so the directory itself has to stay (a renamed
# or replaced one would keep the old inode in the container). Its contents are swapped.
STAGE=$(mktemp -d)
tar -xzf "$FRONTEND_TARBALL" -C "$STAGE"
mkdir -p frontend/dist
find frontend/dist -mindepth 1 -delete
cp -a "$STAGE"/. frontend/dist/
rm -rf "$STAGE" "$FRONTEND_TARBALL"

# The Android APK is not in git (a binary, rarely rebuilt). Its canonical copy lives on the
# server in ~/vana-dash-secrets/ and is put back after every deploy, because dist/ was just
# emptied and the download button in Settings would then serve index.html under an .apk name.
if [ -f ~/vana-dash-secrets/vanadash.apk ]; then
  cp ~/vana-dash-secrets/vanadash.apk frontend/dist/vanadash.apk
fi

# Migrations run at container start (the image CMD), before the server listens.
docker compose -f infra/docker-compose.prod.yml --env-file .env up -d --no-build
# The Caddyfile is mounted as a single file. `git reset` replaces it with a new inode, and
# the caddy container (unchanged in compose, so not recreated by `up -d`) keeps seeing the old
# one. It is recreated only when the content changed since the last deploy.
CADDYFILE_SUM=$(sha256sum infra/Caddyfile | cut -d' ' -f1)
if [ "$(cat .caddyfile.sha256 2>/dev/null)" != "$CADDYFILE_SUM" ]; then
  docker compose -f infra/docker-compose.prod.yml --env-file .env up -d --force-recreate caddy
  echo "$CADDYFILE_SUM" > .caddyfile.sha256
fi
docker image prune -af --filter "until=72h"
# Left over from the years of building on the box; a no-op once the cache is gone.
docker builder prune -af >/dev/null 2>&1 || true
