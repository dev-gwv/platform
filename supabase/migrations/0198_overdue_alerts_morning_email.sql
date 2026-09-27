-- 0198: invoice overdue alerts on the hourly cron, and a morning email for
-- owners and admins.
--
-- 1. The "Payment overdue" alert existed (payment_pending generator, 0182) but
--    only ran when someone pressed a button, and only for the studio of
--    whoever pressed it. This runs it for every studio from 10:00 IST, with
--    the billing screens' rule for overdue (drafts never count), under the
--    same dedupe key, so nobody hears about the same invoice twice.
--
-- 2. One email at 8 am to each owner and admin with what the day needs:
--    today's shoots, leads (new since yesterday, follow-ups due today),
--    tasks due or late, and overdue invoices. Sent only when there is
--    something to say, once a day (the sent-log is a unique row, like 0194),
--    and anyone can stop it from the link in the footer.

-- ── 1. overdue invoices ─────────────────────────────────────────
create or replace function run_invoice_overdue_cron(p_dry_run boolean default false, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_local   timestamp := p_now at time zone 'Asia/Kolkata';
  v_today   date := v_local::date;
  v_due     int := 0;
  v_made    int := 0;
  v_r       record;
  v_summary jsonb;
  v_run     uuid;
begin
  insert into cron_runs (job_name, dry_run) values ('invoice_overdue_cron', p_dry_run) returning id into v_run;

  if extract(hour from v_local) >= 10 then
    for v_r in
      select i.id, i.company_id, i.invoice_number, i.balance_due, i.due_date,
             coalesce(cl.name, 'A client') as client_name, u.user_id
        from invoices i
        left join clients cl on cl.id = i.client_id
        cross join lateral notification_admin_recipients(i.company_id) u(user_id)
       where i.balance_due > 0
         and i.status not in ('draft', 'cancelled')
         and i.due_date is not null
         and i.due_date < v_today
    loop
      v_due := v_due + 1;
      if not p_dry_run then
        if create_notification(
             v_r.company_id, v_r.user_id, 'invoice.overdue', 'Payment overdue',
             v_r.client_name || ' · ₹' || to_char(v_r.balance_due, 'FM99,99,99,990')
               || ' was due ' || to_char(v_r.due_date, 'DD Mon'),
             'invoice_overdue:' || v_r.id || ':' || v_r.due_date,
             'invoice', v_r.id, 'critical', '/billing/invoices/' || v_r.id) then
          v_made := v_made + 1;
        end if;
      end if;
    end loop;
  end if;

  v_summary := jsonb_build_object('due', v_due, 'created', v_made, 'dry_run', p_dry_run);
  update cron_runs set finished_at = now(), summary = v_summary where id = v_run;
  return v_summary;
end;
$$;
revoke all on function run_invoice_overdue_cron(boolean, timestamptz) from public, anon, authenticated;
grant execute on function run_invoice_overdue_cron(boolean, timestamptz) to service_role;

-- ── 2. the morning email ────────────────────────────────────────
alter table users add column if not exists morning_email_off boolean not null default false;

-- Keyed per studio too: someone who runs two studios gets each one's email.
create table if not exists morning_emails (
  user_id    uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  day        date not null,
  sent_at    timestamptz not null default now(),
  primary key (user_id, company_id, day)
);
alter table morning_emails enable row level security;
revoke all on morning_emails from public, anon, authenticated;

/**
 * Who gets a morning email now, and what goes in it. From 08:00 IST, one row
 * per active owner or admin of each studio who has not stopped it and has
 * not had today's, and only when at least one of the four has something.
 */
create or replace function morning_email_due(p_now timestamptz default now())
returns table (
  user_id    uuid,
  company_id uuid,
  email      text,
  name       text,
  studio     text,
  day        date,
  shoots     jsonb,
  new_leads  int,
  follow_ups int,
  tasks      int,
  overdue_count  int,
  overdue_amount numeric
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
           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'name', s.name,
                      'time', to_char(s.start_at at time zone 'Asia/Kolkata', 'FMHH12:MI am'),
                      'place', s.location)
                    order by s.start_at nulls last, s.name)
               from (select * from shoots s
                      where s.company_id = c.id and s.status <> 'cancelled'
                        and coalesce((s.start_at at time zone 'Asia/Kolkata')::date, s.shoot_date) = t.today
                      order by s.start_at nulls last limit 5) s
           ), '[]'::jsonb) as shoots,
           (select count(*) from crm_leads l
             where l.company_id = c.id and l.merged_into is null
               and l.created_at >= ((t.today - 1)::timestamp at time zone 'Asia/Kolkata')
               and l.created_at < (t.today::timestamp at time zone 'Asia/Kolkata'))::int as new_leads,
           (select count(*) from crm_leads l
             where l.company_id = c.id and l.merged_into is null
               and l.status not in ('converted', 'lost')
               and (l.follow_up_at at time zone 'Asia/Kolkata')::date <= t.today)::int as follow_ups,
           (select count(*) from tasks k
             where k.company_id = c.id and k.due_date <= t.today
               and k.status not in ('completed', 'cancelled'))::int as tasks,
           (select count(*) from invoices i
             where i.company_id = c.id and i.balance_due > 0
               and i.status not in ('draft', 'cancelled')
               and i.due_date is not null and i.due_date < t.today)::int as overdue_count,
           (select coalesce(sum(i.balance_due), 0) from invoices i
             where i.company_id = c.id and i.balance_due > 0
               and i.status not in ('draft', 'cancelled')
               and i.due_date is not null and i.due_date < t.today) as overdue_amount
      from companies c, t
  )
  select u.user_id, s.id, au.email, u.name, s.name, t.today,
         s.shoots, s.new_leads, s.follow_ups, s.tasks, s.overdue_count, s.overdue_amount
    from studio s
    cross join t
    join users u on u.company_id = s.id
    join auth.users au on au.id = u.user_id and au.email_verified
   where extract(hour from t.local) >= 8
     and u.deleted_at is null
     and u.status = 'active'
     and u.role in ('super_admin', 'admin')
     and not u.morning_email_off
     and (jsonb_array_length(s.shoots) > 0 or s.new_leads > 0 or s.follow_ups > 0
          or s.tasks > 0 or s.overdue_count > 0)
     and not exists (select 1 from morning_emails m
                      where m.user_id = u.user_id and m.company_id = s.id and m.day = t.today)
$$;
revoke all on function morning_email_due(timestamptz) from public, anon, authenticated;
grant execute on function morning_email_due(timestamptz) to service_role;

/** Mark today's email as sent. True only the first time, so the caller sends once. */
create or replace function morning_email_mark(p_user uuid, p_company uuid, p_day date)
returns boolean
language sql
volatile
security definer
set search_path = public
as $$
  with ins as (
    insert into morning_emails (user_id, company_id, day) values (p_user, p_company, p_day)
    on conflict do nothing
    returning 1
  )
  select exists (select 1 from ins)
$$;
revoke all on function morning_email_mark(uuid, uuid, date) from public, anon, authenticated;
grant execute on function morning_email_mark(uuid, uuid, date) to service_role;

/** "Stop these emails", from the signed link in the footer, or the switch in settings. */
create or replace function morning_email_set(p_user uuid, p_off boolean)
returns boolean
language sql
volatile
security definer
set search_path = public
as $$
  with u as (
    update users set morning_email_off = p_off where user_id = p_user returning 1
  )
  select exists (select 1 from u)
$$;
revoke all on function morning_email_set(uuid, boolean) from public, anon, authenticated;
grant execute on function morning_email_set(uuid, boolean) to service_role;
