-- Pro-rata salaries in the monthly payroll run (0185).
--
-- Someone who joins or leaves part-way through a month is paid for the part
-- they were with the studio:
--
--   window         = the days of the month between joining and leaving
--                    joined = users.pay_effective_from (the owner's pay start date),
--                             else member_profiles.joined_on (the member's own date);
--                             with neither, a full month -- never the day they were
--                             added to the app, which would underpay everyone a
--                             studio onboards mid-month
--                    left   = the earlier of users.pay_effective_to and the day
--                             they were removed (users.deleted_at, India time)
--   payable days   = working days of the month inside the window
--   pro-rated base = round(base × payable days ÷ working days)
--                    (the full base when every working day is inside the window)
--   deduction      = round(base ÷ working days × (unpaid leave + absent days inside
--                    the window)), never more than the pro-rated base
--   net pay        = pro-rated base − deduction + additions − other deductions, never below 0
--
-- A month with no working days at all (every day off) pays by calendar days
-- instead: round(base × days in the window ÷ days in the month).
--
-- Someone whose window does not touch the month gets no line. Someone who
-- joined before the month and has not left is paid exactly as before.
-- Removed or deactivated members are still paid for the month they left in
-- (and any month before it) -- only a removal date (deleted_at) or a pay end
-- date (pay_effective_to) says when; a member made inactive without either
-- has no date to go by and stays out, as before.
--
-- Each line keeps base_amount = the full monthly salary and adds
-- period_start, period_end, payable_days and prorated_base. Generating a
-- draft again recounts them; additions and other deductions stay. The same
-- arithmetic lives in packages/domain/src/payroll.ts.

alter table payroll_lines
  add column if not exists period_start  date,
  add column if not exists period_end    date,
  add column if not exists payable_days  int,
  add column if not exists prorated_base numeric(12, 2);

-- Lines made before this: a full month.
update payroll_lines
   set period_start  = coalesce(period_start, make_date(pay_year, pay_month, 1)),
       period_end    = coalesce(period_end, (make_date(pay_year, pay_month, 1) + interval '1 month - 1 day')::date),
       payable_days  = coalesce(payable_days, working_days),
       prorated_base = coalesce(prorated_base, base_amount)
 where period_start is null or period_end is null or payable_days is null or prorated_base is null;

alter table payroll_lines
  alter column period_start set not null,
  alter column period_end set not null,
  alter column payable_days set not null,
  alter column payable_days set default 0,
  alter column prorated_base set not null,
  alter column prorated_base set default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payroll_lines_period_check') then
    alter table payroll_lines add constraint payroll_lines_period_check
      check (period_end >= period_start and payable_days >= 0 and prorated_base >= 0);
  end if;
end $$;

-- One member's days with the studio in a month (clamped to the month; the
-- window is empty when win_start > win_end).
create or replace function payroll_member_window(p_user uuid, p_first date, p_last date)
returns table (joined_on date, left_on date, win_start date, win_end date)
language sql
stable
set search_path = public
as $$
  select x.j, x.lft, greatest(p_first, coalesce(x.j, p_first)), least(p_last, coalesce(x.lft, p_last))
    from (
      select coalesce(u.pay_effective_from, mp.joined_on) as j,
             -- least() skips a null: whichever of the two dates is known.
             least(u.pay_effective_to, (u.deleted_at at time zone 'Asia/Kolkata')::date) as lft
        from users u
        left join member_profiles mp on mp.user_id = u.user_id
       where u.user_id = p_user
    ) x
$$;
revoke all on function payroll_member_window(uuid, date, date) from public, anon, authenticated;

-- The monthly salary for part of a month (the formula at the top).
create or replace function payroll_prorate(
  p_base numeric, p_payable int, p_work int, p_window_days int, p_month_days int
)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(p_base, 0) <= 0 then 0
    when p_work <= 0 then
      case when p_window_days >= p_month_days then p_base
           else round(p_base * greatest(p_window_days, 0) / p_month_days) end
    when p_payable >= p_work then p_base
    else round(p_base * greatest(p_payable, 0) / p_work)
  end
$$;

-- Totals: the salary paid is the pro-rated base.
create or replace function payroll_refresh_totals(p_run uuid)
returns void
language sql
set search_path = public
as $$
  update payroll_runs r
     set total_base       = coalesce(t.base, 0),
         total_deductions = coalesce(t.ded, 0),
         total_additions  = coalesce(t.adds, 0),
         total_net        = coalesce(t.net, 0),
         total_paid       = coalesce(t.paid, 0),
         people           = coalesce(t.n, 0)
    from (
      select sum(prorated_base) as base, sum(deduction + other_deductions) as ded, sum(additions) as adds,
             sum(net_pay) as net, sum(paid_amount) as paid, count(*)::int as n
        from payroll_lines where run_id = p_run
    ) t
   where r.id = p_run
$$;
revoke all on function payroll_refresh_totals(uuid) from public, anon, authenticated;

-- ── generate (or recount a draft) ────────────────────────────────
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

  -- Count the days (working days inside each person's window only), then
  -- recount every line. Additions and other deductions typed earlier stay.
  insert into payroll_lines as l (run_id, company_id, user_id, pay_year, pay_month, base_amount, working_days,
                                  period_start, period_end, payable_days, prorated_base,
                                  days_present, unpaid_leave_days, absent_days, late_marks, deduction, net_pay)
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
    select a.user_id,
           count(*) filter (where a.status in ('present', 'late'))::int as present,
           count(*) filter (where a.status = 'late')::int as late,
           count(*) filter (where a.status = 'absent' and not on_leave(a.user_id, a.a_date))::int as absent
      from attendance a
      join people p on p.user_id = a.user_id and a.a_date between p.win_start and p.win_end
     where a.company_id = p_company
       and day_off(p_company, a.a_date) is null
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
           coalesce(att.absent, 0) as absent, coalesce(unpaid.days, 0) as unpaid
      from people p
      left join att on att.user_id = p.user_id
      left join unpaid on unpaid.user_id = p.user_id
  )
  select v_run.id, p_company, f.user_id, p_year, p_month, f.base, v_work,
         f.win_start, f.win_end, f.payable, pr.base,
         f.present, f.unpaid, f.absent, f.late,
         d.ded, payroll_net(pr.base, d.ded, 0, 0)
    from facts f
    cross join lateral (
      select payroll_prorate(f.base, f.payable, v_work, f.win_end - f.win_start + 1, v_days) as base
    ) pr
    cross join lateral (
      select case when v_work > 0 and f.base > 0
                  then least(pr.base, round(f.base * (f.unpaid + f.absent) / v_work))
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

-- ── a bonus, an allowance, an advance taken back ─────────────────
-- Same as 0185, but net pay starts from the pro-rated base.
create or replace function payroll_set_adjustments(
  p_company uuid, p_line uuid, p_additions numeric, p_additions_note text,
  p_other numeric, p_other_note text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line payroll_lines;
  v_status text;
  v_net numeric;
begin
  select l.* into v_line from payroll_lines l where l.id = p_line and l.company_id = p_company for update;
  if not found then
    raise exception 'that line was not found' using errcode = 'P0002';
  end if;
  select status into v_status from payroll_runs where id = v_line.run_id;
  if v_status <> 'draft' then
    raise exception 'this month is approved and locked' using errcode = '22023';
  end if;
  if coalesce(p_additions, 0) < 0 or coalesce(p_other, 0) < 0 then
    raise exception 'amounts cannot be negative' using errcode = '22023';
  end if;
  if coalesce(p_additions, 0) > 0 and nullif(btrim(p_additions_note), '') is null then
    raise exception 'say what the addition is for' using errcode = '22023';
  end if;
  if coalesce(p_other, 0) > 0 and nullif(btrim(p_other_note), '') is null then
    raise exception 'say what the deduction is for' using errcode = '22023';
  end if;

  v_net := payroll_net(v_line.prorated_base, v_line.deduction, coalesce(p_additions, 0), coalesce(p_other, 0));
  update payroll_lines
     set additions = coalesce(p_additions, 0),
         additions_note = case when coalesce(p_additions, 0) > 0 then nullif(btrim(p_additions_note), '') end,
         other_deductions = coalesce(p_other, 0),
         other_deductions_note = case when coalesce(p_other, 0) > 0 then nullif(btrim(p_other_note), '') end,
         net_pay = v_net,
         updated_at = now()
   where id = p_line;
  perform payroll_refresh_totals(v_line.run_id);
  return v_net;
end;
$$;
revoke all on function payroll_set_adjustments(uuid, uuid, numeric, text, numeric, text) from public, anon, authenticated;
grant execute on function payroll_set_adjustments(uuid, uuid, numeric, text, numeric, text) to service_role;

-- The salaries ledger: gross is the salary actually earned (pro-rated) plus
-- additions, so gross − deductions = net as before.
create or replace function payroll_sync_salary(p_line uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_l payroll_lines;
  v_r payroll_runs;
  v_first date;
  v_id uuid;
begin
  select * into v_l from payroll_lines where id = p_line;
  select * into v_r from payroll_runs where id = v_l.run_id;
  v_first := make_date(v_r.pay_year, v_r.pay_month, 1);
  select id into v_id from monthly_salaries
   where company_id = v_l.company_id and user_id = v_l.user_id
     and ((pay_year = v_r.pay_year and pay_month = v_r.pay_month) or month = v_first)
   order by (pay_year is not null) desc
   limit 1;
  if v_id is null then
    insert into monthly_salaries (company_id, user_id, month, pay_month, pay_year, gross, deductions, net,
                                  base_amount, paid_amount, status)
      values (v_l.company_id, v_l.user_id, v_first, v_r.pay_month, v_r.pay_year,
              v_l.prorated_base + v_l.additions, v_l.deduction + v_l.other_deductions, v_l.net_pay,
              v_l.net_pay, v_l.paid_amount,
              case when v_l.paid_at is not null then 'paid' else 'unpaid' end);
  else
    update monthly_salaries
       set pay_month = v_r.pay_month, pay_year = v_r.pay_year,
           gross = v_l.prorated_base + v_l.additions,
           deductions = v_l.deduction + v_l.other_deductions,
           net = v_l.net_pay,
           base_amount = v_l.net_pay,
           paid_amount = case when v_l.paid_at is not null then v_l.paid_amount else paid_amount end,
           status = case
             when v_l.paid_at is not null then 'paid'
             when coalesce(paid_amount, 0) <= 0 then 'unpaid'
             when paid_amount + 0.001 >= v_l.net_pay then 'paid'
             else 'partial' end
     where id = v_id;
  end if;
end;
$$;
revoke all on function payroll_sync_salary(uuid) from public, anon, authenticated;
