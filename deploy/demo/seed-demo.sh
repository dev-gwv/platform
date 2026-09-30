#!/bin/sh
# Make (or refresh) the reviewer's demo studio on the VPS.
#
#   DEMO_EMAIL=reviewer@example.com DEMO_PASSWORD='a long one' sh deploy/demo/seed-demo.sh
#
# Run from the checkout root, like deploy/deploy.sh. It only ever EXECs into the
# running containers -- it never runs `up`, `down` or `--build`, so the API keeps
# its Traefik labels (see CLAUDE.md: a bare `docker compose up` takes the site
# down on this host).
#
# The password is hashed inside the API container and only the hash goes to the
# database. It is read from the environment, not from arguments, and is never
# printed, so it stays out of `ps` and out of logs. Choose it yourself and paste
# it into Meta's review form; end the login with revoke-demo.sh.
set -eu

if [ ! -f docker-compose.yml ]; then
  echo "seed-demo.sh: run me from the checkout root (no docker-compose.yml here)" >&2
  exit 1
fi
: "${DEMO_EMAIL:?set DEMO_EMAIL to the login the reviewer will use}"
: "${DEMO_PASSWORD:?set DEMO_PASSWORD (12 or more characters)}"
if [ "${#DEMO_PASSWORD}" -lt 12 ]; then
  echo "seed-demo.sh: DEMO_PASSWORD must be at least 12 characters" >&2
  exit 1
fi
case "$DEMO_EMAIL" in
  *[!A-Za-z0-9._@+-]* | "" ) echo "seed-demo.sh: DEMO_EMAIL has characters an email address should not" >&2; exit 1 ;;
esac

COMPOSE="${COMPOSE:-docker compose -f docker-compose.yml -f docker-compose.coolify.yml}"
export DEMO_PASSWORD

# Same hash the API makes at sign-up (auth-token.ts: Bun.password.hash, argon2id).
HASH=$($COMPOSE exec -T -e DEMO_PASSWORD api bun -e 'console.log(await Bun.password.hash(process.env.DEMO_PASSWORD))')
case "$HASH" in
  '$argon2'*) ;;
  *) echo "seed-demo.sh: could not hash the password inside the api container" >&2; exit 1 ;;
esac

{
  printf '\\set demo_email %s\n' "'$DEMO_EMAIL'"
  printf '\\set pwhash %s\n' "'$HASH'"
  cat deploy/demo/demo-studio.sql
} | $COMPOSE exec -T db sh -c 'psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

echo "seed-demo.sh: done. Sign in at the app with ${DEMO_EMAIL}; the password is the one you set."
