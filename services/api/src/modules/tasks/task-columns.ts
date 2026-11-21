import type { PendingQuery, Row, TransactionSql } from 'postgres'
import { toolbarWhere, type RawTask, type TaskFilter } from './task-query'

/**
 * The Tasks board a page at a time (speed audit, 21 Nov), as the Leads
 * pipeline does it: each status column's first cards with the column's own
 * total, and Show more on one column pages on within that status.
 *
 * A column's order is the board's: the hand-dragged order
 * (`production_board_card_order`, board 'default'; a card never dragged
 * counts as 0), then newest first. A keyset cursor walks it, never OFFSET.
 *
 * The ranking reads only ids and sort keys; the rows themselves come from
 * selectTasks for the ids picked, so a card is the same shape as everywhere.
 * Done is the window's finished work (`since`); cancelled work is off the
 * board, as before.
 */

export const BOARD_STATUSES = ['to_do', 'in_progress', 'review', 'blocked', 'completed'] as const
export type BoardStatus = (typeof BOARD_STATUSES)[number]

/** A column's first page and each Show more (the web's `TASK_COLUMN_PAGE`). */
export const TASK_COLUMN_PAGE = 30

/** Where a column's next page starts: the last card's hand order, when it was made, and its id. */
export interface BoardCursor {
  so: number
  at: string
  id: string
}

/** One ranked card: its id, column and sort keys (`k_at` as text keeps the microseconds). */
export interface BoardKey {
  id: string
  status: string
  k_so: number
  k_at: string
  k_n?: number
  k_total?: number
}

type Frag = PendingQuery<Row[]>

/** Every card the filters match, with its sort keys. Needs nothing joined by the caller. */
function boardBase(sql: TransactionSql, f: TaskFilter, since: string): Frag {
  return sql`
    select t.id, t.status::text as status, coalesce(o.sort_order, 0)::int as k_so,
           t.created_at as k_ts, t.created_at::text as k_at
      from tasks t
      left join projects p on p.id = t.project_id
      left join production_board_card_order o on o.task_id = t.id and o.board_view = 'default'
     where ${toolbarWhere(sql, f)}
       and ${f.project ? sql`t.project_id = ${f.project}` : sql`true`}
       and (t.status::text in ('to_do', 'in_progress', 'review', 'blocked')
            or (t.status::text = 'completed' and t.updated_at >= ${since}::timestamptz))` as unknown as Frag
}

/**
 * The first `per + 1` cards of every column, with each column's total: one
 * statement for the whole board. The extra card says whether more wait.
 */
export function selectColumnKeys(sql: TransactionSql, f: TaskFilter, since: string, per: number): Frag {
  return sql`
    select x.id, x.status, x.k_so, x.k_at, x.k_n, x.k_total from (
      select b.*,
             row_number() over (partition by b.status order by b.k_so, b.k_ts desc, b.id desc)::int as k_n,
             count(*) over (partition by b.status)::int as k_total
        from (${boardBase(sql, f, since)}) b
    ) x
    where x.k_n <= ${per + 1}
    order by x.status, x.k_n` as unknown as Frag
}

/** One column's next `limit + 1` cards after the cursor. */
export function selectColumnPageKeys(
  sql: TransactionSql,
  f: TaskFilter,
  since: string,
  status: BoardStatus,
  after: BoardCursor | null,
  limit: number,
): Frag {
  return sql`
    select b.id, b.status, b.k_so, b.k_at
      from (${boardBase(sql, f, since)}) b
     where b.status = ${status}
       and ${
         after
           ? sql`(b.k_so > ${after.so}::int
                  or (b.k_so = ${after.so}::int and (b.k_ts, b.id) < (${after.at}::timestamptz, ${after.id}::uuid)))`
           : sql`true`
       }
     order by b.k_so, b.k_ts desc, b.id desc
     limit ${limit + 1}` as unknown as Frag
}

export function encodeBoardCursor(k: Pick<BoardKey, 'k_so' | 'k_at' | 'id'>): string {
  return Buffer.from(JSON.stringify(['b', Number(k.k_so), k.k_at, k.id])).toString('base64url')
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STAMP = /^\d{4}-\d{2}-\d{2}[ T][\d:.]+([+-]\d{2}(:?\d{2})?|Z)?$/

/** A cursor back, or 'bad' when it was not one we made. */
export function decodeBoardCursor(raw: string | undefined): BoardCursor | null | 'bad' {
  if (!raw) return null
  try {
    const v: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (!Array.isArray(v) || v.length !== 4) return 'bad'
    const [k, so, at, id] = v as unknown[]
    if (k !== 'b') return 'bad'
    if (typeof so !== 'number' || !Number.isInteger(so)) return 'bad'
    if (typeof at !== 'string' || !STAMP.test(at)) return 'bad'
    if (typeof id !== 'string' || !UUID.test(id)) return 'bad'
    return { so, at, id }
  } catch {
    return 'bad'
  }
}

/** The ranked keys' rows in the keys' order, each with its hand order as `sort_order`. */
function inOrder(keys: readonly BoardKey[], rows: readonly RawTask[]) {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const out: (RawTask & { sort_order: number })[] = []
  for (const k of keys) {
    const r = byId.get(k.id)
    // A task RLS showed to the ranking but not to the read (it changed in
    // between) is simply left out.
    if (r) out.push({ ...r, sort_order: Number(k.k_so) })
  }
  return out
}

/** Every board column, even an empty one, from the ranked keys and their rows. */
export function assembleColumns(keys: readonly BoardKey[], rows: readonly RawTask[], per: number) {
  return BOARD_STATUSES.map((status) => {
    const mine = keys.filter((k) => k.status === status)
    const page = mine.slice(0, per)
    const last = page[page.length - 1]
    return {
      status,
      total: Number(mine[0]?.k_total ?? 0),
      items: inOrder(page, rows),
      next_cursor: mine.length > per && last ? encodeBoardCursor(last) : null,
    }
  })
}

/** One Show more page from its `limit + 1` keys and their rows. */
export function assemblePage(keys: readonly BoardKey[], rows: readonly RawTask[], limit: number) {
  const page = keys.slice(0, limit)
  const last = page[page.length - 1]
  return {
    items: inOrder(page, rows),
    next_cursor: keys.length > limit && last ? encodeBoardCursor(last) : null,
  }
}

/**
 * After POST /tasks/board/order saved a lane's first cards as 0..n-1 (the
 * board sends only the cards it has loaded), every other card of that lane is
 * written after them, keeping their own order -- otherwise a card never
 * dragged (0) would jump up beside the top card. Done reaches back 45 days,
 * past any window the board shows; older done cards sort after it anyway.
 */
export function placeRestAfter(sql: TransactionSql, company: string, view: string, lane: string, ids: readonly string[]): Frag {
  return sql`
    insert into production_board_card_order (company_id, board_view, lane_key, task_id, sort_order)
    select ${company}, ${view}, ${lane}, r.id, ${ids.length}::int + r.rn - 1
      from (
        select t.id, row_number() over (order by coalesce(o.sort_order, 0), t.created_at desc, t.id desc)::int as rn
          from tasks t
          left join production_board_card_order o on o.task_id = t.id and o.board_view = ${view}
         where t.status::text = ${lane}
           and t.id <> all(${ids as string[]}::uuid[])
           and (t.status::text <> 'completed' or t.updated_at >= now() - interval '45 days')
      ) r
    on conflict (company_id, board_view, task_id)
      do update set lane_key = excluded.lane_key, sort_order = excluded.sort_order` as unknown as Frag
}
