import type { TransactionSql } from 'postgres'
import { summarizeCrewOwed } from '@ipc/domain'
import type { CrewPayoutRow } from '@ipc/contracts'
import { todayInIndia } from './dates'

/**
 * Every booking's money in one studio, for Team payouts, the dashboard's
 * "Who you owe" and a person's statement. One query, so the page's headline
 * and the dashboard can never disagree.
 *
 * - The day is the booking's start in India, not UTC.
 * - Paid is the signed ledger total: reversals already taken off.
 * - A booking that no longer stands (released, cancelled, or its shoot
 *   cancelled) is listed only when money went out on it, and is then worth
 *   exactly what was paid -- nothing more is owed on it.
 * - Time blocked off with no shoot and no cost is left out.
 *
 * Read as the service with an explicit company: the ledger's RLS is for
 * owners and managers only, and a delegate with Team payouts would otherwise
 * see every payment as nil.
 */
export async function crewPayoutRows(
  sql: TransactionSql,
  companyId: string,
  opts: { userId?: string | null } = {},
): Promise<CrewPayoutRow[]> {
  const rows = await sql<CrewPayoutRow[]>`
    with r as (
      select t.id as slot_id, t.user_id, u.name as user_name, t.service_name as role,
             s.id as shoot_id, s.name as shoot_name, p.id as project_id, p.name as project_name,
             (t.start_at at time zone 'Asia/Kolkata')::date as day,
             coalesce(t.final_cost, t.estimated_cost, 0)::float8 as cost,
             t.cost_status,
             coalesce(pay.paid, 0)::float8 as paid,
             pay.last_paid,
             (t.status = 'booked' and coalesce(s.status, 'planned') <> 'cancelled') as stands
        from team_assignment_slots t
        left join shoots s on s.id = t.shoot_id
        left join projects p on p.id = s.project_id
        left join users u on u.user_id = t.user_id and u.company_id = t.company_id
        left join lateral (
          select sum(ss.amount_paid) as paid, max(ss.paid_date) as last_paid
            from team_slot_settlements ss where ss.slot_id = t.id
        ) pay on true
       where t.company_id = ${companyId}
         and ${opts.userId ? sql`t.user_id = ${opts.userId}` : sql`true`}
    )
    select slot_id, user_id, user_name, role, shoot_id, shoot_name, project_id, project_name,
           day::text as shoot_date,
           case when stands then cost else paid end as amount,
           cost_status, paid, last_paid::text as last_paid_date, stands
      from r
     -- Blocked time (no shoot, no cost) is not crew money.
     where (stands and (shoot_id is not null or cost > 0)) or paid <> 0
     order by day desc, shoot_name, user_name`
  return rows.map((r) => ({ ...r }))
}

export function crewOwedFrom(rows: readonly CrewPayoutRow[], today = todayInIndia()) {
  return { today, ...summarizeCrewOwed(rows, today) }
}
