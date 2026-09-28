-- 0206: attendance marks itself, inside a radius set per position or person.
--
-- Until now a studio had one location and one radius for everybody
-- (company_location), and a person was marked present only by pressing Check
-- in on a page most employees could not open. The owner asked for three things:
--
--   * the moment someone opens the app inside the radius, they are marked;
--   * outside it they are NOT marked, and the app says how far away they are;
--   * the radius -- and where it is measured from -- can differ per position
--     ("Editors: anywhere", "Photographers: Studio, 150 m") and per person.
--
-- So a studio now has places (the studio itself plus any others: a second
-- office, an edit suite) and rules. A rule belongs to a position (an
-- employee_roles row) or to one person, and says: required at this place (or
-- at any place), with this radius; or anywhere; or not tracked at all. The
-- person's own rule wins, then their position's, then the studio default:
-- required at any active place for in-house staff, not tracked for freelancers
-- (they are tracked per shoot through their bookings).
--
-- company_location stays the studio's source of truth for its own spot, its
-- time zone and its working day; its spot is mirrored into a place called
-- "Studio" by trigger, so every existing screen and test keeps working.
--
-- check_in() gains a third, optional argument (p_auto) so the app can say the
-- mark was automatic. The refusal now carries the distance and the place:
-- "outside_fence: 1.2 km from Studio (allowed 150 m)". check_out() gains an
-- optional location. And a nightly sweep closes the shifts nobody checked out
-- of, marked as closed by the system rather than left open for ever.

