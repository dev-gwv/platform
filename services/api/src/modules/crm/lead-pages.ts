import type { PendingQuery, Row, TransactionSql } from 'postgres'
import type { LeadPageQuery } from '@ipc/contracts'
import { CARD_SELECT, outcomeWhere } from './lead-reads'

/**
 * The Leads page a page at a time (speed audit, 21 Nov: a studio with 1,372
 * open leads downloaded 1.31 MB on every open of Leads, and past 2,000 the
 * oldest open leads silently fell off the board).
 *
 * Every filter the page offers -- the view, a saved view's chips and fields,
 * the toolbar's facets, the Filter extras and the search -- is a WHERE clause
 * here, so a page is never short because its matches sit further down. Two
 * orders, each with a keyset cursor (never OFFSET):
 *
 * - `newest`: a board column's order, created_at desc, id desc.
 * - `urgency`: the list's order, exactly `byUrgency` in features/crm/leads.ts:
 *   late, due today, never contacted, upcoming, the rest; hot first within
 *   each; then the one waiting longest (follow-up, else when it came in).
 *
 * "Overdue" and "today" are measured from `day_start`, the viewer's midnight
 * (else India's), the way the browser measured them before.
 */

/** Stands for "not set" in a facet list (`UNSET` in features/crm/board-filters.ts). */
export const UNSET = '__none'

type Frag = PendingQuery<Row[]>

/** India's midnight now, when the browser did not say its own. */
export function indiaDayStart(now = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60_000)
  return `${ist.toISOString().slice(0, 10)}T00:00:00+05:30`
}

