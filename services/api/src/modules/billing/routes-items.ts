import { Hono } from 'hono'
import { invoiceItemPreset, upsertInvoiceItemPresetRequest, z } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'

export const invoiceItemRoutes = new Hono<AppEnv>()
  // ── Saved items: what the studio bills again and again ─────────────
  .get('/items', async (c) => {
    const rows = await attempt(c, 'billing.items', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select id, name, description, rate, hsn_sac, gst_rate, kind
          from invoice_item_presets where company_id = ${c.get('auth').companyId}
         order by lower(name)`),
    )
    if (!rows) fail(400, 'We could not load your saved items.')
    return c.json(z.array(invoiceItemPreset).parse(rows.map((r) => ({ ...r, rate: Number(r.rate), gst_rate: Number(r.gst_rate) }))))
  })

  .post('/items', requireAction('billing', 'create'), async (c) => {
    const parsed = upsertInvoiceItemPresetRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the item details.')
    const d = parsed.data
    const auth = c.get('auth')
    const rows = await attempt(
      c,
      'billing.item_create',
      () =>
        withUser(c.env, auth.userId, (sql) => sql<{ id: string }[]>`
          insert into invoice_item_presets (company_id, name, description, rate, hsn_sac, gst_rate, kind, created_by)
          values (${auth.companyId}, ${d.name}, ${d.description?.trim() || null}, ${d.rate}, ${d.hsn_sac?.trim() || null},
                  ${d.gst_rate}, ${d.kind}, ${auth.userId})
          returning id`),
      { onCode: (code) => (code === '23505' ? 'taken' : undefined) },
    )
    if (rows === 'taken') fail(409, 'An item with this name is already saved.')
    if (!rows?.[0]) fail(400, 'We could not save the item.')
    return c.json({ id: rows[0].id }, 201)
  })

  .patch('/items/:id', requireAction('billing', 'edit'), async (c) => {
    const parsed = upsertInvoiceItemPresetRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the item details.')
    const d = parsed.data
    const id = uuidParam(c)
    const rows = await attempt(
      c,
      'billing.item_update',
      () =>
        withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
          update invoice_item_presets set name = ${d.name}, description = ${d.description?.trim() || null}, rate = ${d.rate},
                 hsn_sac = ${d.hsn_sac?.trim() || null}, gst_rate = ${d.gst_rate}, kind = ${d.kind}
           where id = ${id} and company_id = ${c.get('auth').companyId}
          returning id`),
      { onCode: (code) => (code === '23505' ? 'taken' : undefined) },
    )
    if (rows === 'taken') fail(409, 'An item with this name is already saved.')
    if (!rows?.[0]) fail(404, 'That item was not found.')
    return c.json({ ok: true })
  })

  .delete('/items/:id', requireAction('billing', 'delete'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'billing.item_delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        delete from invoice_item_presets where id = ${id} and company_id = ${c.get('auth').companyId} returning id`),
    )
    if (!rows?.[0]) fail(404, 'That item was not found.')
    return c.json({ ok: true })
  })
