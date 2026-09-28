-- 0208: a scorecard for every member.
--
-- The owner asked to track each person's performance and deliveries. Nothing
-- measured a person: on-time delivery existed only for the whole studio
-- (report_delivery, 0189), and the member page listed work without saying
-- how it went. member_scorecard() answers four questions for a person and a
-- period, each from records the app already keeps:
--
--   Work on time      deliverables and tasks finished by their due date
--   Right first time  work approved without being sent back
--   On time at shoots "I've reached" within 15 minutes of the call time (0207)
--   Attendance        days present, late counting half (0206), in-house only
--
-- and a score out of 100 from fixed, stated weights: 40, 20, 20, 20. A part
-- with nothing to measure (a freelancer's attendance, a month with no shoots)
-- is left out and the rest are scaled up, so nobody is marked down for work
-- they were never given. An empty period is null, not zero.
--
-- Arrival is only measured on shoots after this migration: before 0207 there
-- was no way to say "I've reached", and every old shoot would read as missed.

do $$
begin
  execute format($f$
    create or replace function scorecard_since() returns timestamptz
    language sql immutable as $b$ select %L::timestamptz $b$
  $f$, now());
end;
$$;

create or replace function member_scorecard_raw(p_company uuid, p_user uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from   timestamptz := p_from::timestamp at time zone 'Asia/Kolkata';
  v_to     timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Kolkata';
  v_today  date := (now() at time zone 'Asia/Kolkata')::date;
  v_inhouse boolean;
  v_tracked boolean;
  d record; t record; q record; s record; a record;
  v_late   jsonb;
  p_work numeric; p_quality numeric; p_shoots numeric; p_att numeric;
  v_score  numeric;
  v_weight numeric;
begin
  select coalesce(u.engagement_type, 'in_house') = 'in_house' into v_inhouse from users u where u.user_id = p_user;
  v_tracked := v_inhouse and coalesce((select r.mode from attendance_rule_for(p_user) r), 'required') <> 'off';

  -- Deliverables they finished in the period.
  select count(*)::int as delivered,
         count(*) filter (where d0.estimated_date is not null)::int as with_due,
         count(*) filter (where d0.estimated_date is not null and d0.done_on <= d0.estimated_date)::int as on_time,
         round(avg(d0.done_on - d0.estimated_date) filter (where d0.done_on > d0.estimated_date), 1) as avg_days_late
    into d
    from (select dd.estimated_date, (dd.delivered_at at time zone 'Asia/Kolkata')::date as done_on
            from deliverables dd
           where dd.company_id = p_company and dd.assignee_id = p_user
             and dd.status = 'completed' and dd.delivered_at >= v_from and dd.delivered_at < v_to) d0;

  -- Tasks they finished in the period.
  select count(*)::int as done,
         count(*) filter (where tk.due_date is not null)::int as with_due,
         count(*) filter (where tk.due_date is not null and (tk.completed_at at time zone 'Asia/Kolkata')::date <= tk.due_date)::int as on_time
    into t
    from tasks tk
    join task_assignees ta on ta.task_id = tk.id and ta.user_id = p_user
   where tk.company_id = p_company and tk.status = 'completed'
     and tk.completed_at >= v_from and tk.completed_at < v_to;

  -- Work approved in the period, and how much of it went back first.
  select count(*)::int as approved,
         count(*) filter (where x.sent_back)::int as sent_back
    into q
    from (select coalesce(w.deliverable_id, w.task_id) as item,
                 bool_or(w.status = 'rejected') as sent_back
            from team_work_submissions w
           where w.company_id = p_company and w.submitted_by = p_user
             and coalesce(w.deliverable_id, w.task_id) is not null
           group by 1
          having bool_or(w.status = 'approved' and w.reviewed_at >= v_from and w.reviewed_at < v_to)) x;

  -- Shoots that happened in the period.
  select count(*)::int as shoots,
         count(*) filter (where sl.start_at >= scorecard_since())::int as measured,
         count(*) filter (where sl.start_at >= scorecard_since() and sl.arrived_at is not null
                            and sl.arrived_at <= sl.start_at + interval '15 minutes')::int as on_time,
         count(*) filter (where sl.response = 'declined')::int as declined
    into s
    from team_assignment_slots sl
    left join shoots sh on sh.id = sl.shoot_id
   where sl.company_id = p_company and sl.user_id = p_user and sl.status = 'booked'
     and sl.start_at >= v_from and sl.start_at < v_to and sl.start_at < now()
     and coalesce(sh.status, 'planned') <> 'cancelled';

  -- Attendance: the days that had an expectation.
  select count(*) filter (where at.status = 'present')::int as present,
         count(*) filter (where at.status = 'late')::int as late,
         count(*) filter (where at.status = 'absent')::int as absent
    into a
    from attendance at
   where at.company_id = p_company and at.user_id = p_user and at.a_date between p_from and least(p_to, v_today);

  -- What is late right now, by name: the "what moves it" line.
  select coalesce(jsonb_agg(jsonb_build_object('title', x.title, 'project', x.project, 'days_late', x.days_late) order by x.days_late desc), '[]'::jsonb)
    into v_late
    from (select dd.title, p.name as project, v_today - dd.estimated_date as days_late
            from deliverables dd join projects p on p.id = dd.project_id
           where dd.company_id = p_company and dd.assignee_id = p_user
             and dd.status not in ('completed', 'cancelled') and dd.estimated_date < v_today
           order by dd.estimated_date limit 5) x;

  p_work    := case when d.with_due + t.with_due > 0 then (d.on_time + t.on_time)::numeric / (d.with_due + t.with_due) end;
  p_quality := case when q.approved > 0 then (q.approved - q.sent_back)::numeric / q.approved end;
  p_shoots  := case when s.measured > 0 then s.on_time::numeric / s.measured end;
  p_att     := case when v_tracked and a.present + a.late + a.absent > 0
                    then (a.present + a.late * 0.5) / (a.present + a.late + a.absent) end;

  v_weight := coalesce(case when p_work is not null then 40 end, 0) + coalesce(case when p_quality is not null then 20 end, 0)
            + coalesce(case when p_shoots is not null then 20 end, 0) + coalesce(case when p_att is not null then 20 end, 0);
  v_score := case when v_weight > 0 then round(
               (coalesce(p_work * 40, 0) + coalesce(p_quality * 20, 0) + coalesce(p_shoots * 20, 0) + coalesce(p_att * 20, 0)) * 100 / v_weight) end;

  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'score', v_score,
    'work', jsonb_build_object('deliverables', d.delivered, 'tasks', t.done,
                               'with_due', d.with_due + t.with_due, 'on_time', d.on_time + t.on_time,
                               'avg_days_late', d.avg_days_late, 'pct', round(p_work * 100)),
    'quality', jsonb_build_object('approved', q.approved, 'sent_back', q.sent_back, 'pct', round(p_quality * 100)),
    'shoots', jsonb_build_object('shoots', s.shoots, 'measured', s.measured, 'on_time', s.on_time,
                                 'declined', s.declined, 'pct', round(p_shoots * 100)),
    'attendance', case when v_tracked then jsonb_build_object('present', a.present, 'late', a.late, 'absent', a.absent,
                                                               'pct', round(p_att * 100)) end,
    'late_now', v_late);
end;
$$;
revoke all on function member_scorecard_raw(uuid, uuid, date, date) from public, anon, authenticated;
grant execute on function member_scorecard_raw(uuid, uuid, date, date) to service_role;

-- Yours, or anyone's in your studio if you run it.
create or replace function member_scorecard(p_user uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_company uuid := get_current_company_id();
begin
  if not exists (select 1 from users p where p.user_id = p_user and p.company_id = v_company)
     or (v_me is distinct from p_user and not exists (
           select 1 from users me where me.user_id = v_me and me.company_id = v_company
              and me.role in ('super_admin', 'admin', 'manager'))) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return member_scorecard_raw(v_company, p_user, p_from, p_to);
end;
$$;
revoke all on function member_scorecard(uuid, date, date) from public, anon;
grant execute on function member_scorecard(uuid, date, date) to authenticated;

-- Everyone's, one row each, best first. Owners and managers.
create or replace function member_scorecard_team(p_from date, p_to date)
returns table (user_id uuid, name text, engagement_type text, card jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_company uuid := get_current_company_id();
begin
  if not exists (select 1 from users me where me.user_id = v_me and me.company_id = v_company
                    and me.role in ('super_admin', 'admin', 'manager')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select x.user_id, x.name, x.engagement_type, x.card
      from (select u.user_id, u.name, coalesce(u.engagement_type, 'in_house') as engagement_type,
                   member_scorecard_raw(v_company, u.user_id, p_from, p_to) as card
              from users u
             where u.company_id = v_company and u.deleted_at is null and u.status = 'active'
               and u.role <> 'super_admin') x
     order by (x.card->>'score')::numeric desc nulls last, x.name;
end;
$$;
revoke all on function member_scorecard_team(date, date) from public, anon;
grant execute on function member_scorecard_team(date, date) to authenticated;