-- ── places ─────────────────────────────────────────────────────
create table if not exists attendance_places (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  radius_m    int not null default 150 check (radius_m between 20 and 5000),
  is_active   boolean not null default true,
  -- The studio's own spot, kept in step with company_location. One per studio.
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists attendance_places_primary_uq on attendance_places (company_id) where is_primary;
create index if not exists attendance_places_company_idx on attendance_places (company_id, is_active);
alter table attendance_places enable row level security;
drop policy if exists attendance_places_select on attendance_places;
create policy attendance_places_select on attendance_places
  for select to authenticated using (company_id = get_current_company_id());
drop policy if exists attendance_places_write on attendance_places;
create policy attendance_places_write on attendance_places
  for all to authenticated
  using (company_id = get_current_company_id() and is_current_owner() and not is_primary)
  with check (company_id = get_current_company_id() and is_current_owner() and not is_primary);
grant select, insert, update, delete on attendance_places to authenticated;

-- The studio's spot follows company_location, whoever writes it.
create or replace function attendance_places_sync_primary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into attendance_places (company_id, name, lat, lng, radius_m, is_active, is_primary)
  values (new.company_id, 'Studio', new.lat, new.lng, greatest(least(new.radius_m, 5000), 20), new.is_active, true)
  on conflict (company_id) where is_primary do update
    set lat = excluded.lat, lng = excluded.lng, radius_m = excluded.radius_m,
        is_active = excluded.is_active, updated_at = now();
  return new;
end;
$$;
drop trigger if exists company_location_sync_place on company_location;
create trigger company_location_sync_place after insert or update on company_location
  for each row execute function attendance_places_sync_primary();

-- A studio that removes its location removes the fence with it.
create or replace function attendance_places_drop_primary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from attendance_places where company_id = old.company_id and is_primary;
  return old;
end;
$$;
drop trigger if exists company_location_drop_place on company_location;
create trigger company_location_drop_place after delete on company_location
  for each row execute function attendance_places_drop_primary();

insert into attendance_places (company_id, name, lat, lng, radius_m, is_active, is_primary)
select company_id, 'Studio', lat, lng, greatest(least(radius_m, 5000), 20), is_active, true
  from company_location
on conflict (company_id) where is_primary do nothing;

-- ── rules ──────────────────────────────────────────────────────
create table if not exists attendance_rules (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  scope       text not null check (scope in ('role', 'user')),
  role_id     uuid references employee_roles (id) on delete cascade,
  user_id     uuid references users (user_id) on delete cascade,
  -- required: inside a place's radius; anywhere: no fence; off: not tracked.
  mode        text not null default 'required' check (mode in ('required', 'anywhere', 'off')),
  -- Null: any active place.
  place_id    uuid references attendance_places (id) on delete set null,
  -- Null: the place's own radius.
  radius_m    int check (radius_m is null or radius_m between 20 and 5000),
  -- Null: the studio's working day (company_location).
  expected_checkin_time time,
  late_grace_minutes    int check (late_grace_minutes is null or late_grace_minutes between 0 and 240),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check ((scope = 'role' and role_id is not null and user_id is null)
      or (scope = 'user' and user_id is not null and role_id is null))
);
create unique index if not exists attendance_rules_role_uq on attendance_rules (company_id, role_id) where scope = 'role';
create unique index if not exists attendance_rules_user_uq on attendance_rules (company_id, user_id) where scope = 'user';
alter table attendance_rules enable row level security;
drop policy if exists attendance_rules_select on attendance_rules;
create policy attendance_rules_select on attendance_rules
  for select to authenticated using (company_id = get_current_company_id());
drop policy if exists attendance_rules_write on attendance_rules;
create policy attendance_rules_write on attendance_rules
  for all to authenticated
  using (company_id = get_current_company_id() and is_current_owner())
  with check (company_id = get_current_company_id() and is_current_owner());
grant select, insert, update, delete on attendance_rules to authenticated;

-- ── where the check-in and check-out were ─────────────────────
alter table attendance
  add column if not exists check_in_place_id   uuid references attendance_places (id) on delete set null,
  add column if not exists check_in_distance_m int,
  add column if not exists check_out_lat       double precision,
  add column if not exists check_out_lng       double precision,
  add column if not exists closed_by_system    boolean not null default false;

-- ── the one answer every check reads ──────────────────────────
-- Person's rule, then the first of their positions' rules, then the default.
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
begin
  select * into v_user from users where user_id = p_user;
  if not found then return; end if;
  select * into v_loc from company_location where company_id = v_user.company_id;

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
      v_loc.expected_checkin_time, coalesce(v_loc.late_grace_minutes, 15),
      coalesce(v_loc.timezone, 'Asia/Kolkata'),
      case when coalesce(v_user.engagement_type, 'in_house') = 'freelancer' then 'freelancer' else 'studio' end;
    return;
  end if;

  return query select
    v_rule.mode, v_rule.place_id,
    (select p.name from attendance_places p where p.id = v_rule.place_id),
    v_rule.radius_m,
    coalesce(v_rule.expected_checkin_time, v_loc.expected_checkin_time),
    coalesce(v_rule.late_grace_minutes, v_loc.late_grace_minutes, 15),
    coalesce(v_loc.timezone, 'Asia/Kolkata'),
    v_from;
end;
$$;
revoke all on function attendance_rule_for(uuid) from public, anon;
grant execute on function attendance_rule_for(uuid) to authenticated, service_role;

-- "420 m", "1.2 km".
create or replace function attendance_distance_text(p_m double precision)
returns text
language sql
immutable
as $$
  select case when p_m < 1000 then round(p_m)::int || ' m'
              else to_char(p_m / 1000.0, 'FM999990.0') || ' km' end
$$;

-- ── check in: the 0157 body, with the rule in front of it ──────
drop function if exists check_in(double precision, double precision);
create or replace function check_in(p_lat double precision, p_lng double precision, p_auto boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_me      uuid := auth.uid();
  v_rule    record;
  v_place   record;
  v_place_id uuid;
  v_dist    int;
  v_tz      text := 'Asia/Kolkata';
  v_date    date;
  v_id      uuid;
  v_late    int := 0;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_rule from attendance_rule_for(v_me);
  v_tz := coalesce(v_rule.tz, 'Asia/Kolkata');
  if v_rule.mode = 'off' then
    raise exception 'not_tracked: attendance is not tracked for you' using errcode = 'P0001';
  end if;

  if v_rule.mode = 'required' then
    -- The nearest active place, judged against its own radius (or the
    -- rule's). No active place at all means no fence, as it always has: a
    -- studio that switched its fence off can still check in from anywhere.
    select p.id, p.name, d.m as distance, coalesce(v_rule.radius_m, p.radius_m) as radius
      into v_place
      from attendance_places p
      cross join lateral (select geo_distance_m(p_lat, p_lng, p.lat, p.lng) as m) d
     where p.company_id = v_company and p.is_active
       and (v_rule.place_id is null or p.id = v_rule.place_id)
     order by d.m - coalesce(v_rule.radius_m, p.radius_m)
     limit 1;
    if found then
      if v_place.distance > v_place.radius then
        raise exception 'outside_fence: % from % (allowed % m)',
          attendance_distance_text(v_place.distance), v_place.name, v_place.radius
          using errcode = 'P0001';
      end if;
      v_place_id := v_place.id;
      v_dist := round(v_place.distance)::int;
    end if;
  end if;

  v_late := attendance_lateness(now(), v_rule.expected, v_rule.grace, v_tz);
  v_date := (now() at time zone v_tz)::date;

  insert into attendance (company_id, user_id, a_date, check_in_at, check_in_lat, check_in_lng,
                          status, late_minutes, source, check_in_place_id, check_in_distance_m)
    values (v_company, v_me, v_date, now(), p_lat, p_lng,
            case when v_late > 0 then 'late' else 'present' end, v_late,
            case when p_auto then 'auto_login' else 'manual' end,
            v_place_id, v_dist)
  on conflict (company_id, user_id, a_date)
    do update set check_in_at = coalesce(attendance.check_in_at, excluded.check_in_at),
                  check_in_lat = coalesce(attendance.check_in_lat, excluded.check_in_lat),
                  check_in_lng = coalesce(attendance.check_in_lng, excluded.check_in_lng),
                  check_in_place_id = coalesce(attendance.check_in_place_id, excluded.check_in_place_id),
                  check_in_distance_m = coalesce(attendance.check_in_distance_m, excluded.check_in_distance_m),
                  -- The arrival that counts is the one already recorded,
                  -- except over an 'absent' row the backstop wrote (0157).
                  status = case when attendance.status = 'absent' then excluded.status else attendance.status end,
                  late_minutes = case when attendance.status = 'absent' then excluded.late_minutes else attendance.late_minutes end,
                  source = case when attendance.check_in_at is null then excluded.source else attendance.source end
    returning id into v_id;
  return v_id;
end;
$$;
revoke all on function check_in(double precision, double precision, boolean) from public, anon;
grant execute on function check_in(double precision, double precision, boolean) to authenticated;

-- ── check out: the 0178 body, with where it happened ──────────
drop function if exists check_out();
create or replace function check_out(p_lat double precision default null, p_lng double precision default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_id      uuid;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  update attendance
     set check_out_at = now(), check_out_lat = p_lat, check_out_lng = p_lng
   where id = (
           select a.id
             from attendance a
            where a.company_id = v_company
              and a.user_id = auth.uid()
              and a.check_in_at is not null
              and a.check_out_at is null
              and a.check_in_at > now() - interval '20 hours'
            order by a.check_in_at desc
            limit 1
            for update)
  returning id into v_id;

  if v_id is null then
    raise exception 'no_open_check_in: nothing to check out of'
      using errcode = 'P0001';
  end if;

  return v_id;
end;
$$;
revoke all on function check_out(double precision, double precision) from public, anon;
grant execute on function check_out(double precision, double precision) to authenticated;

-- ── the shifts nobody closed ──────────────────────────────────
-- Past the 20 hours check_out() allows, a shift can no longer be closed by
-- its owner. Close it at the end of its own day, say so, and leave the hours
-- for a manager to correct if they matter.
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
     set check_out_at = ((a.a_date + time '23:59:59')::timestamp
                         at time zone coalesce(l.timezone, 'Asia/Kolkata')),
         closed_by_system = true
    from companies c
    left join company_location l on l.company_id = c.id
   where a.company_id = c.id
     and a.check_in_at is not null
     and a.check_out_at is null
     and a.check_in_at <= now() - interval '20 hours';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function auto_checkout_sweep() from public, anon, authenticated;
grant execute on function auto_checkout_sweep() to service_role;

-- ── the absent sweep: the 0177 body, skipping people not tracked ──
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
    select timezone into v_tz from company_location where company_id = v_company.id;
    v_tz := coalesce(v_tz, 'Asia/Kolkata');
    -- The day that has just ended where the studio is.
    v_date := ((now() at time zone v_tz) - interval '12 hours')::date;
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
revoke all on function mark_absent_backstop() from public, anon;
grant execute on function mark_absent_backstop() to service_role;
