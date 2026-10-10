-- 0258: the Monday email to the owner (owner, 10 Oct: "we can have the
-- Monday email to the owner").
--
-- Once a week, Monday from 8 am IST, one short mail to each studio's owner:
-- what came in last week and what the week ahead needs. Blocks with nothing
-- in them are left out, and a week with nothing at all sends nothing.
--
--   * Money: received last week (status = 'paid' only, 0146), overdue now,
--     and invoices falling due this week.
--   * Shoots: this week's shoot days, and how many have nobody booked yet.
--   * Editing: work that is late, and work due this week.
--   * Leads: new last week, and how many were booked.
--
-- weekly_email_mark() is the once-a-week guard: marked first, sent second,
-- so two overlapping cron ticks cannot both send. users.weekly_email_off is
-- the owner's switch (My profile, or the link in the footer).

alter table users add column if not exists weekly_email_off boolean not null default false;

create table if not exists weekly_emails (
  user_id    uuid not null,
  company_id uuid not null references companies (id) on delete cascade,
  week       date not null,
  sent_at    timestamptz not null default now(),
  primary key (user_id, company_id, week)
);
alter table weekly_emails enable row level security;
revoke all on weekly_emails from public, anon, authenticated;
grant all on weekly_emails to service_role;

/*
 * Who gets the Monday email now, and what goes in it. `week` is that
 * Monday's date in India; "last week" is the seven days before it.
 */
create or replace function weekly_email_due(p_now timestamptz default now())
returns table (
  user_id          uuid,
  company_id       uuid,
  email            text,
  name             text,
  studio           text,
  week             date,
  received         numeric,
  received_count   int,
  overdue_amount   numeric,
  overdue_count    int,
  due_week_amount  numeric,
  due_week_count   int,
  shoots_week      int,
  shoots_unstaffed int,
  edits_late       int,
  edits_due_week   int,
  leads_new        int,
  leads_booked     int
)
language sql
stable
security definer
set search_path = public
as $$
  with t as (
    select (p_now at time zone 'Asia/Kolkata') as local,
           (p_now at time zone 'Asia/Kolkata')::date as today
  ), studio as (
    select c.id, c.name,
           (select coalesce(sum(rp.amount), 0) from received_payments rp
             where rp.company_id = c.id and rp.status = 'paid'
               and coalesce(rp.date_received, rp.paid_on) between t.today - 7 and t.today - 1) as received,
           (select count(*) from received_payments rp
             where rp.company_id = c.id and rp.status = 'paid'
               and coalesce(rp.date_received, rp.paid_on) between t.today - 7 and t.today - 1)::int as received_count,
           (select coalesce(sum(i.balance_due), 0) from invoices i
             where i.company_id = c.id and i.balance_due > 0 and i.status not in ('draft', 'cancelled')
               and i.due_date is not null and i.due_date < t.today) as overdue_amount,
           (select count(*) from invoices i
             where i.company_id = c.id and i.balance_due > 0 and i.status not in ('draft', 'cancelled')
               and i.due_date is not null and i.due_date < t.today)::int as overdue_count,
           (select coalesce(sum(i.balance_due), 0) from invoices i
             where i.company_id = c.id and i.balance_due > 0 and i.status not in ('draft', 'cancelled')
               and i.due_date between t.today and t.today + 6) as due_week_amount,
           (select count(*) from invoices i
             where i.company_id = c.id and i.balance_due > 0 and i.status not in ('draft', 'cancelled')
               and i.due_date between t.today and t.today + 6)::int as due_week_count,
           (select count(*) from shoots s
             where s.company_id = c.id and coalesce(s.status, '') <> 'cancelled'
               and coalesce((s.start_at at time zone 'Asia/Kolkata')::date, s.shoot_date) between t.today and t.today + 6)::int as shoots_week,
           (select count(*) from shoots s
             where s.company_id = c.id and coalesce(s.status, '') <> 'cancelled'
               and coalesce((s.start_at at time zone 'Asia/Kolkata')::date, s.shoot_date) between t.today and t.today + 6
               and not exists (select 1 from team_assignment_slots a
                                where a.shoot_id = s.id and a.status = 'booked'))::int as shoots_unstaffed,
           (select count(*) from deliverables d
             where d.company_id = c.id and d.status not in ('completed', 'cancelled')
               and d.estimated_date is not null and d.estimated_date < t.today)::int as edits_late,
           (select count(*) from deliverables d
             where d.company_id = c.id and d.status not in ('completed', 'cancelled')
               and d.estimated_date between t.today and t.today + 6)::int as edits_due_week,
           (select count(*) from crm_leads l
             where l.company_id = c.id and l.merged_into is null
               and l.created_at >= ((t.today - 7)::timestamp at time zone 'Asia/Kolkata')
               and l.created_at < (t.today::timestamp at time zone 'Asia/Kolkata'))::int as leads_new,
           (select count(*) from crm_leads l
             where l.company_id = c.id and l.merged_into is null and l.status = 'converted'
               and l.updated_at >= ((t.today - 7)::timestamp at time zone 'Asia/Kolkata')
               and l.updated_at < (t.today::timestamp at time zone 'Asia/Kolkata'))::int as leads_booked
      from companies c, t
  )
  select u.user_id, s.id, au.email, u.name, s.name, t.today,
         s.received, s.received_count, s.overdue_amount, s.overdue_count,
         s.due_week_amount, s.due_week_count, s.shoots_week, s.shoots_unstaffed,
         s.edits_late, s.edits_due_week, s.leads_new, s.leads_booked
    from studio s
    cross join t
    join users u on u.company_id = s.id
    join auth.users au on au.id = u.user_id and au.email_verified
   where extract(isodow from t.local) = 1
     and extract(hour from t.local) >= 8
     and u.deleted_at is null
     and u.status = 'active'
     and u.role = 'super_admin'
     and not u.weekly_email_off
     and (s.received > 0 or s.overdue_count > 0 or s.due_week_count > 0 or s.shoots_week > 0
          or s.edits_late > 0 or s.edits_due_week > 0 or s.leads_new > 0)
     and not exists (select 1 from weekly_emails w
                      where w.user_id = u.user_id and w.company_id = s.id and w.week = t.today)
$$;
revoke all on function weekly_email_due(timestamptz) from public, anon, authenticated;
grant execute on function weekly_email_due(timestamptz) to service_role;

-- Marked before it is sent: true only for the tick that marked it.
create or replace function weekly_email_mark(p_user uuid, p_company uuid, p_week date)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into weekly_emails (user_id, company_id, week) values (p_user, p_company, p_week)
    on conflict do nothing;
  return found;
end;
$$;
revoke all on function weekly_email_mark(uuid, uuid, date) from public, anon, authenticated;
grant execute on function weekly_email_mark(uuid, uuid, date) to service_role;

-- The owner's switch: from My profile, or "Stop the Monday email" in the footer.
create or replace function weekly_email_set(p_user uuid, p_off boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update users set weekly_email_off = p_off where user_id = p_user;
  return found;
end;
$$;
revoke all on function weekly_email_set(uuid, boolean) from public, anon, authenticated;
grant execute on function weekly_email_set(uuid, boolean) to service_role;
