import { Hono } from 'hono'
import { client, createClientRequest, updateClientRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

export const clientsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', requireAction('clients', 'view'), async (c) => {
    const url = new URL(c.req.url)
    const hasPaging =
      url.searchParams.has('page') ||
      url.searchParams.has('page_size') ||
      url.searchParams.has('search') ||
      url.searchParams.has('sort') ||
      url.searchParams.has('relation') ||
      url.searchParams.has('created_from') ||
      url.searchParams.has('created_to')
    if (!hasPaging) {
      const rows = await attempt(c, 'clients.list', () =>
        withUser(c.env, c.get('auth').userId, (sql) => sql`select * from clients order by created_at desc`),
      )
      if (!rows) fail(400, 'We could not load your clients.')
      return c.json(client.array().parse(rows))
    }
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1)
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('page_size') ?? '20') || 20))
    const search = (url.searchParams.get('search') ?? '').trim()
    const sort = (url.searchParams.get('sort') ?? 'recent').trim()
    const orderBy = sort === 'name' ? 'name asc' : sort === 'city' ? 'city asc nulls last, name asc' : 'created_at desc'
    // Relation and the added-on range used to be applied in the browser, to
    // whichever 25 rows the current page happened to hold, while `total` and
    // the pager went on counting every client. "Relation: referral" could
    // therefore show an empty page 1 of 5 with referrals sitting on page 3.
    const relation = (url.searchParams.get('relation') ?? '').trim()
    const createdFrom = (url.searchParams.get('created_from') ?? '').trim()
    const createdTo = (url.searchParams.get('created_to') ?? '').trim()
    for (const [name, v] of [['created_from', createdFrom], ['created_to', createdTo]] as const) {
      if (v && Number.isNaN(Date.parse(v))) fail(422, `That ${name} date is invalid.`)
    }
    const offset = (page - 1) * pageSize
    const result = await attempt(c, 'clients.list.page', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const where = sql`
          where ${search ? sql`(name ilike ${'%' + search + '%'} or coalesce(phone,'') ilike ${'%' + search + '%'} or coalesce(email,'') ilike ${'%' + search + '%'} or coalesce(city,'') ilike ${'%' + search + '%'})` : sql`true`}
            and ${relation ? sql`coalesce(relation,'') ilike ${'%' + relation + '%'}` : sql`true`}
            and ${createdFrom ? sql`created_at >= ${createdFrom}::date` : sql`true`}
            -- A "to" date means the whole of that day, not midnight on it.
            and ${createdTo ? sql`created_at < (${createdTo}::date + 1)` : sql`true`}`
        const countRows = await sql<{ n: number }[]>`
          select count(*)::int as n from clients ${where}`
        const rows = await sql`
          select * from clients ${where}
          order by ${sql.unsafe(orderBy)} limit ${pageSize} offset ${offset}`
        return { total: countRows[0]?.n ?? 0, rows }
      }),
    )
    if (!result) fail(400, 'We could not load your clients.')
    return c.json({ items: client.array().parse(result.rows), total: result.total, page, page_size: pageSize })
  })

  .post('/', requireAction('clients', 'create'), async (c) => {
    const parsed = createClientRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the client details and try again.')
    const auth = c.get('auth')
    // Lovable parity: duplicate-by-phone returns the existing client (409 + link).
    const phone = (parsed.data.phone ?? '').trim()
    if (phone) {
      const existing = await attempt(c, 'clients.dedupe', () =>
        withUser(c.env, auth.userId, async (sql) => {
          const rows = await sql`select * from clients where phone = ${phone} limit 1`
          return rows[0] ?? null
        }),
      )
      if (existing) {
        return c.json({ existing_client: client.parse(existing) }, 409)
      }
    }
    const row = await attempt(
      c,
      'clients.create',
      () =>
        withUser(c.env, auth.userId, async (sql) => {
          const rows = await sql`
          insert into clients ${sql({ ...parsed.data, company_id: auth.companyId, created_by: auth.userId })}
          returning *`
          return rows[0] ?? null
        }),
      {
        onCode: (code) => (code === '23505' ? 'taken' : undefined),
      },
    )
    if (row === 'taken') {
      const existing = await attempt(c, 'clients.dedupe.retry', () =>
        withUser(c.env, auth.userId, async (sql) => {
          const rows = await sql`select * from clients where phone = ${phone} limit 1`
          return rows[0] ?? null
        }),
      )
      if (existing) return c.json({ existing_client: client.parse(existing) }, 409)
      fail(409, 'A client with this phone already exists.')
    }
    if (!row) fail(400, 'We could not create this client.')
    const created = client.parse(row)
    await audit(c, { action: 'client.create', entityType: 'client', entityId: created.id, after: parsed.data })
    return c.json(created, 201)
  })

  .get('/:id', requireAction('clients', 'view'), async (c) => {
    const id = uuidParam(c)
    const row = await attempt(c, 'clients.get', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`select * from clients where id = ${id}`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(404, 'That client was not found.')
    return c.json(client.parse(row))
  })

  // Project history for the client detail page (avoids fetching every project).
  // Also what the invoice editor lists once a customer is picked, so anyone who
  // may see invoices may read it -- not only people with the Clients page.
  .get('/:id/projects', async (c, next) => {
    const a = c.get('auth').access
    if (!a.hasAction('clients', 'view') && !a.hasAction('billing', 'view')) fail(403, 'You do not have access to this.')
    await next()
  }, async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'clients.projects', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select p.id, p.name, p.status, p.client_id, cl.name as client_name, cl.phone as client_phone,
               p.package_cost, p.total_cost,
               coalesce((select sum(rp.amount) from received_payments rp where rp.project_id = p.id and coalesce(rp.status, 'paid') = 'paid'),0) as received,
               p.created_at, null::date as next_shoot_date, 0::int as tasks_overdue
        from projects p left join clients cl on cl.id = p.client_id
        where p.client_id = ${id} order by p.created_at desc`),
    )
    if (!rows) fail(400, 'We could not load project history.')
    const { projectListItem } = await import('@ipc/contracts')
    return c.json(projectListItem.array().parse(rows))
  })

  .patch('/:id', requireAction('clients', 'edit'), async (c) => {
    const parsed = updateClientRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the client details and try again.')
    if (Object.keys(parsed.data).length === 0) fail(422, 'Nothing to change.')
    const id = uuidParam(c)
    const row = await attempt(c, 'clients.update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`update clients set ${sql(parsed.data)} where id = ${id} returning *`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(404, 'That client was not found.')
    await audit(c, { action: 'client.update', entityType: 'client', entityId: id, after: parsed.data })
    return c.json(client.parse(row))
  })

  .delete('/:id', requireAction('clients', 'delete'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(
      c,
      'clients.delete',
      () =>
        withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
          delete from clients where id = ${id} returning id`),
      { onCode: (code) => (code === '23503' ? 'in_use' : undefined) },
    )
    if (rows === 'in_use') fail(409, 'This client has linked projects and cannot be deleted.')
    if (!rows) fail(400, 'We could not delete this client.')
    if (!rows.length) fail(404, 'That client was not found.')
    await audit(c, { action: 'client.delete', entityType: 'client', entityId: id })
    return c.body(null, 204)
  })
