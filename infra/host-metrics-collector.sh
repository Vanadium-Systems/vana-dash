#!/usr/bin/env bash
#
# host-metrics-collector.sh: sends a snapshot of the host to the app once a minute.
#
# It runs directly on the server (never in a container) and posts a JSON snapshot (CPU, RAM
# and disk percentages, the health of each container) to the backend's ingest endpoint.
# The system cron fires it every minute.
#
# -----------------------------------------------------------------------
# WHY IT RUNS ON THE HOST, NOT IN A CONTAINER
# -----------------------------------------------------------------------
# Reading container health (`docker inspect`) needs the Docker daemon. Mounting
# /var/run/docker.sock into a container so it can call the daemon itself is a known
# privilege escalation path: a compromised container with the socket is root on the host.
# This script needs no socket mount. It uses the host's own `docker` CLI, as an operator
# would, and reads /proc and df directly, at host scope. (Memory read from inside a
# container shows the whole host's RAM, not the cgroup limit.)
#
# -----------------------------------------------------------------------
# WHY IT POSTS TO https://<DOMAIN>/api/... AND NOT TO http://backend:3001
# -----------------------------------------------------------------------
# The backend container is internal: it is published on no host port (see
# docker-compose.prod.yml). A script on the bare host is not on the compose network, so
# `backend:3001` does not resolve. Caddy is the only container published on 80/443 and
# already proxies `/api/*` to the backend (see infra/Caddyfile), so the script goes out
# through that same public HTTPS entry point:
#   https://${DOMAIN}/api/monitoring/host-metrics
# The ingest endpoint is therefore reachable from the internet, which is why it has its
# own secret, X-Ingest-Token (backend/src/modules/monitoring/routes.ts), instead of relying
# on network topology. Always HTTPS, never a plain http:// fallback: the token would cross
# the wire in clear.
#
# -----------------------------------------------------------------------
# INSTALL (system cron, root, on the server)
# -----------------------------------------------------------------------
#   1. Copy the script to the host, for example:
#        sudo install -o root -g root -m 750 infra/host-metrics-collector.sh \
#          /opt/vana-dash/host-metrics-collector.sh
#
#   2. A precondition this script does not create:
#        ~/vanadash-secrets/host_metrics_ingest_token   (chmod 600)
#      has to exist on the host and hold exactly the plaintext value of
#      HOST_METRICS_INGEST_TOKEN from the production .env. Set HOST_METRICS_TOKEN_FILE if
#      it lives somewhere else.
#
#   3. DOMAIN has to reach the script, either exported in the crontab environment or as
#      the first CLI argument. Same value as DOMAIN= in the production .env.
#
#   4. `docker` has to be callable without sudo by the cron user (a member of the `docker`
#      group), or the cron job runs as root.
#
#   5. Add to root's crontab (`sudo crontab -e`):
#
#        DOMAIN=dash.example.com
#        * * * * * /opt/vana-dash/host-metrics-collector.sh >> /var/log/host-metrics-collector.log 2>&1
#
#      Rotate the log with logrotate (daily, keep 7, compress).
#
# -----------------------------------------------------------------------
# SERVER-1 (an optional second host, without Docker)
# -----------------------------------------------------------------------
# The same script with HOST_KEY=server-1 in the crontab. The backend stores that snapshot
# apart and shows it under the main host in "System health", with no email alerts. Without
# docker on PATH, containers is sent as `{}`. It goes out over public HTTPS as well:
#
#   DOMAIN=dash.example.com
#   HOST_KEY=server-1
#   * * * * * $HOME/vana-dash/host-metrics-collector.sh >> $HOME/vana-dash/host-metrics-collector.log 2>&1
#
# -----------------------------------------------------------------------
# FAILURE MODE
# -----------------------------------------------------------------------
# Fire-and-forget. Any failure (docker unreachable, a curl error, a non-200 answer) is
# logged to stderr and the script exits non-zero. It does not retry in a loop. One data
# point missed in 60 seconds is not an emergency: the backend already shows "no recent
# snapshot" as a yellow signal.
# -----------------------------------------------------------------------

