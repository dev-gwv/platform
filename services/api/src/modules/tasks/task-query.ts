import type { TransactionSql } from 'postgres'

/**
 * The task lists' query: one select, many filters. GET /tasks, /tasks/my,
 * /tasks/board and the open-task pages (GET /tasks/open) all read through it.
 */
export interface RawTask {
  id: string
  title: string
  description: string | null
  status: string
  priority: string
  due_date: string | null
  project_id: string | null
  project_name: string | null
  custom_priority_code: string | null
  custom_priority_label: string | null
  custom_priority_tone: string | null
  custom_status_code: string | null
  custom_status_label: string | null
  deliverable_id: string | null
  parent_task_id: string | null
  voice_note_url: string | null
  assignee_names: string[]
  assignee_ids: string[]
  tag: string
  blocked_reason: string | null
  created_by: string | null
  created_by_name: string | null
  latest_submission: { id: string; link: string | null; status: string; submitted_at: string } | null
  updated_at: string | null
  description_truncated?: boolean
  routine_id: string | null
}

// Flat select with the project name joined in (was PostgREST `projects(name)`).
// `assignee` narrows to tasks assigned to one person, for an admin previewing
// what a specific team member's board looks like. `project` narrows to one
// project, for its detail page's own Tasks tab. `deliverable` narrows to one
// deliverable (per-deliverable tasks UI). `id` is one task (the detail dialog).
// Each row carries who gave it and the newest work handed in against it, so a
// card can say "by AO" and "Submitted · Open submission" without a second trip.
//
// A busy studio holds thousands of finished tasks, so the pages ask for a
// window (speed audit, 12 Nov): `since` is every open task plus what was done
// or cancelled since then; `before` pages back through the older done ones,
// newest first. Both send a description cut to 200 characters (the drawer and
// the edit dialog read the whole task by id).
export interface TaskFilter {
  assignee?: string | undefined
  project?: string | undefined
  deliverable?: string | undefined
  id?: string | undefined
  parent?: string | undefined
  /** Title search for pickers. */
  q?: string | undefined
  /** Open tasks only (not completed or cancelled). */
  openOnly?: boolean | undefined
  /** With `since`: only the finished ones changed since then (the open ones come a page at a time). */
  doneOnly?: boolean | undefined
  /** One person's tasks, or 'none' for tasks nobody is on (the Person filter). */
  member?: string | undefined
  /** The Due date filter, read against `today`. */
  due?: DueFilter | undefined
  /** The List's tab: one status, or overdue. */
  tab?: OpenTab | undefined
  /** The India (or the viewer's) day, for overdue / due today / next 7 days. */
  today?: string | undefined
  /** The page's search box: title, details, project, tag and who is on it. */
  search?: string | undefined
  /** Open tasks a page at a time, late first then by due date (GET /tasks/open). */
  urgency?: boolean | undefined
  /** Where the next urgency page starts. */
  after?: UrgencyCursor | undefined
  /** Open tasks, and finished ones changed at or after this moment (ISO). */
  since?: string | undefined
  /** Only finished tasks changed before this moment, then before this id at the same moment. */
  before?: DoneCursor | undefined
  limit?: number | undefined
}

export type DueFilter = 'overdue' | 'today' | 'week' | 'none'
export type OpenTab = 'to_do' | 'in_progress' | 'overdue'

/**
 * The last row of an urgency page: its due date ('9999-12-31' for none, so an
 * undated task sinks below dated ones), priority rank, title and id.
 */
export interface UrgencyCursor {
  due: string
  rank: number
  title: string
  id: string
}

export interface DoneCursor {
  ts: string
  id: string | null
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const MOMENT_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}(:?\d{2})?)$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The start of an India day, as a moment: `2026-10-13` → `2026-10-13T00:00:00+05:30`. */
const indiaMidnight = (day: string) => `${day}T00:00:00+05:30`

/** `done_since=YYYY-MM-DD` → the moment that India day began, null when absent, 'bad' when malformed. */
export function readDoneSince(raw: string | undefined): string | null | 'bad' {
  if (!raw) return null
  if (!DAY_RE.test(raw) || Number.isNaN(Date.parse(raw))) return 'bad'
  return indiaMidnight(raw)
}

/**
 * `done_before` is a day (the window's edge, for the first page), a moment,
 * or `<moment>|<task id>` (the `next_cursor` a page hands back, so tasks
 * finished in the same instant are never skipped).
 */
export function readDoneBefore(raw: string | undefined): DoneCursor | null | 'bad' {
  if (!raw) return null
  const [ts, id, ...rest] = raw.split('|')
  if (!ts || rest.length) return 'bad'
  if (id !== undefined && !UUID_RE.test(id)) return 'bad'
  if (DAY_RE.test(ts)) return Number.isNaN(Date.parse(ts)) ? 'bad' : { ts: indiaMidnight(ts), id: id ?? null }
  // Postgres hands back microseconds, which not every Date.parse reads: check
  // the shape here and let the database read the moment itself.
  if (!MOMENT_RE.test(ts)) return 'bad'
  return { ts, id: id ?? null }
}

