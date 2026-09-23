-- One person, many studios, one login.
--
-- `users.user_id` IS the auth id, and `auth.users.email` is unique, so until
-- now a person could belong to exactly one studio. Freelancers do not work
-- that way -- the same second shooter is on three studios' books -- and nor
-- do owners who run more than one studio account. Adding someone a second
-- studio already had failed with "Someone with that email already has an
-- account", and the only way round it was a second email address per studio.
--
-- The shape chosen here keeps every existing RLS policy untouched. Each
-- membership beyond a person's first is a *profile*: its own auth.users row,
-- with no email and no password, pointing at the real login through
-- `identity_id`. The profile's id is its `users.user_id` in that studio, and a
-- session is minted for the profile, so auth.uid() -- and with it every policy
-- and get_current_company_id() -- resolves to exactly one studio, as before.
-- Switching studio is minting a session for a different profile of the same
-- identity.
--
-- What is shared across profiles is the credential: the identity's password,
-- and its password_version, which is the kill switch for every access token
-- (0023). A password change or "sign out everywhere" therefore ends the
-- sessions of every studio that person belongs to, as it should.

alter table auth.users
  add column if not exists identity_id uuid references auth.users (id) on delete cascade,
  -- Which studio to open at the next sign-in: the one they were last in.
  add column if not exists last_profile_id uuid references auth.users (id) on delete set null;

-- A profile is never a login in its own right and never points at another
-- profile: it has no email for /login or /forgot-password to find, no
-- password to check, and its identity is a real login row.
alter table auth.users
  drop constraint if exists auth_users_profile_shape;
alter table auth.users
  add constraint auth_users_profile_shape
  check (identity_id is null or (identity_id <> id and email is null and encrypted_password is null));

create index if not exists auth_users_identity_idx on auth.users (identity_id) where identity_id is not null;

-- ── helpers ─────────────────────────────────────────────────────

-- The login behind any profile id; a login's own id maps to itself.
create or replace function auth_identity_of(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select au.identity_id from auth.users au where au.id = p_user_id), p_user_id)
$$;

