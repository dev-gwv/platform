-- 0192: the task delegation loop.
--
--   assign → the person is told → they work → they submit a link →
--   the person who gave it reviews → done (or sent back).
--
-- Tasks had four states and no way to say "I'm done, please check" or "I'm
-- stuck". Work submissions existed (team_work_submissions, 0010) and could
-- carry a task_id, but submitting never moved the task and approving never
-- closed it, so the two lists drifted apart and a manager had to tidy both.
--
-- What this adds:
--   * two statuses: review (waiting for the person who gave it) and blocked
--     (with a reason);
--   * a tag on every task (free text; the app offers Shoot, Editing, Client,
--     Office, General);
--   * task_activity: a short history per task, written by triggers;
--   * notifications: task.assigned, task.status, task.submitted;
--   * employees may add tasks for themselves (only for themselves);
--   * a submission moves its task to review; approving it completes the
--     task, sending it back returns it to in progress;
--   * review_task(): the person who gave the task (or a manager) approves or
--     sends back.
--
-- ENUM NOTE. migrate.sh runs each file in one transaction (psql -1), and a
-- value added by ALTER TYPE ... ADD VALUE cannot be *used* until that
-- transaction commits ("unsafe use of new value"). So nothing below turns the
-- literal 'review' or 'blocked' into a task_status while this file runs:
-- plpgsql bodies are only planned when first called (after commit), and the
-- policies and SQL-language bodies compare `status::text` instead.
--
-- Existing SQL that reads task status (reminders, the overdue generator,
-- reports) tests `status not in ('completed', 'cancelled')` or
-- `status = 'to_do'`, so review and blocked already count as open work there
-- and nothing else needs to change.

-- ── 1. statuses ──────────────────────────────────────────────────
alter type task_status add value if not exists 'review' after 'in_progress';
alter type task_status add value if not exists 'blocked' after 'review';

-- ── 2. columns ───────────────────────────────────────────────────
alter table tasks add column if not exists tag text not null default 'General';
alter table tasks drop constraint if exists tasks_tag_check;
alter table tasks add constraint tasks_tag_check check (char_length(btrim(tag)) between 1 and 40);

alter table tasks add column if not exists blocked_reason text;
alter table tasks drop constraint if exists tasks_blocked_reason_check;
alter table tasks add constraint tasks_blocked_reason_check
  check (blocked_reason is null or char_length(blocked_reason) <= 500);

create index if not exists tasks_created_by_idx on tasks (created_by);
create index if not exists tws_task_created_idx
  on team_work_submissions (task_id, created_at desc) where task_id is not null;

-- ── 3. activity ──────────────────────────────────────────────────
create table if not exists task_activity (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  task_id    uuid not null references tasks (id) on delete cascade,
  user_id    uuid references auth.users (id) on delete set null,
  action     text not null check (char_length(action) <= 700),
  created_at timestamptz not null default now()
);
create index if not exists task_activity_task_idx on task_activity (task_id, created_at desc);

alter table task_activity enable row level security;
-- Whoever can see the task can see its history. The subquery runs under the
-- caller's own tasks policy, so this is exactly "same visibility as tasks".
-- Rows are written only by the triggers below, so there is no write policy.
drop policy if exists task_activity_select on task_activity;
create policy task_activity_select on task_activity
  for select to authenticated
  using (
    company_id = get_current_company_id()
    and exists (select 1 from tasks t where t.id = task_activity.task_id)
  );

-- ── 4. who sees and adds tasks ───────────────────────────────────
-- The person who gave a task keeps seeing it, even when it is not theirs to
-- do: they are the one who reviews it. (An employee's own task is created by
-- them, so it is visible the moment it is inserted, which INSERT ... RETURNING
-- needs.)
drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks
  for select to authenticated
  using (
    company_id = get_current_company_id()
    and (
      is_current_admin_or_manager()
      or created_by = auth.uid()
      or exists (select 1 from task_assignees a where a.task_id = tasks.id and a.user_id = auth.uid())
    )
  );

