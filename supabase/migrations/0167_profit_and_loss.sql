-- 0167: one Profit & Loss that counts everything, once.
--
-- The app had three profit screens that each counted differently (booked
-- value minus crew; paid minus expenses with no crew; cash minus payouts and
-- overheads), and none read salaries, crew bookings and overheads together.
-- This is the one statement they are replaced by.
--
-- Two ways to read a period:
--   cash   -- money that actually came in and went out in the period:
--             payments received (paid, by paid_on); crew paid (settlements by
--             paid_date); payouts completed; expenses by date; salaries paid;
--             overheads for the months.
--   booked -- the work done in the period: each project's value spread over
--             its shoots and counted on the shoot dates (a project with no
--             shoots counts on the day it was created); crew cost of those
--             shoots; payouts not failed; expenses by date; salaries owed;
--             overheads.
--
-- Every cost is counted in exactly one line:
--   crew bookings (team_assignment_slots / settlements)  -> Team for shoots
--   team_payouts                                         -> Other team payouts
--   expenses with a project                              -> Project expenses
--   monthly_salaries                                     -> Salaries
--   fixed_overheads                                      -> Fixed overheads
--   expenses without a project (incl. flagged overhead)  -> Studio expenses
-- An expense entered "excluding tax" costs its amount plus the tax.
--
-- Personal expenses are left out: they are each person's own, and RLS shows
-- a person only theirs, so a studio total would be wrong.
--
-- SECURITY INVOKER: RLS scopes every table to the caller's studio.

create or replace function expense_cash_out(e expenses)
returns numeric
language sql
immutable
as $$
  select e.amount + case
    when e.amount_is = 'excluding_tax' and e.gst_treatment in ('gst_applicable', 'reverse_charge')
      -- tax_amount defaults to 0 when nobody typed it; then work it out.
      then coalesce(nullif(e.tax_amount, 0), round(e.amount * coalesce(e.gst_rate, 0) / 100, 2))
    else 0
  end
$$;

-- The totals for one period, as numbers. Used for the statement and, month by
-- month, for the trend.
create or replace function pnl_totals(p_from date, p_to date, p_basis text)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_cash boolean := coalesce(p_basis, 'cash') <> 'booked';
  v_m_from date := date_trunc('month', p_from)::date;
  v_income numeric := 0;
  v_gst numeric := 0;
  v_crew numeric := 0;
  v_payouts numeric := 0;
  v_proj_exp numeric := 0;
  v_salaries numeric := 0;
  v_overheads numeric := 0;
  v_studio_exp numeric := 0;