/** `limit` within 1..max, else the fallback. */
export function readLimit(raw: string | undefined, fallback: number, max: number): number {
  const n = Number(raw ?? fallback)
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), max) : fallback
}

/** A title search: `%` and `_` are what they say, not wildcards. */
const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`

/** No date sorts last: an undated task is unscheduled, not urgent. */
export const NO_DUE = '9999-12-31'

/** urgent 0 · high 1 · medium 2 · low 3, as the web's byUrgency ranks them. */
const rankOf = (sql: TransactionSql) =>
  sql`(case t.priority::text when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end)`

/** The task's day as an India date when no `today` was given. */
const todayOf = (sql: TransactionSql, today: string | undefined) =>
  today ? sql`${today}::date` : sql`(now() at time zone 'Asia/Kolkata')::date`

/** Overdue / due today / next 7 days / no date. Each one means open work only, as matchesDue does. */
function dueWhere(sql: TransactionSql, f: TaskFilter) {
  const today = todayOf(sql, f.today)
  switch (f.due) {
    case 'overdue':
      return sql`(t.status::text not in ('completed', 'cancelled') and t.due_date < ${today})`
    case 'today':
      return sql`(t.status::text not in ('completed', 'cancelled') and t.due_date = ${today})`
    case 'week':
      return sql`(t.status::text not in ('completed', 'cancelled') and t.due_date between ${today} and ${today} + 7)`
    case 'none':
      return sql`t.due_date is null`
    default:
      return sql`true`
  }
}

/** The List's tab, on top of everything else. */
function tabWhere(sql: TransactionSql, f: TaskFilter) {
  if (f.tab === 'overdue') return sql`t.due_date < ${todayOf(sql, f.today)}`
  if (f.tab) return sql`t.status::text = ${f.tab}`
  return sql`true`
}

/**
 * The filters a page's toolbar sets -- who, when, the search -- shared by the
 * rows and by their counts, so a count never disagrees with the list.
 * Needs `p` (projects) joined.
 */
function toolbarWhere(sql: TransactionSql, f: TaskFilter) {
  const like = f.search ? likeOf(f.search) : null
  return sql`
    ${f.assignee ? sql`exists (select 1 from task_assignees a2 where a2.task_id = t.id and a2.user_id = ${f.assignee})` : sql`true`}
    and ${
      f.member === 'none'
        ? sql`not exists (select 1 from task_assignees a4 where a4.task_id = t.id)`
        : f.member
          ? sql`exists (select 1 from task_assignees a4 where a4.task_id = t.id and a4.user_id = ${f.member})`
          : sql`true`
    }
    and ${dueWhere(sql, f)}
    and ${
      like
        ? sql`(t.title ilike ${like} or t.description ilike ${like} or p.name ilike ${like} or t.tag::text ilike ${like}
               or exists (select 1 from task_assignees a3 join users u3 on u3.user_id = a3.user_id
                           where a3.task_id = t.id and u3.name ilike ${like}))`
        : sql`true`
    }`
}

export const selectTasks = (sql: TransactionSql, f: TaskFilter = {}) => {
  const windowed = !!(f.since || f.before || f.urgency)
  return sql<RawTask[]>`
  select t.id, t.title,
         ${windowed ? sql`left(t.description, 200)` : sql`t.description`} as description,
         ${windowed ? sql`coalesce(char_length(t.description) > 200, false)` : sql`false`} as description_truncated,
         t.status, t.priority, t.due_date, t.project_id,
         p.name as project_name,
         cp.code as custom_priority_code, cp.label as custom_priority_label, cp.tone as custom_priority_tone,
         t.custom_status_code, cs.label as custom_status_label,
         t.deliverable_id, t.parent_task_id, t.voice_note_url,
         t.tag, t.blocked_reason, t.created_by, t.updated_at, t.routine_id,
         (select cu.name from users cu where cu.user_id = t.created_by) as created_by_name,
         (select json_build_object('id', s.id, 'link', s.submission_link, 'status', s.status, 'submitted_at', s.created_at)
            from team_work_submissions s
           where s.task_id = t.id
           order by s.created_at desc
           limit 1) as latest_submission,
         coalesce(
           array_agg(u.name order by u.name) filter (where u.user_id is not null),
           '{}'::text[]
         ) as assignee_names,
         coalesce(
           array_agg(u.user_id order by u.name) filter (where u.user_id is not null),
           '{}'::uuid[]
         ) as assignee_ids
  from tasks t
  left join projects p on p.id = t.project_id
  left join task_assignees a on a.task_id = t.id
  left join users u on u.user_id = a.user_id
  left join company_task_priorities cp on cp.company_id = t.company_id and cp.code = t.custom_priority_code
  left join company_deliverable_statuses cs on cs.company_id = t.company_id and cs.code = t.custom_status_code
  where ${toolbarWhere(sql, f)}
    and ${f.project ? sql`t.project_id = ${f.project}` : sql`true`}
    and ${f.deliverable ? sql`t.deliverable_id = ${f.deliverable}` : sql`true`}
    and ${f.id ? sql`t.id = ${f.id}` : sql`true`}
    and ${f.parent ? sql`t.parent_task_id = ${f.parent}` : sql`true`}
    and ${f.q ? sql`t.title ilike ${likeOf(f.q)}` : sql`true`}
    and ${f.openOnly ? sql`t.status::text not in ('completed', 'cancelled')` : sql`true`}
    and ${
      f.since
        ? f.doneOnly
          ? sql`(t.status::text in ('completed', 'cancelled') and t.updated_at >= ${f.since}::timestamptz)`
          : sql`(t.status::text not in ('completed', 'cancelled') or t.updated_at >= ${f.since}::timestamptz)`
        : sql`true`
    }
    and ${f.urgency ? sql`t.status::text not in ('completed', 'cancelled') and ${tabWhere(sql, f)}` : sql`true`}
    and ${
      f.after
        ? sql`(coalesce(t.due_date, ${NO_DUE}::date), ${rankOf(sql)}, t.title, t.id)
              > (${f.after.due}::date, ${f.after.rank}::int, ${f.after.title}::text, ${f.after.id}::uuid)`
        : sql`true`
    }
    and ${
      f.before
        ? f.before.id
          ? sql`t.status::text in ('completed', 'cancelled') and (t.updated_at, t.id) < (${f.before.ts}::timestamptz, ${f.before.id}::uuid)`
          : sql`t.status::text in ('completed', 'cancelled') and t.updated_at < ${f.before.ts}::timestamptz`
        : sql`true`
    }
  group by t.id, p.name, cp.code, cp.label, cp.tone, cs.label
  ${
    f.urgency
      ? sql`order by coalesce(t.due_date, ${NO_DUE}::date), ${rankOf(sql)}, t.title, t.id`
      : f.before
        ? sql`order by t.updated_at desc, t.id desc`
        : sql`order by t.created_at desc`
  }
  ${f.limit ? sql`limit ${f.limit}` : sql``}`
}

export interface OpenSummary {
  /** Open tasks the toolbar matches, whatever the tab. */
  open: number
  /** Of those, the ones the tab matches: the "of N" in "Showing 100 of N". */
  matching: number
  to_do: number
  in_progress: number
  review: number
  blocked: number
  overdue: number
  high_priority: number
  due_today: number
  /** Per person (null = nobody on it): open tasks and how many are late. */
  people: { user_id: string | null; open: number; late: number }[]
}

/**
 * The counts beside an open-task page -- tabs, tiles and each person's
 * column -- without sending the rows. The same toolbar filters as the rows.
 */
export const openSummary = (sql: TransactionSql, f: TaskFilter) => {
  const today = todayOf(sql, f.today)
  return sql<OpenSummary[]>`
  with m as (
    select t.id, t.status::text as status, t.priority::text as priority, t.due_date,
           ${tabWhere(sql, f)} as in_tab
      from tasks t
      left join projects p on p.id = t.project_id
     where t.status::text not in ('completed', 'cancelled')
       and ${toolbarWhere(sql, f)}
  )
  select count(*)::int as open,
         count(*) filter (where in_tab)::int as matching,
         count(*) filter (where status = 'to_do')::int as to_do,
         count(*) filter (where status = 'in_progress')::int as in_progress,
         count(*) filter (where status = 'review')::int as review,
         count(*) filter (where status = 'blocked')::int as blocked,
         count(*) filter (where due_date < ${today})::int as overdue,
         count(*) filter (where priority in ('high', 'urgent'))::int as high_priority,
         count(*) filter (where due_date = ${today})::int as due_today,
         (select coalesce(json_agg(json_build_object('user_id', x.user_id, 'open', x.open, 'late', x.late)), '[]'::json)
            from (select a.user_id, count(*)::int as open, count(*) filter (where m2.due_date < ${today})::int as late
                    from m m2 left join task_assignees a on a.task_id = m2.id
                   group by a.user_id) x) as people
    from m`
}

/** The cursor a page hands back: the last row's sort key, as one opaque string. */
export function encodeUrgencyCursor(r: { due_date: string | Date | null; priority: string; title: string; id: string }): string {
  const rank = ({ urgent: 0, high: 1, medium: 2 } as Record<string, number>)[r.priority] ?? 3
  const due = !r.due_date ? NO_DUE : r.due_date instanceof Date ? r.due_date.toISOString().slice(0, 10) : r.due_date.slice(0, 10)
  return Buffer.from(JSON.stringify([due, rank, r.title, r.id])).toString('base64url')
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A cursor back, or 'bad' when it was not one we made. */
export function decodeUrgencyCursor(raw: string | undefined): UrgencyCursor | null | 'bad' {
  if (!raw) return null
  try {
    const v: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (!Array.isArray(v) || v.length !== 4) return 'bad'
    const [due, rank, title, id] = v as unknown[]
    if (typeof due !== 'string' || !DAY.test(due)) return 'bad'
    if (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 0 || rank > 3) return 'bad'
    if (typeof title !== 'string' || title.length > 500) return 'bad'
    if (typeof id !== 'string' || !UUID.test(id)) return 'bad'
    return { due, rank, title, id }
  } catch {
    return 'bad'
  }
}