-- Anyone active may add a task for themselves. It starts open; closing it is
-- a review, not a checkbox.
drop policy if exists tasks_insert_own on tasks;
create policy tasks_insert_own on tasks
  for insert to authenticated
  with check (
    company_id = get_current_company_id()
    and created_by = auth.uid()
    and is_current_user_active()
    and status::text in ('to_do', 'in_progress')
  );

-- ...and put only themselves on it. Assigning someone else stays a manager's
-- job (task_assignees_write).
drop policy if exists task_assignees_insert_self on task_assignees;
create policy task_assignees_insert_self on task_assignees
  for insert to authenticated
  with check (
    company_id = get_current_company_id()
    and user_id = auth.uid()
    and exists (
      select 1 from tasks t
       where t.id = task_assignees.task_id and t.created_by = auth.uid()
    )
  );

-- ── 5. helpers (internal) ────────────────────────────────────────
create or replace function task_status_label(p_status text)
returns text
language sql
immutable
as $$
  select case p_status
    when 'to_do'       then 'To do'
    when 'in_progress' then 'In progress'
    when 'review'      then 'Review'
    when 'blocked'     then 'Blocked'
    when 'completed'   then 'Done'
    when 'cancelled'   then 'Cancelled'
    else p_status
  end
$$;

create or replace function task_person_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select name from users where user_id = p_user
$$;
revoke all on function task_person_name(uuid) from public, anon, authenticated;

