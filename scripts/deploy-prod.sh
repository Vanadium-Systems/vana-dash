#!/usr/bin/env bash
# Deploy, run on the server itself (GitHub Actions calls it over SSH).
# Assumes the repository is already cloned and the production .env sits at its root.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${SKIP_GIT_PULL:-0}" != "1" ]; then
  git fetch origin main
  git reset --hard origin/main
fi

corepack enable
pnpm install --frozen-lockfile
pnpm --filter @vana-dash/frontend build

# The Android APK is not in git (a binary, rarely rebuilt). Its canonical copy lives on the
# server in ~/vana-dash-secrets/ and is put back after every build, because `vite build`
# empties dist/ and the download button in Settings would then serve index.html under an
# .apk name.
if [ -f ~/vana-dash-secrets/vanadash.apk ]; then
  cp ~/vana-dash-secrets/vanadash.apk frontend/dist/vanadash.apk
fi

docker compose -f infra/docker-compose.prod.yml --env-file .env up -d --build
# The Caddyfile is mounted as a single file. `git reset` replaces it with a new inode, and
# the caddy container (unchanged in compose, so not recreated by `up -d`) keeps seeing the old
# one. It is recreated only when the content changed since the last deploy.
CADDYFILE_SUM=$(sha256sum infra/Caddyfile | cut -d' ' -f1)
if [ "$(cat .caddyfile.sha256 2>/dev/null)" != "$CADDYFILE_SUM" ]; then
  docker compose -f infra/docker-compose.prod.yml --env-file .env up -d --force-recreate caddy
  echo "$CADDYFILE_SUM" > .caddyfile.sha256
fi
docker image prune -f
# `docker image prune` does not touch the BuildKit build cache, which grows without limit.
# Pruning by age (`until=Xh`) does nothing here: every build refreshes "last used" on all the
# layers of the chain, the unchanged ones included (a cache hit counts as "used now"), so
# with several deploys a day no layer ever gets older than the threshold. That is how the
# cache reached 17 GB (61% of the disk) under a 24h filter. A cap on size
# (`--max-used-space`) does not depend on recency: it cut 17 GB to under 5 and leaves the
# cache of the latest build intact.
docker builder prune -f --max-used-space=3GB
