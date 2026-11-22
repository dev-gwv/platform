import { taskActivityItem, taskDonePage, taskListItem, taskSubmissionItem, type UpdateTaskRequest } from '@ipc/contracts'
import type { TransactionSql } from 'postgres'
import { fail } from '../../middleware/errors'
import { readDoneBefore, readDoneSince, type RawTask } from './task-query'

/** Helpers the tasks route groups share (router.ts mounts them in order). */

export const list = taskListItem.array()


/**
 * A database check with a message meant for people (0192's "Say what is
 * blocking this task.", "This task is closed.") reaches them as it is,
 * instead of the generic "please check the details".
 */
export const sayIt = (code: string, err: unknown): undefined => {
  if (code === '22023' && err instanceof Error && err.message) fail(422, err.message)
  return undefined
}

export function toItems(rows: RawTask[], order: Map<string, number>) {
  return rows.map((r) => ({ ...r, sort_order: order.get(r.id) ?? 0 }))
}


/** The query string's window, shared by GET /tasks, /tasks/my and /tasks/board. */
export function windowOf(c: { req: { query: (k: string) => string | undefined } }) {
  const since = readDoneSince(c.req.query('done_since'))
  if (since === 'bad') fail(422, 'done_since must be a date (YYYY-MM-DD).')
  const before = readDoneBefore(c.req.query('done_before'))
  if (before === 'bad') fail(422, 'Invalid done_before cursor.')
  return { since: since ?? undefined, before: before ?? undefined }
}

/** One page of older finished tasks, and where the next one starts. */
export function donePage(rows: RawTask[], limit: number) {
  const items = rows.slice(0, limit)
  const last = items[items.length - 1]
  return taskDonePage.parse({
    items: toItems(items, new Map()),
    next_cursor: rows.length > limit && last?.updated_at ? `${last.updated_at}|${last.id}` : null,
  })
}

/** The task as the caller may see it (RLS decides), with who is on it and who gave it. */
export async function taskAccess(sql: TransactionSql, id: string) {
  const rows = await sql<{ status: string; created_by: string | null; project_id: string | null; deliverable_id: string | null; assignee_ids: string[] }[]>`
    select t.status, t.created_by, t.project_id, t.deliverable_id,
           coalesce(array(select a.user_id from task_assignees a where a.task_id = t.id), '{}'::uuid[]) as assignee_ids
      from tasks t where t.id = ${id}`
  return rows[0] ?? null
}

/** Made by the caller for themselves alone (0285): theirs to edit, close, reopen and delete. */
export async function isOwnTask(sql: TransactionSql, id: string): Promise<boolean> {
  const [r] = await sql<{ ok: boolean }[]>`select is_own_task(${id}) as ok`
  return r?.ok ?? false
}

/** The part of an edit a person may make to their own task, or null when it asks for more. */
export function ownTaskPatch(d: UpdateTaskRequest): Record<string, unknown> | null {
  const { title, description, status, priority, due_date, ...rest } = d
  if (Object.values(rest).some((v) => v !== undefined)) return null
  if (status === 'blocked' || status === 'review') return null
  const out: Record<string, unknown> = {}
  if (title !== undefined) out.title = title
  if (description !== undefined) out.description = description
  if (status !== undefined) out.status = status
  if (priority !== undefined) out.priority = priority
  if (due_date !== undefined) out.due_date = due_date
  return Object.keys(out).length ? out : null
}

export const activityList = taskActivityItem.array()
export const submissionList = taskSubmissionItem.array()
