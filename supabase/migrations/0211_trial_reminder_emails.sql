-- 0211: trial and plan reminder emails -- 7 days before, 1 day before, and
-- the day access ends -- so a studio that has not opened the app still hears
-- that its 30 days (0210) or its paid plan are running out.
--
-- The studio owner gets at most three emails per end date:
--   'd7'    -- access ends within 7 days
--   'd1'    -- access ends within a day
--   'ended' -- access ended in the last 3 days
-- A missed cron tick sends only the one that is due now, never a backlog.
-- Keyed by the end date: a studio that renews, or that the platform extends,
-- has a new end date and hears again when that one comes near.
--
-- Never emailed: the platform admins' own studios (they are never cut off),
-- owners who have not confirmed their address, and studios whose access
-- ended more than 3 days ago (so the deploy does not wake old studios).
-- Billing emails are transactional, so onboarding_emails_off (0194) does not
-- silence them.

create table if not exists access_emails (
  company_id uuid not null references companies(id) on delete cascade,
  kind       text not null check (kind in ('d7', 'd1', 'ended')),
  ends_on    date not null,
  sent_at    timestamptz not null default now(),
  primary key (company_id, kind, ends_on)
);
alter table access_emails enable row level security;
revoke all on access_emails from public, anon, authenticated;

/**
 * Who should hear now, and what about. is_trial is true when no paid plan is
 * running -- the email then says "free trial" rather than "plan".
 */
create or replace function access_email_due(p_now timestamptz default now())
returns table (
  company_id  uuid,
  email       text,
  name        text,
  studio      text,
  kind        text,
  ends_at     timestamptz,
  is_trial    boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select c.id as company_id, au.email, u.name, c.name as studio,
           company_access_until(c.plan_expiry, c.grandfathered_until, c.grace_until) as ends_at,
           coalesce(c.plan_expiry, 'epoch'::timestamptz) <= p_now as is_trial
      from companies c
      join auth.users au on au.id = c.owner_user_id and au.email_verified
      left join users u on u.user_id = c.owner_user_id and u.company_id = c.id
     where not exists (select 1 from platform_admins pa where pa.user_id = c.owner_user_id)
  ), k as (
    select s.*,
           case when s.ends_at <= p_now and s.ends_at > p_now - interval '3 days' then 'ended'
                when s.ends_at > p_now and s.ends_at <= p_now + interval '1 day' then 'd1'
                when s.ends_at > p_now + interval '1 day' and s.ends_at <= p_now + interval '7 days' then 'd7'
           end as kind
      from s
     where s.ends_at is not null
  )
  select k.company_id, k.email, k.name, k.studio, k.kind, k.ends_at, k.is_trial
    from k
   where k.kind is not null
     and not exists (select 1 from access_emails e
                      where e.company_id = k.company_id and e.kind = k.kind
                        and e.ends_on = (k.ends_at at time zone 'Asia/Kolkata')::date)
$$;
revoke all on function access_email_due(timestamptz) from public, anon, authenticated;
grant execute on function access_email_due(timestamptz) to service_role;

/** Mark one email as sent. True only the first time, so the caller sends once. */
create or replace function access_email_mark(p_company uuid, p_kind text, p_ends_at timestamptz)
returns boolean
language sql
volatile
security definer
set search_path = public
as $$
  with ins as (
    insert into access_emails (company_id, kind, ends_on)
    values (p_company, p_kind, (p_ends_at at time zone 'Asia/Kolkata')::date)
    on conflict do nothing
    returning 1
  )
  select exists (select 1 from ins)
$$;
revoke all on function access_email_mark(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function access_email_mark(uuid, text, timestamptz) to service_role;