const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`

/** A single-valued facet: the column's value, or UNSET when empty, is one of the list. */
function facet(sql: TransactionSql, column: Frag, values: readonly string[]): Frag {
  if (values.length === 0) return sql`true`
  return sql`coalesce(nullif(${column}::text, ''), ${UNSET}) = any(${values as string[]}::text[])`
}

/**
 * Every WHERE the page can ask for, over `crm_leads l` joined to `users u` on
 * the owner. `d` is the viewer's midnight.
 */
export function leadWhere(sql: TransactionSql, v: LeadPageQuery, d: string): Frag {
  const open = sql`l.status not in ('converted', 'lost')`
  const tomorrow = sql`(${d}::timestamptz + interval '1 day')`
  const uncontacted = sql`(l.status = 'new' and l.last_contacted_at is null)`
  const quick: Record<string, Frag> = {
    due_today: sql`(${open} and l.follow_up_at >= ${d}::timestamptz and l.follow_up_at < ${tomorrow})`,
    overdue: sql`(${open} and l.follow_up_at < ${d}::timestamptz)`,
    hot: sql`(${open} and l.is_hot)`,
    uncontacted,
    proposal_sent: sql`l.status = 'proposal_sent'`,
    unassigned: sql`(${open} and l.assigned_to is null)`,
    no_follow_up: sql`(${open} and l.follow_up_at is null)`,
  }
  const view =
    v.view === 'today'
      ? sql`(${open} and l.follow_up_at < ${tomorrow})`
      : v.view === 'overdue' || v.view === 'uncontacted' || v.view === 'no_follow_up' || v.view === 'hot'
        ? quick[v.view]!
        : v.view === 'all'
          ? open
          : sql`true`
  const quickAll = v.quick.length ? v.quick.map((k) => quick[k]!).reduce((a, b) => sql`${a} and ${b}`) : sql`true`
  // The event facet: any function's type, else the lead's own (0212).
  const hasTypedFn = sql`exists (select 1 from crm_lead_functions f where f.lead_id = l.id and coalesce(f.event_type, '') <> '')`
  const event = v.f_event.length
    ? sql`(exists (select 1 from crm_lead_functions f where f.lead_id = l.id and f.event_type = any(${v.f_event}::text[]))
           or (not ${hasTypedFn} and coalesce(nullif(l.event_type, ''), ${UNSET}) = any(${v.f_event}::text[])))`
    : sql`true`
  const tagIds = v.f_tag.filter((t) => t !== UNSET)
  const tag = v.f_tag.length
    ? sql`(exists (select 1 from crm_lead_tags lt where lt.lead_id = l.id and lt.tag_id::text = any(${tagIds}::text[]))
           or (${v.f_tag.includes(UNSET)} and not exists (select 1 from crm_lead_tags lt where lt.lead_id = l.id)))`
    : sql`true`
  // Event dates: any function's date in range, else the lead's own.
  const hasDatedFn = sql`exists (select 1 from crm_lead_functions f where f.lead_id = l.id and f.event_date is not null)`
  const from = v.event_from ?? null
  const to = v.event_to ?? null
  const inRange = (col: Frag) =>
    sql`(${col} is not null and (${from}::date is null or ${col} >= ${from}::date) and (${to}::date is null or ${col} <= ${to}::date))`
  const eventDates =
    from || to
      ? sql`(exists (select 1 from crm_lead_functions f where f.lead_id = l.id and ${inRange(sql`f.event_date`)})
             or (not ${hasDatedFn} and ${inRange(sql`l.event_date`)}))`
      : sql`true`
  const due =
    v.due === 'none'
      ? sql`l.follow_up_at is null`
      : v.due === 'overdue'
        ? sql`l.follow_up_at < ${d}::timestamptz`
        : v.due === 'today'
          ? sql`(l.follow_up_at >= ${d}::timestamptz and l.follow_up_at < ${tomorrow})`
          : v.due === 'week'
            ? sql`(l.follow_up_at >= ${d}::timestamptz and l.follow_up_at < ${d}::timestamptz + interval '8 days')`
            : sql`true`
  const needle = v.q ? likeOf(v.q) : null
  return sql`
        ${v.include_archived ? sql`true` : sql`l.is_archived = false`}
    and ${sql.unsafe(outcomeWhere(v.outcome))}
    and ${
      v.pipeline_id
        ? sql`(l.pipeline_id = ${v.pipeline_id} or (l.pipeline_id is null and exists (select 1 from crm_pipelines p where p.id = ${v.pipeline_id} and p.is_default)))`
        : sql`true`
    }
    and ${v.stage_id === 'none' ? sql`l.stage_id is null` : v.stage_id ? sql`l.stage_id = ${v.stage_id}` : sql`true`}
    and ${view}
    and ${quickAll}
    and ${v.status ? sql`l.status = ${v.status}` : sql`true`}
    and ${v.assignee === 'none' ? sql`l.assigned_to is null` : v.assignee ? sql`l.assigned_to = ${v.assignee}` : sql`true`}
    and ${v.quality ? sql`l.quality = ${v.quality}` : sql`true`}
    and ${v.tag_id ? sql`exists (select 1 from crm_lead_tags lt where lt.lead_id = l.id and lt.tag_id = ${v.tag_id})` : sql`true`}
    and ${facet(sql, sql`l.stage_id`, v.f_stage)}
    and ${facet(sql, sql`l.assigned_to`, v.f_owner)}
    and ${facet(sql, sql`l.quality`, v.f_quality)}
    and ${facet(sql, sql`l.source`, v.f_source)}
    and ${facet(sql, sql`l.partner_id`, v.f_partner)}
    and ${event}
    and ${tag}
    and ${eventDates}
    and ${due}
    and ${v.created_from ? sql`l.created_at >= ${v.created_from}::timestamptz` : sql`true`}
    and ${v.budget_min !== undefined ? sql`coalesce(l.deal_value, -1) >= ${v.budget_min}` : sql`true`}
    and ${v.budget_max !== undefined ? sql`(l.deal_value is not null and l.deal_value <= ${v.budget_max})` : sql`true`}
    and ${v.hot ? sql`l.is_hot` : sql`true`}
    and ${v.contacted === 'never' ? sql`l.contacted_status = 'uncontacted'` : v.contacted === 'yes' ? sql`l.contacted_status is distinct from 'uncontacted'` : sql`true`}
    and ${
      needle
        ? sql`(l.name ilike ${needle} or l.phone ilike ${needle} or l.email ilike ${needle} or l.title ilike ${needle}
               or l.notes ilike ${needle} or u.name ilike ${needle})`
        : sql`true`
    }`
}

/** The list's rank, as byUrgency ranks (a closed lead owes nobody a call). */
function rankOf(sql: TransactionSql, d: string): Frag {
  return sql`(case
    when c.status in ('converted', 'lost') then 4
    when c.follow_up_at < ${d}::timestamptz then 0
    when c.follow_up_at < ${d}::timestamptz + interval '1 day' then 1
    when c.status = 'new' and c.last_contacted_at is null then 2
    when c.follow_up_at >= ${d}::timestamptz + interval '2 days' then 3
    else 4 end)`
}

export type NewestCursor = { at: string; id: string }
export type UrgencyCursor = { rank: number; hot: number; at: string; id: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STAMP = /^\d{4}-\d{2}-\d{2}[ T][\d:.]+([+-]\d{2}(:?\d{2})?|Z)?$/

export function encodeCursor(c: NewestCursor | UrgencyCursor): string {
  const v = 'rank' in c ? ['u', c.rank, c.hot, c.at, c.id] : ['n', c.at, c.id]
  return Buffer.from(JSON.stringify(v)).toString('base64url')
}

/** A cursor back for this order, or 'bad' when it was not one we made for it. */
export function decodeCursor(raw: string | undefined, order: 'urgency' | 'newest'): NewestCursor | UrgencyCursor | null | 'bad' {
  if (!raw) return null
  try {
    const v: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (!Array.isArray(v)) return 'bad'
    if (order === 'newest') {
      const [k, at, id] = v as unknown[]
      if (k !== 'n' || v.length !== 3 || typeof at !== 'string' || !STAMP.test(at) || typeof id !== 'string' || !UUID.test(id)) return 'bad'
      return { at, id }
    }
    const [k, rank, hot, at, id] = v as unknown[]
    if (k !== 'u' || v.length !== 5) return 'bad'
    if (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 0 || rank > 4) return 'bad'
    if (hot !== 0 && hot !== 1) return 'bad'
    if (typeof at !== 'string' || !STAMP.test(at) || typeof id !== 'string' || !UUID.test(id)) return 'bad'
    return { rank, hot, at, id }
  } catch {
    return 'bad'
  }
}

/** The card rows matching, as `c`, over the same projection GET /crm/leads?shape=card uses. */
const cardsWhere = (sql: TransactionSql, v: LeadPageQuery, d: string) => sql`(${sql.unsafe(CARD_SELECT)} where ${leadWhere(sql, v, d)}) c`

/**
 * One page, `limit + 1` rows so the caller can tell whether there is more.
 * Each row carries its sort keys as text (`k_rank`, `k_hot`, `k_at`) for the
 * next cursor; a timestamp kept as text keeps its microseconds.
 */
export function selectLeadPage(sql: TransactionSql, v: LeadPageQuery, d: string, after: NewestCursor | UrgencyCursor | null): Frag {
  if (v.order === 'urgency') {
    const a = after && 'rank' in after ? after : null
    return sql`
      select * from (
        select c.*, ${rankOf(sql, d)} as k_rank, (case when c.is_hot then 0 else 1 end) as k_hot,
               coalesce(c.follow_up_at, c.created_at) as k_sort, coalesce(c.follow_up_at, c.created_at)::text as k_at
          from ${cardsWhere(sql, v, d)}
      ) p
      where ${a ? sql`(p.k_rank, p.k_hot, p.k_sort, p.id) > (${a.rank}, ${a.hot}, ${a.at}::timestamptz, ${a.id}::uuid)` : sql`true`}
      order by p.k_rank, p.k_hot, p.k_sort, p.id
      limit ${v.limit + 1}`
  }
  const a = after && !('rank' in after) ? after : null
  return sql`
    select c.*, c.created_at::text as k_at
      from ${cardsWhere(sql, v, d)}
     where ${a ? sql`(c.created_at, c.id) < (${a.at}::timestamptz, ${a.id}::uuid)` : sql`true`}
     order by c.created_at desc, c.id desc
     limit ${v.limit + 1}`
}

/** How many match in all, and what they are worth. */
export function countLeads(sql: TransactionSql, v: LeadPageQuery, d: string): Frag {
  return sql`
    select count(*)::int as total, coalesce(sum(l.deal_value), 0)::float8 as value
      from crm_leads l
      left join users u on u.user_id = l.assigned_to
     where ${leadWhere(sql, v, d)}`
}

/**
 * The board's first `per + 1` cards in every stage, newest first, with each
 * stage's own count and value: one statement for the whole board.
 */
export function selectColumns(sql: TransactionSql, v: LeadPageQuery, d: string, per: number): Frag {
  return sql`
    select * from (
      select c.*, c.created_at::text as k_at,
             row_number() over (partition by c.stage_id order by c.created_at desc, c.id desc)::int as k_n,
             count(*) over (partition by c.stage_id)::int as k_total,
             coalesce(sum(c.deal_value) over (partition by c.stage_id), 0)::float8 as k_value
        from ${cardsWhere(sql, v, d)}
    ) x
    where x.k_n <= ${per + 1}
    order by x.stage_id nulls last, x.k_n`
}

/** The size of every built-in view and chip, over every open, live lead (RLS decides whose). */
export function selectCounts(sql: TransactionSql, d: string): Frag {
  const tomorrow = sql`${d}::timestamptz + interval '1 day'`
  return sql`
    select count(*)::int as all,
           count(*) filter (where l.follow_up_at < ${tomorrow})::int as today,
           count(*) filter (where l.follow_up_at < ${d}::timestamptz)::int as overdue,
           count(*) filter (where l.follow_up_at >= ${d}::timestamptz and l.follow_up_at < ${tomorrow})::int as due_today,
           count(*) filter (where l.status = 'new' and l.last_contacted_at is null)::int as uncontacted,
           count(*) filter (where l.follow_up_at is null)::int as no_follow_up,
           count(*) filter (where l.is_hot)::int as hot,
           count(*) filter (where l.status = 'proposal_sent')::int as proposal_sent,
           count(*) filter (where l.assigned_to is null)::int as unassigned
      from crm_leads l
     where l.is_archived = false and l.status not in ('converted', 'lost')`
}

type KeyRow = Record<string, unknown> & { id: string; k_at: string; k_rank?: number; k_hot?: number }

/** Where the next page starts after this row. */
export function cursorAfter(row: KeyRow, order: 'urgency' | 'newest'): string {
  return order === 'urgency'
    ? encodeCursor({ rank: Number(row.k_rank), hot: Number(row.k_hot), at: row.k_at, id: row.id })
    : encodeCursor({ at: row.k_at, id: row.id })
}
