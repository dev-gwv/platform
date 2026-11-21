#!/bin/sh
# Bring the backend up to whatever is checked out here.
#
# Called three ways, and it has to behave identically in all three:
#   * the GitHub Action, over SSH, from a hosted runner
#   * the GitHub Action, in place, from a self-hosted runner on the VPS
#   * a human on the box, when the Action cannot get in
#
# The git fetch/checkout is the CALLER's job, not this script's — this file
# lives in the repo, so it cannot be the thing that updates the repo. By the
# time it runs, the working tree is already the revision being deployed.
#
# Run from the checkout root:  sh deploy/deploy.sh
set -eu

if [ ! -f docker-compose.yml ]; then
  echo "deploy.sh: run me from the checkout root (no docker-compose.yml here)" >&2
  exit 1
fi
if [ ! -f .env ]; then
  echo "deploy.sh: no .env here — the compose file reads it with env_file" >&2
  exit 1
fi

# ── Stamp the release ────────────────────────────────────────
# /health and every Sentry event report this. Unset, they say "dev", and
# "which deploy broke it" has no answer — which is exactly how this system ran
# until the first deploy that set it.
#
# It reaches Compose through the environment, and only the api service reads
# it (`APP_VERSION: ${APP_VERSION:-}` under api in docker-compose.yml). It used
# to be written into .env, which every service reads through env_file, so each
# deploy changed every container's config and Compose recreated all of them
# (backup, migrate and the tickers) just for a new commit id. A stale
# APP_VERSION line left in .env is harmless: api's own `environment:` entry
# wins over env_file.
SHA=$(git rev-parse HEAD)
APP_VERSION=$SHA
export APP_VERSION
echo "deploy.sh: APP_VERSION=${SHA}"

# This VPS runs Coolify (its Traefik terminates TLS on 80/443), so the coolify
# overlay is used and our own caddy is omitted. Every call below goes through
# dc() so all of them carry the same two files: a bare `docker compose` drops
# the Traefik labels and the API vanishes behind a 503.
dc() {
  docker compose -f docker-compose.yml -f docker-compose.coolify.yml "$@"
}

# ── Zero-downtime helpers (only used with ZERO_DOWNTIME_DEPLOY=1) ──
# A setting from the environment wins; otherwise the last NAME= line in .env.
# .env is read, never sourced: it is Compose's env file, not shell.
setting() {
  if printenv "$1" >/dev/null 2>&1; then
    printenv "$1"
  else
    sed -n "s/^[[:space:]]*\(export[[:space:]][[:space:]]*\)\{0,1\}$1[[:space:]]*=[[:space:]]*//p" .env \
      | tail -n 1 | tr -d "\"'\r" | sed 's/[[:space:]]*#.*$//; s/[[:space:]]*$//'
  fi
}

zero_downtime_wanted() {
  [ "$(setting ZERO_DOWNTIME_DEPLOY)" = "1" ]
}

# "running/healthy", "running/starting", "exited/", "gone/" ...
health_of() {
  docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$1" 2>/dev/null \
    || echo "gone/"
}

# The container's Traefik labels, one per line, sorted.
traefik_labels_of() {
  docker inspect -f '{{range $k, $v := .Config.Labels}}{{printf "%s=%s\n" $k $v}}{{end}}' "$1" 2>/dev/null \
    | grep '^traefik\.' | sort
}

# Stop and remove every api container except the one named (the old one).
zd_remove_others() {
  for id in $(dc ps -aq api); do
    if [ "$id" != "$1" ]; then
      docker stop -t 15 "$id" >/dev/null 2>&1 || true
      docker rm -f "$id" >/dev/null 2>&1 || true
    fi
  done
}

