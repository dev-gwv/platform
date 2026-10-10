#!/bin/sh
# Nightly Postgres backup for the self-hosted VPS (the `backup` compose service).
#
#   backup.sh daemon    dump now, then once a day at BACKUP_AT_UTC (default)
#   backup.sh once      one dump, then exit  (docker compose run --rm backup once)
#   backup.sh health    exit non-zero if the newest backup is stale (healthcheck)
#   backup.sh drill     restore the newest dump into a scratch database and check it
#   backup.sh restore … hand off to restore.sh (see there; destructive)
#
# Each run: pg_dump -Fc -> /backups, verify the dump is readable, prune local
# copies older than BACKUP_KEEP_DAYS, then (if BACKUP_S3_BUCKET is set) copy it
# off the box with rclone and prune the remote past BACKUP_OFFSITE_KEEP_DAYS.
#
# Success is recorded in marker files so `health` can fail loudly when backups
# quietly stop happening — the failure mode that actually loses data.
set -eu

DIR="${BACKUP_DIR:-/backups}"
DB="${POSTGRES_DB:-ipc}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
OFFSITE_KEEP_DAYS="${BACKUP_OFFSITE_KEEP_DAYS:-30}"
AT="${BACKUP_AT_UTC:-02:30}"
LOCAL_MARKER="$DIR/.last-success"
OFFSITE_MARKER="$DIR/.last-offsite"
DRILL_MARKER="$DIR/.last-drill"
DRILL_FAILED="$DIR/.drill-failed"
# The tables a restore must bring back, counted at dump time and again after.
DRILL_TABLES="companies users clients projects shoots invoices received_payments crm_leads"

# Stale thresholds (minutes). Local is a hard daily expectation; the off-box copy
# gets a longer grace so one flaky night at the storage provider doesn't wedge a
# deploy that waits on this container's health.
LOCAL_STALE_MIN=1560      # 26h
OFFSITE_STALE_MIN=4320    # 72h
DRILL_STALE_MIN=11520     # 8 days: the drill runs weekly

log() { echo "[backup] $*"; }

offsite_enabled() { [ -n "${BACKUP_S3_BUCKET:-}" ]; }

# rclone is configured entirely from the environment as a remote named "off",
# so nothing has to be written to disk or baked into the image.
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

run_backup() {
  mkdir -p "$DIR"
  export PGPASSWORD="$POSTGRES_PASSWORD"

  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  file="$DIR/${DB}-${stamp}.dump"

  # What the restore drill will expect to find. Counted just before the dump,
  # so a row added in between can only make the dump hold one more, never less.
  counts "$DB" > "$file.counts" 2>/dev/null || rm -f "$file.counts"

  log "dumping $DB -> $(basename "$file")"
  # -Fc = custom format: compressed, and pg_restore can read a table out of it.
  pg_dump -Fc \
    -h "${PGHOST:-db}" \
    -U "${POSTGRES_USER:-postgres}" \
    -d "$DB" \
    -f "$file"

  # A dump that can't be listed is a truncated dump. Cheap, catches the case
  # where the disk filled or the connection dropped mid-write.
  if ! pg_restore --list "$file" >/dev/null 2>&1; then
    log "FAILED: $(basename "$file") is not a readable dump — deleting"
    rm -f "$file"
    return 1
  fi

  size=$(du -h "$file" | cut -f1)
  log "ok $(basename "$file") ($size)"
  date -u +%s > "$LOCAL_MARKER"

  # Local retention. -mtime is whole days, which is what we want here.
  find "$DIR" -maxdepth 1 -name "${DB}-*.dump" -mtime "+${KEEP_DAYS}" -print -delete |
    while read -r old; do log "pruned local $(basename "$old")"; rm -f "$old.counts"; done

  if offsite_enabled; then
    copy_offsite "$file"
  else
    log "BACKUP_S3_BUCKET unset — local-only. A backup on the same box as the"
    log "database does not survive losing the box. Configure off-box storage."
  fi
}

copy_offsite() {
  file="$1"
  rclone_env
  dest="$(remote_path)/$(basename "$file")"

  log "uploading -> $dest"
  if rclone copyto "$file" "$dest" --retries 3 --low-level-retries 5 --stats-one-line; then
    log "uploaded $(basename "$file")"
    date -u +%s > "$OFFSITE_MARKER"
    rclone delete "$(remote_path)" --min-age "${OFFSITE_KEEP_DAYS}d" ||
      log "warning: remote prune failed (upload succeeded)"
  else
    log "FAILED: upload of $(basename "$file") — the local copy is kept"
    return 1
  fi
}

# "table count" per line, for the drill to compare.
counts() {
  for t in $DRILL_TABLES; do
    n=$(psql -h "${PGHOST:-db}" -U "${POSTGRES_USER:-postgres}" -d "$1" -Atc "select count(*) from public.$t" 2>/dev/null || echo missing)
    echo "$t $n"
  done
}

