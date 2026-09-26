-- Is the studio free on that date?
--
-- The first question of every wedding enquiry, and the app could not answer it.
-- `crm_leads.event_date` has existed since 0066 and `shoots.shoot_date` since
-- 0006; nothing ever compared them. So a lead asking for a day the studio is
-- already shooting looked exactly like a lead asking for an empty Tuesday, and
-- two families asking for the same date looked like two ordinary leads.
--
-- Set-based on purpose. A per-row function would be one subquery per lead, and
-- the inbox reads a few hundred at a time; this is one pass that the lead
-- SELECT joins against, so the cost is the same whether it answers for one
-- lead or for all of them.
--
-- 'held' is deliberately absent. Holding a date against a token advance is the
-- next migration; adding the value here before anything can produce it would
-- mean a status the UI must handle and the database can never return.

create or replace function crm_date_availability()
returns table (on_date date, status text, wanted_by int)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    -- No company, or a deactivated member: no rows. The caller is a join, so
    -- raising here would take down the whole lead list rather than hide a
    -- figure. Every row it could have returned is company-scoped anyway.
    select get_current_company_id() as company_id
     where get_current_company_id() is not null
       and is_current_user_active()
  ),
  -- Open leads only. A converted lead's date is represented by its project's
  -- shoots, and a lost lead is nobody's claim on the calendar.
  wanted as (
    select l.event_date as d, count(*)::int as n
      from crm_leads l
      join me on me.company_id = l.company_id
     where l.event_date is not null
       and l.is_archived = false
       and l.status not in ('converted', 'lost')
     group by l.event_date
  ),
  booked as (
    select distinct s.shoot_date as d
      from shoots s
      join me on me.company_id = s.company_id
     where s.shoot_date is not null
  )
  select
    coalesce(w.d, b.d) as on_date,
    case
      -- A shoot already on the day wins: the studio is not free, however many
      -- people are asking.
      when b.d is not null then 'booked'
      when coalesce(w.n, 0) > 1 then 'contested'
      else 'free'
    end as status,
    -- How many open leads want this date, including the one being asked
    -- about. "2 asking 14 Dec" reads off this directly.
    coalesce(w.n, 0) as wanted_by
  from wanted w
  full outer join booked b on b.d = w.d;
$$;

revoke all on function crm_date_availability() from public, anon;
grant execute on function crm_date_availability() to authenticated;

-- The join is on event_date for one company, which is exactly this index.
create index if not exists crm_leads_company_event_date_idx
  on crm_leads (company_id, event_date)
  where event_date is not null;

create index if not exists shoots_company_shoot_date_idx
  on shoots (company_id, shoot_date)
  where shoot_date is not null;
