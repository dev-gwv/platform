-- 0305: daily tasks -- a task that comes back by itself (owner, 14 Nov:
-- "a recurring task system for any team member ... it should show them daily
-- on the dashboard. If they do not ... submit, there should be an intimation").
--
-- 1. task_routines: what to do, for whom, which days (every day, chosen
--    weekdays, or one date a month), an optional "finish by" time (India
--    time), when it starts and ends, paused or not. task_routine_people holds
--    who does it.
-- 2. Every day each person gets their own copy as an ordinary task
--    (tasks.routine_id, tasks.routine_for, due that India day, tag 'Daily'),
--    made by generate_routine_tasks() on the five-minute messages tick and
--    straight away when a routine is saved. A copy is made once per routine,
--    person and day (a unique index), so the tick can run as often as it likes.
--    Making a copy rings nobody: a "New task" every morning would be noise.
-- 3. A copy not done by the next morning is closed as missed (status
--    cancelled, routine_missed = true) when the new day's copies are made, so
--    a person's list never fills with old days and the history still counts it.
-- 4. routine_tasks_remind(), on the same tick: once a copy is past its
--    finish-by time (7 pm India time when none was set) and still not done,
--    the person is told once ("Not done yet: ...") and so is whoever set the
--    routine ("Ravi has not done ...").
-- 5. routine_task_done(task, done): the person on a copy ticks it done (or
--    takes the tick back the same day) in one tap; daily work needs no review.
--
-- Safe to run twice: if not exists, create or replace, drop ... if exists.

create table if not exists task_routines (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  priority    task_priority not null default 'medium',
  -- 'days': on the weekdays listed (ISO: 1 = Monday ... 7 = Sunday);
  -- 'monthly': on month_day each month (the last day in a shorter month).
  repeat      text not null default 'days' check (repeat in ('days', 'monthly')),
  weekdays    smallint[] not null default '{1,2,3,4,5,6,7}'
              check (weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]),
  month_day   smallint check (month_day is null or month_day between 1 and 31),
  -- Finish by, India time. Null: by the end of the working day (7 pm).
  due_time    time,
  starts_on   date not null default ((now() at time zone 'Asia/Kolkata')::date),
  ends_on     date,
  paused      boolean not null default false,
  project_id  uuid references projects (id) on delete set null,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (repeat <> 'monthly' or month_day is not null),
  check (repeat <> 'days' or cardinality(weekdays) > 0),
  check (ends_on is null or ends_on >= starts_on)
);
create index if not exists task_routines_company_idx on task_routines (company_id);

drop trigger if exists task_routines_set_updated_at on task_routines;
create trigger task_routines_set_updated_at before update on task_routines
  for each row execute function set_updated_at();

