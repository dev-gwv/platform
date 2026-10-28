-- 0288: a platform admin's own studio is open for life (the owner's word,
-- 28 Oct: connect@themulberryweddings.in "is the admin account ... why is
-- there a trial system over here? Please completely open it up").
--
-- 0210 kept the owner's own studio out of the 30-day trial, but only once,
-- for the admins there were that day: mulberry (0246) and later admins got a
-- trial like any new studio. This makes it a rule. A studio a platform admin
-- owns, or runs as super_admin, has its open access (grandfathered_until)
-- set to the end of 2099: no trial, no "days left", and no plan limits
-- (company_plan() is null without a paid plan, so nothing is counted). A paid
-- plan on it is left alone. It holds for admins added later and for studios
-- they make later, through the triggers below. Safe to run twice.

create or replace function open_platform_admin_studios(p_company uuid default null)
returns void
language sql
security definer
set search_path = public
as $$
  update companies c
     set grandfathered_until = '2099-12-31 23:59:59+05:30'::timestamptz
   where (p_company is null or c.id = p_company)
     and coalesce(c.grandfathered_until, 'epoch'::timestamptz) < '2099-12-31 23:59:59+05:30'::timestamptz
     and exists (
       select 1 from users u
         join platform_admins pa on pa.user_id in (u.user_id, auth_identity_of(u.user_id))
        where u.company_id = c.id
          and u.deleted_at is null
          and (u.user_id = c.owner_user_id or u.role = 'super_admin'))
$$;
revoke all on function open_platform_admin_studios(uuid) from public, anon, authenticated;

select open_platform_admin_studios();

-- A new platform admin: every studio of theirs opens at once.
create or replace function platform_admins_open_studios()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform open_platform_admin_studios();
  return null;
end;
$$;
drop trigger if exists platform_admins_open_studios on platform_admins;
create trigger platform_admins_open_studios
  after insert on platform_admins
  for each statement execute function platform_admins_open_studios();

-- A studio a platform admin makes or joins as its owner later (a brand, a
-- second studio): open from its first row.
create or replace function users_open_admin_studio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is not null and new.deleted_at is null then
    perform open_platform_admin_studios(new.company_id);
  end if;
  return null;
end;
$$;
drop trigger if exists users_open_admin_studio on users;
create trigger users_open_admin_studio
  after insert or update of role, company_id on users
  for each row execute function users_open_admin_studio();
