-- Team Booking v2: a booked person hears about it, and a booking says when
-- it was released.
--
--   * team_assignment_slots gains released_at and updated_at. A released slot
--     is still a record of who was going to be there; now it says when that
--     stopped being true.
--   * set_team_slot_status stamps released_at and refuses an id it cannot
--     find, instead of reporting success for a row it never touched.
--   * Being booked on a shoot -- or having a booking moved to you -- writes a
--     notification to the person booked (not to whoever booked them).
--   * run_shoot_reminder_cron: the evening before a shoot (after 6 pm in
--     India), everyone booked on it gets one reminder per booking.

alter table team_assignment_slots
  add column if not exists released_at timestamptz,
  add column if not exists updated_at  timestamptz not null default now();

drop trigger if exists team_assignment_slots_set_updated_at on team_assignment_slots;
create trigger team_assignment_slots_set_updated_at
  before update on team_assignment_slots
  for each row execute function set_updated_at();

create or replace function set_team_slot_status(p_slot_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_current_admin_or_manager() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_status not in ('booked', 'released', 'cancelled') then
    raise exception 'invalid status';
  end if;
  update team_assignment_slots
     set status = p_status,
         released_at = case when p_status = 'released' then now()
                            when p_status = 'booked' then null
                            else released_at end
   where id = p_slot_id and company_id = get_current_company_id();
  if not found then
    raise exception 'slot not found' using errcode = 'P0002';
  end if;
end;
$$;

-- ── tell the person booked ───────────────────────────────────────
create or replace function team_slots_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shoot  record;
  v_when   text;
begin
  if new.status <> 'booked' or new.shoot_id is null or new.user_id = auth.uid() then
    return new;
  end if;
  -- Only a new booking, or one that has just become this person's.
  if tg_op = 'UPDATE'
     and old.user_id = new.user_id
     and old.status = 'booked' then
    return new;
  end if;
  select s.name, s.location, p.name as project_name
    into v_shoot
    from shoots s left join projects p on p.id = s.project_id
   where s.id = new.shoot_id;
  v_when := to_char(new.start_at at time zone 'Asia/Kolkata', 'Dy DD Mon, HH12:MI AM');
  perform create_notification(
    new.company_id, new.user_id, 'shoot_assigned',
    'You''re booked: ' || coalesce(v_shoot.name, 'a shoot'),
    v_when
      || coalesce(' · ' || nullif(btrim(new.service_name), ''), '')
      || coalesce(' · ' || nullif(btrim(v_shoot.location), ''), '')
      || coalesce(' · ' || v_shoot.project_name, ''),
    'shoot_assigned:' || new.id || ':' || new.user_id,
    'shoot', new.shoot_id, 'info', '/shoots/my');
  return new;
end;
$$;

drop trigger if exists team_slots_notify on team_assignment_slots;
create trigger team_slots_notify
  after insert or update of user_id, status on team_assignment_slots
  for each row execute function team_slots_notify();

-- ── the evening before ───────────────────────────────────────────
-- Runs with the hourly reminders. Quiet until 6 pm India time, then one
-- reminder per booking for shoots starting tomorrow (India date).
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
      select t.id, t.company_id, t.user_id, t.service_name, t.start_at, t.shoot_id,
             s.name as shoot_name, s.location
        from team_assignment_slots t
        join shoots s on s.id = t.shoot_id
       where t.status = 'booked'
         and s.status not in ('cancelled', 'completed')
         and (t.start_at at time zone 'Asia/Kolkata')::date = v_tomorrow
    loop
      v_due := v_due + 1;
      if not p_dry_run then
        if create_notification(
             v_r.company_id, v_r.user_id, 'shoot_tomorrow',
             'Tomorrow: ' || coalesce(v_r.shoot_name, 'shoot'),
             to_char(v_r.start_at at time zone 'Asia/Kolkata', 'HH12:MI AM')
               || coalesce(' · ' || nullif(btrim(v_r.service_name), ''), '')
               || coalesce(' · ' || nullif(btrim(v_r.location), ''), ''),
             'shoot_tomorrow:' || v_r.id || ':' || v_tomorrow,
             'shoot', v_r.shoot_id, 'info', '/shoots/my') then
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