# Start the new API beside the old one, wait for it, drain the old one out of
# Traefik, stop it. Returns 0 when the swap is done OR when it chose not to try
# (then step 3 replaces the api the ordinary way). Exits 1 when the new API
# would not come up; the old one is then still the one serving.
roll_api() {
  zd_health_timeout=$(setting ZERO_DOWNTIME_HEALTH_TIMEOUT)
  zd_health_timeout=${zd_health_timeout:-180}
  zd_drain_timeout=$(setting ZERO_DOWNTIME_DRAIN_TIMEOUT)
  zd_drain_timeout=${zd_drain_timeout:-150}
  # Traefik's Docker provider re-reads the containers when one changes health
  # and applies at most one change every 2 s by default; 5 s covers both.
  zd_settle=5

  echo "deploy.sh: zero-downtime: on (ZERO_DOWNTIME_DEPLOY=1)."
  zd_old=$(dc ps -q api)
  zd_count=$(printf '%s' "$zd_old" | grep -c . || true)
  if [ "$zd_count" != "1" ]; then
    echo "deploy.sh: zero-downtime: ${zd_count} api containers running, not 1 -- replacing it the ordinary way."
    return 0
  fi
  if [ "$(health_of "$zd_old")" != "running/healthy" ]; then
    echo "deploy.sh: zero-downtime: the running api is not healthy, so Traefik is not sending it anything to keep -- replacing it the ordinary way."
    return 0
  fi

  # A second api from the image just built, beside the old one. --no-recreate
  # leaves the old container exactly as it is; --no-deps touches nothing else.
  if ! dc up -d --no-deps --no-recreate --scale api=2 api; then
    zd_remove_others "$zd_old"
    echo "deploy.sh: zero-downtime: could not start a second api. The old one is still serving." >&2
    exit 1
  fi
  zd_new=$(dc ps -q api | grep -vxF "$zd_old" || true)
  if [ "$(printf '%s' "$zd_new" | grep -c . || true)" != "1" ]; then
    zd_remove_others "$zd_old"
    echo "deploy.sh: zero-downtime: expected one new api container, found: ${zd_new:-none}. Removed; the old one is still serving." >&2
    exit 1
  fi
  echo "deploy.sh: zero-downtime: new api $(printf '%.12s' "$zd_new") started beside $(printf '%.12s' "$zd_old")."

  # Two containers of one service must carry the same routers and service, or
  # Traefik reports a conflict and drops the router: the API would 404 for the
  # whole overlap. A label change (docker-compose.coolify.yml, API_DOMAIN,
  # API_ALT_DOMAIN) therefore goes the ordinary way. The new container is still
  # "starting", and Traefik ignores a container until it is healthy, so taking
  # it away again here is never seen.
  if [ "$(traefik_labels_of "$zd_old")" != "$(traefik_labels_of "$zd_new")" ]; then
    zd_remove_others "$zd_old"
    echo "deploy.sh: zero-downtime: the Traefik labels changed in this deploy; two containers with different routers would make Traefik drop the API. Replacing it the ordinary way."
    return 0
  fi

  echo "deploy.sh: zero-downtime: waiting up to ${zd_health_timeout}s for the new api to report healthy..."
  zd_end=$(( $(date +%s) + zd_health_timeout ))
  while :; do
    zd_state=$(health_of "$zd_new")
    case "$zd_state" in
      running/healthy) break ;;
      running/starting) ;;
      *)
        echo "deploy.sh: zero-downtime: the new api is ${zd_state} (healthy expected). Its last log lines:" >&2
        docker logs --tail 40 "$zd_new" >&2 2>&1 || true
        zd_remove_others "$zd_old"
        echo "deploy.sh: NEW API DID NOT START -- removed it. The old API is still serving." >&2
        echo "deploy.sh: The migrations above HAVE been applied. Fix the API, then run sh deploy/deploy.sh again." >&2
        exit 1
        ;;
    esac
    if [ "$(date +%s)" -ge "$zd_end" ]; then
      echo "deploy.sh: zero-downtime: the new api was not healthy after ${zd_health_timeout}s. Its last log lines:" >&2
      docker logs --tail 40 "$zd_new" >&2 2>&1 || true
      zd_remove_others "$zd_old"
      echo "deploy.sh: NEW API DID NOT START -- removed it. The old API is still serving." >&2
      echo "deploy.sh: The migrations above HAVE been applied. Fix the API, then run sh deploy/deploy.sh again." >&2
      exit 1
    fi
    sleep 2
  done
  echo "deploy.sh: zero-downtime: new api healthy; Traefik now sends requests to both."
  sleep "$zd_settle"

  # Take the old one out of Traefik while it still answers: the draining mark
  # turns its healthcheck red, Traefik drops an unhealthy container, and only
  # then is it stopped (SIGTERM; server.ts finishes what is in flight). A
  # container made before the mark existed cannot be drained this way and is
  # stopped straight away, which is the one place a request can still miss.
  if docker inspect -f '{{json .Config.Healthcheck}}' "$zd_old" 2>/dev/null | grep -q 'ipc-api-draining'; then
    echo "deploy.sh: zero-downtime: draining the old api (up to ${zd_drain_timeout}s for its healthcheck to turn)..."
    docker exec "$zd_old" touch /tmp/ipc-api-draining || true
    zd_end=$(( $(date +%s) + zd_drain_timeout ))
    zd_drained=no
    while [ "$(date +%s)" -lt "$zd_end" ]; do
      if [ "$(health_of "$zd_old")" = "running/unhealthy" ]; then
        zd_drained=yes
        break
      fi
      sleep 2
    done
    if [ "$zd_drained" = yes ]; then
      sleep "$zd_settle"
    else
      echo "deploy.sh: zero-downtime: WARNING: the old api did not turn unhealthy in ${zd_drain_timeout}s; stopping it anyway." >&2
    fi
  else
    echo "deploy.sh: zero-downtime: the old api predates the draining mark; stopping it directly."
  fi

  # The new one must still be up before the old one goes.
  if [ "$(health_of "$zd_new")" != "running/healthy" ]; then
    docker exec "$zd_old" rm -f /tmp/ipc-api-draining >/dev/null 2>&1 || true
    zd_remove_others "$zd_old"
    echo "deploy.sh: zero-downtime: the new api stopped being healthy while the old one drained -- removed it." >&2
    echo "deploy.sh: The old API is still running and turns healthy again within a minute. Run sh deploy/deploy.sh again." >&2
    exit 1
  fi

  docker stop -t 15 "$zd_old" >/dev/null
  docker rm -f "$zd_old" >/dev/null
  # Back to one replica, keeping the new container as it is.
  dc up -d --no-deps --no-recreate --scale api=1 api
  echo "deploy.sh: zero-downtime: done; the new api is the only one serving."
}

