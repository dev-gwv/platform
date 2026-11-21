#!/bin/sh
# Restore the database from a dump taken by backup.sh. DESTRUCTIVE: it drops and
# recreates the database, so the API must be stopped first.
#
#   docker compose -f docker-compose.yml -f docker-compose.coolify.yml run --rm backup restore list
#   docker compose -f docker-compose.yml -f docker-compose.coolify.yml stop api cron cron-messages cron-attendance
#   docker compose -f docker-compose.yml -f docker-compose.coolify.yml run --rm -e RESTORE_CONFIRM=yes backup restore latest
#   sh deploy/deploy.sh
#
# Bring it back with deploy.sh, never a bare `docker compose up`: on the
# Coolify host that drops the Traefik labels and the API answers 503.
#
# The name argument may be a local file in /backups, a bare dump filename (it is
# fetched from off-box storage if it isn't local), or "latest".
#
# Practise this on a scratch box before you need it. An untested restore is a
# hope, not a backup.
set -eu

DIR="${BACKUP_DIR:-/backups}"
DB="${POSTGRES_DB:-ipc}"
HOST="${PGHOST:-db}"
USER="${POSTGRES_USER:-postgres}"
export PGPASSWORD="$POSTGRES_PASSWORD"

log() { echo "[restore] $*"; }

offsite_enabled() { [ -n "${BACKUP_S3_BUCKET:-}" ]; }

rclone_env() {
  export RCLONE_CONFIG_OFF_TYPE=s3
  export RCLONE_CONFIG_OFF_PROVIDER="${BACKUP_S3_PROVIDER:-Other}"
  export RCLONE_CONFIG_OFF_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID:-}"
  export RCLONE_CONFIG_OFF_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:-}"
  export RCLONE_CONFIG_OFF_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
  export RCLONE_CONFIG_OFF_REGION="${BACKUP_S3_REGION:-auto}"
  export RCLONE_CONFIG_OFF_NO_CHECK_BUCKET=true
}

remote_path() { echo "off:${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX:-ipc}"; }

do_list() {
  log "local ($DIR):"
  ls -lh "$DIR"/*.dump 2>/dev/null || log "  (none)"
  if offsite_enabled; then
    rclone_env
    log "off-box ($(remote_path)):"
    rclone lsl "$(remote_path)" || log "  (unreadable)"
  else
    log "off-box: not configured (BACKUP_S3_BUCKET unset)"
  fi
}

resolve() {
  arg="$1"
  if [ "$arg" = "latest" ]; then
    # Newest by name — the stamp is ISO-ish UTC, so lexical order is time order.
    latest=$(ls "$DIR"/*.dump 2>/dev/null | sort | tail -n 1 || true)
    [ -n "$latest" ] || { log "no local dumps in $DIR — try: restore list" >&2; exit 1; }
    echo "$latest"
    return
  fi
  [ -f "$arg" ] && { echo "$arg"; return; }
  [ -f "$DIR/$arg" ] && { echo "$DIR/$arg"; return; }

  offsite_enabled || { log "no such dump: $arg — try: restore list" >&2; exit 1; }
  rclone_env
  log "not local — fetching $arg from off-box storage" >&2
  rclone copyto "$(remote_path)/$arg" "$DIR/$arg" --retries 3 >&2
  echo "$DIR/$arg"
}

[ "${1:-}" = "list" ] && { do_list; exit 0; }
[ $# -ge 1 ] || { echo "usage: restore.sh <list|latest|dump-name>" >&2; exit 2; }

FILE=$(resolve "$1")

if [ "${RESTORE_CONFIRM:-}" != "yes" ]; then
  log "would restore $DB on $HOST from $FILE"
  log "this DROPS the existing database. Re-run with RESTORE_CONFIRM=yes."
  exit 1
fi

log "verifying $FILE"
pg_restore --list "$FILE" >/dev/null

# The API reconnects on its own between terminate and restore, then serves a
# half-restored schema as if it were fine. Refuse while it answers.
if wget -q -O /dev/null -T 5 "http://api:8787/health" 2>/dev/null; then
  log "the API is still up — stop it first: docker compose stop api cron" >&2
  exit 1
fi

log "dropping and recreating $DB"
psql -v ON_ERROR_STOP=1 -h "$HOST" -U "$USER" -d postgres \
  -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DB' and pid <> pg_backend_pid()" \
  >/dev/null
dropdb -h "$HOST" -U "$USER" --if-exists "$DB"
createdb -h "$HOST" -U "$USER" "$DB"

log "restoring (this can take a while)"
# --exit-on-error so a half-restored database can't be mistaken for a good one.
# If it trips on a missing role, run the `migrate` service once (it applies the
# idempotent bootstrap that creates the roles) and restore again.
pg_restore -h "$HOST" -U "$USER" -d "$DB" --no-owner --exit-on-error "$FILE"

log "done. Bring it back up from the checkout root: sh deploy/deploy.sh"
