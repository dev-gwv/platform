-- Monthly payroll run: "pay everyone this month" on one screen.
--
--   * payroll_runs: one per studio per month, draft -> approved -> paid.
--   * payroll_lines: one per in-house member with a monthly salary (or
--     stipend), worked out from attendance and approved leave:
--
--       working days = days in the month - weekly off days - holidays
--       deduction    = round(base / working days * (unpaid leave days + absent days)),
--                      never more than the base
--       net pay      = base - deduction + additions - other deductions, never below 0
--
--     Unpaid leave is approved leave of kind 'unpaid' on a working day (a
--     half day is 0.5). Absent is a day marked absent that is not covered by
--     approved leave. Lateness is counted and shown, never deducted. The same
--     formula lives in packages/domain/src/payroll.ts for the screen.
--
--   * Generating a draft again recounts the days but keeps the additions and
--     other deductions someone typed. An approved run is locked: the only
--     thing left to do is mark lines paid.
--   * Marking a line paid writes that month's monthly_salaries row, so the
--     Salaries tab, the member page and Profit & Loss stay right, and tells
--     the member their payslip is ready.
--
-- Access: the tables are read-only to the app. The owner, admins and managers
-- read them under RLS; a member reads only their own lines, and only once the
-- run is approved. Every write goes through the functions below, which only
-- the API's service role may call -- after it has checked the caller is the
-- owner or edits team salaries (module access lives in the API, not here),
-- and always scoped to the caller's own studio.

create table if not exists payroll_runs (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies (id) on delete cascade,
  pay_year         int not null check (pay_year between 2000 and 2100),
  pay_month        int not null check (pay_month between 1 and 12),
  status           text not null default 'draft' check (status in ('draft', 'approved', 'paid')),
  total_base       numeric(12, 2) not null default 0,
  total_deductions numeric(12, 2) not null default 0,
  total_additions  numeric(12, 2) not null default 0,
  total_net        numeric(12, 2) not null default 0,
  total_paid       numeric(12, 2) not null default 0,
  people           int not null default 0,
  created_by       uuid references users (user_id) on delete set null,
  created_at       timestamptz not null default now(),
  generated_at     timestamptz not null default now(),
  approved_by      uuid references users (user_id) on delete set null,
  approved_at      timestamptz,
  paid_at          timestamptz,
  unique (company_id, pay_year, pay_month)
);

create table if not exists payroll_lines (
  id                    uuid primary key default gen_random_uuid(),
  run_id                uuid not null references payroll_runs (id) on delete cascade,
  company_id            uuid not null references companies (id) on delete cascade,
  user_id               uuid not null references users (user_id) on delete cascade,
  -- Copied from the run so a member's own read needs no second table (and
  -- the two policies never look at each other).
  pay_year              int not null,
  pay_month             int not null,
  released              boolean not null default false,
  base_amount           numeric(12, 2) not null default 0 check (base_amount >= 0),
  working_days          int not null default 0,
  days_present          int not null default 0,
  unpaid_leave_days     numeric(5, 1) not null default 0,
  absent_days           int not null default 0,
  late_marks            int not null default 0,
  deduction             numeric(12, 2) not null default 0 check (deduction >= 0),
  additions             numeric(12, 2) not null default 0 check (additions >= 0),
  additions_note        text check (additions_note is null or length(additions_note) <= 200),
  other_deductions      numeric(12, 2) not null default 0 check (other_deductions >= 0),
  other_deductions_note text check (other_deductions_note is null or length(other_deductions_note) <= 200),
  net_pay               numeric(12, 2) not null default 0 check (net_pay >= 0),
  paid_amount           numeric(12, 2) not null default 0,
  paid_at               timestamptz,
  payment_mode          text check (payment_mode is null or length(payment_mode) <= 40),
  payment_reference     text check (payment_reference is null or length(payment_reference) <= 120),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (run_id, user_id)
);
create index if not exists payroll_lines_user_idx on payroll_lines (company_id, user_id);

alter table payroll_runs enable row level security;
alter table payroll_lines enable row level security;

drop policy if exists payroll_runs_select on payroll_runs;
create policy payroll_runs_select on payroll_runs
  for select to authenticated
  using (company_id = get_current_company_id() and (is_current_owner() or is_current_admin_or_manager()));

-- A member sees their own line once the month is approved (released).
drop policy if exists payroll_lines_select on payroll_lines;
create policy payroll_lines_select on payroll_lines
  for select to authenticated
  using (
    company_id = get_current_company_id()
    and (is_current_owner() or is_current_admin_or_manager() or (user_id = auth.uid() and released))
  );

