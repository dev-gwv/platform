-- 0225: "I've reached" measures lateness from the booking's real start.
--
-- 0224's mark_arrived compared clock times on the arrival day:
-- attendance_lateness(now(), start_at::time, ...). A shoot that starts at
-- 11:40 PM and is reached at 12:10 AM came out 23½ hours early -- "present".
-- CI caught it by running across IST midnight. The body below is 0224's,
-- copied whole; only the v_late line changes: minutes since start_at, late
-- once past the grace, measured from the start (as attendance_lateness does).

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
    v_late := ceil(extract(epoch from now() - v_slot.start_at) / 60);
    v_late := case when v_late > greatest(coalesce(v_rule.grace, 0), 0) then v_late else 0 end;
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