-- Every studio a login can open: its own users row, plus each linked profile
-- the studio has left sign-in enabled on. A directory-only (offline) profile
-- is on that studio's books but is not somewhere its person can sign in to.
create or replace function list_login_profiles(p_identity uuid)
returns table (
  profile_id   uuid,
  company_id   uuid,
  company_name text,
  role         app_role,
  is_owner     boolean,
  display_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select u.user_id, u.company_id, c.name, u.role, (c.owner_user_id = u.user_id), u.name
    from users u
    join companies c on c.id = u.company_id
    join auth.users au on au.id = u.user_id
   where (au.id = p_identity or (au.identity_id = p_identity and u.login_enabled))
     and u.deleted_at is null
     and u.status = 'active'
   order by lower(c.name), u.user_id
$$;

-- Which profile a fresh sign-in opens: the explicitly requested one if it is
-- this login's, else the last one used, else the login's own studio, else the
-- first it belongs to. A login with no studio at all (a Google sign-up that
-- has not named its studio yet) gets its own id back, which is what
-- /complete-setup expects.
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
  select profile_id into v_pick
    from list_login_profiles(v_identity)
   order by coalesce(profile_id = v_last, false) desc, (profile_id = v_identity) desc, lower(company_name)
   limit 1;
  return coalesce(v_pick, v_identity);
end;
$$;

-- Remember the studio just opened, for the next sign-in.
create or replace function remember_login_profile(p_profile uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update auth.users set last_profile_id = p_profile
   where id = auth_identity_of(p_profile)
     and last_profile_id is distinct from p_profile
$$;

-- ── sessions ────────────────────────────────────────────────────

-- Same as 0033 but for two lines: a profile's token is checked against its
-- login's password_version, and a profile the studio has taken sign-in off
-- stops resolving at once.
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
    exists (select 1 from platform_admins pa where pa.user_id = u.user_id) as is_platform_admin,
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

-- Sign a person out of everything: every studio's refresh tokens, and one
-- password_version bump on the login that strands every access token minted
-- for any of its profiles. Accepts either a login or a profile id.
create or replace function revoke_all_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity uuid := auth_identity_of(p_user_id);
  v_version  integer;
begin
  update refresh_tokens set revoked_at = now()
   where revoked_at is null and expires_at > now()
     and user_id in (
       select id from auth.users where id = v_identity or identity_id = v_identity
     );
  update auth.users set password_version = password_version + 1
   where id = v_identity
   returning password_version into v_version;
  return v_version;
end;
$$;

-- End one studio's sessions for a person, and only that studio's. Removing a
-- freelancer from one studio must not sign them out of the other two they
-- work for; their access tokens for this studio already stop resolving the
-- moment the users row is deleted (get_auth_context reads deleted_at).
create or replace function revoke_profile_sessions(p_profile uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update refresh_tokens set revoked_at = now()
   where user_id = p_profile and revoked_at is null and expires_at > now()
$$;

-- ── invitations ─────────────────────────────────────────────────

-- The preview now says whether the invited email already signs in somewhere,
-- so the page can ask for that password rather than inventing a new one.
drop function if exists peek_user_invitation(text);
create function peek_user_invitation(p_raw text)
returns table (
  email        text,
  name         text,
  company_name text,
  role         app_role,
  expires_at   timestamptz,
  has_account  boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select i.email, i.pending_name, c.name, i.role, i.expires_at,
         exists (
           select 1 from auth.users au
            where lower(au.email) = lower(i.email)
              and au.identity_id is null
              and (au.encrypted_password is not null or au.email_verified)
         )
  from user_invitations i
  join companies c on c.id = i.company_id
  where i.token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now()
$$;

-- Accepting an invitation for an email that already has a login adds this
-- studio to that login as a profile, instead of failing on the unique email.
-- The API has already checked that login's password before calling this.
create or replace function consume_user_invitation(p_raw text, p_password_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv      user_invitations%rowtype;
  v_user     uuid;
  v_identity uuid;
  v_role     uuid;
begin
  select * into v_inv
  from user_invitations
  where token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
    and accepted_at is null
    and revoked_at is null
    and expires_at > now()
  for update;

  if v_inv.id is null then
    return null;
  end if;

  select au.id into v_identity
    from auth.users au
   where lower(au.email) = lower(v_inv.email) and au.identity_id is null;

  if v_identity is not null then
    -- Already in this studio under this login: nothing to create, the
    -- invitation is simply spent.
    select p.profile_id into v_user
      from list_login_profiles(v_identity) p
     where p.company_id = v_inv.company_id;
    if v_user is null then
      insert into auth.users (email, encrypted_password, email_verified, email_verified_at, identity_id)
      values (null, null, true, now(), v_identity)
      returning id into v_user;
    end if;
    -- A login that was never used (an offline directory entry elsewhere) is
    -- given the password chosen here; a real one keeps its own.
    update auth.users
       set encrypted_password = p_password_hash, email_verified = true, email_verified_at = now()
     where id = v_identity and encrypted_password is null and not email_verified;
  else
    insert into auth.users (email, encrypted_password, email_verified, email_verified_at)
    values (v_inv.email, p_password_hash, true, now())
    returning id into v_user;
  end if;

  if not exists (select 1 from users where user_id = v_user) then
    insert into users (
      user_id, company_id, role, name, email, phone, alternate_phone,
      status, employee_type, salary, address, engagement_type, login_enabled
    ) values (
      v_user, v_inv.company_id, v_inv.role, v_inv.pending_name, v_inv.email,
      v_inv.pending_phone, v_inv.pending_alternate_phone,
      'active',
      case when v_inv.role = 'employee' then 1 else 2 end,
      v_inv.pending_salary, v_inv.pending_address, v_inv.pending_engagement_type, true
    );
  end if;

  foreach v_role in array v_inv.pending_role_ids loop
    insert into employee_role_assignments (user_id, role_id, company_id)
    values (v_user, v_role, v_inv.company_id)
    on conflict do nothing;
  end loop;

  update user_invitations
     set accepted_at = now(), accepted_by = v_user
   where id = v_inv.id;

  return v_user;
end;
$$;

-- ── grants: all of it is the API's service path, none of it a user's ──
revoke all on function auth_identity_of(uuid)              from public, anon, authenticated;
revoke all on function list_login_profiles(uuid)           from public, anon, authenticated;
revoke all on function pick_login_profile(uuid, uuid)      from public, anon, authenticated;
revoke all on function remember_login_profile(uuid)        from public, anon, authenticated;
revoke all on function revoke_all_sessions(uuid)           from public, anon, authenticated;
revoke all on function revoke_profile_sessions(uuid)       from public, anon, authenticated;
revoke all on function peek_user_invitation(text)          from public, anon, authenticated;
revoke all on function consume_user_invitation(text, text) from public, anon, authenticated;

grant execute on function auth_identity_of(uuid)              to service_role;
grant execute on function list_login_profiles(uuid)           to service_role;
grant execute on function pick_login_profile(uuid, uuid)      to service_role;
grant execute on function remember_login_profile(uuid)        to service_role;
grant execute on function revoke_all_sessions(uuid)           to service_role;
grant execute on function revoke_profile_sessions(uuid)       to service_role;
grant execute on function peek_user_invitation(text)          to service_role;
grant execute on function consume_user_invitation(text, text) to service_role;
