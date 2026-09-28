-- 0207: crew answer their bookings, say when they've reached, and tasks keep time.
--
-- A booking (team_assignment_slots) was a one-way order: booked, released or
-- cancelled, by a manager. The person booked could not say "yes, I'll be
-- there" or "I can't make it", so the studio found out on the day. Now:
--
--   * response: pending -> confirmed | declined (with a reason), answered by
--     the person booked. A decline tells whoever booked them; the booking
--     stays until a manager releases it, so nobody silently loses crew.
--     Moving a booking to someone else asks them afresh.
--   * arrived_at: "I've reached", on the shoot day, with where they were --
--     stored for the record, never enforced (venues are not attendance places,
--     by the owner's choice).
--   * The evening-before reminder asks the unconfirmed to confirm.
--
-- Bookings made before this migration are treated as confirmed: nobody was
-- ever asked, and 400 "not confirmed" chips on old shoots would be noise.
--
-- Tasks gain started_at and completed_at, stamped as the status moves, so a
-- task's timing can be read the way a deliverable's already is (0174/0161).

alter table team_assignment_slots
  add column if not exists response       text not null default 'pending'
    check (response in ('pending', 'confirmed', 'declined')),
  add column if not exists responded_at   timestamptz,
  add column if not exists decline_reason text check (decline_reason is null or char_length(decline_reason) <= 300),
  add column if not exists arrived_at     timestamptz,
  add column if not exists arrived_lat    double precision,
  add column if not exists arrived_lng    double precision;

update team_assignment_slots set response = 'confirmed', responded_at = coalesce(responded_at, created_at)
 where response = 'pending' and responded_at is null;

-- A booking handed to someone else is a new question for them.
create or replace function team_slots_reset_response()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id then
    new.response := 'pending';
    new.responded_at := null;
    new.decline_reason := null;
    new.arrived_at := null;
    new.arrived_lat := null;
    new.arrived_lng := null;
  end if;
  return new;
end;
$$;
drop trigger if exists team_slots_reset_response on team_assignment_slots;
create trigger team_slots_reset_response before update of user_id on team_assignment_slots
  for each row execute function team_slots_reset_response();

-- ── answering ─────────────────────────────────────────────────
create or replace function respond_to_slot(p_slot uuid, p_response text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot   team_assignment_slots;
  v_shoot  text;
  v_me     text;
  v_to     uuid;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_response not in ('confirmed', 'declined') then
    raise exception 'invalid response' using errcode = '22023';
  end if;
  select * into v_slot from team_assignment_slots
   where id = p_slot and company_id = get_current_company_id() and user_id = auth.uid()
   for update;
  if not found then
    raise exception 'slot not found' using errcode = 'P0002';
  end if;
  if v_slot.status <> 'booked' then
    raise exception 'not_booked: this booking was released or cancelled' using errcode = 'P0001';
  end if;
  if v_slot.end_at < now() then
    raise exception 'past: this shoot is over' using errcode = 'P0001';
  end if;
  if p_response = 'declined' and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'reason_required: say why you can''t make it' using errcode = 'P0001';
  end if;

  update team_assignment_slots
     set response = p_response, responded_at = now(),
         decline_reason = case when p_response = 'declined' then left(btrim(p_reason), 300) else null end
   where id = p_slot;

  if p_response = 'declined' then
    select s.name into v_shoot from shoots s where s.id = v_slot.shoot_id;
    select u.name into v_me from users u where u.user_id = auth.uid();
    v_to := crm_alert_recipient(v_slot.company_id, v_slot.created_by);
    if v_to is not null and v_to <> auth.uid() then
      perform create_notification(
        v_slot.company_id, v_to, 'shoot_declined',
        coalesce(v_me, 'Someone') || ' can''t make ' || coalesce(v_shoot, 'a shoot'),
        to_char(v_slot.start_at at time zone 'Asia/Kolkata', 'Dy DD Mon, HH12:MI AM')
          || coalesce(' · ' || nullif(btrim(v_slot.service_name), ''), '')
          || ' · "' || left(btrim(p_reason), 140) || '"',
        'shoot_declined:' || v_slot.id || ':' || now()::date,
        'shoot', v_slot.shoot_id, 'warning', '/team-allocation');
    end if;
  end if;
end;
$$;
revoke all on function respond_to_slot(uuid, text, text) from public, anon;
grant execute on function respond_to_slot(uuid, text, text) to authenticated;

-- ── "I've reached" ─────────────────────────────────────────────
-- From three hours before the start until the end. The first tap counts.
create or replace function mark_arrived(p_slot uuid, p_lat double precision default null, p_lng double precision default null)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot team_assignment_slots;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_slot from team_assignment_slots
   where id = p_slot and company_id = get_current_company_id() and user_id = auth.uid()
   for update;
  if not found then
    raise exception 'slot not found' using errcode = 'P0002';
  end if;
  if v_slot.status <> 'booked' then
    raise exception 'not_booked: this booking was released or cancelled' using errcode = 'P0001';
  end if;
  if now() < v_slot.start_at - interval '3 hours' or now() > v_slot.end_at then
    raise exception 'not_now: you can mark this from three hours before the shoot until it ends' using errcode = 'P0001';
  end if;
  if v_slot.arrived_at is not null then
    return v_slot.arrived_at;
  end if;
  update team_assignment_slots
     set arrived_at = now(), arrived_lat = p_lat, arrived_lng = p_lng,
         -- Turning up is an answer.
         response = case when response = 'pending' then 'confirmed' else response end,
         responded_at = coalesce(responded_at, now())
   where id = p_slot;
  return now();
end;
$$;
revoke all on function mark_arrived(uuid, double precision, double precision) from public, anon;
grant execute on function mark_arrived(uuid, double precision, double precision) to authenticated;

-- ── the evening before: the 0172 body, asking the unconfirmed ──
create or replace function run_shoot_reminder_cron(p_dry_run boolean default false, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_local   timestamp := p_now at time zone 'Asia/Kolkata';
  v_tomorrow date := (v_local::date) + 1;
  v_due     int := 0;
  v_created int := 0;
  v_r       record;
  v_summary jsonb;
  v_run     uuid;
begin
  insert into cron_runs (job_name, dry_run) values ('shoot_reminder_cron', p_dry_run) returning id into v_run;

  if extract(hour from v_local) >= 18 then
    for v_r in
      select t.id, t.company_id, t.user_id, t.service_name, t.start_at, t.shoot_id, t.response,
             s.name as shoot_name, s.location
        from team_assignment_slots t
        join shoots s on s.id = t.shoot_id
       where t.status = 'booked'
         and t.response <> 'declined'
         and s.status not in ('cancelled', 'completed')
         and (t.start_at at time zone 'Asia/Kolkata')::date = v_tomorrow
    loop
      v_due := v_due + 1;
      if not p_dry_run then
        if create_notification(
             v_r.company_id, v_r.user_id, 'shoot_tomorrow',
             'Tomorrow: ' || coalesce(v_r.shoot_name, 'shoot')
               || case when v_r.response = 'pending' then ' · please confirm' else '' end,
             to_char(v_r.start_at at time zone 'Asia/Kolkata', 'HH12:MI AM')
               || coalesce(' · ' || nullif(btrim(v_r.service_name), ''), '')
               || coalesce(' · ' || nullif(btrim(v_r.location), ''), ''),
             'shoot_tomorrow:' || v_r.id || ':' || v_tomorrow,
             'shoot', v_r.shoot_id, case when v_r.response = 'pending' then 'warning' else 'info' end, '/shoots/my') then
          v_created := v_created + 1;
        end if;
      end if;
    end loop;
  end if;

  v_summary := jsonb_build_object('bookings_tomorrow', v_due, 'notifications_created', v_created, 'dry_run', p_dry_run);
  update cron_runs set finished_at = now(), summary = v_summary where id = v_run;
  return v_summary;
end;
$$;
revoke all on function run_shoot_reminder_cron(boolean, timestamptz) from public, anon;
grant execute on function run_shoot_reminder_cron(boolean, timestamptz) to service_role;

-- ── tasks keep time ────────────────────────────────────────────
alter table tasks
  add column if not exists started_at   timestamptz,
  add column if not exists completed_at timestamptz;

-- Best available history for tasks already done: when they last changed.
update tasks set completed_at = updated_at where status = 'completed' and completed_at is null;
update tasks set started_at = coalesce(started_at, created_at)
 where status in ('in_progress', 'review', 'completed') and started_at is null;

create or replace function tasks_stamp_times()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('in_progress', 'review', 'completed') and new.started_at is null then
    new.started_at := now();
  end if;
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    new.completed_at := now();
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists tasks_stamp_times on tasks;
create trigger tasks_stamp_times before insert or update of status on tasks
  for each row execute function tasks_stamp_times();