-- Read-only to the app; writes are the functions below.
revoke insert, update, delete on payroll_runs, payroll_lines from authenticated, anon;
grant select on payroll_runs, payroll_lines to authenticated;
grant select, insert, update, delete on payroll_runs, payroll_lines to service_role;

-- Sum a run's lines onto the run. Plain (not definer): only ever called from
-- the functions below, which already run with the rights it needs.
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
      select sum(base_amount) as base, sum(deduction + other_deductions) as ded, sum(additions) as adds,
             sum(net_pay) as net, sum(paid_amount) as paid, count(*)::int as n
        from payroll_lines where run_id = p_run
    ) t
   where r.id = p_run
$$;
revoke all on function payroll_refresh_totals(uuid) from public, anon, authenticated;

-- Net pay from a line's own numbers (the formula at the top).
create or replace function payroll_net(p_base numeric, p_deduction numeric, p_additions numeric, p_other numeric)
returns numeric
language sql
immutable
as $$
  select greatest(0, round(p_base - p_deduction + p_additions - p_other, 2))
$$;

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
  v_work   int;
  v_people uuid[];
begin
  if p_month not between 1 and 12 or p_year not between 2000 and 2100 then
    raise exception 'pick a month' using errcode = '22023';
  end if;
  v_first := make_date(p_year, p_month, 1);
  v_last := (v_first + interval '1 month - 1 day')::date;
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

  -- Who is paid monthly: active, in-house, with a salary (or a stipend).
  v_people := array(
    select u.user_id from users u
     where u.company_id = p_company and u.deleted_at is null and coalesce(u.status, 'active') = 'active'
       and u.role <> 'super_admin'
       and coalesce(u.engagement_type, 'in_house') <> 'freelancer'
       and (coalesce(u.salary, 0) > 0 or coalesce(u.stipend_amount, 0) > 0));

  -- Someone who is no longer paid monthly leaves the draft.
  delete from payroll_lines
   where run_id = v_run.id and not (user_id = any (v_people));

  -- Count the days (working days only), then recount every line. Additions
  -- and other deductions typed earlier stay as they are.
  insert into payroll_lines as l (run_id, company_id, user_id, pay_year, pay_month, base_amount, working_days,
                                  days_present, unpaid_leave_days, absent_days, late_marks, deduction, net_pay)
  with people as (
    select u.user_id, case when coalesce(u.salary, 0) > 0 then u.salary else u.stipend_amount end as base
      from users u where u.user_id = any (v_people)
  ), att as (
    select a.user_id,
           count(*) filter (where a.status in ('present', 'late'))::int as present,
           count(*) filter (where a.status = 'late')::int as late,
           count(*) filter (where a.status = 'absent' and not on_leave(a.user_id, a.a_date))::int as absent
      from attendance a
     where a.company_id = p_company and a.a_date between v_first and v_last
       and a.user_id = any (v_people)
       and day_off(p_company, a.a_date) is null
     group by a.user_id
  ), unpaid as (
    select lr.user_id, sum(case when lr.half_day then 0.5 else 1 end) as days
      from leave_requests lr
      join generate_series(v_first, v_last, interval '1 day') g(d)
        on g.d::date between lr.start_date and lr.end_date
     where lr.company_id = p_company and lr.status = 'approved' and lr.kind = 'unpaid'
       and lr.user_id = any (v_people)
       and day_off(p_company, g.d::date) is null
     group by lr.user_id
  ), facts as (
    select p.user_id, p.base, coalesce(att.present, 0) as present, coalesce(att.late, 0) as late,
           coalesce(att.absent, 0) as absent, coalesce(unpaid.days, 0) as unpaid
      from people p
      left join att on att.user_id = p.user_id
      left join unpaid on unpaid.user_id = p.user_id
  )
  select v_run.id, p_company, f.user_id, p_year, p_month, f.base, v_work, f.present, f.unpaid, f.absent, f.late,
         d.ded, payroll_net(f.base, d.ded, 0, 0)
    from facts f
    cross join lateral (
      select case when v_work > 0 and f.base > 0
                  then least(f.base, round(f.base * (f.unpaid + f.absent) / v_work))
                  else 0 end as ded
    ) d
  on conflict (run_id, user_id) do update
     set base_amount = excluded.base_amount,
         working_days = excluded.working_days,
         days_present = excluded.days_present,
         unpaid_leave_days = excluded.unpaid_leave_days,
         absent_days = excluded.absent_days,
         late_marks = excluded.late_marks,
         deduction = excluded.deduction,
         net_pay = payroll_net(excluded.base_amount, excluded.deduction, l.additions, l.other_deductions),
         updated_at = now();

  update payroll_runs set generated_at = now() where id = v_run.id;
  perform payroll_refresh_totals(v_run.id);
  return v_run.id;