# The restore drill: an untested backup is a hope. Restores the newest dump
# into a scratch database on the same server, checks every table in
# DRILL_TABLES came back with at least the rows it had at dump time, and
# drops the scratch copy. Never touches the live database.
drill() {
  export PGPASSWORD="$POSTGRES_PASSWORD"
  file=$(ls -1t "$DIR"/"${DB}"-*.dump 2>/dev/null | head -1)
  [ -n "$file" ] || { log "drill: no dump to restore"; return 1; }
  scratch="${DB}_restore_drill"
  host="${PGHOST:-db}"
  user="${POSTGRES_USER:-postgres}"
  log "drill: restoring $(basename "$file") into $scratch"
  psql -h "$host" -U "$user" -d postgres -qc "drop database if exists $scratch" &&
    psql -h "$host" -U "$user" -d postgres -qc "create database $scratch" || { log "drill: could not make $scratch"; return 1; }
  ok=1
  pg_restore -h "$host" -U "$user" -d "$scratch" --no-owner --no-privileges --exit-on-error "$file" > /dev/null 2>&1 || {
    log "drill FAILED: pg_restore did not finish"
    ok=0
  }
  if [ "$ok" = 1 ] && [ -f "$file.counts" ]; then
    while read -r t want; do
      got=$(psql -h "$host" -U "$user" -d "$scratch" -Atc "select count(*) from public.$t" 2>/dev/null || echo missing)
      if [ "$want" = missing ] || [ "$got" = missing ] || [ "$got" -lt "$want" ]; then
        log "drill FAILED: $t has $got rows, the dump was taken with $want"
        ok=0
      fi
    done < "$file.counts"
  fi
  psql -h "$host" -U "$user" -d postgres -qc "drop database if exists $scratch" || true
  if [ "$ok" = 1 ]; then
    log "drill ok: $(basename "$file") restores, every checked table came back"
    date -u +%s > "$DRILL_MARKER"
    rm -f "$DRILL_FAILED"
    return 0
  fi
  date -u +%s > "$DRILL_FAILED"
  return 1
}

# Fresh within N minutes?
fresh() {
  [ -f "$1" ] || return 1
  [ -z "$(find "$1" -mmin "+$2")" ]
}

health() {
  fresh "$LOCAL_MARKER" "$LOCAL_STALE_MIN" || {
    echo "no successful local backup in the last $((LOCAL_STALE_MIN / 60))h"
    exit 1
  }
  if [ -f "$DRILL_FAILED" ]; then
    echo "the last restore drill failed: a backup that does not restore is not a backup"
    exit 1
  fi
  if [ -f "$DRILL_MARKER" ] && ! fresh "$DRILL_MARKER" "$DRILL_STALE_MIN"; then
    echo "no restore drill in the last $((DRILL_STALE_MIN / 1440)) days"
    exit 1
  fi
  if offsite_enabled; then
    fresh "$OFFSITE_MARKER" "$OFFSITE_STALE_MIN" || {
      echo "no successful off-box copy in the last $((OFFSITE_STALE_MIN / 60))h"
      exit 1
    }
  fi
  echo "ok"
}

# Seconds until the next BACKUP_AT_UTC. Leading zeros are stripped so "02:30"
# doesn't get read as octal by the shell's arithmetic.
sleep_until_next() {
  h=$(echo "${AT%%:*}" | sed 's/^0*//'); h=${h:-0}
  m=$(echo "${AT##*:}" | sed 's/^0*//'); m=${m:-0}
  now=$(( $(date -u +%s) % 86400 ))
  target=$(( h * 3600 + m * 60 ))
  delta=$(( target - now ))
  [ "$delta" -le 0 ] && delta=$(( delta + 86400 ))
  log "next run in $(( delta / 3600 ))h $(( delta % 3600 / 60 ))m (at ${AT} UTC)"
  sleep "$delta"
}

case "${1:-daemon}" in
  health) health ;;
  once)   run_backup ;;
  drill)  drill ;;
  # The image's entrypoint is this script, so restore is reached through it:
  # `docker compose run --rm backup restore list`.
  restore) shift; exec /bin/sh "$(dirname "$0")/restore.sh" "$@" ;;
  daemon)
    # One at start: a deploy leaves a fresh snapshot behind, and a broken backup
    # path shows up immediately instead of at 02:30 three weeks from now.
    run_backup || log "startup backup failed — will retry on schedule"
    while true; do
      sleep_until_next
      run_backup || log "scheduled backup failed — will retry tomorrow"
      # Sundays, and the first night with no drill on record: prove the newest
      # dump restores.
      if [ "$(date -u +%u)" = 7 ] || [ ! -f "$DRILL_MARKER" ]; then
        drill || log "restore drill failed — health reports it until a drill passes"
      fi
    done
    ;;
  *) echo "usage: backup.sh [daemon|once|health|drill|restore <args>]" >&2; exit 2 ;;
esac
