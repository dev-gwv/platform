import type { Context } from 'hono'
import type { TransactionSql } from 'postgres'
import { seesStudioWork } from '@ipc/permissions'
import type { AppEnv } from '../context'
import { fail } from '../middleware/errors'

/**
 * Staff see their own work, not the studio's.
 *
 * Row security lets every member of a studio read every project, so the
 * line is drawn here: someone who does not run projects or handle money
 * (seesStudioWork) gets only the projects they work on, with no money and no
 * client phone, and the studio-wide screens answer 403. Their own work --
 * /shoots/my, /tasks/my, /projects/deliverables/mine, /allocation, /hr --
 * was already theirs alone.
 */
export function studioWork(c: Context<AppEnv>): boolean {
  const auth = c.get('auth')
  return auth.isOwner || seesStudioWork(auth.access)
}

export const NOT_YOURS = 'This is the studio’s work. Your own shoots, edits and tasks are under My work.'

/** Middleware: only for people who see the studio's work. */
export async function requireStudioWork(c: Context<AppEnv>, next: () => Promise<void>) {
  if (!studioWork(c)) fail(403, NOT_YOURS)
  await next()
}

/**
 * The projects someone works on: a live booking on one of its shoots, a
 * deliverable they edit, or a task given to them. A SQL fragment over the
 * project id column named by `col`.
 */
export function worksOn(sql: TransactionSql, me: string, col = sql`p.id`) {
  return sql`${col} in (
    select sh.project_id from team_assignment_slots s join shoots sh on sh.id = s.shoot_id
     where s.user_id = ${me} and s.status <> 'cancelled' and s.released_at is null
    union
    select d.project_id from deliverables d where d.assignee_id = ${me}
    union
    select t.project_id from tasks t join task_assignees a on a.task_id = t.id
     where a.user_id = ${me} and t.project_id is not null
  )`
}
