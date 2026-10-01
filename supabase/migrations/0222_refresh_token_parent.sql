-- 0222: a refresh token knows which token it replaced.
--
-- 0221 told "the reply never arrived" (rescue) from "someone else used the
-- successor" (end the session) by comparing created_at. Two tokens made in
-- the same instant compare equal, so a reused token could read as a lost
-- reply and be let through -- CI caught it on a fast runner. Each token now
-- records its parent; the successor of a spent token is found by that link,
-- not by the clock. Tokens minted before this keep 0221's reading.

alter table refresh_tokens
  add column if not exists parent_id uuid references refresh_tokens (id) on delete set null;
create index if not exists rt_parent_idx on refresh_tokens (parent_id) where parent_id is not null;

-- Copied from 0221 (the latest definition); only the successor lookup and
-- the parent link change.
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
    -- The token minted in this one's place. Unused, unrevoked and still
    -- valid: the browser never received it, so it is a lost reply.
    select * into v_next from refresh_tokens r where r.parent_id = v_row.id;
    if v_next.id is null then
      -- Minted before 0222 recorded parents: fall back to 0221's reading.
      select * into v_next from refresh_tokens r
       where r.family_id = v_row.family_id
         and r.created_at >= v_row.consumed_at
         and not exists (
           select 1 from refresh_tokens x
            where x.family_id = v_row.family_id
              and x.id <> v_row.id
              and x.consumed_at is not null
              and x.created_at >= v_row.created_at
         )
       order by r.created_at desc
       limit 1;
    end if;
    if v_next.id is not null and v_next.id <> v_row.id
       and v_next.consumed_at is null and v_next.revoked_at is null
       and v_next.expires_at > now()
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
  insert into refresh_tokens (user_id, family_id, token_hash, expires_at, parent_id)
  values (
    v_row.user_id,
    v_row.family_id,
    encode(sha256(convert_to(v_new_raw, 'UTF8')), 'hex'),
    now() + interval '90 days',
    v_row.id
  );

  return query select v_row.user_id, v_new_raw;
end;
$$;

revoke all on function rotate_refresh_token(text) from public, anon, authenticated;
grant execute on function rotate_refresh_token(text) to service_role;