begin
  if v_cash then
    select coalesce(sum(amount), 0) into v_income
      from received_payments
     where coalesce(status, 'paid') = 'paid' and paid_on between p_from and p_to;
    select coalesce(sum(amount_paid), 0) into v_crew
      from team_slot_settlements
     where paid_date between p_from and p_to;
    select coalesce(sum(amount), 0) into v_payouts
      from team_payouts
     where status = 'completed' and coalesce(period_end, created_at::date) between p_from and p_to;
    select coalesce(sum(case when status = 'paid' then coalesce(paid_amount, net, gross, base_amount, 0)
                             else coalesce(paid_amount, 0) end), 0) into v_salaries
      from monthly_salaries
     where month between v_m_from and p_to;
  else
    -- Each project's value, spread evenly over its shoots.
    select coalesce(sum(share), 0) into v_income
      from (
        select p.total_cost / count(*) over (partition by p.id) as share, s.shoot_date
          from projects p
          join shoots s on s.project_id = p.id
         where p.status <> 'cancelled' and s.shoot_date is not null
      ) x
     where x.shoot_date between p_from and p_to;
    select v_income + coalesce(sum(p.total_cost), 0) into v_income
      from projects p
     where p.status <> 'cancelled'
       and p.created_at::date between p_from and p_to
       and not exists (select 1 from shoots s where s.project_id = p.id and s.shoot_date is not null);
    select coalesce(sum(coalesce(t.final_cost, t.estimated_cost, 0)), 0) into v_crew
      from team_assignment_slots t
      join shoots s on s.id = t.shoot_id
     where t.status not in ('cancelled', 'released')
       and coalesce(s.shoot_date, t.start_at::date) between p_from and p_to;
    select coalesce(sum(amount), 0) into v_payouts
      from team_payouts
     where status <> 'failed' and coalesce(period_end, created_at::date) between p_from and p_to;
    select coalesce(sum(coalesce(net, gross, base_amount, 0)), 0) into v_salaries
      from monthly_salaries
     where month between v_m_from and p_to;
  end if;

  select coalesce(sum(it.cgst + it.sgst + it.igst), 0) into v_gst
    from invoice_items it
    join invoices i on i.id = it.invoice_id
   where i.status not in ('draft', 'cancelled') and i.invoice_date between p_from and p_to;

  select coalesce(sum(expense_cash_out(e)) filter (where e.project_id is not null), 0),
         coalesce(sum(expense_cash_out(e)) filter (where e.project_id is null), 0)
    into v_proj_exp, v_studio_exp
    from expenses e
   where e.expense_date between p_from and p_to;

  select coalesce(sum(amount), 0) into v_overheads
    from fixed_overheads
   where is_active and month between v_m_from and p_to;

  return jsonb_build_object(
    'income', round(v_income, 2),
    'gst_collected', round(v_gst, 2),
    'team_crew', round(v_crew, 2),
    'team_payouts', round(v_payouts, 2),
    'project_expenses', round(v_proj_exp, 2),
    'gross_profit', round(v_income - v_crew - v_payouts - v_proj_exp, 2),
    'salaries', round(v_salaries, 2),
    'overheads', round(v_overheads, 2),
    'studio_expenses', round(v_studio_exp, 2),
    'net_profit', round(v_income - v_crew - v_payouts - v_proj_exp - v_salaries - v_overheads - v_studio_exp, 2)
  );
end;
$$;