create table if not exists task_routine_people (
  routine_id uuid not null references task_routines (id) on delete cascade,
  user_id    uuid not null references users (user_id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  primary key (routine_id, user_id)
);
create index if not exists task_routine_people_user_idx on task_routine_people (user_id);

alter table task_routines enable row level security;
alter table task_routine_people enable row level security;

-- Read by everyone in the studio (a person sees whose routine they are on);
-- written through the API, which checks tasks create/edit, and RLS keeps every
-- row inside the caller's studio.
drop policy if exists task_routines_rw on task_routines;
create policy task_routines_rw on task_routines
  for all
  using (company_id = (select get_current_company_id()) and (select is_current_user_active()))
  with check (company_id = (select get_current_company_id()) and (select is_current_user_active()));

drop policy if exists task_routine_people_rw on task_routine_people;
create policy task_routine_people_rw on task_routine_people
  for all
  using (company_id = (select get_current_company_id()) and (select is_current_user_active()))
  with check (company_id = (select get_current_company_id()) and (select is_current_user_active()));

grant select, insert, update, delete on task_routines, task_routine_people to authenticated;

alter table tasks add column if not exists routine_id uuid references task_routines (id) on delete set null;
alter table tasks add column if not exists routine_for uuid references users (user_id) on delete set null;
alter table tasks add column if not exists routine_missed boolean not null default false;
alter table tasks add column if not exists routine_reminded_at timestamptz;
create unique index if not exists tasks_routine_day_person
  on tasks (routine_id, due_date, routine_for) where routine_id is not null;

-- ── is this routine due on that day? ─────────────────────────────
create or replace function task_routine_due_on(r task_routines, p_day date)
returns boolean
language sql
immutable
as $$
  select not r.paused
     and p_day >= r.starts_on
     and (r.ends_on is null or p_day <= r.ends_on)
     and case r.repeat
           when 'days' then extract(isodow from p_day)::smallint = any (r.weekdays)
           when 'monthly' then extract(day from p_day)::int = least(
             r.month_day::int,
             extract(day from (date_trunc('month', p_day) + interval '1 month - 1 day'))::int)
           else false
         end
$$;

-- ── the day's copies ───────────────────────────────────────────────
-- p_routine narrows to one routine (when it is saved); null makes every
-- studio's copies for the day. Returns how many copies were made.
create or replace function generate_routine_tasks(p_day date default null, p_routine uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := coalesce(p_day, (now() at time zone 'Asia/Kolkata')::date);
  r     task_routines;
  p     record;
  v_id  uuid;
  v_n   int := 0;
begin
  -- Someone signed in may make their own studio's copies for one routine;
  -- every studio's at once is the cron's job.
  if auth.uid() is not null then
    if p_routine is null or not exists (
      select 1 from task_routines x where x.id = p_routine and x.company_id = get_current_company_id()
    ) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  end if;

  -- No "New task" or "Moved to Cancelled" for copies made here.
  perform set_config('ipc.task_quiet', '1', true);

  -- Yesterday's (and older) copies still open are missed.
  update tasks t
     set status = 'cancelled', routine_missed = true
   where t.routine_id is not null
     and t.due_date < v_day
     and t.status::text not in ('completed', 'cancelled')
     and (p_routine is null or t.routine_id = p_routine);

  for r in
    select * from task_routines
     where (p_routine is null or id = p_routine)
  loop
    if not task_routine_due_on(r, v_day) then
      continue;
    end if;
    for p in
      select rp.user_id
        from task_routine_people rp
        join users u on u.user_id = rp.user_id
       where rp.routine_id = r.id
         and u.company_id = r.company_id
         and u.deleted_at is null
         and u.status = 'active'
    loop
      insert into tasks (company_id, project_id, title, description, priority, status,
                         due_date, tag, created_by, routine_id, routine_for)
      values (r.company_id, r.project_id, r.title, r.description, r.priority, 'to_do',
              v_day, 'Daily', r.created_by, r.id, p.user_id)
      on conflict (routine_id, due_date, routine_for) where routine_id is not null do nothing
      returning id into v_id;
      if v_id is not null then
        insert into task_assignees (task_id, user_id, company_id)
        values (v_id, p.user_id, r.company_id)
        on conflict do nothing;
        v_n := v_n + 1;
        v_id := null;
      end if;
    end loop;
  end loop;

  perform set_config('ipc.task_quiet', '', true);
  return v_n;
end;
$$;
revoke all on function generate_routine_tasks(date, uuid) from public, anon;
grant execute on function generate_routine_tasks(date, uuid) to authenticated, service_role;

-- A person being added to an existing task is still told, except for the
-- daily copies made above. Copied from 0192 with the quiet check added.
create or replace function task_assignees_log_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_task  tasks;
  v_from  text;
begin
  select * into v_task from tasks where id = new.task_id;
  if not found then
    return new;
  end if;
  if coalesce(current_setting('ipc.task_quiet', true), '') = '1' then
    return new;
  end if;

  if new.user_id = v_actor then
    perform task_log(v_task, v_actor, 'took this task');
    return new;
  end if;

  perform task_log(v_task, v_actor,
    'assigned this to ' || coalesce(task_person_name(new.user_id), 'a team member'));
  v_from := task_person_name(coalesce(v_actor, v_task.created_by));
  perform task_notify(v_task, new.user_id, 'task.assigned', 'New task: ' || v_task.title,
    concat_ws(' · ',
      'From ' || coalesce(v_from, 'your studio'),
      'Due ' || to_char(v_task.due_date, 'FMDD Mon')));
  return new;
end;
$$;

-- ── the reminder when a day's copy is not done ─────────────────────
create or replace function routine_tasks_remind()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now  timestamp := now() at time zone 'Asia/Kolkata';
  t      record;
  v_n    int := 0;
  v_name text;
  v_by   text;
begin
  for t in
    select k.id, k.company_id, k.title, k.routine_for, k.due_date,
           r.created_by as setter, r.due_time
      from tasks k
      join task_routines r on r.id = k.routine_id
     where k.routine_id is not null
       and k.routine_reminded_at is null
       and k.status::text not in ('completed', 'cancelled')
       and k.due_date = v_now::date
       and k.due_date + coalesce(r.due_time, time '19:00') <= v_now
  loop
    update tasks set routine_reminded_at = now() where id = t.id;
    v_by := case when t.due_time is null then 'today'
                 else 'by ' || lower(to_char(t.due_time, 'FMHH12:MI am')) end;
    if t.routine_for is not null then
      perform create_notification(
        t.company_id, t.routine_for, 'task.daily_missed',
        left('Not done yet: ' || t.title, 200),
        'Your daily task was due ' || v_by || '. Tick it done once it is.',
        'routine_late:' || t.id,
        'task', t.id, 'warning', '/dashboard', '{}'::jsonb);
    end if;
    if t.setter is not null and t.setter is distinct from t.routine_for then
      select u.name into v_name from users u where u.user_id = t.routine_for;
      perform create_notification(
        t.company_id, t.setter, 'task.daily_missed',
        left(coalesce(v_name, 'Someone') || ' has not done: ' || t.title, 200),
        'It was due ' || v_by || '.',
        'routine_late_setter:' || t.id,
        'task', t.id, 'warning', '/tasks?view=daily', '{}'::jsonb);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function routine_tasks_remind() from public, anon, authenticated;
grant execute on function routine_tasks_remind() to service_role;

-- ── one tap: done (or not done after all, the same day) ────────────
create or replace function routine_task_done(p_task uuid, p_done boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t   tasks;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select * into v_t from tasks where id = p_task;
  if not found or v_t.routine_id is null then
    raise exception 'That daily task was not found.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from task_assignees a where a.task_id = p_task and a.user_id = v_uid)
     and not (v_t.company_id = get_current_company_id() and is_current_admin_or_manager()) then
    raise exception 'This daily task is not yours.' using errcode = '42501';
  end if;
  if v_t.routine_missed then
    raise exception 'That day has passed. Today''s copy is on your list.' using errcode = '22023';
  end if;
  if not p_done and v_t.due_date < v_today then
    raise exception 'That day has passed.' using errcode = '22023';
  end if;

  perform set_config('ipc.task_quiet', '1', true);
  update tasks set status = case when p_done then 'completed'::task_status else 'to_do'::task_status end
   where id = p_task;
  perform task_log(v_t, v_uid, case when p_done then 'ticked today''s daily task done' else 'took the done tick back' end);
  perform set_config('ipc.task_quiet', '', true);
  return case when p_done then 'completed' else 'to_do' end;
end;
$$;
revoke all on function routine_task_done(uuid, boolean) from public, anon;
grant execute on function routine_task_done(uuid, boolean) to authenticated;
