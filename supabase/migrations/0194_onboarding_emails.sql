-- 0194: onboarding emails for new studios.
--
-- A studio owner gets a welcome email when they confirm their address, then
-- at most three short nudges (day 1, 3 and 7) while setup is unfinished. Each
-- nudge names only the next step. Setup finished, skipped, or "stop these
-- emails" ends the series.
--
-- The sent-log is what makes it once-only: a kind is marked before it is
-- sent, and the mark is a unique row, so a retried or doubled cron tick
-- cannot send the same email twice. A missed tick sends only the latest nudge
-- that is due, never a backlog.

create table if not exists onboarding_emails (
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('welcome', 'day1', 'day3', 'day7')),
  sent_at    timestamptz not null default now(),
  primary key (user_id, kind)
);
alter table onboarding_emails enable row level security;
revoke all on onboarding_emails from public, anon, authenticated;

alter table companies
  add column if not exists onboarding_emails_off boolean not null default false;

/**
 * Who should get a nudge now. One row per studio owner at most: the latest
 * nudge whose day has come and that has not been sent. Studios older than
 * ten days are left alone, so existing studios never get a burst on deploy.
 */
create or replace function onboarding_email_due(p_now timestamptz default now())
returns table (
  company_id uuid,
  user_id    uuid,
  email      text,
  name       text,
  kind       text,
  step       int
)
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select c.id as company_id, c.owner_user_id as user_id, au.email, u.name,
           p_now - coalesce(au.email_verified_at, c.created_at) as age,
           exists (select 1 from users m
                    where m.company_id = c.id and m.deleted_at is null
                      and m.status = 'active' and m.user_id <> c.owner_user_id) as has_team,
           exists (select 1 from clients cl where cl.company_id = c.id) as has_client,
           exists (select 1 from projects p where p.company_id = c.id) as has_project
      from companies c
      join auth.users au on au.id = c.owner_user_id and au.email_verified
      left join users u on u.user_id = c.owner_user_id and u.company_id = c.id
     where c.setup_done_at is null
       and c.setup_skipped_at is null
       and not c.onboarding_emails_off
       and c.created_at > p_now - interval '10 days'
  ), k as (
    select s.*,
           case when age >= interval '7 days' then 'day7'
                when age >= interval '3 days' then 'day3'
                when age >= interval '1 day'  then 'day1'
           end as kind
      from s
     where not (has_team and has_client and has_project)
  )
  select k.company_id, k.user_id, k.email, k.name, k.kind,
         case when not has_team then 1 when not has_client then 2 else 3 end as step
    from k
   where k.kind is not null
     and not exists (select 1 from onboarding_emails e
                      where e.user_id = k.user_id and e.kind = k.kind)
$$;
revoke all on function onboarding_email_due(timestamptz) from public, anon, authenticated;
grant execute on function onboarding_email_due(timestamptz) to service_role;

/** Mark one email as sent. True only the first time, so the caller sends once. */
create or replace function onboarding_email_mark(p_user uuid, p_kind text)
returns boolean
language sql
volatile
security definer
set search_path = public
as $$
  with ins as (
    insert into onboarding_emails (user_id, kind) values (p_user, p_kind)
    on conflict do nothing
    returning 1
  )
  select exists (select 1 from ins)
$$;
revoke all on function onboarding_email_mark(uuid, text) from public, anon, authenticated;
grant execute on function onboarding_email_mark(uuid, text) to service_role;

/**
 * The welcome email's details for a user who has just confirmed their email:
 * only the owner of a studio whose setup is still open gets one. Returns no
 * row for anyone else (a team member accepting an invite, say).
 */
create or replace function onboarding_welcome_for(p_user uuid)
returns table (company_id uuid, email text, name text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, au.email, u.name
    from companies c
    join auth.users au on au.id = c.owner_user_id
    left join users u on u.user_id = c.owner_user_id and u.company_id = c.id
   where c.owner_user_id = p_user
     and c.setup_done_at is null
     and c.setup_skipped_at is null
     and not c.onboarding_emails_off
   order by c.created_at desc
   limit 1
$$;
revoke all on function onboarding_welcome_for(uuid) from public, anon, authenticated;
grant execute on function onboarding_welcome_for(uuid) to service_role;

/** "Stop these emails", from the signed link in the footer. */
create or replace function onboarding_emails_stop(p_company uuid)
returns boolean
language sql
volatile
security definer
set search_path = public
as $$
  with u as (
    update companies set onboarding_emails_off = true where id = p_company returning 1
  )
  select exists (select 1 from u)
$$;
revoke all on function onboarding_emails_stop(uuid) from public, anon, authenticated;
grant execute on function onboarding_emails_stop(uuid) to service_role;
