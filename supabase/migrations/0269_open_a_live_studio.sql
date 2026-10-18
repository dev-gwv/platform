-- 0269: a login never opens on an expired studio while another of its
-- studios is open, and the platform owner can see and fix which studio a
-- login opens (owner, 17 Oct: a studio owner extended in Studio Access
-- Manager still landed on "Plan expired").
--
--   * pick_login_profile() (copied from 0159, its only definition) now puts
--     a studio with access first, then the one the login was last in, then
--     its own, then by name. Asking for a particular studio (a switch) is
--     unchanged.
--   * platform_login_lookup(email): every studio that login opens, with its
--     access and which one opens first -- for a platform admin only.
--   * platform_open_first(email, company): the studio that login opens next
--     time it signs in.

create or replace function pick_login_profile(p_user_id uuid, p_wanted uuid default null)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_identity uuid := auth_identity_of(p_user_id);
  v_last     uuid;
  v_pick     uuid;
begin
  if p_wanted is not null then
    select profile_id into v_pick from list_login_profiles(v_identity) where profile_id = p_wanted;
    return v_pick;  -- null: not theirs, the caller refuses
  end if;

  select last_profile_id into v_last from auth.users where id = v_identity;
  select lp.profile_id into v_pick
    from list_login_profiles(v_identity) lp
    join companies c on c.id = lp.company_id
   order by coalesce(company_access_until(c.plan_expiry, c.grandfathered_until, c.grace_until) > now(), false) desc,
            coalesce(lp.profile_id = v_last, false) desc,
            (lp.profile_id = v_identity) desc,
            lower(lp.company_name)
   limit 1;
  return coalesce(v_pick, v_identity);
end;
$$;
revoke all on function pick_login_profile(uuid, uuid) from public, anon, authenticated;
grant execute on function pick_login_profile(uuid, uuid) to service_role;

-- Every studio the login with this email opens. No rows: no login uses it.
create or replace function platform_login_lookup(p_email text)
returns table (
  profile_id   uuid,
  company_id   uuid,
  company_name text,
  role         app_role,
  is_owner     boolean,
  plan_gate    text,
  access_until timestamptz,
  opens_first  boolean,
  last_in      boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_identity uuid;
  v_first    uuid;
  v_last     uuid;
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  select au.id, au.last_profile_id into v_identity, v_last
    from auth.users au
   where lower(au.email) = lower(btrim(p_email)) and au.identity_id is null
   limit 1;
  if v_identity is null then
    return;
  end if;
  v_first := pick_login_profile(v_identity);
  return query
    select lp.profile_id, lp.company_id, lp.company_name, lp.role, lp.is_owner,
           platform_plan_gate(c.plan_expiry, c.grandfathered_until, c.grace_until),
           company_access_until(c.plan_expiry, c.grandfathered_until, c.grace_until),
           lp.profile_id = v_first,
           coalesce(lp.profile_id = v_last, false)
      from list_login_profiles(v_identity) lp
      join companies c on c.id = lp.company_id
     order by lp.profile_id = v_first desc, lower(lp.company_name);
end;
$$;
revoke all on function platform_login_lookup(text) from public, anon;
grant execute on function platform_login_lookup(text) to authenticated;

-- The studio this login opens the next time it signs in.
create or replace function platform_open_first(p_email text, p_company uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity uuid;
  v_profile  uuid;
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  select au.id into v_identity
    from auth.users au
   where lower(au.email) = lower(btrim(p_email)) and au.identity_id is null
   limit 1;
  select lp.profile_id into v_profile
    from list_login_profiles(v_identity) lp
   where lp.company_id = p_company
   limit 1;
  if v_profile is null then
    raise exception 'that login does not open that studio' using errcode = '22023';
  end if;
  update auth.users set last_profile_id = v_profile where id = v_identity;
end;
$$;
revoke all on function platform_open_first(text, uuid) from public, anon;
grant execute on function platform_open_first(text, uuid) to authenticated;