create or replace function task_log(p_task tasks, p_user uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into task_activity (company_id, task_id, user_id, action)
  values (p_task.company_id, p_task.id, p_user, left(p_action, 700));
end;
$$;
revoke all on function task_log(tasks, uuid, text) from public, anon, authenticated;

-- One in-app notification about a task, opening it. Each event is its own row
-- (the key carries the moment), so being assigned the same task twice, or a
-- task moving back and forth, is told each time.
create or replace function task_notify(
  p_task tasks, p_recipient uuid, p_type text, p_title text, p_body text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_recipient is null then
    return;
  end if;
  perform create_notification(
    p_task.company_id, p_recipient, p_type, left(p_title, 200), nullif(left(coalesce(p_body, ''), 500), ''),
    p_type || ':' || p_task.id || ':' || p_recipient || ':' || extract(epoch from clock_timestamp())::text,
    'task', p_task.id, 'info', '/tasks?open=' || p_task.id, '{}'::jsonb);
end;
$$;
revoke all on function task_notify(tasks, uuid, text, text, text) from public, anon, authenticated;

-- ── 6. triggers on tasks ─────────────────────────────────────────
-- A reason belongs to a blocked task only; moving on clears it.
create or replace function tasks_clear_blocked_reason()
returns trigger
language plpgsql
as $$
begin
  if new.status::text <> 'blocked' then
    new.blocked_reason := null;
  end if;
  return new;
end;
$$;
drop trigger if exists tasks_clear_blocked_reason on tasks;
create trigger tasks_clear_blocked_reason
  before insert or update on tasks
  for each row execute function tasks_clear_blocked_reason();

create or replace function tasks_log_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform task_log(new, coalesce(auth.uid(), new.created_by), 'created this task');
  return new;
end;
$$;
drop trigger if exists tasks_log_created on tasks;
create trigger tasks_log_created
  after insert on tasks
  for each row execute function tasks_log_created();

-- A status move: one line of history, and the people on the task are told
-- (not the one who moved it). The person who gave the task is told when it
-- waits for them (review) or is stuck (blocked).
--
-- Every update, not `update of status`: a column list fires only for columns
-- named in the UPDATE statement.
create or replace function tasks_log_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_label text;
  v_title text;
  v_body  text;
  v_user  uuid;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;
  -- A submission or a review moves the task itself and says so itself.
  if coalesce(current_setting('ipc.task_quiet', true), '') = '1' then
    return new;
  end if;

  v_label := task_status_label(new.status::text);
  v_body := case when new.status::text = 'blocked' then new.blocked_reason end;
  perform task_log(new, v_actor,
    'moved this to ' || v_label || coalesce(': ' || v_body, ''));

  v_title := 'Moved to ' || v_label || ': ' || new.title;
  for v_user in select a.user_id from task_assignees a where a.task_id = new.id loop
    if v_actor is null or v_user <> v_actor then
      perform task_notify(new, v_user, 'task.status', v_title, v_body);
    end if;
  end loop;

  if new.status::text in ('review', 'blocked')
     and new.created_by is not null
     and new.created_by is distinct from v_actor
     and not exists (select 1 from task_assignees a where a.task_id = new.id and a.user_id = new.created_by) then
    perform task_notify(new, new.created_by, 'task.status', v_title, v_body);
  end if;
  return new;
end;
$$;
drop trigger if exists tasks_log_status on tasks;
create trigger tasks_log_status
  after update on tasks
  for each row execute function tasks_log_status();

-- ── 7. triggers on assignees ─────────────────────────────────────
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
drop trigger if exists task_assignees_log_added on task_assignees;
create trigger task_assignees_log_added
  after insert on task_assignees
  for each row execute function task_assignees_log_added();

create or replace function task_assignees_log_removed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_task tasks;
begin
  -- A task being deleted takes its assignees with it; there is nothing left
  -- to write history against.
  select * into v_task from tasks where id = old.task_id;
  if not found then
    return old;
  end if;
  perform task_log(v_task, auth.uid(),
    'removed ' || coalesce(task_person_name(old.user_id), 'a team member'));
  return old;
end;
$$;
drop trigger if exists task_assignees_log_removed on task_assignees;
create trigger task_assignees_log_removed
  after delete on task_assignees
  for each row execute function task_assignees_log_removed();

-- ── 8. submissions move the task ─────────────────────────────────
create or replace function tws_follow_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_task  tasks;
  v_by    uuid;
  v_user  uuid;
  v_note  text;
begin
  if new.task_id is null then
    return new;
  end if;
  select * into v_task from tasks where id = new.task_id;
  if not found then
    return new;
  end if;

  -- Submitted (or submitted again after being sent back): waiting for review.
  if tg_op = 'INSERT' or (new.status = 'submitted' and old.status is distinct from 'submitted') then
    v_by := coalesce(new.submitted_by, v_actor);
    perform task_log(v_task, v_by,
      case when tg_op = 'INSERT' then 'submitted work' else 'submitted work again' end);
    if v_task.status::text not in ('completed', 'cancelled') then
      perform set_config('ipc.task_quiet', '1', true);
      update tasks set status = 'review' where id = v_task.id;
      perform set_config('ipc.task_quiet', '', true);
    end if;
    if v_task.created_by is not null and v_task.created_by is distinct from v_by then
      perform task_notify(v_task, v_task.created_by, 'task.submitted',
        'Work submitted: ' || v_task.title,
        concat_ws(' · ', 'From ' || coalesce(task_person_name(v_by), 'a team member'), new.submission_link));
    end if;
    return new;
  end if;

  if old.status is not distinct from new.status then
    return new;
  end if;

  v_note := nullif(btrim(coalesce(new.review_notes, '')), '');
  if new.status = 'approved' then
    perform task_log(v_task, v_actor, 'approved the work');
    if v_task.status::text <> 'cancelled' then
      perform set_config('ipc.task_quiet', '1', true);
      update tasks set status = 'completed' where id = v_task.id;
      perform set_config('ipc.task_quiet', '', true);
    end if;
    for v_user in select a.user_id from task_assignees a where a.task_id = v_task.id loop
      if v_actor is null or v_user <> v_actor then
        perform task_notify(v_task, v_user, 'task.status', 'Approved: ' || v_task.title, v_note);
      end if;
    end loop;
  elsif new.status = 'rejected' then
    perform task_log(v_task, v_actor, 'sent the work back' || coalesce(': ' || v_note, ''));
    if v_task.status::text <> 'cancelled' then
      perform set_config('ipc.task_quiet', '1', true);
      update tasks set status = 'in_progress' where id = v_task.id;
      perform set_config('ipc.task_quiet', '', true);
    end if;
    for v_user in select a.user_id from task_assignees a where a.task_id = v_task.id loop
      if v_actor is null or v_user <> v_actor then
        perform task_notify(v_task, v_user, 'task.status', 'Sent back: ' || v_task.title, v_note);
      end if;
    end loop;
  end if;
  return new;
end;
$$;
drop trigger if exists tws_follow_task on team_work_submissions;
create trigger tws_follow_task
  after insert or update of status on team_work_submissions
  for each row execute function tws_follow_task();

-- ── 9. RPCs ──────────────────────────────────────────────────────
-- The person on a task moves it along. Done is not theirs to say: a task is
-- completed by review (or by a manager). Blocked needs a reason — "blocked"
-- alone tells the person who gave it nothing.
drop function if exists update_my_task_status(uuid, task_status);
create or replace function update_my_task_status(
  p_task_id uuid,
  p_status  task_status,
  p_reason  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_now text;
begin
  if not exists (
    select 1 from task_assignees where task_id = p_task_id and user_id = auth.uid()
  ) then
    raise exception 'not your task' using errcode = '42501';
  end if;
  if p_status::text not in ('to_do', 'in_progress', 'review', 'blocked') then
    raise exception 'The person who gave you this task marks it done.' using errcode = '22023';
  end if;
  select status::text into v_now from tasks where id = p_task_id;
  -- Same status again (a voice note riding along with the move): nothing to do.
  if v_now = p_status::text then
    return;
  end if;
  if v_now in ('completed', 'cancelled') then
    raise exception 'This task is closed.' using errcode = '22023';
  end if;
  if p_status::text = 'blocked' and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Say what is blocking this task.' using errcode = '22023';
  end if;
  update tasks
     set status = p_status,
         blocked_reason = case when p_status::text = 'blocked' then left(btrim(p_reason), 500) end,
         updated_at = now()
   where id = p_task_id;
end;
$$;
revoke all on function update_my_task_status(uuid, task_status, text) from public, anon;
grant execute on function update_my_task_status(uuid, task_status, text) to authenticated;

-- Approve or send back a task waiting for review. The person who gave the
-- task, or a manager. With a submission waiting, that submission is what is
-- judged (and the trigger above moves the task); without one, the task moves
-- directly.
create or replace function review_task(
  p_task_id uuid,
  p_approve boolean,
  p_note    text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task tasks;
  v_sub  uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v_task from tasks where id = p_task_id and company_id = get_current_company_id();
  if not found then
    raise exception 'task not in this studio' using errcode = '42501';
  end if;
  if not (is_current_admin_or_manager() or v_task.created_by = auth.uid()) then
    raise exception 'Only the person who gave this task can review it.' using errcode = '42501';
  end if;
  if v_task.status::text <> 'review' then
    raise exception 'This task is not waiting for review.' using errcode = '22023';
  end if;
  if not p_approve and v_note is null then
    raise exception 'Say what needs to change.' using errcode = '22023';
  end if;

  select id into v_sub from team_work_submissions
   where task_id = p_task_id and status = 'submitted'
   order by created_at desc limit 1;

  if v_sub is not null then
    update team_work_submissions
       set status = case when p_approve then 'approved' else 'rejected' end,
           review_notes = left(v_note, 2000), reviewed_by = auth.uid(), reviewed_at = now()
     where id = v_sub;
  elsif p_approve then
    update tasks set status = 'completed' where id = p_task_id;
  else
    update tasks set status = 'in_progress' where id = p_task_id;
    perform task_log(v_task, auth.uid(), 'said: ' || left(v_note, 600));
  end if;
end;
$$;
revoke all on function review_task(uuid, boolean, text) from public, anon;
grant execute on function review_task(uuid, boolean, text) to authenticated;

revoke all on function tasks_log_created() from public, anon, authenticated;
revoke all on function tasks_log_status() from public, anon, authenticated;
revoke all on function task_assignees_log_added() from public, anon, authenticated;
revoke all on function task_assignees_log_removed() from public, anon, authenticated;
revoke all on function tws_follow_task() from public, anon, authenticated;
