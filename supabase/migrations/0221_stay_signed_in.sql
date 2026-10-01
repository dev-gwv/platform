-- 0221: stay signed in until you sign out.
--
-- The owner: "The system keeps on logging out after some time. Stop it unless
-- the user logs it out." Three things ended a session nobody asked to end:
--
--   1. A hard 30 days from sign-in. Every rotation inherited the first
--      token's expiry, so a studio using the app daily was still thrown out
--      on day 30. Now each rotation pushes the expiry to 90 days from now:
--      a session ends after 90 days of not opening the app, not 90 days of use.
--
--   2. A lost reply. If the refresh reached the server but its answer never
--      reached the browser (Wi-Fi drop, tab closed mid-request), the browser
--      kept the old token. Presenting it later than 60 seconds after it was
--      spent looked like theft and killed the whole family. Now, when the
--      token handed out in its place has never been used, the browser simply
--      never got it: that unused successor is withdrawn and a fresh one
--      issued. Real reuse -- the successor HAS been used, so two parties hold
--      the session -- still revokes the family.
--
--   3. Two tabs refreshing together. The loser got the same refusal as an
--      expired session and signed every tab out. refresh_token_state() lets
--      the API tell "another tab has just rotated this" (409, wait and pick up
--      the new token) apart from "this session is over" (401).

-- Copied from 0024 (the latest definition); only the expiry changes.
create or replace function issue_refresh_token(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw text := gen_random_uuid()::text || gen_random_uuid()::text;
begin
  insert into refresh_tokens (user_id, family_id, token_hash, expires_at)
  values (
    p_user_id,
    gen_random_uuid(),
    encode(sha256(convert_to(v_raw, 'UTF8')), 'hex'),
    now() + interval '90 days'
  );
  return v_raw;
end;
$$;

-- Copied from 0034 (the latest definition): the expiry slides, and a token
-- whose successor was never used is a lost reply, not a theft.
create or replace function rotate_refresh_token(p_raw text)
returns table (user_id uuid, token text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash    text := encode(sha256(convert_to(p_raw, 'UTF8')), 'hex');
  v_row     refresh_tokens%rowtype;
  v_next    refresh_tokens%rowtype;
  v_new_raw text;
begin
  update refresh_tokens
     set consumed_at = now()
   where token_hash = v_hash
     and consumed_at is null
     and revoked_at is null
     and expires_at > now()
   returning * into v_row;

  if not found then
    select * into v_row from refresh_tokens where token_hash = v_hash;
    if v_row.id is null or v_row.revoked_at is not null or v_row.consumed_at is null then
      return query select null::uuid, null::text;   -- unknown, revoked or expired
      return;
    end if;
    -- Spent already. Inside 60 seconds it is another tab's race: refused,
    -- and the API tells that tab to pick up the winner's token.
    if v_row.consumed_at >= now() - interval '60 seconds' then
      return query select null::uuid, null::text;
      return;
    end if;
    -- The newest token of the family. Unused, and minted when this one was
    -- spent: the browser never received it.
    select * into v_next from refresh_tokens r
     where r.family_id = v_row.family_id
     order by r.created_at desc
     limit 1;
    if v_next.id is not null and v_next.id <> v_row.id
       and v_next.consumed_at is null and v_next.revoked_at is null
       and v_next.expires_at > now()
       and v_next.created_at >= v_row.consumed_at
       -- Nothing issued after this token has been used: one holder only.
       and not exists (
         select 1 from refresh_tokens r
          where r.family_id = v_row.family_id
            and r.created_at > v_row.created_at
            and r.consumed_at is not null
       )
    then
      update refresh_tokens set revoked_at = now() where id = v_next.id;
    else
      -- The successor was used: two parties hold this session. End it.
      update refresh_tokens set revoked_at = now()
        where family_id = v_row.family_id and revoked_at is null;
      return query select null::uuid, null::text;
      return;
    end if;
  end if;

  -- A member row that has been soft-deleted or deactivated ends the session
  -- here rather than at the next access-token mint. An account with no member
  -- row yet (mid-registration) is not a dead member.
  if exists (
    select 1 from users u
    where u.user_id = v_row.user_id
      and (u.deleted_at is not null or u.status <> 'active')
  ) then
    update refresh_tokens set revoked_at = now()
      where family_id = v_row.family_id and revoked_at is null;
    return query select null::uuid, null::text;
    return;
  end if;

  v_new_raw := gen_random_uuid()::text || gen_random_uuid()::text;
  insert into refresh_tokens (user_id, family_id, token_hash, expires_at)
  values (
    v_row.user_id,
    v_row.family_id,
    encode(sha256(convert_to(v_new_raw, 'UTF8')), 'hex'),
    now() + interval '90 days'
  );

  return query select v_row.user_id, v_new_raw;
end;
$$;

-- Why a refresh was refused: 'raced' (spent by another tab in the last
-- minute -- the session is fine) or 'ended'. Nothing else is told.
create or replace function refresh_token_state(p_raw text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when r.id is not null and r.revoked_at is null and r.consumed_at is not null
                and r.consumed_at >= now() - interval '60 seconds' then 'raced'
           else 'ended'
         end
    from (select 1) one
    left join refresh_tokens r on r.token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
$$;

revoke all on function issue_refresh_token(uuid) from public, anon, authenticated;
revoke all on function rotate_refresh_token(text) from public, anon, authenticated;
revoke all on function refresh_token_state(text) from public, anon, authenticated;
grant execute on function issue_refresh_token(uuid) to service_role;
grant execute on function rotate_refresh_token(text) to service_role;
grant execute on function refresh_token_state(text) to service_role;
