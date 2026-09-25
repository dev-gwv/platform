-- Start reminders: tell the person on a piece of work when to START it, not
-- only when it is due.
--
--   * deliverables.started_at: set when the editor taps "Start", hands work
--     in, or it moves to review/done. Assigning someone no longer reads as
--     "started" (0166 flips pending to in_progress on assignment).
--   * deliverable_work_days(): how many days the work needs -- the project's
--     own production lead (delivery_days_after_start, from the wizard's
--     lead_days) or, failing that, the same guess by name the wizard makes
--     (raw 2, backup/sorting 1, film 30, anything else 7).
--   * deliverable_start_by(): due date minus the work, minus a day for review.
--   * run_start_reminder_cron(): every morning (after 9 am India), two days
--     before the start date, on the day, and every day after until started.
--     Tasks get the same, a day before their due date.

alter table deliverables add column if not exists started_at timestamptz;

create or replace function deliverable_work_days(p_title text, p_lead int)
returns int
language sql
immutable
as $$
  select case
    when coalesce(p_lead, 0) > 0 then p_lead
    when lower(coalesce(p_title, '')) ~ 'raw\s*(photo|foot|video|pic)' then 2
    when lower(coalesce(p_title, '')) ~ '(data\s*sort|sorting|data\s*copy|copy\s*data|backup)' then 1
    when lower(coalesce(p_title, '')) ~ '(film|long\s*video|full\s*video|cinematic)' then 30
    else 7
  end
$$;

-- The day to begin: due, minus the work, minus one day for review.
create or replace function deliverable_start_by(p_due date, p_title text, p_lead int)
returns date
language sql
immutable
as $$
  select case when p_due is null then null
              else p_due - deliverable_work_days(p_title, p_lead) - 1 end
$$;

-- Work counts as started once it reaches review or done, or work is handed in.
create or replace function deliverables_mark_started()
returns trigger
language plpgsql
as $$
begin
  if new.started_at is null and new.status in ('review', 'completed') then
    new.started_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists deliverables_mark_started on deliverables;
create trigger deliverables_mark_started
  before insert or update of status on deliverables
  for each row execute function deliverables_mark_started();

create or replace function work_submission_marks_started()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deliverable_id is not null then
    update deliverables set started_at = coalesce(started_at, now()) where id = new.deliverable_id;
  end if;
  return new;
end;
$$;
drop trigger if exists work_submission_marks_started on team_work_submissions;
create trigger work_submission_marks_started
  after insert on team_work_submissions
  for each row execute function work_submission_marks_started();

-- Work already handed in or in review has started.
update deliverables d set started_at = coalesce(d.started_at, d.updated_at)
 where d.started_at is null
   and (d.status in ('review', 'completed')
        or exists (select 1 from team_work_submissions w where w.deliverable_id = d.id));

-- The editor on it says "I've started".
create or replace function start_deliverable(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update deliverables set started_at = coalesce(started_at, now())
   where id = p_id and company_id = get_current_company_id()
     and (assignee_id = auth.uid() or is_current_admin_or_manager());
  if not found then
    raise exception 'deliverable not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function start_deliverable(uuid) from public, anon;
grant execute on function start_deliverable(uuid) to authenticated;

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
             deliverable_work_days(d.title, d.delivery_days_after_start) as work_days,
             deliverable_start_by(d.estimated_date, d.title, d.delivery_days_after_start) as start_by
        from deliverables d
        join projects p on p.id = d.project_id
       where d.assignee_id is not null
         and d.started_at is null
         and d.status not in ('review', 'completed', 'cancelled')
         and p.status = 'active'
         and d.estimated_date is not null
         and deliverable_start_by(d.estimated_date, d.title, d.delivery_days_after_start) <= v_today + 2
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
