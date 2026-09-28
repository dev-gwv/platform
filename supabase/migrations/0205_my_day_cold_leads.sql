-- 0205: "My day" for every caller, and leads going cold checked by the clock.
--
-- Borrowed from the Control Center's end-of-day sales report and cut to what
-- a studio needs: no points, no submission ritual. Every caller sees, on
-- Today's calls, what they did today -- calls made and answered, messages,
-- quotations sent, bookings -- and the owner sees one line per caller.
-- The same counters feed the 8 am email as "Yesterday".
--
-- And what 0105 never did: check leads by the clock. A new lead that has
-- waited two hours for a call nudges its owner once; a lead nobody is on
-- for an hour nudges the studio owner once. The morning email says how many
-- leads are going cold: never called, quotation quiet for three days, stuck
-- in the same stage for five.

-- ── one caller, one day ─────────────────────────────────────────
-- The counters, by studio and person, over any window. The two wrappers
-- below add the access checks; the morning email calls this directly.
create or replace function crm_day_counts(p_company uuid, p_user uuid, p_from timestamptz, p_to timestamptz)
returns table (
  calls_made      int,
  calls_answered  int,
  messages        int,
  follow_ups_done int,
  leads_moved     int,
  quotes_sent     int,
  booked          int,
  leads_touched   int
)
language sql
stable
security definer
set search_path = public
as $$
  with a as (
    select * from crm_activities
     where company_id = p_company and actor_id = p_user
       and created_at >= p_from and created_at < p_to
  ), e as (
    -- A stage move by this person; a lead's arrival (no from_status) is not one.
    select * from crm_lead_events
     where company_id = p_company and actor_id = p_user
       and from_status is not null and to_status is not null and from_status <> to_status
       and created_at >= p_from and created_at < p_to
  ), q as (
    select * from crm_quotes
     where company_id = p_company and created_by = p_user
       and sent_at >= p_from and sent_at < p_to
  ), b as (
    select * from crm_leads
     where company_id = p_company and assigned_to = p_user
       and converted_at >= p_from and converted_at < p_to
  )
  select
    (select count(*) from a where type = 'call' and direction = 'out')::int,
    (select count(*) from a where type = 'call' and direction = 'out' and outcome in ('answered', 'callback'))::int,
    (select count(*) from a where type in ('whatsapp', 'email', 'sms') and direction = 'out')::int,
    (select count(*) from crm_activities
      where company_id = p_company and type = 'task'
        and (actor_id = p_user or assigned_to = p_user)
        and done_at >= p_from and done_at < p_to)::int,
    (select count(*) from e)::int,
    (select count(*) from q)::int,
    (select count(*) from b)::int,
    (select count(distinct lead_id) from (
       select lead_id from a union select lead_id from e union select lead_id from q union select id from b) t)::int
$$;
revoke all on function crm_day_counts(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function crm_day_counts(uuid, uuid, timestamptz, timestamptz) to service_role;

/** One caller's day (India time), with the leads they worked. */
create or replace function crm_day_report(p_user uuid, p_date date default (now() at time zone 'Asia/Kolkata')::date)
returns table (
  user_id         uuid,
  day             date,
  calls_made      int,
  calls_answered  int,
  messages        int,
  follow_ups_done int,
  leads_moved     int,
  quotes_sent     int,
  booked          int,
  leads_touched   int,
  overdue_left    int,
  due_today_left  int,
  lead_lines      jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_company uuid := get_current_company_id();
  v_from timestamptz := p_date::timestamp at time zone 'Asia/Kolkata';
  v_to   timestamptz := (p_date + 1)::timestamp at time zone 'Asia/Kolkata';
  c record;
begin
  -- Yours, or anyone's in your studio if you run it. Never another studio's.
  if not exists (select 1 from users p where p.user_id = p_user and p.company_id = v_company)
     or (v_me is distinct from p_user and not exists (
           select 1 from users me
            where me.user_id = v_me and me.company_id = v_company
              and me.role in ('super_admin', 'admin', 'manager'))) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into c from crm_day_counts(v_company, p_user, v_from, v_to);
  return query
  select p_user, p_date,
         c.calls_made, c.calls_answered, c.messages, c.follow_ups_done, c.leads_moved,
         c.quotes_sent, c.booked, c.leads_touched,
         (select count(*) from crm_leads l
           where l.company_id = v_company and l.assigned_to = p_user and l.is_archived = false
             and l.status not in ('converted', 'lost') and l.follow_up_at < v_from)::int,
         (select count(*) from crm_leads l
           where l.company_id = v_company and l.assigned_to = p_user and l.is_archived = false
             and l.status not in ('converted', 'lost') and l.follow_up_at >= v_from and l.follow_up_at < v_to)::int,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', x.id, 'name', x.name, 'phone', x.phone,
                    'last_type', x.type, 'last_outcome', x.outcome,
                    'last_note', left(x.body, 140), 'last_at', x.created_at,
                    'next_at', x.follow_up_at)
                  order by x.created_at desc)
             from (
               select distinct on (l.id) l.id, l.name, l.phone, l.follow_up_at,
                      a.type, a.outcome, a.body, a.created_at
                 from crm_activities a
                 join crm_leads l on l.id = a.lead_id
                where a.company_id = v_company and a.actor_id = p_user
                  and a.created_at >= v_from and a.created_at < v_to
                order by l.id, a.created_at desc
             ) x
           ), '[]'::jsonb);
