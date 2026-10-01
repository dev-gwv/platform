-- 0224: attendance v2 -- off until the owner turns it on, then done properly.
--
-- The owner asked for "a great attendance system": daily, location set by the
-- owner, best practice. 0206 gave places, rules and automatic marking; 0223
-- stopped the sweep marking studios that never set attendance up. What was
-- still missing:
--
--   * A switch. Attendance is OFF until the owner turns it on, and the day it
--     goes on is remembered (enabled_at): nobody is marked, swept absent or
--     cut a rupee for a day before it. Studios already tracking are turned on
--     from their first real check-in (backfill below).
--   * Working hours in one place: day start, minutes of grace, day end, and
--     "half day if they work less than N hours". A studio without a pinned
--     location can still set them (attendance_policy, not company_location).
--   * Evidence: the phone's GPS accuracy is kept, a fix rougher than 500 m is
--     refused, and a selfie can be required (only the person and managers can
--     open it -- file_access() -- and it is purged after 60 days).
--   * Half day as a status; shoot days recorded when the person taps "I've
--     reached" (source 'shoot', the booking kept on the row) and never
--     overwritten by an office check-in.
--   * A forgotten check-out is closed at the studio's day end, not 23:59.
--   * Payroll: only days the studio tracked, half a day per half day, an
--     optional "N late marks = half a day", and a shoot day never cut.
--   * Reminders in the app: "You haven't checked in yet", "Don't forget to
--     check out", and the owner's "3 not in yet: …".
--
-- Every function below is copied from its latest definition and edited:
-- attendance_rule_for/check_in/check_out/auto_checkout_sweep 0206,
-- mark_absent_backstop 0223, mark_arrived 0207, payroll_generate 0187,
-- decide_attendance_correction 0177, set_attendance_manual 0035.

-- ── the switch and the working day ────────────────────────────────
alter table attendance_policy
  add column if not exists enabled                 boolean not null default false,
  add column if not exists enabled_at              timestamptz,
  add column if not exists day_start               time,
  add column if not exists grace_min               int not null default 15
    check (grace_min between 0 and 240),
  add column if not exists day_end                 time,
  add column if not exists half_day_hours          numeric(3, 1)
    check (half_day_hours is null or half_day_hours between 1 and 12),
  add column if not exists selfie_required         boolean not null default false,
  -- 0 = lateness is never deducted; 3 = every three late marks cost half a day.
  add column if not exists late_marks_per_half_day int not null default 0
    check (late_marks_per_half_day between 0 and 10);

-- ── what a mark carries ──────────────────────────────────────────
alter table attendance
  add column if not exists accuracy_m     int check (accuracy_m is null or accuracy_m >= 0),
  -- Restrict: the evidence cannot be deleted from under the row (purge clears it first).
  add column if not exists selfie_file_id uuid references files (id) on delete restrict,
  add column if not exists slot_id        uuid references team_assignment_slots (id) on delete set null;
create unique index if not exists attendance_selfie_uq on attendance (selfie_file_id) where selfie_file_id is not null;

-- The status and source checks were inline (0014, 0054), so their names are
-- whatever Postgres chose: drop every check on those columns, then name ours.
do $$
declare
  v_c record;
begin
  for v_c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.attendance'::regclass
       and con.contype = 'c'
       and (pg_get_constraintdef(con.oid) ilike '%status%' or pg_get_constraintdef(con.oid) ilike '%source%')
       and pg_get_constraintdef(con.oid) not ilike '%late_minutes%'
       and pg_get_constraintdef(con.oid) not ilike '%accuracy_m%'
  loop
    execute format('alter table attendance drop constraint %I', v_c.conname);
  end loop;
end;
$$;
alter table attendance
  add constraint attendance_status_v2 check (status in ('present', 'late', 'half_day', 'absent')),
  add constraint attendance_source_v2 check (source in ('manual', 'auto_login', 'auto_checkout', 'shoot'));

alter table payroll_lines
  add column if not exists half_days         numeric(5, 1) not null default 0,
  add column if not exists late_penalty_days numeric(5, 1) not null default 0;

-- ── is the studio tracking that day? ─────────────────────────────
create or replace function attendance_tz(p_company uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select timezone from company_location where company_id = p_company), 'Asia/Kolkata')
$$;
revoke all on function attendance_tz(uuid) from public, anon;
grant execute on function attendance_tz(uuid) to authenticated, service_role;

create or replace function attendance_enabled(p_company uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from attendance_policy p
     where p.company_id = p_company and p.enabled and p.enabled_at is not null
       and p_date >= (p.enabled_at at time zone attendance_tz(p_company))::date)
$$;
revoke all on function attendance_enabled(uuid, date) from public, anon;
grant execute on function attendance_enabled(uuid, date) to authenticated, service_role;