# ── 1. Build ─────────────────────────────────────────────────
# The images are built while the old containers keep serving.
dc build api backup wa-bot

# ── 2. Migrate, with the old API still serving ──────────────
# The database comes up (or stays up), then the migrations run on their own.
# If one fails the deploy stops HERE: nothing else has been recreated, so the
# API that was running keeps serving on the schema it knows.
dc up -d --wait db
if ! dc run --rm -T migrate; then
  echo "deploy.sh: MIGRATION FAILED — stopping before the API is touched." >&2
  echo "deploy.sh: The API that was running is still serving. Fix the migration" >&2
  echo "deploy.sh: (see the [migrate] lines above), then run sh deploy/deploy.sh again." >&2
  exit 1
fi

# ── 2b. Zero-downtime API swap (opt-in) ─────────────────────
# Off unless ZERO_DOWNTIME_DEPLOY=1 (in the environment, or in .env). Off, the
# script does exactly what it did before: step 3 recreates the api, and the
# few seconds between the old container stopping and the new one answering
# are dropped requests. On, the new API is started BESIDE the old one, takes
# traffic once healthy, and only then is the old one taken out and stopped.
# Step 3 then finds the api already current and leaves it alone.
# docs/RUNBOOK.md "Zero-downtime deploys" says how to turn it on and check it.
if zero_downtime_wanted; then
  roll_api
fi

# ── 3. Up ────────────────────────────────────────────────────
# Services are named explicitly, and anything added to docker-compose.yml must
# be added HERE too or it is defined and never started — cron-attendance sat in
# the compose file unrun for months for exactly that reason, which meant the
# nightly absent sweep never fired once.
#
# --wait blocks on the db and api healthchecks. `api` still depends on
# `migrate` completing successfully; it runs once more here and finds nothing
# left to apply.
dc up -d --wait --remove-orphans \
  db migrate api cron cron-attendance cron-messages wa-bot

# backup is started without --wait. Its health says whether backups are good
# (fresh, restorable, copied off the box in production), which is something
# to fix, not a reason to call a deploy that already replaced the API failed;
# and its 5-minute start period would hold every deploy that recreated it.
dc up -d backup
BACKUP_ID=$(dc ps -q backup 2>/dev/null || true)
if [ -n "$BACKUP_ID" ]; then
  BACKUP_HEALTH=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$BACKUP_ID" 2>/dev/null || true)
  if [ "$BACKUP_HEALTH" = "unhealthy" ]; then
    echo "deploy.sh: WARNING: the backup container is unhealthy. Its reason:" >&2
    dc exec -T backup sh /backup/backup.sh health >&2 || true
  fi
fi

dc ps