set -uo pipefail
# No `set -e`, on purpose: one failed step (a container without a healthcheck, a hiccup of
# the docker CLI) must not cancel the whole snapshot. Each step checks and logs its own
# failure.

SCRIPT_NAME="$(basename "$0")"

log_err() {
  echo "[$SCRIPT_NAME] $(date -u '+%Y-%m-%dT%H:%M:%SZ') ERROR: $*" >&2
}

# -------------------------------------------------------------------------
# DOMAIN: the first CLI argument wins, then the env var; otherwise fail at once
# -------------------------------------------------------------------------
DOMAIN="${1:-${DOMAIN:-}}"
if [[ -z "$DOMAIN" ]]; then
  log_err "DOMAIN is not set: pass it as \$1 or export DOMAIN in the crontab environment"
  exit 1
fi

# -------------------------------------------------------------------------
# The token file: read it, never echo it, never log it
# -------------------------------------------------------------------------
TOKEN_FILE="${HOST_METRICS_TOKEN_FILE:-$HOME/vanadash-secrets/host_metrics_ingest_token}"
if [[ ! -r "$TOKEN_FILE" ]]; then
  log_err "cannot read the ingest token file: $TOKEN_FILE (see step 2 of INSTALL at the top of this script)"
  exit 1
fi
INGEST_TOKEN="$(<"$TOKEN_FILE")"
if [[ -z "$INGEST_TOKEN" ]]; then
  log_err "the ingest token file is empty: $TOKEN_FILE"
  exit 1
fi

ENDPOINT="https://${DOMAIN}/api/monitoring/host-metrics"

HOST_KEY="${HOST_KEY:-dash}"
if [[ "$HOST_KEY" != "dash" && "$HOST_KEY" != "server-1" ]]; then
  log_err "unknown HOST_KEY: '$HOST_KEY' (accepted: dash, server-1)"
  exit 1
fi

# -------------------------------------------------------------------------
# CPU %: two /proc/stat samples about 200ms apart, in the same run.
# -------------------------------------------------------------------------
read_proc_stat() {
  read -r _cpu user nice system idle iowait irq softirq steal _rest < /proc/stat
  local total=$((user + nice + system + idle + iowait + irq + softirq + steal))
  local idle_all=$((idle + iowait))
  echo "$total $idle_all"
}

cpu_pct="0"
if [[ -r /proc/stat ]]; then
  read -r total1 idle1 <<< "$(read_proc_stat)"
  sleep 0.2
  read -r total2 idle2 <<< "$(read_proc_stat)"
  total_delta=$((total2 - total1))
  idle_delta=$((idle2 - idle1))
  if (( total_delta > 0 )); then
    cpu_pct="$(awk -v td="$total_delta" -v id="$idle_delta" 'BEGIN { printf "%.1f", (1 - (id / td)) * 100 }')"
  else
    log_err "the /proc/stat delta was zero over the 200ms sampling window, reporting cpu_pct=0"
  fi
else
  log_err "/proc/stat is not readable, reporting cpu_pct=0"
fi

# -------------------------------------------------------------------------
# RAM %: /proc/meminfo, (MemTotal - MemAvailable) / MemTotal * 100
# MemAvailable (not MemFree) already counts reclaimable cache and buffers.
# -------------------------------------------------------------------------
ram_pct="0"
if [[ -r /proc/meminfo ]]; then
  mem_total_kb="$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)"
  mem_available_kb="$(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo)"
  if [[ -n "$mem_total_kb" && -n "$mem_available_kb" && "$mem_total_kb" -gt 0 ]]; then
    ram_pct="$(awk -v t="$mem_total_kb" -v a="$mem_available_kb" 'BEGIN { printf "%.1f", (t - a) / t * 100 }')"
  else
    log_err "could not parse MemTotal/MemAvailable from /proc/meminfo, reporting ram_pct=0"
  fi
else
  log_err "/proc/meminfo is not readable, reporting ram_pct=0"
fi

