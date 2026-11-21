#!/bin/sh
# Idempotent DB migrator — runs on every deploy (the `migrate` compose service,
# run on its own by deploy/deploy.sh before the API is replaced).
# 1. applies the bootstrap (roles/auth/extensions/grants), which is idempotent
# 2. records applied migrations in a schema_migrations ledger and runs only the
#    ones not yet applied, each in its own transaction together with its
#    ledger row (so a file is never recorded without having run, or run twice)
#
# Rules on top of that, each learned the hard way:
# * A file with no SQL in it (only comments: a number CLAIMED ahead of its
#   body, see CLAUDE.md) is skipped and NOT recorded. Recording it is what
#   made 0265's body never run: the ledger said "applied" for an empty file.
# * A pending file numbered at or below the highest number already applied is
#   refused: it means two sessions picked the same number, or a body was added
#   to a claim after a later migration was deployed. Put it in a new, higher
#   number (written to be safe to run twice), or, when it really is safe out of
#   order, run with MIGRATE_ALLOW_OUT_OF_ORDER=1.
#
# Adopting an EXISTING database (already migrated 0001.. by hand / old init.sh):
# if the ledger is empty but the schema already exists (companies table present),
# every current migration is BASELINED (marked applied without re-running), so
# only genuinely new files run from then on.
set -eu

export PGPASSWORD="$POSTGRES_PASSWORD"
PSQL="psql -X -v ON_ERROR_STOP=1 -h ${PGHOST:-db} -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-ipc}"
# Overridable only so the script can be exercised against a scratch database.
BOOTSTRAP_SQL=${BOOTSTRAP_SQL:-/db/00_bootstrap.sql}
MIGRATIONS_DIR=${MIGRATIONS_DIR:-/db/migrations}

echo "[migrate] bootstrap (idempotent)"
$PSQL -f "$BOOTSTRAP_SQL"
$PSQL -c "alter role authenticator with login password '${DB_AUTHENTICATOR_PASSWORD}'"

echo "[migrate] ensure ledger"
$PSQL -c "create table if not exists schema_migrations (
  filename text primary key, applied_at timestamptz not null default now());"

# Baseline decision made once, before the loop.
HAS_SCHEMA=$($PSQL -tAc "select to_regclass('public.companies') is not null")

# The whole ledger in ONE query, not one psql round trip per file.
APPLIED=$($PSQL -tAc "select filename from schema_migrations order by filename")
if [ -z "$APPLIED" ]; then LEDGER_EMPTY=1; else LEDGER_EMPTY=0; fi
# Highest number already applied (the four digits at the front of the name).
MAX_APPLIED=$(printf '%s\n' "$APPLIED" | sed -n 's/^\([0-9][0-9]*\)_.*/\1/p' | sort -n | tail -n 1)
MAX_APPLIED=${MAX_APPLIED:-0}

is_applied() {
  printf '%s\n' "$APPLIED" | grep -qxF "$1"
}

# True when the file holds something other than comments and blank lines.
has_sql() {
  sed -e 's/--.*$//' "$1" | grep -q '[^[:space:]]'
}

applied_count=0
for f in $(ls "$MIGRATIONS_DIR"/*.sql | grep -v '/0000_' | sort); do
  name=$(basename "$f")
  is_applied "$name" && continue

  case "$name" in
    *[!A-Za-z0-9_.-]*)
      echo "[migrate] REFUSED: '$name' — a migration name may only hold letters, digits, _ . -" >&2
      exit 1 ;;
  esac

  if [ "$HAS_SCHEMA" = "t" ] && [ "$LEDGER_EMPTY" = "1" ]; then
    echo "[migrate] baseline (mark applied, do not run) $name"
    $PSQL -c "insert into schema_migrations (filename) values ('$name')"
    continue
  fi

  if ! has_sql "$f"; then
    echo "[migrate] $name: claim only, skipped (no SQL yet; not recorded, so its body runs once it has one)"
    continue
  fi

  num=$(printf '%s' "$name" | sed -n 's/^\([0-9][0-9]*\)_.*/\1/p')
  num=${num:-0}
  # 10# would be bash; strip leading zeros portably for the comparison.
  num_int=$(printf '%s' "$num" | sed 's/^0*//'); num_int=${num_int:-0}
  max_int=$(printf '%s' "$MAX_APPLIED" | sed 's/^0*//'); max_int=${max_int:-0}
  if [ "$num_int" -le "$max_int" ] && [ "${MIGRATE_ALLOW_OUT_OF_ORDER:-0}" != "1" ]; then
    echo "[migrate] REFUSED: $name is numbered at or below $MAX_APPLIED, the highest migration already applied." >&2
    echo "[migrate] Two sessions picked the same number, or a body was added to an old claim after later" >&2
    echo "[migrate] migrations were deployed. Move its SQL to a new number above $MAX_APPLIED (written to be" >&2
    echo "[migrate] safe to run twice). If it really is safe out of order, rerun with MIGRATE_ALLOW_OUT_OF_ORDER=1." >&2
    exit 1
  fi

  echo "[migrate] applying $name"
  # One transaction for the file AND its ledger row: a failure leaves neither.
  $PSQL -1 -f "$f" -c "insert into schema_migrations (filename) values ('$name')"
  applied_count=$((applied_count + 1))
done

echo "[migrate] done ($applied_count applied)"
