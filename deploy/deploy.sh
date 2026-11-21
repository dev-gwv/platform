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
