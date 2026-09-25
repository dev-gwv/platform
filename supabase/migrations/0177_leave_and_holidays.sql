-- Leave, holidays, weekly off-days, and "I forgot to check in" requests.
--
--   * leave_requests: a team member asks for days off; an owner, admin or
--     manager approves or turns it down. Both sides are told.
--   * company_holidays and attendance_policy.weekly_off: days nobody is
--     expected in. The nightly absent sweep skips them, and skips anyone on
--     approved leave -- until now a holiday marked the whole team absent.
--   * attendance_corrections: a member asks to fix a day (forgot to tap in,
--     phone died); once approved it is written to attendance like a manual
--     correction, lateness worked out from the studio's start of day.
--
-- Every write goes through a function that checks who is asking; the tables
-- themselves are read-only to the app (RLS), so a member can never approve
-- their own leave by writing the row.

-- ── weekly off-days ──────────────────────────────────────────────
create table if not exists attendance_policy (
  company_id  uuid primary key references companies (id) on delete cascade,
  -- 0 = Sunday … 6 = Saturday.
  weekly_off  smallint[] not null default '{}'
                check (weekly_off <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  updated_at  timestamptz not null default now()
);
alter table attendance_policy enable row level security;
drop policy if exists attendance_policy_select on attendance_policy;
create policy attendance_policy_select on attendance_policy
  for select to authenticated using (company_id = get_current_company_id());
grant select on attendance_policy to authenticated;

create or replace function set_weekly_off(p_days smallint[])
returns smallint[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days smallint[];
begin
  if not (is_current_user_active() and is_current_admin_or_manager()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct d order by d), '{}') into v_days from unnest(coalesce(p_days, '{}')) d;
  insert into attendance_policy (company_id, weekly_off, updated_at)
    values (get_current_company_id(), v_days, now())
  on conflict (company_id) do update set weekly_off = excluded.weekly_off, updated_at = now();
  return v_days;
end;
$$;
revoke all on function set_weekly_off(smallint[]) from public, anon;
grant execute on function set_weekly_off(smallint[]) to authenticated;

-- ── holidays ─────────────────────────────────────────────────────
create table if not exists company_holidays (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies (id) on delete cascade,
  holiday_date date not null,
  name         text not null check (length(btrim(name)) between 1 and 80),
  created_at   timestamptz not null default now(),
  unique (company_id, holiday_date)
);
alter table company_holidays enable row level security;
drop policy if exists company_holidays_select on company_holidays;
drop policy if exists company_holidays_write on company_holidays;
create policy company_holidays_select on company_holidays
  for select to authenticated using (company_id = get_current_company_id());
create policy company_holidays_write on company_holidays
  for all to authenticated
  using (company_id = get_current_company_id() and is_current_admin_or_manager())
  with check (company_id = get_current_company_id() and is_current_admin_or_manager());
grant select, insert, update, delete on company_holidays to authenticated;

-- Why nobody is expected in on a day: the holiday's name, 'Weekly off', or null.
create or replace function day_off(p_company uuid, p_date date)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select name from company_holidays where company_id = p_company and holiday_date = p_date),
    (select 'Weekly off' from attendance_policy
      where company_id = p_company and extract(dow from p_date)::smallint = any (weekly_off))
  )
$$;
revoke all on function day_off(uuid, date) from public, anon;
grant execute on function day_off(uuid, date) to authenticated, service_role;

-- ── leave ────────────────────────────────────────────────────────
create table if not exists leave_requests (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies (id) on delete cascade,
  user_id       uuid not null references users (user_id) on delete cascade,
  kind          text not null default 'casual' check (kind in ('casual', 'sick', 'paid', 'unpaid', 'other')),
  start_date    date not null,
  end_date      date not null,
  half_day      boolean not null default false,
  reason        text check (reason is null or length(reason) <= 500),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by    uuid references users (user_id) on delete set null,
  decided_at    timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  created_at    timestamptz not null default now(),
  check (end_date >= start_date),
  check (not half_day or start_date = end_date),
  check (end_date - start_date <= 60)
);
create index if not exists leave_requests_user_idx on leave_requests (company_id, user_id, start_date);
create index if not exists leave_requests_status_idx on leave_requests (company_id, status);
alter table leave_requests enable row level security;
drop policy if exists leave_requests_select on leave_requests;
create policy leave_requests_select on leave_requests
  for select to authenticated
  using (company_id = get_current_company_id() and (user_id = auth.uid() or is_current_admin_or_manager()));
