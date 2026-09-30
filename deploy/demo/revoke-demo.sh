#!/bin/sh
# End the reviewer's temporary login: the account cannot sign in any more, every
# open session is closed, and the studio's trial is over. The sample leads stay
# (they are labelled sample data) so the studio can be looked at again later by
# running seed-demo.sh, which restores the login for another 14 days.
#
#   DEMO_EMAIL=reviewer@example.com sh deploy/demo/revoke-demo.sh
#
# Run from the checkout root. Only EXECs into the db container; never up/down.
set -eu

if [ ! -f docker-compose.yml ]; then
  echo "revoke-demo.sh: run me from the checkout root (no docker-compose.yml here)" >&2
  exit 1
fi
: "${DEMO_EMAIL:?set DEMO_EMAIL to the reviewer's login}"
case "$DEMO_EMAIL" in
  *[!A-Za-z0-9._@+-]* | "" ) echo "revoke-demo.sh: DEMO_EMAIL has characters an email address should not" >&2; exit 1 ;;
esac

COMPOSE="${COMPOSE:-docker compose -f docker-compose.yml -f docker-compose.coolify.yml}"

{
  printf '\\set demo_email %s\n' "'$DEMO_EMAIL'"
  cat <<'SQL'
-- psql does not fill variables into a DO body, so the email goes in as a setting.
select set_config('demo.email', lower(:'demo_email'), false) \gset
do $revoke$
declare
  v_uid uuid;
  v_co  uuid;
begin
  select id into v_uid from auth.users where lower(email) = current_setting('demo.email');
  if v_uid is null then
    raise exception 'no account with that email';
  end if;
  select company_id into v_co from users where user_id = v_uid;
  -- Only ever a demo studio: refuse to lock out a real one by a slip of the fingers.
  if not exists (select 1 from companies where id = v_co and name = 'Demo Studio (sample data)') then
    raise exception 'that account does not belong to the demo studio';
  end if;

  update auth.users
     set encrypted_password = null, password_changed_at = now(), password_version = password_version + 1
   where id = v_uid;
  perform revoke_all_sessions(v_uid);
  update users set status = 'inactive' where user_id = v_uid;
  update companies set grandfathered_until = now() - interval '1 day' where id = v_co;
end
$revoke$;
select 'demo login ended' as result;
SQL
} | $COMPOSE exec -T db sh -c 'psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
