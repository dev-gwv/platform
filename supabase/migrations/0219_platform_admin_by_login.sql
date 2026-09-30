-- 0219: a platform admin stays one in every studio they open.
--
-- 0218 put the owner's login in platform_admins, but the board still did not
-- show. Since 0159 one login can open several studios, and in a studio it
-- joined as a member the session runs as that studio's profile id, not the
-- login's own id. is_platform_admin() and get_auth_context() compared
-- platform_admins against that profile id, so the flag was lost the moment
-- the owner worked inside any studio other than one created by that login.
--
-- Both now accept the profile or the login behind it (auth_identity_of, 0159),
-- and the owner's email is seeded again from both the login and the studio
-- rows, trimmed and lower-cased, so a stray capital or space cannot miss it.

insert into platform_admins (user_id)
select au.id from auth.users au
 where lower(trim(au.email)) = 'connect@wpbmastery.in'
union
select auth_identity_of(u.user_id) from users u
 where lower(trim(u.email)) = 'connect@wpbmastery.in'
   and u.deleted_at is null
on conflict do nothing;

create or replace function is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from platform_admins
     where user_id in (auth.uid(), auth_identity_of(auth.uid()))
  )
$$;

-- Copied from 0159 (the latest definition); only the is_platform_admin line changes.
create or replace function get_auth_context()
returns table (
  company_id          uuid,
  role                app_role,
  is_owner            boolean,
  is_platform_admin   boolean,
  display_name        text,
  email               text,
  plan_expiry         timestamptz,
  plan_gate           text,
  profile_key         text,
  overrides           jsonb,
  password_changed_at timestamptz,
  password_version    integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.company_id,
    u.role,
    (c.owner_user_id = u.user_id) as is_owner,
    exists (select 1 from platform_admins pa where pa.user_id in (u.user_id, coalesce(au.identity_id, au.id))) as is_platform_admin,
    u.name                        as display_name,
    u.email,
    c.plan_expiry,
    case
      when coalesce(c.plan_expiry,         'epoch'::timestamptz) > now() then 'active'
      when coalesce(c.grandfathered_until, 'epoch'::timestamptz) > now() then 'grandfathered'
      when coalesce(c.grace_until,         'epoch'::timestamptz) > now() then 'grace'
      else 'expired'
    end                           as plan_gate,
    (
      select a.profile_key from user_access_assignments a
      where a.user_id = u.user_id and a.is_active
      limit 1
    )                             as profile_key,
    coalesce((
      select jsonb_agg(jsonb_build_object('permission_key', o.permission_key, 'enabled', o.enabled))
      from user_access_overrides o where o.user_id = u.user_id
    ), '[]'::jsonb)               as overrides,
    idn.password_changed_at,
    idn.password_version
  from users u
  join companies c on c.id = u.company_id
  join auth.users au on au.id = u.user_id
  join auth.users idn on idn.id = coalesce(au.identity_id, au.id)
  where u.user_id = auth.uid()
    and u.deleted_at is null
    and u.status = 'active'
    and (au.identity_id is null or u.login_enabled)
$$;
revoke all on function get_auth_context() from public, anon;
grant execute on function get_auth_context() to authenticated;
