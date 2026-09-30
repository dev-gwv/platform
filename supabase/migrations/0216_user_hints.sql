-- 0216: small per-person memory for one-time notes, and when a member last
-- opened the app.
--
-- When a studio assigns an editor or books crew, the app now says, once in a
-- plain line, that the member sees the work on their own login -- new studios
-- did not know a team dashboard existed. The owner asked for it to show for
-- the first few assignments only, with a way to close it for good. That count
-- has to follow the person from phone to laptop, so it lives on their row:
--
--   users.hints  {"assign_note": {"shown": 3, "closed": false}, ...}
--
-- It is written only through set_user_hint(), and only ever to the caller's
-- own row. Nothing in it is private (a counter and a flag), so it rides on the
-- users row the caller can already read.
--
-- "Has Nitin ever opened the app?" is answered from usage_events (0117), which
-- every signed-in tab writes to once a minute. The index below makes the
-- per-person max cheap.

alter table users add column if not exists hints jsonb not null default '{}'::jsonb;

create index if not exists usage_events_user_time_idx on usage_events (user_id, occurred_at desc);

-- Merge one key into the caller's own hints and return the whole object.
-- Keys are short snake_case words; a value is small JSON. A null value removes
-- the key.
create or replace function set_user_hint(p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hints jsonb;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_key is null or p_key !~ '^[a-z][a-z0-9_]{0,39}$' then
    raise exception 'bad hint key' using errcode = '22023';
  end if;
  if p_value is not null and length(p_value::text) > 2000 then
    raise exception 'hint too large' using errcode = '22023';
  end if;

  update users
     set hints = case
                   when p_value is null then coalesce(hints, '{}'::jsonb) - p_key
                   else coalesce(hints, '{}'::jsonb) || jsonb_build_object(p_key, p_value)
                 end
   where user_id = v_uid
     and deleted_at is null
  returning hints into v_hints;

  return coalesce(v_hints, '{}'::jsonb);
end;
$$;

revoke all on function set_user_hint(text, jsonb) from public, anon;
grant execute on function set_user_hint(text, jsonb) to authenticated;
