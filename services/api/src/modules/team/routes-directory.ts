import type { TransactionSql } from 'postgres'
import { Hono } from 'hono'
import { teamProfileGap, memberOverview, directoryMember, teamMember } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireModule, requireOwner } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser, withService } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { mayManageMember } from '@ipc/permissions'
import { listMemberDocs, serveDocument } from '../../lib/member-docs'
import { actorOf } from './shared'

export const teamDirectoryRoutes = new Hono<AppEnv>()
  // Owner: who still has an incomplete profile, and what is missing (field
  // names only -- never the values, which stay private to the member).
  .get('/profile-gaps', requireOwner(), async (c) => {
    const rows = await attempt(c, 'team.profile_gaps', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ user_id: string; missing: string[]; required: number }[]>`
        select user_id, missing, required from team_profile_gaps()`),
    )
    if (!rows) fail(400, 'We could not load profile gaps.')
    return c.json(
      teamProfileGap.array().parse(
        rows.map((r) => {
          const need = Math.max(1, Number(r.required))
          return { user_id: r.user_id, missing: r.missing, percent: Math.round((100 * (need - r.missing.length)) / need) }
        }),
      ),
    )
  })

  // Every caller of this endpoint uses it as a "who can this go to" picker
  // (a deal owner, a distribution rota, a workflow step, a booking slot) --
  // never a place to see who used to work here, so a deactivated member
  // (status = 'inactive', deleted_at still null) is excluded the same as a
  // removed one.
  // The crew picker's list. Job roles let it put the right people first for a
  // requirement; the pay basis lets a booking pre-fill its payout -- but only
  // for someone who plans crew, since this route is open to every member.
  .get('/members', async (c) => {
    const canPlan = c.get('auth').access.hasAction('projects', 'edit')
    const rows = await attempt(c, 'team.members', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select u.user_id, u.name, u.role, u.engagement_type, u.phone, u.email,
                 ${canPlan ? sql`u.payout_type` : sql`null::text`} as payout_type,
                 ${canPlan ? sql`u.freelancer_rate` : sql`null::numeric`} as freelancer_rate,
                 ${canPlan ? sql`u.rate_wedding_day` : sql`null::numeric`} as rate_wedding_day,
                 ${canPlan ? sql`u.rate_half_day` : sql`null::numeric`} as rate_half_day,
                 coalesce(u.login_enabled, true) as login_enabled,
                 -- Heartbeats are company-scoped by RLS; 0216 indexes this.
                 (select max(ue.occurred_at) from usage_events ue where ue.user_id = u.user_id) as last_seen_at,
                 coalesce(
                   array_agg(er.type_name order by er.type_name) filter (where er.id is not null),
                   '{}'::text[]
                 ) as role_names
            from users u
            left join employee_role_assignments era on era.user_id = u.user_id
            left join employee_roles er on er.id = era.role_id
           where u.deleted_at is null and u.status = 'active'
           group by u.user_id
           order by u.name`,
      ),
    )
    if (!rows) fail(400, 'We could not load the team.')
    return c.json(teamMember.array().parse(rows))
  })

  // The directory carries compensation, so the row is assembled once and then
  // trimmed per caller: only team_salaries sees `salary`. Filtering client-side
  // would ship every studio's payroll to every manager's browser.
  //
  // Lovable parity: page/page_size/search/status are honoured on the server.
  // Without page/page_size the historical array shape is returned untouched;
  // with them a { items, total, page, page_size } page is returned instead.
  .get('/directory', requireModule('team_directory'), async (c) => {
    const pageRaw = c.req.query('page')
    const sizeRaw = c.req.query('page_size')
    const search = c.req.query('search')?.trim().toLowerCase() ?? ''
    const status = c.req.query('status')?.trim() ?? ''
    const paged = pageRaw !== undefined || sizeRaw !== undefined
    const page = Math.max(1, Number(pageRaw ?? 1) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(sizeRaw ?? 25) || 25))
    const offset = (page - 1) * pageSize

    // Engagement, role and the salary range used to narrow the page the
    // browser already had, while `total` below went on counting everyone --
    // so filtering to freelancers could show an empty page 1 of 4 with the
    // freelancers on page 3. They narrow the query now, and the count agrees.
    const engagement = c.req.query('engagement_type')?.trim() ?? ''
    if (engagement && !['in_house', 'freelancer'].includes(engagement)) {
      fail(422, 'That engagement type is not one we use.')
    }
    // One control, two kinds of role: `app:<role>` is the access ladder,
    // `job:<uuid>` is one of the studio's own job roles.
    const roleParam = c.req.query('role')?.trim() ?? ''
    const [roleKind, roleValue] = roleParam ? roleParam.split(':') : [null, null]
    if (roleParam && roleKind !== 'app' && roleKind !== 'job') fail(422, 'That role filter is not valid.')
    if (roleKind === 'job' && !/^[0-9a-f-]{36}$/i.test(roleValue ?? '')) fail(422, 'That job role is not valid.')

    // A salary bound is only honoured for someone allowed to see salaries.
    // Applied for anyone else it would leak the figures it is hiding: page
    // through "min 80000" and you have the list without ever seeing a number.
    const canSeeSalary = c.get('auth').access.hasModule('team_salaries')
    const bound = (key: string): number | null => {
      const raw = c.req.query(key)?.trim()
      if (!raw || !canSeeSalary) return null
      const n = Number(raw)
      if (!Number.isFinite(n)) fail(422, 'That salary filter is not a number.')
      return n
    }
    const minSalary = bound('min_salary')
    const maxSalary = bound('max_salary')

    const narrow = (sql: TransactionSql) => sql`
      and ${engagement ? sql`u.engagement_type = ${engagement}` : sql`true`}
      and ${roleKind === 'app' ? sql`u.role = ${roleValue}` : sql`true`}
      and ${
        roleKind === 'job'
          ? sql`exists (select 1 from employee_role_assignments x where x.user_id = u.user_id and x.role_id = ${roleValue}::uuid)`
          : sql`true`
      }
      -- A bound only ever narrows. Someone with no salary recorded drops out
      -- of both directions rather than being counted as zero, which would put
      -- them inside every "under X" -- a claim about a figure nobody entered.
      and ${minSalary === null ? sql`true` : sql`(u.salary is not null and u.salary >= ${minSalary})`}
      and ${maxSalary === null ? sql`true` : sql`(u.salary is not null and u.salary <= ${maxSalary})`}`

    const rows = await attempt(c, 'team.directory', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select
            u.user_id, u.name, u.email, u.role, u.phone, u.alternate_phone, u.status,
            u.engagement_type, u.login_enabled, u.salary, u.address, u.created_at,
            u.freelancer_rate, u.rate_wedding_day, u.rate_half_day,
            u.payout_type, u.commission_pct, u.commission_basis, u.stipend_amount,
            u.pay_effective_from, u.pay_effective_to, u.compensation_notes,
            u.payment_type, u.pay_components, u.payment_status,
            coalesce(
              array_agg(er.type_name order by er.type_name) filter (where er.id is not null),
              '{}'::text[]
            ) as role_names,
            coalesce(
              array_agg(er.id order by er.type_name) filter (where er.id is not null),
              '{}'::uuid[]
            ) as role_ids,
            (select max(ue.occurred_at) from usage_events ue where ue.user_id = u.user_id) as last_seen_at
          from users u
          left join employee_role_assignments era on era.user_id = u.user_id
          left join employee_roles er on er.id = era.role_id
          where u.deleted_at is null
            and ${status ? sql`u.status = ${status}` : sql`true`}
            and ${search ? sql`(lower(u.name) like ${`%${search}%`} or lower(coalesce(u.email, '')) like ${`%${search}%`} or coalesce(u.phone, '') like ${`%${search}%`} or coalesce(u.alternate_phone, '') like ${`%${search}%`})` : sql`true`}
            ${narrow(sql)}
          group by u.user_id
          order by u.name
          ${paged ? sql`limit ${pageSize} offset ${offset}` : sql``}`,
      ),
    )
    if (!rows) fail(400, 'We could not load the team.')

    const list = directoryMember.array().parse(rows)
    const shaped = canSeeSalary
      ? list
      : list.map((m) => ({
          ...m,
          salary: null,
          freelancer_rate: null,
          rate_wedding_day: null,
          rate_half_day: null,
          commission_pct: null,
          stipend_amount: null,
          compensation_notes: null,
        }))
    if (!paged) return c.json(shaped)

    const counted = await attempt(c, 'team.directory_count', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ n: string }[]>`
          select count(*)::text as n from users u
          where u.deleted_at is null
            and ${status ? sql`u.status = ${status}` : sql`true`}
            and ${search ? sql`(lower(u.name) like ${`%${search}%`} or lower(coalesce(u.email, '')) like ${`%${search}%`} or coalesce(u.phone, '') like ${`%${search}%`} or coalesce(u.alternate_phone, '') like ${`%${search}%`})` : sql`true`}
            ${narrow(sql)}`,
      ),
    )
    const total = Number(counted?.[0]?.n ?? shaped.length)
    return c.json({ items: shaped, total, page, page_size: pageSize })
  })

  // One member, seen from every side (the member page). Open to the member
  // themself and to whoever holds team_directory; every section is trimmed
  // here for the person asking, so nothing they may not see leaves the server.
  .get('/members/:id/overview', async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const self = auth.userId === id
    const access = auth.access
    if (!self && !access.hasModule('team_directory')) fail(403, 'You do not have access to this member.')
    // Leave and other people's attendance are for whoever decides them (RLS
    // agrees: anyone else would read an empty month and think it was real).
    const decides = auth.isOwner || ['super_admin', 'admin', 'manager'].includes(auth.role)
    const see = {
      private: self || auth.isOwner,
      salary: self || access.hasModule('team_salaries'),
      payouts: self || access.hasModule('team_payouts'),
      work: self || access.hasAction('projects', 'view'),
      tasks: self || decides,
      attendance: self || (decides && access.hasModule('attendance')),
      leave: self || decides,
    }

    const data = await attempt(c, 'team.member_overview', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const [m] = await sql`
          select u.user_id, u.name, u.email, u.phone, u.alternate_phone, u.address, u.avatar_url, u.role,
                 coalesce(u.status, 'active') as status, u.engagement_type, coalesce(u.login_enabled, true) as login_enabled,
                 (co.owner_user_id = u.user_id) as is_owner, u.created_at,
                 u.salary::float8 as salary, u.freelancer_rate::float8 as freelancer_rate,
                 coalesce((select array_agg(er.type_name order by er.type_name)
                             from employee_role_assignments era join employee_roles er on er.id = era.role_id
                            where era.user_id = u.user_id), '{}'::text[]) as role_names,
                 profile_missing(u.user_id) as missing, profile_required_count(u.user_id) as required
            from users u
            join companies co on co.id = u.company_id
           where u.user_id = ${id} and u.deleted_at is null`
        if (!m) return 'missing' as const

        const today = sql`(now() at time zone 'Asia/Kolkata')::date`
        const monthStart = sql`date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date`

        const priv = see.private
          ? (await sql`
              select date_of_birth, blood_group, joined_on, emergency_name, emergency_relation, emergency_phone,
                     upi_id, bank_account_name, right(nullif(btrim(bank_account_number), ''), 4) as bank_account_last4,
                     bank_ifsc, pan is not null as pan_on_file
                from member_profiles where user_id = ${id}`)[0] ?? {
              date_of_birth: null, blood_group: null, joined_on: null, emergency_name: null, emergency_relation: null,
              emergency_phone: null, upi_id: null, bank_account_name: null, bank_account_last4: null, bank_ifsc: null, pan_on_file: false,
            }
          : null

        let attendance = null
        if (see.attendance) {
          const [a] = await sql`
            select to_char(${monthStart}, 'YYYY-MM') as month,
                   count(*) filter (where status = 'present')::int as present,
                   count(*) filter (where status = 'late')::int as late,
                   count(*) filter (where status = 'absent')::int as absent,
                   coalesce(sum(late_minutes) filter (where status = 'late'), 0)::int as late_minutes
              from attendance
             where user_id = ${id} and a_date between ${monthStart} and ${today}`
          const [l] = await sql`
            select coalesce(sum(case when half_day then 0.5
                                     else (least(end_date, ${today}) - greatest(start_date, ${monthStart}) + 1) end), 0)::float8 as days
              from leave_requests
             where user_id = ${id} and status = 'approved' and end_date >= ${monthStart} and start_date <= ${today}`
          const [t] = await sql`
            select a.status, a.check_in_at, a.check_out_at, on_leave(${id}, ${today}) as on_leave
              from (select 1) x
              left join attendance a on a.user_id = ${id} and a.a_date = ${today}`
          attendance = { ...a, leave_days: Number(l?.days ?? 0), today: t ?? null }
        }

        let work = null
        if (see.work) {
          const shoots = await sql`
            select s.id, s.shoot_id, sh.name as shoot_name, s.service_name, p.id as project_id, p.name as project_name,
                   cl.name as client_name, s.start_at, s.end_at, sh.location
              from team_assignment_slots s
              left join shoots sh on sh.id = s.shoot_id
              left join projects p on p.id = sh.project_id
              left join clients cl on cl.id = p.client_id
             where s.user_id = ${id} and s.status = 'booked' and s.end_at >= now()
             order by s.start_at
             limit 8`
          const [month] = await sql`
            select count(*)::int as n from team_assignment_slots
             where user_id = ${id} and status = 'booked'
               and (start_at at time zone 'Asia/Kolkata')::date >= ${monthStart}
               and (start_at at time zone 'Asia/Kolkata')::date < (${monthStart} + interval '1 month')::date`
          const deliverables = await sql`
            select d.id, d.title, d.project_id, p.name as project_name, d.status, d.estimated_date, d.started_at,
                   coalesce(d.estimated_date < ${today}, false) as late
              from deliverables d
              join projects p on p.id = d.project_id
             where d.assignee_id = ${id} and d.status not in ('completed', 'cancelled')
             order by d.estimated_date nulls last, d.created_at
             limit 20`
          const tasks = see.tasks
            ? await sql`
                select t.id, t.title, t.project_id, p.name as project_name, t.status::text as status,
                       t.priority::text as priority, t.due_date, coalesce(t.due_date < ${today}, false) as late
                  from tasks t
                  join task_assignees ta on ta.task_id = t.id and ta.user_id = ${id}
                  left join projects p on p.id = t.project_id
                 where t.status not in ('completed', 'cancelled')
                 order by t.due_date nulls last, t.created_at
                 limit 20`
            : null
          work = { shoots, deliverables, tasks, shoots_this_month: month?.n ?? 0 }
        }

        const leave = see.leave
          ? await sql`
              select id, kind, start_date, end_date, half_day, status
                from leave_requests
               where user_id = ${id} and status in ('pending', 'approved') and end_date >= ${today}
               order by start_date
               limit 10`
          : null

        const payouts = see.payouts
          ? await sql`
              select id, amount::float8 as amount, period_start, period_end, status, payment_mode, reference, created_at
                from team_payouts
               where user_id = ${id}
               order by period_end desc, created_at desc
               limit 12`
          : null

        return { m, priv, attendance, work, leave, payouts }
      }),
    )
    if (data === 'missing') fail(404, 'That team member was not found.')
    if (!data) fail(400, 'We could not load this member.')

    // Salaries are readable by owners, admins and managers under RLS; the
    // member reads their own here, with the check above standing in for it.
    const salaries = see.salary
      ? await attempt(c, 'team.member_overview_salaries', () =>
          withService(c.env, (sql) => sql`
            select id, pay_month as month, pay_year as year, coalesce(base_amount, 0)::float8 as base_amount,
                   coalesce(paid_amount, 0)::float8 as paid_amount, status
              from monthly_salaries
             where company_id = ${auth.companyId} and user_id = ${id} and pay_month is not null and pay_year is not null
             order by pay_year desc, pay_month desc
             limit 12`),
        )
      : null

    const { m, priv, attendance, work, leave, payouts } = data
    const need = Math.max(1, Number(m.required))
    const missing = (m.missing as string[]) ?? []
    return c.json(
      memberOverview.parse({
        member: {
          ...m,
          salary: see.salary ? m.salary : null,
          freelancer_rate: see.salary || access.hasAction('projects', 'edit') ? m.freelancer_rate : null,
        },
        profile: { missing, percent: Math.round((100 * (need - missing.length)) / need) },
        private: priv,
        attendance,
        work,
        leave,
        salaries: salaries ?? (see.salary ? [] : null),
        payouts,
        can: {
          edit:
            (auth.isOwner || access.hasAction('team_directory', 'edit')) &&
            mayManageMember(actorOf(c), { user_id: id, role: String(m.role), is_owner: Boolean(m.is_owner) }),
          see_pay: see.salary || see.payouts,
          manage_access: auth.isOwner,
        },
      }),
    )
  })

  // A member's ID proof, for the owner (RLS: the member and the owner only).
  .get('/members/:id/documents', requireOwner(), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'team.member_documents', () => withUser(c.env, c.get('auth').userId, (sql) => listMemberDocs(sql, id)))
    if (!rows) fail(400, 'We could not load their documents.')
    return c.json(rows)
  })

  .get('/members/:id/documents/:docId', requireOwner(), async (c) => {
    const id = uuidParam(c)
    const docId = uuidParam(c, 'docId')
    const rows = await attempt(c, 'team.member_document', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ name: string; mime: string; bytes: Buffer }[]>`
        select name, mime, bytes from member_documents where id = ${docId} and user_id = ${id}`),
    )
    if (!rows) fail(400, 'We could not load that document.')
    if (!rows.length) fail(404, 'That document was not found.')
    await audit(c, { action: 'member.document_viewed', entityType: 'user', entityId: id })
    return serveDocument(rows[0]!)
  })