grant select on leave_requests to authenticated;

-- Approved leave covering a day (a half day counts: the sweep must not mark it absent).
create or replace function on_leave(p_user uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from leave_requests
     where user_id = p_user and status = 'approved' and p_date between start_date and end_date)
$$;
revoke all on function on_leave(uuid, date) from public, anon;
grant execute on function on_leave(uuid, date) to authenticated, service_role;

create or replace function request_leave(
  p_kind text, p_start date, p_end date, p_half_day boolean, p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_me      uuid := auth.uid();
  v_id      uuid;
  v_name    text;
  v_when    text;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_end < p_start then
    raise exception 'the leave ends before it starts' using errcode = '22023';
  end if;
  if p_start < (now() at time zone 'Asia/Kolkata')::date - 30 then
    raise exception 'leave can be asked for up to 30 days back' using errcode = '22023';
  end if;
  if exists (
    select 1 from leave_requests
     where user_id = v_me and status in ('pending', 'approved')
       and daterange(start_date, end_date, '[]') && daterange(p_start, p_end, '[]')
  ) then
    raise exception 'you already have leave on some of these days' using errcode = '22023';
  end if;

  insert into leave_requests (company_id, user_id, kind, start_date, end_date, half_day, reason)
    values (v_company, v_me, coalesce(p_kind, 'casual'), p_start, p_end, coalesce(p_half_day, false), nullif(btrim(p_reason), ''))
    returning id into v_id;

  select name into v_name from users where user_id = v_me;
  v_when := to_char(p_start, 'DD Mon') || case when p_end > p_start then ' – ' || to_char(p_end, 'DD Mon') else '' end
            || case when coalesce(p_half_day, false) then ' (half day)' else '' end;
  perform create_notification(
    v_company, r, 'leave.requested', coalesce(v_name, 'Someone') || ' asked for leave',
    v_when || coalesce(' · ' || nullif(btrim(p_reason), ''), ''),
    'leave_requested:' || v_id, 'leave', v_id, 'info', '/leave?tab=approvals')
  from notification_admin_recipients(v_company) r
  where r <> v_me;
  return v_id;
end;
$$;
revoke all on function request_leave(text, date, date, boolean, text) from public, anon;
grant execute on function request_leave(text, date, date, boolean, text) to authenticated;

create or replace function decide_leave(p_id uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r leave_requests;
begin
  if not (is_current_user_active() and is_current_admin_or_manager()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_r from leave_requests where id = p_id and company_id = get_current_company_id();
  if not found then
    raise exception 'leave request not found' using errcode = 'P0002';
  end if;
  if v_r.status <> 'pending' then
    raise exception 'this request was already decided' using errcode = '22023';
  end if;
  if v_r.user_id = auth.uid() and not is_current_owner() then
    raise exception 'someone else has to decide your own leave' using errcode = '42501';
  end if;
  if not p_approve and nullif(btrim(p_note), '') is null then
    raise exception 'say why, so they can plan' using errcode = '22023';
  end if;

  update leave_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '')
   where id = p_id;

  -- A day the sweep already marked absent is leave now, not an absence.
  if p_approve then
    delete from attendance
     where company_id = v_r.company_id and user_id = v_r.user_id
       and a_date between v_r.start_date and v_r.end_date
       and status = 'absent' and check_in_at is null;
  end if;

  perform create_notification(
    v_r.company_id, v_r.user_id, 'leave.decided',
    case when p_approve then 'Leave approved' else 'Leave not approved' end,
    to_char(v_r.start_date, 'DD Mon') || case when v_r.end_date > v_r.start_date then ' – ' || to_char(v_r.end_date, 'DD Mon') else '' end
      || coalesce(' · ' || nullif(btrim(p_note), ''), ''),
    'leave_decided:' || p_id, 'leave', p_id,
    case when p_approve then 'info' else 'warning' end, '/leave');
end;
$$;
revoke all on function decide_leave(uuid, boolean, text) from public, anon;
grant execute on function decide_leave(uuid, boolean, text) to authenticated;

-- The person who asked may take it back: while pending, or before it starts.
create or replace function cancel_leave(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update leave_requests set status = 'cancelled'
   where id = p_id and user_id = auth.uid()
     and (status = 'pending' or (status = 'approved' and start_date > (now() at time zone 'Asia/Kolkata')::date));
  if not found then
    raise exception 'that leave cannot be cancelled now' using errcode = '22023';
  end if;
end;
$$;
revoke all on function cancel_leave(uuid) from public, anon;
grant execute on function cancel_leave(uuid) to authenticated;

-- ── "I forgot to check in" ───────────────────────────────────────
create table if not exists attendance_corrections (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies (id) on delete cascade,
  user_id       uuid not null references users (user_id) on delete cascade,
  a_date        date not null,
  check_in_at   timestamptz not null,
  check_out_at  timestamptz,
  reason        text not null check (length(btrim(reason)) between 3 and 500),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by    uuid references users (user_id) on delete set null,
  decided_at    timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  created_at    timestamptz not null default now(),
  check (check_out_at is null or check_out_at > check_in_at)
);
create unique index if not exists attendance_corrections_one_pending
  on attendance_corrections (user_id, a_date) where status = 'pending';
create index if not exists attendance_corrections_status_idx on attendance_corrections (company_id, status);
alter table attendance_corrections enable row level security;
drop policy if exists attendance_corrections_select on attendance_corrections;
create policy attendance_corrections_select on attendance_corrections
  for select to authenticated
  using (company_id = get_current_company_id() and (user_id = auth.uid() or is_current_admin_or_manager()));
grant select on attendance_corrections to authenticated;

create or replace function request_attendance_correction(
  p_date date, p_check_in timestamptz, p_check_out timestamptz, p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_me      uuid := auth.uid();
  v_today   date := (now() at time zone 'Asia/Kolkata')::date;
  v_id      uuid;
  v_name    text;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_date > v_today or p_date < v_today - 31 then
    raise exception 'pick a day in the last month' using errcode = '22023';
  end if;
  if p_check_out is not null and p_check_out <= p_check_in then
    raise exception 'check-out must be after check-in' using errcode = '22023';
  end if;
  if exists (select 1 from attendance_corrections where user_id = v_me and a_date = p_date and status = 'pending') then
    raise exception 'you already asked to fix this day' using errcode = '22023';
  end if;

  insert into attendance_corrections (company_id, user_id, a_date, check_in_at, check_out_at, reason)
    values (v_company, v_me, p_date, p_check_in, p_check_out, btrim(p_reason))
    returning id into v_id;

  select name into v_name from users where user_id = v_me;
  perform create_notification(
    v_company, r, 'attendance.correction', coalesce(v_name, 'Someone') || ' asked to fix ' || to_char(p_date, 'DD Mon'),
    btrim(p_reason), 'attendance_correction:' || v_id, 'attendance', v_id, 'info', '/leave?tab=approvals')
  from notification_admin_recipients(v_company) r
  where r <> v_me;
  return v_id;
end;
$$;
revoke all on function request_attendance_correction(date, timestamptz, timestamptz, text) from public, anon;
grant execute on function request_attendance_correction(date, timestamptz, timestamptz, text) to authenticated;

create or replace function decide_attendance_correction(p_id uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r    attendance_corrections;
  v_loc  company_location;
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
    select * into v_loc from company_location where company_id = v_r.company_id;
    if found then
      v_late := attendance_lateness(v_r.check_in_at, v_loc.expected_checkin_time, v_loc.late_grace_minutes, v_loc.timezone);
    end if;
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
    case when p_approve then 'info' else 'warning' end, '/attendance');
end;
$$;
revoke all on function decide_attendance_correction(uuid, boolean, text) from public, anon;
grant execute on function decide_attendance_correction(uuid, boolean, text) to authenticated;

-- ── the nightly sweep respects all of it ─────────────────────────
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
