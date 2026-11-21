/**
 * One project's booked profit over its whole life, for its Overview margin and
 * its Billing tab's profit card.
 *
 * Both used to ask `profit_and_loss(from 2000, to 2100, 'booked', project)`,
 * which works out the whole studio's statement, twelve months of trend and
 * every expense category before narrowing the projects list to one -- seconds
 * of work on a busy studio for four numbers (speed audit, 21 Nov).
 *
 * This is the project part of `profit_and_loss` (0167, the `scope` / `shares` /
 * `income` block, booked basis) on its own, word for word in its rules, so the
 * figure is the very one Billing > Profit & Loss shows for the project.
 * supabase/tests/profit-and-loss.test.ts holds the two side by side: change
 * one, change the other.
 *
 * $1 the project, $2 and $3 the period (the whole life: PROJECT_LIFE). Runs as
 * the caller, so RLS keeps it to their own studio; no row for a project they
 * cannot see.
 */
export const PROJECT_LIFE = ['2000-01-01', '2100-12-31'] as const

export const PROJECT_MARGIN_SQL = `
  with scope as (
    select p.id, p.name, p.status, p.total_cost, p.created_at, cl.name as client_name
      from projects p left join clients cl on cl.id = p.client_id
     where p.id = $1::uuid
  ),
  shares as (
    select s.project_id, sc.total_cost / count(*) over (partition by s.project_id) as share, s.shoot_date
      from shoots s join scope sc on sc.id = s.project_id
     where s.shoot_date is not null and sc.status <> 'cancelled'
  ),
  income as (
    select sc.id,
           coalesce((select sum(share) from shares sh where sh.project_id = sc.id and sh.shoot_date between $2::date and $3::date), 0)
           + case when sc.status <> 'cancelled'
                   and not exists (select 1 from shoots s where s.project_id = sc.id and s.shoot_date is not null)
                   and sc.created_at::date between $2::date and $3::date
                  then sc.total_cost else 0 end as income,
           (select coalesce(sum(coalesce(t.final_cost, t.estimated_cost, 0)), 0)
              from team_assignment_slots t join shoots s on s.id = t.shoot_id
             where s.project_id = sc.id and t.status not in ('cancelled', 'released')
               and coalesce(s.shoot_date, t.start_at::date) between $2::date and $3::date) as team,
           (select coalesce(sum(expense_cash_out(e)), 0) from expenses e
             where e.project_id = sc.id and e.expense_date between $2::date and $3::date) as expenses,
           case when sc.status = 'cancelled' then 0 else greatest(sc.total_cost - (
             select coalesce(sum(r.amount), 0) from received_payments r
              where r.project_id = sc.id and coalesce(r.status, 'paid') = 'paid'), 0) end as to_collect
      from scope sc
  )
  select jsonb_build_object(
           'project_id', sc.id, 'name', sc.name, 'client_name', sc.client_name, 'status', sc.status,
           'income', round(i.income, 2), 'team', round(i.team, 2), 'expenses', round(i.expenses, 2),
           'profit', round(i.income - i.team - i.expenses, 2),
           'margin', case when i.income > 0 then round((i.income - i.team - i.expenses) / i.income * 100, 1) end,
           'to_collect', round(i.to_collect, 2)
         ) as r
    from income i join scope sc on sc.id = i.id`
