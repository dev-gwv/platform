-- 0291: nishagraham11@gmail.com is a platform admin too (the owner's word,
-- 30 Oct: "a super admin in Studio Autopilot with unlimited access ... create
-- the user if it doesn't exist").
--
-- That email may not have signed up yet, and an account is never made here
-- with a password nobody chose. So the email waits in platform_admin_emails:
-- once someone signs up with it and proves the inbox is theirs (the emailed
-- confirmation link, or Google), that login is made a platform admin, and 0288
-- opens its studio for life (no trial, no limits). If the login is already
-- there, it is made one now. Safe to run twice. A later admin is added by a
-- migration copied from this one: one insert into platform_admin_emails and
-- the seed below.

create table if not exists platform_admin_emails (
  email      text primary key check (email = lower(trim(email)) and email like '%@%'),
  added_at   timestamptz not null default now()
);
alter table platform_admin_emails enable row level security;
revoke all on platform_admin_emails from public, anon, authenticated;

insert into platform_admin_emails (email) values ('nishagraham11@gmail.com')
on conflict do nothing;

-- Now, if the account is already there.
-- The login only: a studio profile's email can be anything a studio typed for
-- a team member, so it is not taken as proof here.
insert into platform_admins (user_id)
select au.id from auth.users au
 where lower(trim(au.email)) = 'nishagraham11@gmail.com'
on conflict do nothing;

-- Later, once the person proves the inbox is theirs: the API calls this after
-- an emailed confirmation link is used (/auth/verify) and after a Google
-- sign-in (Google proved the mailbox). Never from a trigger on email: a studio
-- can give a team login any email and marks it confirmed itself, so an email
-- alone proves nothing.
create or replace function claim_platform_admin(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := auth_identity_of(p_user);
begin
  if v_id is null or not exists (
       select 1 from auth.users au
         join platform_admin_emails e on e.email = lower(trim(au.email))
        where au.id = v_id) then
    return false;
  end if;
  insert into platform_admins (user_id) values (v_id) on conflict do nothing;
  return true;
end;
$$;
revoke all on function claim_platform_admin(uuid) from public, anon, authenticated;
grant execute on function claim_platform_admin(uuid) to service_role;
