import { Hono } from 'hono'
import { crmStats, crmStatsQuery, crmTeamStatsRow } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'

const dateRange = (c: { req: { query: (k: string) => string | undefined } }) => {
  const today = new Date()
  const from = new Date(today)
  from.setDate(from.getDate() - 29)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const parsed = crmStatsQuery.safeParse({
    from: c.req.query('from') ?? iso(from),
    to: c.req.query('to') ?? iso(today),
    source: c.req.query('source') || undefined,
    assignee: c.req.query('assignee') || undefined,
  })
  if (!parsed.success || parsed.data.to < parsed.data.from) fail(422, 'Pick a valid date range.')
  return parsed.data
}

export const crmReportRoutes = new Hono<AppEnv>()
  // ── Reports ─────────────────────────────────────────────────
  .get('/stats', async (c) => {
    const range = dateRange(c)
    const rows = await attempt(c, 'crm.stats', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ stats: unknown }[]>`select crm_stats(
          ${range.from}::date, ${range.to}::date,
          ${range.source ?? null}::text, ${range.assignee ?? null}::uuid) as stats`,
      ),
    )
    if (!rows) fail(400, 'Stats failed.')
    const base = crmStats.parse(rows[0]?.stats ?? {})
    // Lovable parity extras: pipeline value, quality split, 5-way
    // follow-up health, activity + won/lost trends, proposal KPI, warnings.
    const extras = await attempt(c, 'crm.stats_extras', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [q] = await sql<{
          pipeline_value: number;
          overdue: number; due_today: number; due_tomorrow: number; upcoming_7d: number; no_follow_up: number;
          proposal_count: number; proposal_value: number;
        }[]>`
          select coalesce(sum(l.deal_value) filter (where l.status not in ('converted', 'lost')), 0) as pipeline_value,
                 count(*) filter (where l.status not in ('converted', 'lost') and l.follow_up_at is not null and l.follow_up_at < now())::int as overdue,
                 count(*) filter (where l.status not in ('converted', 'lost') and l.follow_up_at >= date_trunc('day', now()) and l.follow_up_at < date_trunc('day', now()) + interval '1 day')::int as due_today,
                 count(*) filter (where l.status not in ('converted', 'lost') and l.follow_up_at >= date_trunc('day', now()) + interval '1 day' and l.follow_up_at < date_trunc('day', now()) + interval '2 days')::int as due_tomorrow,
                 count(*) filter (where l.status not in ('converted', 'lost') and l.follow_up_at >= date_trunc('day', now()) + interval '2 days' and l.follow_up_at < date_trunc('day', now()) + interval '8 days')::int as upcoming_7d,
                 count(*) filter (where l.status not in ('converted', 'lost') and l.follow_up_at is null)::int as no_follow_up,
                 count(*) filter (where l.status = 'proposal_sent')::int as proposal_count,
                 coalesce(sum(l.deal_value) filter (where l.status = 'proposal_sent'), 0) as proposal_value
          from crm_leads l
          where l.company_id = get_current_company_id() and l.is_archived = false`
        const qb = await sql<{ quality: string | null; count: number }[]>`
          select l.quality, count(*)::int as count from crm_leads l
          where l.company_id = get_current_company_id() and l.is_archived = false
          group by l.quality`
        const quality_breakdown: Record<string, number> = {}
        for (const r of qb) quality_breakdown[r.quality ?? 'unset'] = r.count
        const trend = await sql<{ day: string; count: number }[]>`
          select to_char(d, 'YYYY-MM-DD') as day, count(a.id)::int as count
          from generate_series(${range.from}::date, ${range.to}::date, interval '1 day') d
          left join crm_activities a on a.created_at::date = d::date
            and a.company_id = get_current_company_id()
          group by d order by d`
        const wl = await sql<{ day: string; won: number; lost: number }[]>`
          select to_char(d, 'YYYY-MM-DD') as day,
                 count(l.id) filter (where l.status = 'converted')::int as won,
                 count(l.id) filter (where l.status = 'lost')::int as lost
          from generate_series(${range.from}::date, ${range.to}::date, interval '1 day') d
          left join crm_leads l on l.company_id = get_current_company_id()
            and coalesce(l.converted_at, l.stage_changed_at, l.updated_at)::date = d::date
          group by d order by d`
        return { q: q ?? null, quality_breakdown, trend, wl }
      }),
    )
    const warnings: string[] = []
    if ((extras?.q?.no_follow_up ?? 0) > 0) warnings.push(`${extras?.q?.no_follow_up} open leads have no follow-up set.`)
    if ((extras?.q?.overdue ?? 0) > 0) warnings.push(`${extras?.q?.overdue} follow-ups are overdue.`)
    if (base.uncontacted > 0) warnings.push(`${base.uncontacted} new leads were never contacted.`)
    return c.json(
      crmStats.parse({
        ...base,
        pipeline_value: extras?.q?.pipeline_value ?? 0,
        quality_breakdown: extras?.quality_breakdown ?? {},
        follow_up_health: {
          overdue: extras?.q?.overdue ?? 0,
          due_today: extras?.q?.due_today ?? 0,
          due_tomorrow: extras?.q?.due_tomorrow ?? 0,
          upcoming_7d: extras?.q?.upcoming_7d ?? 0,
          no_follow_up: extras?.q?.no_follow_up ?? 0,
        },
        activity_trend: extras?.trend ?? [],
        won_lost_trend: extras?.wl ?? [],
        proposal_count: extras?.q?.proposal_count ?? 0,
        proposal_value: extras?.q?.proposal_value ?? 0,
        warnings,
      }),
    )
  })

  .get('/team-stats', async (c) => {
    const range = dateRange(c)
    const rows = await attempt(c, 'crm.team_stats', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`select * from crm_team_stats(${range.from}::date, ${range.to}::date)`,
      ),
    )
    if (!rows) fail(400, 'We could not load the team view.')
    const base = crmTeamStatsRow.array().parse(rows)
    // Lovable parity: per-member outreach (whatsapp / messages / notes) +
    // pipeline value + warnings.
    const extra = await attempt(c, 'crm.team_stats_extras', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        // Two aggregates, joined after: one join of both tables multiplied
        // each person's messages by their leads and their pipeline by their messages.
        return sql<{
          user_id: string; whatsapp: number; messages: number; notes: number; pipeline_value: number;
        }[]>`
          select m.user_id,
                 coalesce(a.whatsapp, 0) as whatsapp, coalesce(a.messages, 0) as messages, coalesce(a.notes, 0) as notes,
                 coalesce(l.pipeline_value, 0) as pipeline_value
          from users m
          left join (
            select actor_id,
                   count(*) filter (where type = 'whatsapp')::int as whatsapp,
                   count(*) filter (where type in ('whatsapp', 'sms', 'email'))::int as messages,
                   count(*) filter (where type = 'note')::int as notes
              from crm_activities
             where company_id = get_current_company_id()
               and created_at >= ${range.from}::timestamptz and created_at < (${range.to}::date + 1)::timestamptz
             group by actor_id
          ) a on a.actor_id = m.user_id
          left join (
            select assigned_to, sum(deal_value) as pipeline_value
              from crm_leads
             where company_id = get_current_company_id() and is_archived = false
               and status not in ('converted', 'lost')
             group by assigned_to
          ) l on l.assigned_to = m.user_id
          where m.company_id = get_current_company_id() and m.deleted_at is null`
      }),
    )
    const byId = new Map((extra ?? []).map((e) => [e.user_id, e]))
    return c.json(
      crmTeamStatsRow.array().parse(
        base.map((r) => {
          const e = byId.get(r.user_id)
          const warn: string[] = []
          if (r.overdue > 0) warn.push(`${r.overdue} overdue follow-ups.`)
          if (r.uncontacted > 0) warn.push(`${r.uncontacted} leads never contacted.`)
          if (r.open > 0 && (e?.messages ?? 0) === 0) warn.push('No outreach logged in range.')
          return {
            ...r,
            whatsapp: e?.whatsapp ?? 0,
            messages: e?.messages ?? 0,
            notes: e?.notes ?? 0,
            pipeline_value: e?.pipeline_value ?? 0,
            warnings: warn,
          }
        }),
      ),
    )
  })
