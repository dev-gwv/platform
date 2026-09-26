-- Two fixes to jobs that already run.
--
-- run_start_reminder_cron (0174) counted back from the due date with the
-- built-in guess (film 30 days, raw 2...). My Work shows the studio's own
-- work days since 0179, so a deliverable with no lead of its own could be
-- chased on a different day from the one on screen. It now asks
-- company_start_by / company_work_days: the deliverable's own lead, then the
-- studio's type, then the built-in guess -- the same answer as My Work.
--
-- run_notification_generator('reminders') (0125, copied in 0162) still read
-- reminders.remind_at and .done, which 0060 dropped, so running it failed.
-- It reads due_at and status now, with the hourly job's dedupe key.

create or replace function run_start_reminder_cron(p_dry_run boolean default false, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_local   timestamp := p_now at time zone 'Asia/Kolkata';
  v_today   date := v_local::date;
  v_due     int := 0;
  v_created int := 0;
  v_r       record;
  v_left    int;
  v_title   text;
  v_body    text;
  v_sev     text;
  v_summary jsonb;
  v_run     uuid;
begin
  insert into cron_runs (job_name, dry_run) values ('start_reminder_cron', p_dry_run) returning id into v_run;

  if extract(hour from v_local) >= 9 then
    -- Deliverables: from two days before the start date, every day, until started.
    for v_r in
      select d.id, d.company_id, d.assignee_id as user_id, d.title, d.estimated_date, p.name as project_name,
             company_work_days(d.company_id, d.title, d.delivery_days_after_start) as work_days,
             company_start_by(d.company_id, d.estimated_date, d.title, d.delivery_days_after_start) as start_by
        from deliverables d
        join projects p on p.id = d.project_id
       where d.assignee_id is not null
         and d.started_at is null
         and d.status not in ('review', 'completed', 'cancelled')
         and p.status = 'active'
         and d.estimated_date is not null
         and company_start_by(d.company_id, d.estimated_date, d.title, d.delivery_days_after_start) <= v_today + 2
         and d.estimated_date >= v_today - 30
    loop
      v_left := v_r.start_by - v_today;
      if v_left not in (2) and v_left > 0 then
        continue;
      end if;
      v_due := v_due + 1;
      if v_left = 2 then
        v_title := 'Start ' || v_r.title || ' by ' || to_char(v_r.start_by, 'Dy DD Mon');
        v_sev := 'info';
      elsif v_left = 0 then
        v_title := 'Start ' || v_r.title || ' today';
        v_sev := 'warning';
      else
        v_title := v_r.title || ': should have started ' || (-v_left) || case when v_left = -1 then ' day ago' else ' days ago' end;
        v_sev := case when v_r.estimated_date - v_today <= 2 then 'critical' else 'warning' end;
      end if;
      v_body := v_r.project_name || ' · due ' || to_char(v_r.estimated_date, 'DD Mon')
                || ' · needs about ' || v_r.work_days || case when v_r.work_days = 1 then ' day' else ' days' end;
      if not p_dry_run then
        if create_notification(
             v_r.company_id, v_r.user_id, 'deliverable_start', v_title, v_body,
             'deliverable_start:' || v_r.id || ':' || v_r.user_id || ':' || v_r.estimated_date || ':' || v_today,
             'deliverable', v_r.id, v_sev, '/my-work',
             jsonb_build_object('start_by', v_r.start_by, 'work_days', v_r.work_days, 'estimated_date', v_r.estimated_date)) then
          v_created := v_created + 1;
        end if;
      end if;
    end loop;

    -- Tasks: a day before they are due, and every day after, until picked up.
    for v_r in
      select t.id, t.company_id, a.user_id, t.title, t.due_date, p.name as project_name
        from tasks t
        join task_assignees a on a.task_id = t.id
        left join projects p on p.id = t.project_id
       where t.status = 'to_do'
         and t.due_date is not null
         and t.due_date - 1 <= v_today
         and t.due_date >= v_today - 14
         and (p.id is null or p.status = 'active')
    loop
      v_left := (v_r.due_date - 1) - v_today;
      v_due := v_due + 1;
      if v_left >= 0 then
        v_title := 'Start ' || v_r.title || ' today';
        v_sev := 'warning';
      else
        v_title := v_r.title || ': not started, due ' || to_char(v_r.due_date, 'DD Mon');
        v_sev := case when v_r.due_date <= v_today then 'critical' else 'warning' end;
      end if;
      if not p_dry_run then
        if create_notification(
             v_r.company_id, v_r.user_id, 'task_start', v_title, v_r.project_name,
             'task_start:' || v_r.id || ':' || v_r.user_id || ':' || v_r.due_date || ':' || v_today,
             'task', v_r.id, v_sev, '/tasks/my') then
          v_created := v_created + 1;
        end if;
      end if;
    end loop;
  end if;

  v_summary := jsonb_build_object('due', v_due, 'notifications_created', v_created, 'dry_run', p_dry_run);
  update cron_runs set finished_at = now(), summary = v_summary where id = v_run;
  return v_summary;
end;
$$;
revoke all on function run_start_reminder_cron(boolean, timestamptz) from public, anon;
grant execute on function run_start_reminder_cron(boolean, timestamptz) to service_role;

create or replace function run_notification_generator(
  p_key      text,
  p_dry_run  boolean default true,
  p_date_from timestamptz default null,
  p_date_to   timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_from timestamptz := coalesce(p_date_from, now() - interval '30 days');
  v_to   timestamptz := coalesce(p_date_to, now() + interval '30 days');
  v_scanned int := 0;
  v_generated int := 0;
  v_made boolean;
  r record;
begin
  if v_company is null then
    raise exception 'no company in context' using errcode = '42501';
  end if;

  if p_key = 'allocation_conflicts' then
    -- Two bookings for one person that overlap in time. `a.id < b.id` so each
    -- pair is reported once, not twice from both sides.
    for r in
      select a.user_id, a.id as slot_id, a.start_at, b.id as other_id
        from team_assignment_slots a
        join team_assignment_slots b
          on b.company_id = a.company_id and b.user_id = a.user_id and b.id > a.id
         and b.status = 'booked' and a.status = 'booked'
         and b.start_at < a.end_at and a.start_at < b.end_at
       where a.company_id = v_company and a.start_at between v_from and v_to
    loop
      v_scanned := v_scanned + 1;
      if not p_dry_run then
        v_made := create_notification(
          v_company, r.user_id, 'allocation.conflict',
          'Double booking', 'You are booked twice over the same hours.',
          'alloc_conflict:' || r.slot_id || ':' || r.other_id,
          'team_slot', r.slot_id, 'critical', '/team-allocation');
        if v_made then v_generated := v_generated + 1; end if;
      end if;
    end loop;

  elsif p_key = 'reminders' then
    for r in
      -- remind_at/done went in 0060: a reminder is due_at + status now.
      -- Same dedupe key as the hourly run_reminder_cron (0181), so running
      -- this by hand never alerts twice for one reminder.
      select rm.id, rm.user_id, rm.title, rm.due_at
        from reminders rm
       where rm.company_id = v_company and rm.status = 'active'
         and rm.due_at between v_from and least(v_to, now())
    loop
      v_scanned := v_scanned + 1;
      if not p_dry_run then
        v_made := create_notification(
          v_company, r.user_id, 'reminder', r.title, 'Reminder due',
          'reminder:' || r.id, 'reminder', r.id, 'warning', '/reminders');
        if v_made then v_generated := v_generated + 1; end if;
      end if;
    end loop;

  elsif p_key = 'tasks' then
    -- Overdue and unfinished, to whoever it is assigned to.
    for r in
      select t.id, t.title, t.due_date, ta.user_id
        from tasks t
        join task_assignees ta on ta.task_id = t.id
       where t.company_id = v_company
         and t.status not in ('completed', 'cancelled')
         and t.due_date is not null
         and t.due_date < current_date
         and t.due_date >= v_from::date
    loop
      v_scanned := v_scanned + 1;
      if not p_dry_run then
        v_made := create_notification(
          v_company, r.user_id, 'task.overdue', 'Task overdue', r.title,
          'task_overdue:' || r.id || ':' || r.due_date, 'task', r.id, 'warning', '/tasks');
        if v_made then v_generated := v_generated + 1; end if;
      end if;
    end loop;

  elsif p_key = 'shoots' then
    -- Upcoming shoots, to the crew booked on them.
    for r in
      select s.id, s.name, s.shoot_date, tas.user_id
        from shoots s
        join team_assignment_slots tas on tas.shoot_id = s.id and tas.status = 'booked'
       where s.company_id = v_company
         and s.status in ('planned', 'confirmed')
         and s.shoot_date is not null
         and s.shoot_date between current_date and least(v_to, now() + interval '7 days')::date
    loop
      v_scanned := v_scanned + 1;
      if not p_dry_run then
        v_made := create_notification(
          v_company, r.user_id, 'shoot.upcoming', 'Shoot coming up',
          r.name || ' on ' || to_char(r.shoot_date, 'DD Mon'),
          'shoot_upcoming:' || r.id, 'shoot', r.id, 'info', '/shoots');
        if v_made then v_generated := v_generated + 1; end if;
      end if;
    end loop;

  elsif p_key in ('data_pending', 'backup_pending') then
    -- Same table, two independent custody tracks.
    for r in
      select d.id, d.data_label, u.user_id
        from shoot_data_records d
        cross join lateral notification_admin_recipients(v_company) u(user_id)
       where d.company_id = v_company
         and ((p_key = 'data_pending'   and d.primary_status = 'pending')
           or (p_key = 'backup_pending' and d.backup_status  = 'pending'))
    loop
      v_scanned := v_scanned + 1;
      if not p_dry_run then
        v_made := create_notification(
          v_company, r.user_id,
          case when p_key = 'data_pending' then 'data.pending' else 'data.backup_pending' end,
          case when p_key = 'data_pending' then 'Data copy pending' else 'Backup pending' end,
          r.data_label, p_key || ':' || r.id, 'data_record', r.id, 'warning', '/data-management');
        if v_made then v_generated := v_generated + 1; end if;
      end if;
    end loop;

  elsif p_key = 'payment_pending' then
    for r in
      select i.id, i.invoice_number, i.balance_due, i.due_date, u.user_id
        from invoices i
        cross join lateral notification_admin_recipients(v_company) u(user_id)
       where i.company_id = v_company
         and i.balance_due > 0
         and i.status <> 'cancelled'
         and i.due_date is not null
         and i.due_date < current_date
    loop
      v_scanned := v_scanned + 1;
      if not p_dry_run then
        v_made := create_notification(
          v_company, r.user_id, 'invoice.overdue', 'Payment overdue',
          'Invoice ' || coalesce(r.invoice_number, '') || ' — ' || to_char(r.balance_due, 'FM999999990.00') || ' outstanding',
          'invoice_overdue:' || r.id || ':' || r.due_date, 'invoice', r.id, 'critical', '/billing');
        if v_made then v_generated := v_generated + 1; end if;
      end if;
    end loop;

  elsif p_key = 'crm_follow_ups' then
    for r in
      select l.id, l.name, l.follow_up_at, l.assigned_to
        from crm_leads l
       where l.company_id = v_company
         and l.assigned_to is not null
         and l.status not in ('converted', 'lost')
         and l.follow_up_at is not null
         and l.follow_up_at < now()
         and l.follow_up_at >= v_from
    loop
      v_scanned := v_scanned + 1;
      if not p_dry_run then
        v_made := create_notification(
          v_company, r.assigned_to, 'crm.follow_up_overdue', 'Follow-up overdue',
          coalesce(r.name, 'A lead') || ' is past its follow-up time.',
          'lead_followup:' || r.id || ':' || date_trunc('day', r.follow_up_at),
          'crm_lead', r.id, 'warning', '/follow-ups');
        if v_made then v_generated := v_generated + 1; end if;
      end if;
    end loop;

  else
    raise exception 'unknown generator %', p_key using errcode = '22023';
  end if;

  return jsonb_build_object(
    'key', p_key,
    'dry_run', p_dry_run,
    'scanned', v_scanned,
    'generated', case when p_dry_run then 0 else v_generated end,
    'deduped', case when p_dry_run then 0 else v_scanned - v_generated end
  );
end;
$$;

