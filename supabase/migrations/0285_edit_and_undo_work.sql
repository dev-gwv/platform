-- 0285: projects, shoots, post-production and data can be changed back
-- (owner, 26 Oct: "once something is created, people cannot edit it back or
-- undo it ... they should be able to undo it or change it whenever it is
-- required"). Safe to run twice: every function is create-or-replace with an
-- unchanged argument list, every table and column is if-not-exists.
--
--   withdraw_submission(id)       an editor takes a hand-in back while it
--                                 still waits for review; the deliverable
--                                 (and a linked task) go back to editing.
--   unmark_arrived(slot)          an owner or manager undoes "I've reached":
--                                 the stamp and the shoot-day attendance row
--                                 mark_arrived (0225) wrote for that booking.
--   clear_slot_cost(slot, fields) empties a booking's payout amounts or note.
--                                 set_slot_cost (0090) keeps whatever it is
--                                 not given, so nothing could be emptied.
--                                 Refused (P0001 'paid') when it would leave
--                                 no amount on a booking with money paid.
--   is_own_task / update_own_task / delete_own_task
--                                 a task someone made for themselves alone is
--                                 theirs to edit, tick done, reopen, delete.
--   client_occasion_dismissals    a wedding-day anniversary the studio
--                                 deleted stays deleted: the trigger
--                                 shoots_wedding_anniversary (copied from
--                                 0243, the latest) no longer remakes it.
--   deliverable_notes.edited_at   a written note's author can change its
--                                 words (update policy on text notes only).
--   client_detail_dismissals      an event the client sent on the details
--                                 form that the studio will not shoot stops
--                                 waiting on the Shoots tab.
--
-- Changing a review decision, a crew answer, a cancelled booking, a reminder,
-- a referral and the data stamps needed no SQL: the functions already take
-- the other answer, or the API clears the column.

-- ── a hand-in taken back ─────────────────────────────────────────────
create or replace function withdraw_submission(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v        team_work_submissions;
  v_status text;
begin
  select * into v from team_work_submissions
   where id = p_id and company_id = get_current_company_id()
   for update;
  if not found then
    return 'missing';
  end if;
  if v.submitted_by is distinct from auth.uid() then
    return 'not_yours';
  end if;
  -- Once someone has looked at it, the decision is theirs to change.
  if v.status <> 'submitted' then
    return 'reviewed';
  end if;

  delete from team_work_submissions where id = p_id;

  -- The deliverable it moved to With manager goes back to editing -- only if
  -- it is still in review, so a deliverable moved on by hand is left alone.
  if v.deliverable_id is not null then
    select status::text into v_status from deliverables where id = v.deliverable_id;
    if v_status = 'review' then
      perform deliverable_follow_submission(v.deliverable_id, 'in_progress', 'editing',
        null, 'withdrawn:' || v.id, auth.uid());
    end if;
  end if;

  -- A task waiting for review on this hand-in alone is back in progress.
  if v.task_id is not null
     and not exists (select 1 from team_work_submissions w where w.task_id = v.task_id and w.status = 'submitted') then
    update tasks set status = 'in_progress' where id = v.task_id and status::text = 'review';
  end if;
  return 'ok';
end;
$$;
revoke all on function withdraw_submission(uuid) from public, anon;
grant execute on function withdraw_submission(uuid) to authenticated;

-- ── "I've reached" undone ────────────────────────────────────────────
create or replace function unmark_arrived(p_slot uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v team_assignment_slots;
begin
  if not (is_current_user_active() and is_current_admin_or_manager()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v from team_assignment_slots
   where id = p_slot and company_id = get_current_company_id()
   for update;
  if not found or v.arrived_at is null then
    return false;
  end if;
  update team_assignment_slots
     set arrived_at = null, arrived_lat = null, arrived_lng = null
   where id = p_slot;
  -- The day's attendance mark_arrived wrote for this booking; an office
  -- check-in of the same day (another source) is not touched.
  delete from attendance
   where company_id = v.company_id and user_id = v.user_id
     and slot_id = p_slot and source = 'shoot';
  return true;
end;
$$;
revoke all on function unmark_arrived(uuid) from public, anon;
grant execute on function unmark_arrived(uuid) to authenticated;

-- ── a payout emptied ─────────────────────────────────────────────────
create or replace function clear_slot_cost(p_slot_id uuid, p_fields text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v       team_assignment_slots;
  v_est   numeric;
  v_final numeric;
  v_paid  numeric;
begin
  if not is_current_admin_or_manager() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(coalesce(p_fields, '{}'::text[])) f
              where f not in ('estimated_cost', 'final_cost', 'cost_notes')) then
    raise exception 'invalid field' using errcode = '22023';
  end if;
  select * into v from team_assignment_slots
   where id = p_slot_id and company_id = get_current_company_id()
   for update;
  if not found then
    raise exception 'slot not found' using errcode = '42501';
  end if;

  v_est := case when 'estimated_cost' = any(p_fields) then null else v.estimated_cost end;
  v_final := case when 'final_cost' = any(p_fields) then null else v.final_cost end;

  -- Money already paid against a payout keeps a payout to be paid against.
  if coalesce(v_final, v_est) is null and coalesce(v.final_cost, v.estimated_cost) is not null then
    select coalesce(sum(amount_paid), 0) into v_paid from team_slot_settlements where slot_id = p_slot_id;
    if v_paid > 0 then
      raise exception 'paid: money has already been paid on this booking' using errcode = 'P0001';
    end if;
  end if;

  update team_assignment_slots
     set estimated_cost = v_est,
         final_cost     = v_final,
         cost_notes     = case when 'cost_notes' = any(p_fields) then null else cost_notes end,
         -- No amount left is no payout decided.
         cost_status    = case when coalesce(v_final, v_est) is null then 'not_decided' else cost_status end
   where id = p_slot_id;
end;
$$;
revoke all on function clear_slot_cost(uuid, text[]) from public, anon;
grant execute on function clear_slot_cost(uuid, text[]) to authenticated;

-- ── a task made for oneself ──────────────────────────────────────────
create or replace function is_own_task(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from tasks t
     where t.id = p_task
       and t.company_id = get_current_company_id()
       and t.created_by = auth.uid()
       and exists (select 1 from task_assignees a where a.task_id = t.id and a.user_id = auth.uid())
       and not exists (select 1 from task_assignees a where a.task_id = t.id and a.user_id <> auth.uid())
  )
$$;
revoke all on function is_own_task(uuid) from public, anon;
grant execute on function is_own_task(uuid) to authenticated;

-- Only its own words, date, priority and status; Blocked and Review keep
-- their own ways in (a reason; a hand-in).
create or replace function update_own_task(p_task uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := nullif(p_patch ->> 'status', '');
  v_title  text;
begin
  if not (is_current_user_active() and is_own_task(p_task)) then
    raise exception 'not your task' using errcode = '42501';
  end if;
  if v_status is not null and v_status not in ('to_do', 'in_progress', 'completed', 'cancelled') then
    raise exception 'Use Blocked or Submit work for that.' using errcode = '22023';
  end if;
  if p_patch ? 'title' then
    v_title := left(btrim(coalesce(p_patch ->> 'title', '')), 200);
    if v_title = '' then
      raise exception 'The task needs a name.' using errcode = '22023';
    end if;
  end if;
  update tasks
     set title       = coalesce(v_title, title),
         description = case when p_patch ? 'description'
                            then nullif(left(btrim(coalesce(p_patch ->> 'description', '')), 2000), '')
                            else description end,
         due_date    = case when p_patch ? 'due_date' then nullif(p_patch ->> 'due_date', '')::date else due_date end,
         priority    = case when p_patch ? 'priority' then (p_patch ->> 'priority')::task_priority else priority end,
         status      = coalesce(v_status::task_status, status)
   where id = p_task;
end;
$$;
revoke all on function update_own_task(uuid, jsonb) from public, anon;
grant execute on function update_own_task(uuid, jsonb) to authenticated;

create or replace function delete_own_task(p_task uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (is_current_user_active() and is_own_task(p_task)) then
    return false;
  end if;
  delete from tasks where id = p_task;
  return found;
end;
$$;
revoke all on function delete_own_task(uuid) from public, anon;
grant execute on function delete_own_task(uuid) to authenticated;

-- ── a deleted wedding anniversary stays deleted ──────────────────────
create table if not exists client_occasion_dismissals (
  company_id  uuid not null references companies (id) on delete cascade,
  client_id   uuid not null references clients (id) on delete cascade,
  kind        text not null check (kind in ('birthday', 'anniversary')),
  person_name text not null default '',
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (client_id, kind, person_name)
);
alter table client_occasion_dismissals enable row level security;
drop policy if exists client_occasion_dismissals_select on client_occasion_dismissals;
create policy client_occasion_dismissals_select on client_occasion_dismissals for select to authenticated
  using (company_id = get_current_company_id());
drop policy if exists client_occasion_dismissals_write on client_occasion_dismissals;
create policy client_occasion_dismissals_write on client_occasion_dismissals for all to authenticated
  using (company_id = get_current_company_id() and is_current_user_active())
  with check (company_id = get_current_company_id() and is_current_user_active()
              and client_id in (select id from clients where company_id = get_current_company_id()));
grant select, insert, delete on client_occasion_dismissals to authenticated;
grant select, insert, delete on client_occasion_dismissals to service_role;

-- Copied from 0243 (the latest); only the dismissal check is new.
create or replace function shoots_wedding_anniversary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client uuid;
  v_found  client_occasions;
begin
  if new.shoot_date is null or new.status = 'cancelled' or new.name !~* 'wedding' then
    return new;
  end if;
  -- "Wedding day" wins over "Pre-wedding": only a name that is the wedding.
  if new.name ~* '(pre|post)[\s-]*wedding' then
    return new;
  end if;
  select client_id into v_client from projects where id = new.project_id;
  if v_client is null then
    return new;
  end if;
  -- The studio took the wedding-day anniversary off: it stays off (0285).
  if exists (select 1 from client_occasion_dismissals
              where client_id = v_client and kind = 'anniversary' and person_name = '') then
    return new;
  end if;
  select * into v_found from client_occasions
   where client_id = v_client and kind = 'anniversary' and person_name = '';
  if not found then
    insert into client_occasions (company_id, client_id, project_id, kind, month, day, year, source)
      values (new.company_id, v_client, new.project_id, 'anniversary',
              extract(month from new.shoot_date), extract(day from new.shoot_date),
              extract(year from new.shoot_date), 'wedding_day');
  elsif v_found.source = 'wedding_day' and v_found.project_id is not distinct from new.project_id then
    update client_occasions
       set month = extract(month from new.shoot_date), day = extract(day from new.shoot_date),
           year = extract(year from new.shoot_date)
     where id = v_found.id;
  end if;
  return new;
end;
$$;

-- ── a note's words changed by its author ─────────────────────────────
alter table deliverable_notes add column if not exists edited_at timestamptz;
drop policy if exists deliverable_notes_update on deliverable_notes;
create policy deliverable_notes_update on deliverable_notes for update to authenticated
  using (
    company_id = get_current_company_id()
    and is_current_user_active()
    and kind = 'text'
    and author_id = auth.uid()
  )
  with check (
    company_id = get_current_company_id()
    and kind = 'text'
    and author_id = auth.uid()
  );
-- The words and the stamp only: never whose note it is or what it belongs to.
grant update (body, edited_at) on deliverable_notes to authenticated;

-- ── the client's events the studio said No thanks to ─────────────────
create table if not exists client_detail_dismissals (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  event_date date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists client_detail_dismissals_one
  on client_detail_dismissals (project_id, lower(btrim(name)), coalesce(event_date, '0001-01-01'::date));
alter table client_detail_dismissals enable row level security;
drop policy if exists client_detail_dismissals_select on client_detail_dismissals;
create policy client_detail_dismissals_select on client_detail_dismissals for select to authenticated
  using (company_id = get_current_company_id());
drop policy if exists client_detail_dismissals_write on client_detail_dismissals;
create policy client_detail_dismissals_write on client_detail_dismissals for all to authenticated
  using (company_id = get_current_company_id() and is_current_user_active())
  with check (company_id = get_current_company_id() and is_current_user_active()
              and project_id in (select id from projects where company_id = get_current_company_id()));
grant select, insert, delete on client_detail_dismissals to authenticated;
grant select, insert, delete on client_detail_dismissals to service_role;
