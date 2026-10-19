import { Hono } from 'hono'
import { createPartyRequest, updatePartyRequest, party } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

const list = party.array()

/**
 * Vendors, freelancers, and other parties an expense is paid to or received
 * from — shared between company and personal expenses. Any active member can
 * add one on the fly while logging an expense, the same way a shoot service
 * is typed in rather than picked from an admin-curated list first.
 */
export const partiesRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', async (c) => {
    // Lovable parity: parties manager filters (search/kind/active).
    const search = (c.req.query('search') ?? '').trim() || null
    const kind = c.req.query('kind') || null
    const active = c.req.query('active') ?? null
    const rows = await attempt(c, 'parties.list', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        try {
          return await sql`select id, name, kind, phone, email, gstin, address, state, is_active, categories from parties
           where (${search}::text is null or name ilike '%' || ${search} || '%')
             and (${kind}::text is null or kind = ${kind})
             and (${active}::text is null or (${active} = 'true' and is_active = true) or (${active} = 'false' and is_active = false))
           order by name asc`
        } catch {
          return await sql`select id, name, kind from parties order by name asc`
        }
      }),
    )
    if (!rows) fail(400, 'We could not load parties.')
    return c.json(list.parse((rows as Record<string, unknown>[]).map((r) => ({
      ...r,
      phone: (r['phone'] as string | null) ?? null,
      email: (r['email'] as string | null) ?? null,
      gstin: (r['gstin'] as string | null) ?? null,
      address: (r['address'] as string | null) ?? null,
      state: (r['state'] as string | null) ?? null,
      is_active: typeof r['is_active'] === 'boolean' ? r['is_active'] : null,
    }))))
  })

  .post('/', async (c) => {
    const parsed = createPartyRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please name the party.')
    const auth = c.get('auth')
    const row = await attempt(c, 'parties.create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        try {
          const rows = await sql`
            insert into parties ${sql({ company_id: auth.companyId, ...parsed.data })}
            returning id, name, kind, phone, email, gstin, address, state, is_active, categories`
          return rows[0] ?? null
        } catch {
          const rows = await sql`
            insert into parties ${sql({ company_id: auth.companyId, name: parsed.data.name, kind: parsed.data.kind })}
            returning id, name, kind`
          return rows[0] ?? null
        }
      }),
    )
    if (!row) fail(400, 'We could not add this party.')
    await audit(c, { action: 'party.create', entityType: 'party', entityId: (row as { id: string }).id, after: parsed.data })
    return c.json(party.parse({ ...(row as Record<string, unknown>), phone: (row as Record<string, unknown>)['phone'] ?? null, email: (row as Record<string, unknown>)['email'] ?? null, gstin: (row as Record<string, unknown>)['gstin'] ?? null, address: (row as Record<string, unknown>)['address'] ?? null, state: (row as Record<string, unknown>)['state'] ?? null, is_active: (row as Record<string, unknown>)['is_active'] ?? null }), 201)
  })

  .patch('/:id', async (c) => {
    const parsed = updatePartyRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the party details.')
    if (Object.keys(parsed.data).length === 0) fail(422, 'Nothing to change.')
    const id = uuidParam(c)
    const row = await attempt(c, 'parties.update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`
          update parties set ${sql(parsed.data)} where id = ${id}
          returning id, name, kind, phone, email, gstin, address, state, is_active, categories`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(404, 'That party was not found.')
    const updated = party.parse({ ...(row as Record<string, unknown>), phone: (row as Record<string, unknown>)['phone'] ?? null, email: (row as Record<string, unknown>)['email'] ?? null, gstin: (row as Record<string, unknown>)['gstin'] ?? null, address: (row as Record<string, unknown>)['address'] ?? null, state: (row as Record<string, unknown>)['state'] ?? null, is_active: (row as Record<string, unknown>)['is_active'] ?? null })
    await audit(c, { action: 'party.update', entityType: 'party', entityId: id, after: parsed.data })
    return c.json(updated)
  })

  // Both expense tables reference a party with ON DELETE SET NULL: a past
  // expense keeps its own record of what it paid, it just stops pointing at a
  // party that no longer exists. Deleting one is always allowed.
  .delete('/:id', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'parties.delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        delete from parties where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not delete this party.')
    if (!rows.length) fail(404, 'That party was not found.')
    await audit(c, { action: 'party.delete', entityType: 'party', entityId: id })
    return c.body(null, 204)
  })
