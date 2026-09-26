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
SHA=$(git rev-parse HEAD)
if grep -q '^APP_VERSION=' .env; then
  sed -i "s|^APP_VERSION=.*|APP_VERSION=${SHA}|" .env
else
  echo "APP_VERSION=${SHA}" >> .env
fi
echo "deploy.sh: APP_VERSION=${SHA}"

# ── Up ───────────────────────────────────────────────────────
# This VPS runs Coolify (its Traefik terminates TLS on 80/443), so the coolify
# overlay is used and our own caddy is omitted.
#
# Services are named explicitly, and anything added to docker-compose.yml must
# be added HERE too or it is defined and never started — cron-attendance sat in
# the compose file unrun for months for exactly that reason, which meant the
# nightly absent sweep never fired once.
#
# --wait blocks on the db and api healthchecks. `api` depends on `migrate`
# completing successfully, so a failed migration stops the deploy here rather
# than leaving the API running against a half-migrated database.
docker compose -f docker-compose.yml -f docker-compose.coolify.yml \
  up -d --build --wait --remove-orphans \
  db migrate api cron cron-attendance cron-messages backup

docker compose -f docker-compose.yml -f docker-compose.coolify.yml ps
