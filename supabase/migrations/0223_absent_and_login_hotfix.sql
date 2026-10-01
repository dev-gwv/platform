-- 0223: no absences for studios that never set attendance up, none on shoot
-- days, and the rows that should never have been written.
--
-- mark_absent_backstop() ran every night for every studio. A studio that had
-- never chosen a place, a rule or a working day still had its in-house team
-- marked absent on every day nobody happened to open the app -- and payroll
-- (0187) deducts a day's pay per absent row. A photographer on a wedding,
-- tapping "I've reached" at the venue instead of opening the app at the
-- studio, was marked absent too.
--
-- So:
--   * attendance_configured(company): a studio tracks attendance once it has
--     a location, an active place or a rule. Until then nothing is marked.
--   * the sweep skips a day someone was booked on a shoot.
--   * the absent rows the sweep wrote for either reason are removed. A row
--     someone corrected by hand, or checked in on, is never touched. Payroll
--     runs already approved or paid are left as they are (they cannot be
--     reopened); a draft recounts on its next Generate.

create or replace function attendance_configured(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from company_location where company_id = p_company)
      or exists (select 1 from attendance_places where company_id = p_company and is_active)
      or exists (select 1 from attendance_rules where company_id = p_company)
$$;
revoke all on function attendance_configured(uuid) from public, anon;
grant execute on function attendance_configured(uuid) to authenticated, service_role;

-- Booked on a shoot for any part of that local day.
create or replace function booked_on_shoot(p_user uuid, p_date date, p_tz text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from team_assignment_slots t
     where t.user_id = p_user
       and t.status = 'booked'
       and t.shoot_id is not null
       and t.start_at < ((p_date + 1)::timestamp at time zone p_tz)
       and t.end_at > (p_date::timestamp at time zone p_tz)
  )
$$;
revoke all on function booked_on_shoot(uuid, date, text) from public, anon;
grant execute on function booked_on_shoot(uuid, date, text) to authenticated, service_role;

-- ── the absent sweep: the 0206 body, for studios that track, off shoot days ──
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
    -- 0223: a studio that never set attendance up is not tracking anyone.
    if not attendance_configured(v_company.id) then
      continue;
    end if;
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

-- ── the rows that should not exist ───────────────────────────────
-- Only what the sweep itself wrote: absent, never checked in, never corrected.
delete from attendance a
 where a.status = 'absent'
   and a.check_in_at is null
   and a.corrected_by is null
   and (
     not attendance_configured(a.company_id)
     or booked_on_shoot(
          a.user_id, a.a_date,
          coalesce((select l.timezone from company_location l where l.company_id = a.company_id), 'Asia/Kolkata'))
   );