create or replace function profit_and_loss(p_from date, p_to date, p_basis text default 'cash', p_project uuid default null)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_cash boolean := coalesce(p_basis, 'cash') <> 'booked';
  v_lines jsonb;
  v_monthly jsonb := '[]'::jsonb;
  v_m date;
  v_end date;
  v_categories jsonb;
  v_projects jsonb;
  v_rail jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Pick a start and an end date.' using errcode = '22023';
  end if;

  v_lines := pnl_totals(p_from, p_to, p_basis);

  -- Twelve months ending with the period's last month.
  for i in reverse 11..0 loop
    v_m := (date_trunc('month', p_to) - make_interval(months => i))::date;
    v_end := (v_m + interval '1 month - 1 day')::date;
    v_monthly := v_monthly || jsonb_build_array(
      jsonb_build_object('month', to_char(v_m, 'YYYY-MM')) || pnl_totals(v_m, v_end, p_basis));
  end loop;

  -- Where the money went, beyond the team: expense and overhead categories.
  select coalesce(jsonb_agg(jsonb_build_object('category', category, 'amount', round(amount, 2)) order by amount desc), '[]'::jsonb)
    into v_categories
    from (
      select category, sum(amount) as amount from (
        select coalesce(nullif(btrim(e.category), ''), 'Other') as category, expense_cash_out(e) as amount
          from expenses e where e.expense_date between p_from and p_to
        union all
        select coalesce(nullif(btrim(o.category), ''), 'Overheads'), o.amount
          from fixed_overheads o
         where o.is_active and o.month between date_trunc('month', p_from)::date and p_to
      ) c
      group by category
      having sum(amount) > 0
    ) g;

  -- Each project in the period: what came in, what it cost, what is left to collect.
  with scope as (
    select p.id, p.name, p.status, p.total_cost, cl.name as client_name
      from projects p left join clients cl on cl.id = p.client_id
     where p_project is null or p.id = p_project
  ),
  shares as (
    select s.project_id, sc.total_cost / count(*) over (partition by s.project_id) as share, s.shoot_date
      from shoots s join scope sc on sc.id = s.project_id
     where s.shoot_date is not null and sc.status <> 'cancelled'
  ),
  income as (
    select sc.id,
           case when v_cash then (
             select coalesce(sum(r.amount), 0) from received_payments r
              where r.project_id = sc.id and coalesce(r.status, 'paid') = 'paid' and r.paid_on between p_from and p_to)
           else (
             coalesce((select sum(share) from shares sh where sh.project_id = sc.id and sh.shoot_date between p_from and p_to), 0)
             + case when sc.status <> 'cancelled'
                     and not exists (select 1 from shoots s where s.project_id = sc.id and s.shoot_date is not null)
                     and (select p.created_at::date from projects p where p.id = sc.id) between p_from and p_to
                    then sc.total_cost else 0 end)
           end as income,
           case when v_cash then (
             select coalesce(sum(t.amount_paid), 0) from team_slot_settlements t
              where t.project_id = sc.id and t.paid_date between p_from and p_to)
           else (
             select coalesce(sum(coalesce(t.final_cost, t.estimated_cost, 0)), 0)
               from team_assignment_slots t join shoots s on s.id = t.shoot_id
              where s.project_id = sc.id and t.status not in ('cancelled', 'released')
                and coalesce(s.shoot_date, t.start_at::date) between p_from and p_to)
           end as team,
           (select coalesce(sum(expense_cash_out(e)), 0) from expenses e
             where e.project_id = sc.id and e.expense_date between p_from and p_to) as expenses,
           case when sc.status = 'cancelled' then 0 else greatest(sc.total_cost - (
             select coalesce(sum(r.amount), 0) from received_payments r
              where r.project_id = sc.id and coalesce(r.status, 'paid') = 'paid'), 0) end as to_collect
      from scope sc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'project_id', sc.id, 'name', sc.name, 'client_name', sc.client_name, 'status', sc.status,
           'income', round(i.income, 2), 'team', round(i.team, 2), 'expenses', round(i.expenses, 2),
           'profit', round(i.income - i.team - i.expenses, 2),
           'margin', case when i.income > 0 then round((i.income - i.team - i.expenses) / i.income * 100, 1) end,
           'to_collect', round(i.to_collect, 2)
         ) order by (i.income - i.team - i.expenses) desc), '[]'::jsonb)
    into v_projects
    from income i join scope sc on sc.id = i.id
   where i.income <> 0 or i.team <> 0 or i.expenses <> 0 or p_project is not null;

  -- Beside the statement: money still out there, and money owed.
  select jsonb_build_object(
    'still_to_collect', round(coalesce((
      select sum(greatest(p.total_cost - coalesce((
        select sum(r.amount) from received_payments r
         where r.project_id = p.id and coalesce(r.status, 'paid') = 'paid'), 0), 0))
        from projects p where p.status <> 'cancelled' and (p_project is null or p.id = p_project)), 0), 2),
    'owed_to_team', round(coalesce((
      select sum(greatest(coalesce(t.final_cost, t.estimated_cost, 0) - coalesce((
        select sum(st.amount_paid) from team_slot_settlements st where st.slot_id = t.id), 0), 0))
        from team_assignment_slots t
        join shoots s on s.id = t.shoot_id
       where t.status not in ('cancelled', 'released') and (p_project is null or s.project_id = p_project)), 0), 2),
    'unbanked', round(coalesce((
      select sum(r.amount) from received_payments r
       where coalesce(r.status, 'paid') = 'paid' and r.cleared_at is null
         and (p_project is null or r.project_id = p_project)), 0), 2)
  ) into v_rail;

  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'basis', case when v_cash then 'cash' else 'booked' end,
    'lines', v_lines, 'monthly', v_monthly, 'categories', v_categories,
    'projects', v_projects, 'rail', v_rail);
end;
$$;

grant execute on function expense_cash_out(expenses) to authenticated;
grant execute on function pnl_totals(date, date, text) to authenticated;
grant execute on function profit_and_loss(date, date, text, uuid) to authenticated;
