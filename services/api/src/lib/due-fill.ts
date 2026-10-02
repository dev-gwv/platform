import type { TransactionSql } from 'postgres'
import { deliverableDueDate, deliverableTimings, type StudioDeliverableType } from '@ipc/domain'
import { todayInIndia } from './dates'

/**
 * Give a project's undated deliverables the date the wizard would have given
 * them: the studio's own type for that name (or the trade's usual numbers),
 * counted from the wedding day, the last shoot or today. A date already set is
 * never moved, and a deliverable whose anchor is still unknown (no wedding day
 * yet) stays undated rather than guessed -- the client is quoted from it.
 * Returns how many were filled.
 */
export async function fillProjectDueDates(sql: TransactionSql, projectId: string, today = todayInIndia()): Promise<number> {
  const shoots = await sql<{ name: string; shoot_date: string | null }[]>`
    select name, to_char(shoot_date, 'YYYY-MM-DD') as shoot_date
      from shoots where project_id = ${projectId} and coalesce(status, '') <> 'cancelled'`
  const open = await sql<{ id: string; title: string }[]>`
    select id, title from deliverables
     where project_id = ${projectId} and estimated_date is null and status not in ('completed', 'cancelled')`
  if (open.length === 0) return 0
  const types = await sql<StudioDeliverableType[]>`
    select t.title, t.delivery_days as due_days, t.due_basis, t.work_days, t.is_archived
      from deliverable_templates t
      join projects p on p.company_id = t.company_id
     where p.id = ${projectId}`
  let filled = 0
  for (const d of open) {
    const t = deliverableTimings(d.title, types)
    const due = deliverableDueDate(t.due_basis, shoots, t.due_days, null, today)
    if (!due) continue
    const rows = await sql`update deliverables set estimated_date = ${due} where id = ${d.id} and estimated_date is null returning id`
    filled += rows.length
  }
  return filled
}