-- When a shift that was never closed is closed: the studio's day end, or
-- the end of the day when there is none -- never before the check-in.
create or replace function attendance_close_at(p_company uuid, p_date date, p_check_in timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    p_check_in,
    ((p_date + coalesce((select day_end from attendance_policy where company_id = p_company), time '23:59:59'))::timestamp
      at time zone attendance_tz(p_company)))
$$;
revoke all on function attendance_close_at(uuid, date, timestamptz) from public, anon;
grant execute on function attendance_close_at(uuid, date, timestamptz) to authenticated, service_role;

-- ── the owner's settings, in one call ────────────────────────────
create or replace function set_attendance_policy(
  p_enabled        boolean,
  p_day_start      time,
  p_grace          int,
  p_day_end        time,
  p_half_day_hours numeric,
  p_selfie         boolean,
  p_late_marks     int
)
returns attendance_policy
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_row     attendance_policy;
begin
  if not (is_current_user_active() and is_current_owner()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_day_start is not null and p_day_end is not null and p_day_end <= p_day_start then
    raise exception 'bad_hours: the day has to end after it starts' using errcode = 'P0001';
  end if;
  insert into attendance_policy as p (company_id, enabled, enabled_at, day_start, grace_min, day_end,
                                      half_day_hours, selfie_required, late_marks_per_half_day, updated_at)
  values (v_company, coalesce(p_enabled, false), case when p_enabled then now() end, p_day_start,
          coalesce(p_grace, 15), p_day_end, p_half_day_hours, coalesce(p_selfie, false), coalesce(p_late_marks, 0), now())
  on conflict (company_id) do update
    set enabled = excluded.enabled,
        -- Turning it on starts the count; turning it off and on again restarts it.
        enabled_at = case when excluded.enabled and not p.enabled then now()
                          when excluded.enabled then coalesce(p.enabled_at, now())
                          else p.enabled_at end,
        day_start = excluded.day_start,
        grace_min = excluded.grace_min,
        day_end = excluded.day_end,
        half_day_hours = excluded.half_day_hours,
        selfie_required = excluded.selfie_required,
        late_marks_per_half_day = excluded.late_marks_per_half_day,
        updated_at = now()
  returning * into v_row;
  -- company_location keeps the start and grace every older reader uses.
  update company_location
     set expected_checkin_time = v_row.day_start, late_grace_minutes = v_row.grace_min
   where company_id = v_company;
  return v_row;
end;
$$;
revoke all on function set_attendance_policy(boolean, time, int, time, numeric, boolean, int) from public, anon;
grant execute on function set_attendance_policy(boolean, time, int, time, numeric, boolean, int) to authenticated;

-- ── the rule: 0206, with the policy's hours when there is no location ──
create or replace function attendance_rule_for(p_user uuid)
returns table (
  mode       text,
  place_id   uuid,
  place_name text,
  radius_m   int,
  expected   time,
  grace      int,
  tz         text,
  rule_from  text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user users;
  v_rule attendance_rules;
  v_from text;
  v_loc  company_location;
  v_pol  attendance_policy;
begin
  select * into v_user from users where user_id = p_user;
  if not found then return; end if;
  select * into v_loc from company_location where company_id = v_user.company_id;
  select * into v_pol from attendance_policy where company_id = v_user.company_id;

  select * into v_rule from attendance_rules r
   where r.company_id = v_user.company_id and r.scope = 'user' and r.user_id = p_user;
  if found then
    v_from := 'person';
  else
    select r.* into v_rule from attendance_rules r
      join employee_role_assignments a on a.role_id = r.role_id and a.user_id = p_user
     where r.company_id = v_user.company_id and r.scope = 'role'
     order by r.created_at
     limit 1;
    if found then v_from := 'position'; end if;
  end if;

  if v_from is null then
    return query select
      case when coalesce(v_user.engagement_type, 'in_house') = 'freelancer' then 'off' else 'required' end,
      null::uuid, null::text, null::int,
      coalesce(v_loc.expected_checkin_time, v_pol.day_start),
      coalesce(v_loc.late_grace_minutes, v_pol.grace_min, 15),
      coalesce(v_loc.timezone, 'Asia/Kolkata'),
      case when coalesce(v_user.engagement_type, 'in_house') = 'freelancer' then 'freelancer' else 'studio' end;
    return;
  end if;

  return query select
    v_rule.mode, v_rule.place_id,
    (select p.name from attendance_places p where p.id = v_rule.place_id),
    v_rule.radius_m,
    coalesce(v_rule.expected_checkin_time, v_loc.expected_checkin_time, v_pol.day_start),
    coalesce(v_rule.late_grace_minutes, v_loc.late_grace_minutes, v_pol.grace_min, 15),
    coalesce(v_loc.timezone, 'Asia/Kolkata'),
    v_from;
end;
$$;
revoke all on function attendance_rule_for(uuid) from public, anon;
grant execute on function attendance_rule_for(uuid) to authenticated, service_role;

-- ── check in: 0206, switched, with accuracy and a selfie ──────────
drop function if exists check_in(double precision, double precision, boolean);
create or replace function check_in(
  p_lat      double precision,
  p_lng      double precision,
  p_auto     boolean default false,
  p_accuracy double precision default null,
  p_selfie   uuid default null
)
returns table (id uuid, status text, late_minutes int, place_name text, distance_m int)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_company  uuid := get_current_company_id();
  v_me       uuid := auth.uid();
  v_rule     record;
  v_pol      attendance_policy;
  v_place    record;
  v_place_id uuid;
  v_place_nm text;
  v_dist     int;
  v_tz       text;
  v_date     date;
  v_id       uuid;
  v_late     int := 0;
  v_row      attendance;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_rule from attendance_rule_for(v_me);
  v_tz := coalesce(v_rule.tz, 'Asia/Kolkata');
  v_date := (now() at time zone v_tz)::date;
  select * into v_pol from attendance_policy where company_id = v_company;

  if not attendance_enabled(v_company, v_date) then
    raise exception 'not_enabled: attendance is not switched on for your studio' using errcode = 'P0001';
  end if;
  if v_rule.mode = 'off' then
    raise exception 'not_tracked: attendance is not tracked for you' using errcode = 'P0001';
  end if;
  -- A shoot day is already counted, by the booking: opening the app at the
  -- venue (far from any studio place) must not be refused, and adds nothing.
  select * into v_row from attendance a where a.company_id = v_company and a.user_id = v_me and a.a_date = v_date;
  if found and v_row.source = 'shoot' and v_row.check_in_at is not null then
    return query select v_row.id, v_row.status, v_row.late_minutes, null::text, null::int;
    return;
  end if;
  if p_accuracy is not null and p_accuracy > 500 then
    raise exception 'too_rough: %', attendance_distance_text(p_accuracy) using errcode = 'P0001';
  end if;
  if coalesce(v_pol.selfie_required, false) and p_selfie is null then
    raise exception 'selfie_needed: take a selfie to check in' using errcode = 'P0001';
  end if;
  if p_selfie is not null and not exists (
       select 1 from files f
        where f.id = p_selfie and f.company_id = v_company and f.created_by = v_me
          and f.mime like 'image/%' and f.created_at > now() - interval '15 minutes'
          and not exists (select 1 from attendance a where a.selfie_file_id = f.id)) then
    raise exception 'bad_selfie: take the selfie again' using errcode = 'P0001';
  end if;

  -- Yesterday's shift nobody closed is closed at its day end, not left open.
  update attendance a
     set check_out_at = attendance_close_at(a.company_id, a.a_date, a.check_in_at), closed_by_system = true
   where a.company_id = v_company and a.user_id = v_me
     and a.check_in_at is not null and a.check_out_at is null and a.a_date < v_date;

  if v_rule.mode = 'required' then
    -- The nearest active place against its own radius (or the rule's). A
    -- rough fix gets the benefit of its doubt, up to the radius again.
    select p.id, p.name, d.m as distance, coalesce(v_rule.radius_m, p.radius_m) as radius
      into v_place
      from attendance_places p
      cross join lateral (select geo_distance_m(p_lat, p_lng, p.lat, p.lng) as m) d
     where p.company_id = v_company and p.is_active
       and (v_rule.place_id is null or p.id = v_rule.place_id)
     order by d.m - coalesce(v_rule.radius_m, p.radius_m)
     limit 1;
    if found then
      if v_place.distance > v_place.radius + least(coalesce(p_accuracy, 0), v_place.radius) then
        raise exception 'outside_fence: % from % (allowed % m)',
          attendance_distance_text(v_place.distance), v_place.name, v_place.radius
          using errcode = 'P0001';
      end if;
      v_place_id := v_place.id;
      v_place_nm := v_place.name;
      v_dist := round(v_place.distance)::int;
    end if;
  end if;

  v_late := attendance_lateness(now(), v_rule.expected, v_rule.grace, v_tz);

  insert into attendance as a (company_id, user_id, a_date, check_in_at, check_in_lat, check_in_lng,
                               status, late_minutes, source, check_in_place_id, check_in_distance_m,
                               accuracy_m, selfie_file_id)
    values (v_company, v_me, v_date, now(), p_lat, p_lng,
            case when v_late > 0 then 'late' else 'present' end, v_late,
            case when p_auto then 'auto_login' else 'manual' end,
            v_place_id, v_dist, round(p_accuracy)::int, p_selfie)
  on conflict (company_id, user_id, a_date)
    do update set check_in_at = coalesce(a.check_in_at, excluded.check_in_at),
                  check_in_lat = coalesce(a.check_in_lat, excluded.check_in_lat),
                  check_in_lng = coalesce(a.check_in_lng, excluded.check_in_lng),
                  check_in_place_id = coalesce(a.check_in_place_id, excluded.check_in_place_id),
                  check_in_distance_m = coalesce(a.check_in_distance_m, excluded.check_in_distance_m),
                  accuracy_m = coalesce(a.accuracy_m, excluded.accuracy_m),
                  selfie_file_id = coalesce(a.selfie_file_id, excluded.selfie_file_id),
                  -- The arrival that counts is the one already recorded,
                  -- except over an 'absent' row the backstop wrote (0157).
                  status = case when a.status = 'absent' and a.check_in_at is null then excluded.status else a.status end,
                  late_minutes = case when a.status = 'absent' and a.check_in_at is null then excluded.late_minutes else a.late_minutes end,
                  source = case when a.check_in_at is null then excluded.source else a.source end
    returning a.id into v_id;

  return query select x.id, x.status, x.late_minutes, v_place_nm, v_dist from attendance x where x.id = v_id;
end;
$$;
revoke all on function check_in(double precision, double precision, boolean, double precision, uuid) from public, anon;
grant execute on function check_in(double precision, double precision, boolean, double precision, uuid) to authenticated;

-- ── check out: 0206, with the half day ─────────────────────────────
create or replace function check_out(p_lat double precision default null, p_lng double precision default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_id      uuid;
  v_hours   numeric;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select half_day_hours into v_hours from attendance_policy where company_id = v_company;

  update attendance a
     set check_out_at = now(), check_out_lat = p_lat, check_out_lng = p_lng,
         -- Under the studio's half-day hours is a half day -- unless half the
         -- day was approved leave, which is the other half.
         status = case
                    when v_hours is not null and a.status in ('present', 'late')
                         and now() - a.check_in_at < make_interval(mins => (v_hours * 60)::int)
                         and not exists (select 1 from leave_requests lr
                                          where lr.user_id = a.user_id and lr.status = 'approved' and lr.half_day
                                            and lr.start_date = a.a_date)
                    then 'half_day' else a.status end
   where a.id = (
           select x.id
             from attendance x
            where x.company_id = v_company
              and x.user_id = auth.uid()
              and x.check_in_at is not null
              and x.check_out_at is null
              and x.check_in_at > now() - interval '20 hours'
            order by x.check_in_at desc
            limit 1
            for update)
  returning a.id into v_id;

  if v_id is null then
    raise exception 'no_open_check_in: nothing to check out of'
      using errcode = 'P0001';
  end if;

  return v_id;
end;
$$;
revoke all on function check_out(double precision, double precision) from public, anon;
grant execute on function check_out(double precision, double precision) to authenticated;

-- ── shifts nobody closed: 0206, closed at the studio's day end ──────
create or replace function auto_checkout_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  update attendance a
     set check_out_at = attendance_close_at(a.company_id, a.a_date, a.check_in_at),
         closed_by_system = true
    from companies c
    left join attendance_policy p on p.company_id = c.id
   where a.company_id = c.id
     and a.check_in_at is not null
     and a.check_out_at is null
     and (a.check_in_at <= now() - interval '20 hours'
          -- Two hours past the studio's day end is long enough to have left.
          or (p.day_end is not null
              and now() >= ((a.a_date + p.day_end)::timestamp at time zone attendance_tz(c.id)) + interval '2 hours'
              and a.check_in_at < ((a.a_date + p.day_end)::timestamp at time zone attendance_tz(c.id))));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function auto_checkout_sweep() from public, anon, authenticated;
grant execute on function auto_checkout_sweep() to service_role;

-- ── the absent sweep: 0223, only where and since the studio tracks ──
create or replace function mark_absent_backstop()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company companies;
  v_tz      text;
  v_date    date;
  v_added   int := 0;
  v_total   int := 0;
begin
  for v_company in select * from companies loop
    v_tz := attendance_tz(v_company.id);
    -- The day that has just ended where the studio is.
    v_date := ((now() at time zone v_tz) - interval '12 hours')::date;
    -- 0224: off, or switched on after that day -- nobody is counted.
    if not attendance_enabled(v_company.id, v_date) then
      continue;
    end if;
    -- A holiday or a weekly off: nobody was expected in.
    if day_off(v_company.id, v_date) is not null then
      continue;
    end if;
    insert into attendance (company_id, user_id, a_date, status)
      select v_company.id, u.user_id, v_date, 'absent'
      from users u
      where u.company_id = v_company.id and u.deleted_at is null and u.status = 'active'
        and u.role <> 'super_admin'
        and coalesce(u.login_enabled, true)
        and coalesce(u.engagement_type, 'in_house') = 'in_house'
        and u.created_at::date <= v_date
        and not on_leave(u.user_id, v_date)
        -- 0206: a person or position the studio does not track.
        and coalesce((select r.mode from attendance_rule_for(u.user_id) r), 'required') <> 'off'
        -- 0223: a shoot day is a working day, wherever the shoot was.
        and not booked_on_shoot(u.user_id, v_date, v_tz)
        and not exists (
          select 1 from attendance a
          where a.company_id = v_company.id and a.user_id = u.user_id and a.a_date = v_date
        )
      on conflict (company_id, user_id, a_date) do nothing;
    get diagnostics v_added = row_count;
    v_total := v_total + v_added;
  end loop;
  return v_total;
end;
$$;
revoke all on function mark_absent_backstop() from public, anon, authenticated;
grant execute on function mark_absent_backstop() to service_role;

-- ── "I've reached": 0207, and the shoot day is the day's attendance ──
create or replace function mark_arrived(p_slot uuid, p_lat double precision default null, p_lng double precision default null)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot team_assignment_slots;
  v_rule record;
  v_tz   text;
  v_date date;
  v_late int;
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

  -- 0224: for someone the studio tracks, reaching the venue is the day's
  -- check-in -- late against the booking's own start. An office check-in
  -- already made that day stays; a backstop 'absent' does not.
  v_tz := attendance_tz(v_slot.company_id);
  v_date := (now() at time zone v_tz)::date;
  select * into v_rule from attendance_rule_for(auth.uid());
  if attendance_enabled(v_slot.company_id, v_date) and coalesce(v_rule.mode, 'off') <> 'off' then
    v_late := attendance_lateness(now(), (v_slot.start_at at time zone v_tz)::time, v_rule.grace, v_tz);
    insert into attendance as a (company_id, user_id, a_date, check_in_at, check_in_lat, check_in_lng,
                                 status, late_minutes, source, slot_id)
      values (v_slot.company_id, auth.uid(), v_date, now(), p_lat, p_lng,
              case when v_late > 0 then 'late' else 'present' end, v_late, 'shoot', p_slot)
    on conflict (company_id, user_id, a_date) do update
      set check_in_at = excluded.check_in_at, check_in_lat = excluded.check_in_lat, check_in_lng = excluded.check_in_lng,
          status = excluded.status, late_minutes = excluded.late_minutes, source = 'shoot', slot_id = excluded.slot_id
      where a.check_in_at is null;
  end if;
  return now();
end;
$$;
revoke all on function mark_arrived(uuid, double precision, double precision) from public, anon;
grant execute on function mark_arrived(uuid, double precision, double precision) to authenticated;

-- ── a correction: 0177, late against the person's own rule ───────────
create or replace function decide_attendance_correction(p_id uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r    attendance_corrections;
  v_rule record;
  v_late int := 0;
begin
  if not (is_current_user_active() and is_current_admin_or_manager()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_r from attendance_corrections where id = p_id and company_id = get_current_company_id();
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if v_r.status <> 'pending' then
    raise exception 'this request was already decided' using errcode = '22023';
  end if;
  if v_r.user_id = auth.uid() and not is_current_owner() then
    raise exception 'someone else has to approve your own correction' using errcode = '42501';
  end if;

  update attendance_corrections
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '')
   where id = p_id;

  if p_approve then
    select * into v_rule from attendance_rule_for(v_r.user_id);
    v_late := attendance_lateness(v_r.check_in_at, v_rule.expected, v_rule.grace, coalesce(v_rule.tz, 'Asia/Kolkata'));
    insert into attendance (company_id, user_id, a_date, status, check_in_at, check_out_at,
                            corrected_by, correction_note, late_minutes)
      values (v_r.company_id, v_r.user_id, v_r.a_date, case when v_late > 0 then 'late' else 'present' end,
              v_r.check_in_at, v_r.check_out_at, auth.uid(), 'Asked by the member: ' || v_r.reason, v_late)
    on conflict (company_id, user_id, a_date) do update
      set status = excluded.status, check_in_at = excluded.check_in_at, check_out_at = excluded.check_out_at,
          corrected_by = excluded.corrected_by, correction_note = excluded.correction_note,
          late_minutes = excluded.late_minutes;
  end if;

  perform create_notification(
    v_r.company_id, v_r.user_id, 'attendance.correction_decided',
    case when p_approve then 'Attendance fixed for ' else 'Attendance not changed for ' end || to_char(v_r.a_date, 'DD Mon'),
    nullif(btrim(p_note), ''), 'attendance_correction_decided:' || p_id, 'attendance', p_id,
    case when p_approve then 'info' else 'warning' end, '/attendance/my');
end;
$$;
revoke all on function decide_attendance_correction(uuid, boolean, text) from public, anon;
grant execute on function decide_attendance_correction(uuid, boolean, text) to authenticated;

-- ── a manual fix: 0035, which may now say half day ──────────────────
create or replace function set_attendance_manual(
  p_user_id      uuid,
  p_date         date,
  p_status       text,
  p_check_in_at  timestamptz default null,
  p_check_out_at timestamptz default null,
  p_note         text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_id uuid;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not (is_current_owner() or current_app_role() = 'admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_status not in ('present', 'late', 'half_day', 'absent') then
    raise exception 'unknown status' using errcode = '22023';
  end if;
  if p_check_in_at is not null and p_check_out_at is not null and p_check_out_at < p_check_in_at then
    raise exception 'check-out before check-in' using errcode = '22023';
  end if;
  if not exists (select 1 from users where user_id = p_user_id and company_id = v_company and deleted_at is null) then
    raise exception 'unknown_member' using errcode = 'P0001';
  end if;

  insert into attendance (company_id, user_id, a_date, status, check_in_at, check_out_at, corrected_by, correction_note)
  values (v_company, p_user_id, p_date, p_status, p_check_in_at, p_check_out_at, auth.uid(), p_note)
  on conflict (company_id, user_id, a_date) do update
    set status = excluded.status,
        check_in_at = excluded.check_in_at,
        check_out_at = excluded.check_out_at,
        corrected_by = excluded.corrected_by,
        correction_note = excluded.correction_note
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function set_attendance_manual(uuid, date, text, timestamptz, timestamptz, text) from public, anon;
grant execute on function set_attendance_manual(uuid, date, text, timestamptz, timestamptz, text) to authenticated;

-- ── payroll: 0187, counting only tracked days ───────────────────────
create or replace function payroll_generate(p_company uuid, p_year int, p_month int, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run    payroll_runs;
  v_first  date;
  v_last   date;
  v_days   int;
  v_work   int;
  v_people uuid[];
  v_tz     text := attendance_tz(p_company);
  v_marks  int := coalesce((select late_marks_per_half_day from attendance_policy where company_id = p_company), 0);
begin
  if p_month not between 1 and 12 or p_year not between 2000 and 2100 then
    raise exception 'pick a month' using errcode = '22023';
  end if;
  v_first := make_date(p_year, p_month, 1);
  v_last := (v_first + interval '1 month - 1 day')::date;
  v_days := v_last - v_first + 1;
  if v_first > (now() at time zone 'Asia/Kolkata')::date + 31 then
    raise exception 'that month is too far ahead' using errcode = '22023';
  end if;

  select * into v_run from payroll_runs
   where company_id = p_company and pay_year = p_year and pay_month = p_month
   for update;
  if found and v_run.status <> 'draft' then
    raise exception 'this month is approved and locked' using errcode = '22023';
  end if;
  if not found then
    insert into payroll_runs (company_id, pay_year, pay_month, created_by)
      values (p_company, p_year, p_month, p_actor)
      returning * into v_run;
  end if;

  select count(*)::int into v_work
    from generate_series(v_first, v_last, interval '1 day') g(d)
   where day_off(p_company, g.d::date) is null;

  -- Who is paid monthly: in-house, with a salary (or a stipend), and with the
  -- studio for at least one day of the month. Active members; and anyone
  -- removed or with a pay end date, for the months up to when they left.
  v_people := array(
    select u.user_id from users u
     cross join lateral payroll_member_window(u.user_id, v_first, v_last) w
     where u.company_id = p_company
       and ((u.deleted_at is null and coalesce(u.status, 'active') = 'active') or w.left_on is not null)
       and u.role <> 'super_admin'
       and coalesce(u.engagement_type, 'in_house') <> 'freelancer'
       and (coalesce(u.salary, 0) > 0 or coalesce(u.stipend_amount, 0) > 0)
       and w.win_start <= w.win_end);

  -- Someone who is no longer paid this month leaves the draft.
  delete from payroll_lines
   where run_id = v_run.id and not (user_id = any (v_people));

  insert into payroll_lines as l (run_id, company_id, user_id, pay_year, pay_month, base_amount, working_days,
                                  period_start, period_end, payable_days, prorated_base,
                                  days_present, unpaid_leave_days, absent_days, late_marks, half_days,
                                  late_penalty_days, deduction, net_pay)
  with work as (
    select g.d::date as d
      from generate_series(v_first, v_last, interval '1 day') g(d)
     where day_off(p_company, g.d::date) is null
  ), people as (
    select u.user_id, case when coalesce(u.salary, 0) > 0 then u.salary else u.stipend_amount end as base,
           w.win_start, w.win_end,
           (select count(*)::int from work where work.d between w.win_start and w.win_end) as payable
      from users u
     cross join lateral payroll_member_window(u.user_id, v_first, v_last) w
     where u.user_id = any (v_people)
  ), att as (
    -- 0224: only days the studio was tracking, and never a shoot day.
    select a.user_id,
           count(*) filter (where a.status in ('present', 'late'))::int as present,
           count(*) filter (where a.status = 'late')::int as late,
           count(*) filter (where a.status = 'half_day' and not on_leave(a.user_id, a.a_date))::int as half,
           count(*) filter (where a.status = 'absent' and not on_leave(a.user_id, a.a_date)
                              and not booked_on_shoot(a.user_id, a.a_date, v_tz))::int as absent
      from attendance a
      join people p on p.user_id = a.user_id and a.a_date between p.win_start and p.win_end
     where a.company_id = p_company
       and day_off(p_company, a.a_date) is null
       and attendance_enabled(p_company, a.a_date)
     group by a.user_id
  ), unpaid as (
    select lr.user_id, sum(case when lr.half_day then 0.5 else 1 end) as days
      from leave_requests lr
      join people p on p.user_id = lr.user_id
      join work on work.d between lr.start_date and lr.end_date and work.d between p.win_start and p.win_end
     where lr.company_id = p_company and lr.status = 'approved' and lr.kind = 'unpaid'
     group by lr.user_id
  ), facts as (
    select p.user_id, p.base, p.win_start, p.win_end, p.payable,
           coalesce(att.present, 0) as present, coalesce(att.late, 0) as late,
           coalesce(att.half, 0) as half, coalesce(att.absent, 0) as absent, coalesce(unpaid.days, 0) as unpaid,
           case when v_marks > 0 then floor(coalesce(att.late, 0)::numeric / v_marks) * 0.5 else 0 end as late_pen
      from people p
      left join att on att.user_id = p.user_id
      left join unpaid on unpaid.user_id = p.user_id
  )
  select v_run.id, p_company, f.user_id, p_year, p_month, f.base, v_work,
         f.win_start, f.win_end, f.payable, pr.base,
         f.present, f.unpaid, f.absent, f.late, f.half * 0.5, f.late_pen,
         d.ded, payroll_net(pr.base, d.ded, 0, 0)
    from facts f
    cross join lateral (
      select payroll_prorate(f.base, f.payable, v_work, f.win_end - f.win_start + 1, v_days) as base
    ) pr
    cross join lateral (
      select case when v_work > 0 and f.base > 0
                  then least(pr.base, round(f.base * (f.unpaid + f.absent + f.half * 0.5 + f.late_pen) / v_work))
                  else 0 end as ded
    ) d
  on conflict (run_id, user_id) do update
     set base_amount = excluded.base_amount,
         working_days = excluded.working_days,
         period_start = excluded.period_start,
         period_end = excluded.period_end,
         payable_days = excluded.payable_days,
         prorated_base = excluded.prorated_base,
         days_present = excluded.days_present,
         unpaid_leave_days = excluded.unpaid_leave_days,
         absent_days = excluded.absent_days,
         late_marks = excluded.late_marks,
         half_days = excluded.half_days,
         late_penalty_days = excluded.late_penalty_days,
         deduction = excluded.deduction,
         net_pay = payroll_net(excluded.prorated_base, excluded.deduction, l.additions, l.other_deductions),
         updated_at = now();

  update payroll_runs set generated_at = now() where id = v_run.id;
  perform payroll_refresh_totals(v_run.id);
  return v_run.id;
end;
$$;
revoke all on function payroll_generate(uuid, int, int, uuid) from public, anon, authenticated;
grant execute on function payroll_generate(uuid, int, int, uuid) to service_role;

-- ── reminders in the app ─────────────────────────────────────────
-- Run every few minutes by the cron; each note goes once a day at most
-- (create_notification dedupes on the key).
create or replace function run_attendance_reminders(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pol    attendance_policy;
  v_tz     text;
  v_local  timestamp;
  v_date   date;
  v_u      record;
  v_in     int := 0;
  v_out    int := 0;
  v_owner  int := 0;
  v_names  text[];
  v_admin  record;
begin
  for v_pol in select * from attendance_policy where enabled and enabled_at is not null loop
    v_tz := attendance_tz(v_pol.company_id);
    v_local := p_now at time zone v_tz;
    v_date := v_local::date;
    if v_date < (v_pol.enabled_at at time zone v_tz)::date or day_off(v_pol.company_id, v_date) is not null then
      continue;
    end if;
    v_names := '{}';

    for v_u in
      select u.user_id, u.name, r.expected, r.grace, a.check_in_at, a.check_out_at
        from users u
        cross join lateral attendance_rule_for(u.user_id) r
        left join attendance a on a.user_id = u.user_id and a.company_id = u.company_id and a.a_date = v_date
       where u.company_id = v_pol.company_id and u.deleted_at is null and u.status = 'active'
         and u.role <> 'super_admin' and coalesce(u.login_enabled, true)
         and r.mode <> 'off'
         and not on_leave(u.user_id, v_date)
         and not booked_on_shoot(u.user_id, v_date, v_tz)
    loop
      if v_u.check_in_at is null and v_u.expected is not null
         and v_local::time >= v_u.expected + make_interval(mins => coalesce(v_u.grace, 0)) then
        v_names := v_names || v_u.name;
        if create_notification(v_pol.company_id, v_u.user_id, 'attendance.check_in',
             'You haven''t checked in yet', 'Open the app at work and tap Check in.',
             'attendance_check_in:' || v_date, 'attendance', null, 'warning', '/attendance/my') then
          v_in := v_in + 1;
        end if;
      elsif v_u.check_in_at is not null and v_u.check_out_at is null and v_pol.day_end is not null
         and v_pol.day_end < time '23:30'
         and v_local::time >= v_pol.day_end + interval '30 minutes' then
        if create_notification(v_pol.company_id, v_u.user_id, 'attendance.check_out',
             'Don''t forget to check out', 'Tap Check out before you leave.',
             'attendance_check_out:' || v_date, 'attendance', null, 'info', '/attendance/my') then
          v_out := v_out + 1;
        end if;
      end if;
    end loop;

    if cardinality(v_names) > 0 then
      for v_admin in
        select u.user_id from users u
         where u.company_id = v_pol.company_id and u.deleted_at is null and u.status = 'active'
           and u.role in ('super_admin', 'admin')
      loop
        if create_notification(v_pol.company_id, v_admin.user_id, 'attendance.not_in',
             cardinality(v_names) || ' not in yet: ' || array_to_string(v_names[1:3], ', ')
               || case when cardinality(v_names) > 3 then ' and ' || (cardinality(v_names) - 3) || ' more' else '' end,
             null, 'attendance_not_in:' || v_date, 'attendance', null, 'info', '/attendance') then
          v_owner := v_owner + 1;
        end if;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('check_in', v_in, 'check_out', v_out, 'owners', v_owner);
end;
$$;
revoke all on function run_attendance_reminders(timestamptz) from public, anon, authenticated;
grant execute on function run_attendance_reminders(timestamptz) to service_role;

-- ── selfies are kept 60 days ─────────────────────────────────────
create or replace function purge_attendance_selfies(p_days int default 60)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(a.selfie_file_id), '{}') into v_ids
    from attendance a
   where a.selfie_file_id is not null
     and coalesce(a.check_in_at, a.created_at) < now() - make_interval(days => greatest(p_days, 1));
  update attendance set selfie_file_id = null where selfie_file_id = any (v_ids);
  delete from files where id = any (v_ids);
  return cardinality(v_ids);
end;
$$;
revoke all on function purge_attendance_selfies(int) from public, anon, authenticated;
grant execute on function purge_attendance_selfies(int) to service_role;

-- ── backfill: studios already tracking stay on ───────────────────
-- On from their first real check-in (or now, if nobody has checked in yet),
-- with the start and grace they already had. No selfie, so the automatic
-- marking they are used to carries on unchanged.
insert into attendance_policy as p (company_id, enabled, enabled_at, day_start, grace_min, updated_at)
select c.id, true,
       coalesce((select min(a.check_in_at) from attendance a where a.company_id = c.id and a.check_in_at is not null), now()),
       l.expected_checkin_time, coalesce(l.late_grace_minutes, 15), now()
  from companies c
  left join company_location l on l.company_id = c.id
 where attendance_configured(c.id)
on conflict (company_id) do update
  set enabled = true,
      enabled_at = coalesce(p.enabled_at, excluded.enabled_at),
      day_start = coalesce(p.day_start, excluded.day_start),
      grace_min = excluded.grace_min,
      updated_at = now();

-- Absences the sweep wrote before a studio was tracking are not absences.
delete from attendance a
 where a.status = 'absent'
   and a.check_in_at is null
   and a.corrected_by is null
   and not attendance_enabled(a.company_id, a.a_date);

-- The switch replaces 0223's guess at whether a studio tracks attendance.
drop function if exists attendance_configured(uuid);