# -------------------------------------------------------------------------
# Disk %: the root filesystem, from `df --output=pcent`.
# -------------------------------------------------------------------------
disk_pct="0"
if disk_line="$(df --output=pcent / 2>/dev/null | tail -n 1)"; then
  disk_pct="$(echo "$disk_line" | tr -d ' %')"
  if ! [[ "$disk_pct" =~ ^[0-9]+$ ]]; then
    log_err "could not parse the output of 'df --output=pcent /' ('$disk_line'), reporting disk_pct=0"
    disk_pct="0"
  fi
else
  log_err "'df --output=pcent /' failed, reporting disk_pct=0"
fi

# -------------------------------------------------------------------------
# Container health: docker inspect over every running container. A container with no
# healthcheck counts as "healthy" while `.State.Running` is true, and as "stopped" when it
# is not running.
# -------------------------------------------------------------------------
containers_json="{}"
if command -v docker >/dev/null 2>&1; then
  container_ids="$(docker ps -q 2>/dev/null || true)"
  if [[ -n "$container_ids" ]]; then
    entries=()
    while IFS=$'\t' read -r name running health; do
      [[ -z "$name" ]] && continue
      name="${name#/}"
      if [[ -z "$health" ]]; then
        if [[ "$running" == "true" ]]; then
          health="healthy"
        else
          health="stopped"
        fi
      fi
      entries+=("\"${name}\":\"${health}\"")
      # shellcheck disable=SC2086 # on purpose: container_ids is a whitespace-separated list
      # of docker ids, meant to expand into separate arguments.
    done < <(docker inspect --format '{{.Name}}	{{.State.Running}}	{{.State.Health.Status}}' $container_ids 2>/dev/null)

    if [[ "${#entries[@]}" -gt 0 ]]; then
      containers_json="{$(IFS=,; echo "${entries[*]}")}"
    else
      log_err "docker inspect returned nothing parsable for the running containers"
    fi
  fi
elif [[ "$HOST_KEY" == "dash" ]]; then
  log_err "the docker CLI is not on PATH, reporting an empty containers object"
fi

# -------------------------------------------------------------------------
# Build the request body and send it.
# -------------------------------------------------------------------------
body="$(printf '{"host":"%s","cpu_pct":%s,"ram_pct":%s,"disk_pct":%s,"containers":%s}' \
  "$HOST_KEY" "$cpu_pct" "$ram_pct" "$disk_pct" "$containers_json")"

# The ingest token must never be a literal argv argument (any local user would see it in
# `ps aux` or /proc/<pid>/cmdline). It goes through a short-lived curl config file, mode
# 600, removed by the trap even when curl fails or the script is killed mid-request.
curl_config_file="$(mktemp)"
chmod 600 "$curl_config_file"
trap 'rm -f "$curl_config_file" /tmp/host-metrics-collector-response.$$ /tmp/host-metrics-collector-curlerr.$$' EXIT
printf 'header = "X-Ingest-Token: %s"\n' "$INGEST_TOKEN" > "$curl_config_file"

http_status="$(curl --silent --show-error --output /tmp/host-metrics-collector-response.$$ \
  --write-out '%{http_code}' \
  --max-time 10 \
  --request POST \
  --header "Content-Type: application/json" \
  --config "$curl_config_file" \
  --data "$body" \
  "$ENDPOINT" 2>/tmp/host-metrics-collector-curlerr.$$)" || curl_exit=$?

response_body="$(cat /tmp/host-metrics-collector-response.$$ 2>/dev/null || true)"
curl_err="$(cat /tmp/host-metrics-collector-curlerr.$$ 2>/dev/null || true)"
rm -f "$curl_config_file" /tmp/host-metrics-collector-response.$$ /tmp/host-metrics-collector-curlerr.$$

if [[ -n "${curl_exit:-}" ]]; then
  log_err "curl could not reach $ENDPOINT: $curl_err"
  exit 1
fi

if [[ "$http_status" != "200" ]]; then
  log_err "the ingest endpoint returned HTTP $http_status: $response_body"
  exit 1
fi

exit 0