end;
$$;
revoke all on function crm_day_report(uuid, date) from public, anon;
grant execute on function crm_day_report(uuid, date) to authenticated, service_role;

/** Everyone's day, one row per active person, for owners and managers. */
create or replace function crm_day_report_team(p_date date default (now() at time zone 'Asia/Kolkata')::date)
returns table (
  user_id         uuid,
  user_name       text,
  calls_made      int,
  calls_answered  int,
  messages        int,
  quotes_sent     int,
  booked          int,
  leads_touched   int,
  overdue_left    int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_company uuid := get_current_company_id();
  v_from timestamptz := p_date::timestamp at time zone 'Asia/Kolkata';
  v_to   timestamptz := (p_date + 1)::timestamp at time zone 'Asia/Kolkata';
begin
  if not exists (select 1 from users me
                  where me.user_id = v_me and me.company_id = v_company
                    and me.role in ('super_admin', 'admin', 'manager')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select u.user_id, u.name, c.calls_made, c.calls_answered, c.messages, c.quotes_sent, c.booked, c.leads_touched,
         (select count(*) from crm_leads l
           where l.company_id = v_company and l.assigned_to = u.user_id and l.is_archived = false
             and l.status not in ('converted', 'lost') and l.follow_up_at < v_from)::int
    from users u
    cross join lateral crm_day_counts(v_company, u.user_id, v_from, v_to) c
   where u.company_id = v_company and u.deleted_at is null and u.status = 'active'
     and (c.leads_touched > 0
          or exists (select 1 from crm_leads l where l.company_id = v_company and l.assigned_to = u.user_id
                                                 and l.is_archived = false and l.status not in ('converted', 'lost')))
   order by c.calls_made desc, c.leads_touched desc, u.name;
end;
$$;
revoke all on function crm_day_report_team(date) from public, anon;
grant execute on function crm_day_report_team(date) to authenticated, service_role;

-- ── leads going cold, by the clock ──────────────────────────────
-- Two nudges, each once per lead, never for a lead older than a week (a
-- backlog is the morning email's job, not a burst of notifications).
create or replace function crm_cold_sweep(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r record;
  v_to uuid;
  v_uncalled int := 0;
  v_unassigned int := 0;
begin
  -- New lead, two hours, nobody has called.
  for v_r in
    select l.id, l.company_id, l.assigned_to, l.name, l.phone, l.source, l.created_at
      from crm_leads l
     where l.is_archived = false and l.merged_into is null
       and l.status not in ('converted', 'lost')
       and l.last_contacted_at is null and l.last_call_at is null
       and l.created_at < now() - interval '2 hours'
       and l.created_at > now() - interval '7 days'
       and l.assigned_to is not null
  loop
    if p_dry_run then v_uncalled := v_uncalled + 1; continue; end if;
    v_to := crm_alert_recipient(v_r.company_id, v_r.assigned_to);
    if v_to is not null and create_notification(
         v_r.company_id, v_to, 'crm_cold',
         coalesce(v_r.name, v_r.phone, 'A new lead') || ' has waited 2 hours for a call',
         'Arrived ' || to_char(v_r.created_at at time zone 'Asia/Kolkata', 'FMHH12:MI am')
           || case when v_r.source is not null then ' from ' || replace(v_r.source, '_', ' ') else '' end
           || '. The first call wins the booking.',
         'crm_cold:' || v_r.id::text,
         'crm_lead', v_r.id, 'warning', '/follow-ups/queue')
    then
      v_uncalled := v_uncalled + 1;
    end if;
  end loop;

  -- An hour in, nobody is on it.
  for v_r in
    select l.id, l.company_id, l.name, l.phone, l.created_at
      from crm_leads l
     where l.is_archived = false and l.merged_into is null
       and l.status not in ('converted', 'lost')
       and l.assigned_to is null
       and l.created_at < now() - interval '1 hour'
       and l.created_at > now() - interval '7 days'
  loop
    if p_dry_run then v_unassigned := v_unassigned + 1; continue; end if;
    v_to := crm_alert_recipient(v_r.company_id, null);
    if v_to is not null and create_notification(
         v_r.company_id, v_to, 'crm_cold',
         coalesce(v_r.name, v_r.phone, 'A new lead') || ' has nobody on it',
         'Arrived an hour ago and is not assigned to anyone yet.',
         'crm_unassigned:' || v_r.id::text,
         'crm_lead', v_r.id, 'warning', '/follow-ups')
    then
      v_unassigned := v_unassigned + 1;
    end if;
  end loop;

  return jsonb_build_object('uncalled', v_uncalled, 'unassigned', v_unassigned, 'dry_run', p_dry_run);
end;
$$;
revoke all on function crm_cold_sweep(boolean) from public, anon, authenticated;
grant execute on function crm_cold_sweep(boolean) to service_role;

-- run_crm_followup_cron: the 0151 body verbatim, plus the cold sweep.
create or replace function run_crm_followup_cron(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run uuid;
  v_r record;
  v_d record;
  v_overdue int := 0;
  v_notified int := 0;
  v_unassigned int := 0;
  v_digests int := 0;
  v_rules int := 0;
  v_to uuid;
  v_cadences jsonb;
  v_sla jsonb;
  v_tasks jsonb;
  v_quotes jsonb;
  v_workflows jsonb;
  v_cold jsonb;
  v_summary jsonb;
begin
  insert into cron_runs (job_name, dry_run) values ('crm_followup_cron', p_dry_run) returning id into v_run;

  v_cadences := crm_advance_cadences(p_dry_run);
  v_sla := crm_sla_sweep(p_dry_run);
  v_tasks := crm_task_reminders(p_dry_run);
  v_quotes := crm_expire_quotes(p_dry_run);
  v_cold := crm_cold_sweep(p_dry_run);

  for v_r in
    select l.id, l.company_id, l.assigned_to, l.name, l.phone, l.follow_up_at
    from crm_leads l
    where l.is_archived = false
      and l.status not in ('converted', 'lost')
      and l.follow_up_at is not null
      and l.follow_up_at < now()
  loop
    v_overdue := v_overdue + 1;
    if v_r.assigned_to is null then v_unassigned := v_unassigned + 1; end if;
    if p_dry_run then continue; end if;
    if v_r.assigned_to is not null then
      if create_notification(
           v_r.company_id, v_r.assigned_to, 'crm_overdue',
           'Follow-up overdue: ' || coalesce(v_r.name, v_r.phone, 'unnamed lead'),
           'Promised for ' || to_char(v_r.follow_up_at, 'DD Mon HH24:MI'),
           'crm_overdue:' || v_r.id::text || ':' || current_date::text,
           'crm_lead', v_r.id)
      then
        v_notified := v_notified + 1;
      end if;
    end if;
    v_rules := v_rules + crm_enroll_workflows(v_r.id, 'follow_up_overdue', null);
  end loop;

  -- One line per company per day, and only when there is something to say.
  if not p_dry_run then
    for v_d in
      select l.company_id, count(*) as n
        from crm_leads l
       where l.is_archived = false
         and l.status not in ('converted', 'lost')
         and l.assigned_to is null
         and l.follow_up_at is not null
         and l.follow_up_at < now()
       group by l.company_id
    loop
      v_to := crm_alert_recipient(v_d.company_id, null);
      if v_to is not null then
        if create_notification(
             v_d.company_id, v_to, 'crm_overdue',
             v_d.n || case when v_d.n = 1 then ' overdue lead has nobody on it' else ' overdue leads have nobody on them' end,
             'They were promised a follow-up and are not assigned to anyone.',
             'crm_overdue_unassigned:' || current_date::text,
             null, null)
        then
          v_digests := v_digests + 1;
        end if;
      end if;
    end loop;
  end if;

  v_workflows := crm_run_workflows(p_dry_run);

  v_summary := jsonb_build_object('overdue', v_overdue, 'notified', v_notified,
                                  'unassigned', v_unassigned, 'digests', v_digests,
                                  'rules_applied', v_rules,
                                  'cadences', v_cadences, 'sla', v_sla, 'tasks', v_tasks,
                                  'quotes', v_quotes, 'workflows', v_workflows, 'cold', v_cold,
                                  'dry_run', p_dry_run);
  update cron_runs set finished_at = now(), summary = v_summary where id = v_run;
  return v_summary;
end;
$$;

-- ── the morning email learns about cold leads and yesterday ─────
-- The 0198 body verbatim, plus: cold_uncalled (+ the oldest, in days),
-- cold_quiet_quotes, cold_stuck, and yesterday's counters per caller.
drop function if exists morning_email_due(timestamptz);
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
  overdue_amount numeric,
  cold_uncalled  int,
  cold_oldest_days int,
  cold_quiet_quotes int,
  cold_stuck     int,
  yesterday      jsonb
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
               and i.due_date is not null and i.due_date < t.today) as overdue_amount,
           -- Never called: open, no contact, at least a day old.
           (select count(*) from crm_leads l
             where l.company_id = c.id and l.merged_into is null and l.is_archived = false
               and l.status not in ('converted', 'lost')
               and l.last_contacted_at is null and l.last_call_at is null
               and l.created_at < p_now - interval '1 day')::int as cold_uncalled,
           (select coalesce(max(extract(day from p_now - l.created_at))::int, 0) from crm_leads l
             where l.company_id = c.id and l.merged_into is null and l.is_archived = false
               and l.status not in ('converted', 'lost')
               and l.last_contacted_at is null and l.last_call_at is null
               and l.created_at < p_now - interval '1 day') as cold_oldest_days,
           -- A quotation sent three days ago and nothing since.
           (select count(*) from crm_quotes q
             join crm_leads l on l.id = q.lead_id
            where q.company_id = c.id and q.status = 'sent'
              and q.sent_at < p_now - interval '3 days'
              and l.is_archived = false and l.status not in ('converted', 'lost')
              and not exists (select 1 from crm_activities a
                               where a.lead_id = l.id and a.created_at > q.sent_at))::int as cold_quiet_quotes,
           -- Same stage for five days, nothing done in that time.
           (select count(*) from crm_leads l
             where l.company_id = c.id and l.merged_into is null and l.is_archived = false
               and l.status not in ('converted', 'lost', 'new')
               and l.stage_changed_at < p_now - interval '5 days'
               and not exists (select 1 from crm_activities a
                               where a.lead_id = l.id and a.created_at > p_now - interval '5 days'))::int as cold_stuck,
           coalesce((
             select jsonb_agg(jsonb_build_object('name', u.name, 'calls', d.calls_made, 'answered', d.calls_answered,
                                                 'quotes', d.quotes_sent, 'booked', d.booked)
                              order by d.calls_made desc, u.name)
               from users u
               cross join lateral crm_day_counts(c.id, u.user_id,
                                                 (t.today - 1)::timestamp at time zone 'Asia/Kolkata',
                                                 t.today::timestamp at time zone 'Asia/Kolkata') d
              where u.company_id = c.id and u.deleted_at is null and u.status = 'active'
                and d.leads_touched > 0
           ), '[]'::jsonb) as yesterday
      from companies c, t
  )
  select u.user_id, s.id, au.email, u.name, s.name, t.today,
         s.shoots, s.new_leads, s.follow_ups, s.tasks, s.overdue_count, s.overdue_amount,
         s.cold_uncalled, s.cold_oldest_days, s.cold_quiet_quotes, s.cold_stuck, s.yesterday
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
          or s.tasks > 0 or s.overdue_count > 0
          or s.cold_uncalled > 0 or s.cold_quiet_quotes > 0 or s.cold_stuck > 0
          or jsonb_array_length(s.yesterday) > 0)
     and not exists (select 1 from morning_emails m
                      where m.user_id = u.user_id and m.company_id = s.id and m.day = t.today)
$$;
revoke all on function morning_email_due(timestamptz) from public, anon, authenticated;
grant execute on function morning_email_due(timestamptz) to service_role;