end;
$$;
revoke all on function payroll_generate(uuid, int, int, uuid) from public, anon, authenticated;
grant execute on function payroll_generate(uuid, int, int, uuid) to service_role;

-- ── a bonus, an allowance, an advance taken back ─────────────────
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

  v_net := payroll_net(v_line.base_amount, v_line.deduction, coalesce(p_additions, 0), coalesce(p_other, 0));
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

-- Write one line into the monthly salaries ledger (what the Salaries tab and
-- Profit & Loss read). Owed = net pay; paid only once it is marked paid.
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
              v_l.base_amount + v_l.additions, v_l.deduction + v_l.other_deductions, v_l.net_pay,
              v_l.net_pay, v_l.paid_amount,
              case when v_l.paid_at is not null then 'paid' else 'unpaid' end);
  else
    update monthly_salaries
       set pay_month = v_r.pay_month, pay_year = v_r.pay_year,
           gross = v_l.base_amount + v_l.additions,
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

-- ── approve: the numbers are final ───────────────────────────────
create or replace function payroll_approve(p_company uuid, p_run uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run payroll_runs;
  v_line uuid;
begin
  select * into v_run from payroll_runs where id = p_run and company_id = p_company for update;
  if not found then
    raise exception 'that payroll was not found' using errcode = 'P0002';
  end if;
  if v_run.status <> 'draft' then
    raise exception 'this month is already approved' using errcode = '22023';
  end if;
  if not exists (select 1 from payroll_lines where run_id = p_run) then
    raise exception 'there is nobody to pay in this month' using errcode = '22023';
  end if;
  update payroll_runs set status = 'approved', approved_by = p_actor, approved_at = now() where id = p_run;
  update payroll_lines set released = true where run_id = p_run;
  for v_line in select id from payroll_lines where run_id = p_run loop
    perform payroll_sync_salary(v_line);
  end loop;
end;
$$;
revoke all on function payroll_approve(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function payroll_approve(uuid, uuid, uuid) to service_role;

-- ── mark paid: one line, or every line still to pay (p_line null) ─
create or replace function payroll_mark_paid(
  p_company uuid, p_run uuid, p_line uuid, p_actor uuid, p_mode text, p_reference text
)
returns table (line_id uuid, user_id uuid, net_pay numeric)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_run payroll_runs;
  v_l payroll_lines;
  v_month text;
begin
  select * into v_run from payroll_runs r where r.id = p_run and r.company_id = p_company for update;
  if not found then
    raise exception 'that payroll was not found' using errcode = 'P0002';
  end if;
  if v_run.status = 'draft' then
    raise exception 'approve the month before paying' using errcode = '22023';
  end if;
  if p_line is not null and not exists (select 1 from payroll_lines l where l.id = p_line and l.run_id = p_run) then
    raise exception 'that line was not found' using errcode = 'P0002';
  end if;
  if p_line is not null and exists (select 1 from payroll_lines l where l.id = p_line and l.paid_at is not null) then
    raise exception 'this person is already marked paid' using errcode = '22023';
  end if;
  v_month := trim(to_char(make_date(v_run.pay_year, v_run.pay_month, 1), 'FMMonth YYYY'));

  for v_l in
    update payroll_lines l
       set paid_amount = l.net_pay, paid_at = now(),
           payment_mode = nullif(btrim(p_mode), ''), payment_reference = nullif(btrim(p_reference), ''),
           updated_at = now()
     where l.run_id = p_run and l.paid_at is null and (p_line is null or l.id = p_line)
     returning l.*
  loop
    perform payroll_sync_salary(v_l.id);
    perform create_notification(
      p_company, v_l.user_id, 'payroll.payslip', 'Payslip for ' || v_month || ' is ready',
      'Net pay ₹' || to_char(v_l.net_pay, 'FM99,99,99,990.00'),
      'payslip:' || v_l.id, 'payroll_line', v_l.id, 'info', '/payroll/payslip/' || v_l.id, '{}'::jsonb);
    line_id := v_l.id;
    user_id := v_l.user_id;
    net_pay := v_l.net_pay;
    return next;
  end loop;

  perform payroll_refresh_totals(p_run);
  update payroll_runs r
     set status = 'paid', paid_at = now()
   where r.id = p_run
     and not exists (select 1 from payroll_lines l where l.run_id = p_run and l.paid_at is null);
end;
$$;
revoke all on function payroll_mark_paid(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function payroll_mark_paid(uuid, uuid, uuid, uuid, text, text) to service_role;
