import { Hono } from 'hono'
import {
  createInvoiceTemplateRequest,
  invoiceTemplate,
  invoiceTemplateList,
  createInvoiceNoteTemplateRequest,
  invoiceSignatureRequest,
  invoiceNoteTemplateList,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

export const invoiceTemplateRoutes = new Hono<AppEnv>()
  // ── Invoice Templates ──────────────────────────────────────
  .get('/templates', async (c) => {
    const rows = await attempt(c, 'billing.templates_list', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select id, company_id, name, layout_json, is_default, created_at
          from invoice_templates
         where company_id = ${c.get('auth').companyId}
         order by is_default desc, created_at desc`),
    )
    if (!rows) fail(400, 'We could not load templates.')
    return c.json(invoiceTemplateList.parse({ items: rows }))
  })

  .post('/templates', requireAction('billing', 'edit'), async (c) => {
    const parsed = createInvoiceTemplateRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the template details.')
    const auth = c.get('auth')
    const d = parsed.data
    const rows = await attempt(c, 'billing.template_create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        // A new design keeps the studio's signature (set once from an invoice).
        if (d.layout_json.signatory_name === undefined && d.layout_json.signature_image === undefined) {
          const [had] = await sql<{ n: string | null; t: string | null; i: string | null }[]>`
            select layout_json->>'signatory_name' as n, layout_json->>'signatory_title' as t, layout_json->>'signature_image' as i
              from invoice_templates where company_id = ${auth.companyId}
             order by is_default desc, created_at limit 1`
          if (had) Object.assign(d.layout_json, { signatory_name: had.n, signatory_title: had.t, signature_image: had.i })
        }
        // If setting as default, unset other defaults
        if (d.is_default) {
          await sql`update invoice_templates set is_default = false where company_id = ${auth.companyId} and is_default = true`
        }
        const made = await sql<{ id: string; company_id: string; name: string; layout_json: unknown; is_default: boolean; created_at: string }[]>`
          insert into invoice_templates (company_id, name, layout_json, is_default)
          values (${auth.companyId}, ${d.name}, ${sql.json(d.layout_json)}, ${d.is_default})
          returning id, company_id, name, layout_json, is_default, created_at`
        return made
      }),
    )
    if (!rows?.[0]) fail(400, 'We could not create this template.')
    await audit(c, { action: 'invoice_template.create', entityType: 'invoice_template', entityId: rows[0].id, after: { name: d.name } })
    return c.json(invoiceTemplate.parse(rows[0]), 201)
  })

  .patch('/templates/:id', requireAction('billing', 'edit'), async (c) => {
    const id = uuidParam(c)
    const parsed = createInvoiceTemplateRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the template details.')
    const auth = c.get('auth')
    const d = parsed.data
    const rows = await attempt(c, 'billing.template_update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        if (d.is_default) {
          await sql`update invoice_templates set is_default = false where company_id = ${auth.companyId} and is_default = true and id != ${id}`
        }
        return sql<{ id: string }[]>`
          update invoice_templates
             set name = ${d.name}, layout_json = ${sql.json(d.layout_json)}, is_default = ${d.is_default}
           where id = ${id} and company_id = ${auth.companyId}
           returning id`
      }),
    )
    if (!rows) fail(400, 'We could not save this template.')
    if (!rows.length) fail(404, 'We could not find that template.')
    await audit(c, { action: 'invoice_template.update', entityType: 'invoice_template', entityId: id, after: d })
    return c.json({ ok: true })
  })

  // Who signs the invoices, set from the invoice itself (owner, 26 Oct): the
  // name, title and signature go on every one of the studio's designs, so a
  // switch of design never loses them. A studio with no design yet gets one.
  .put('/signature', requireAction('billing', 'edit'), async (c) => {
    const parsed = invoiceSignatureRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the signature.')
    const auth = c.get('auth')
    const patch = {
      signatory_name: parsed.data.signatory_name || null,
      signatory_title: parsed.data.signatory_title || null,
      signature_image: parsed.data.signature_image,
    }
    const done = await attempt(c, 'billing.signature', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql<{ id: string }[]>`
          update invoice_templates set layout_json = coalesce(layout_json, '{}'::jsonb) || ${sql.json(patch)}
           where company_id = ${auth.companyId}
          returning id`
        if (rows.length) return rows.length
        const layout = createInvoiceTemplateRequest.parse({ name: 'Standard' }).layout_json
        await sql`
          insert into invoice_templates (company_id, name, layout_json, is_default)
          values (${auth.companyId}, 'Standard', ${sql.json({ ...layout, ...patch })}, true)`
        return 1
      }),
    )
    if (!done) fail(400, 'We could not save the signature.')
    await audit(c, {
      action: 'invoice_template.signature',
      entityType: 'invoice_template',
      entityId: null,
      after: { signatory_name: patch.signatory_name, signatory_title: patch.signatory_title, signature: !!patch.signature_image },
    })
    return c.json({ ok: true })
  })

  .delete('/templates/:id', requireAction('billing', 'edit'), async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const rows = await attempt(c, 'billing.template_delete', () =>
      withUser(c.env, auth.userId, async (sql) => {
        return sql<{ id: string }[]>`
          delete from invoice_templates where id = ${id} and company_id = ${auth.companyId} returning id`
      }),
    )
    if (!rows) fail(400, 'We could not delete this template.')
    if (!rows.length) fail(404, 'We could not find that template.')
    await audit(c, { action: 'invoice_template.delete', entityType: 'invoice_template', entityId: id })
    return c.json({ ok: true })
  })

  // ── Notes snippet library (billing module) ──────────────────
  // Independent of the print-layout templates above -- a reusable Notes
  // string, not a layout. template_type splits Terms from Notes.
  .get('/note-templates', async (c) => {
    const rows = await attempt(c, 'billing.note_templates_list', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select id, company_id, title, content,
               coalesce(template_type, 'note') as template_type,
               is_default, created_at
          from invoice_note_templates
         where company_id = ${c.get('auth').companyId} and is_active = true
         order by is_default desc, created_at desc`),
    )
    if (!rows) fail(400, 'We could not load note templates.')
    return c.json(invoiceNoteTemplateList.parse({ items: rows }))
  })

  .post('/note-templates', requireAction('billing', 'edit'), async (c) => {
    const parsed = createInvoiceNoteTemplateRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the note template details.')
    const auth = c.get('auth')
    const d = parsed.data
    const rows = await attempt(c, 'billing.note_template_create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        if (d.is_default) {
          await sql`update invoice_note_templates set is_default = false where company_id = ${auth.companyId} and coalesce(template_type, 'note') = ${d.template_type} and is_default = true`
        }
        return sql<{ id: string }[]>`
          insert into invoice_note_templates (company_id, title, content, template_type, is_default)
          values (${auth.companyId}, ${d.title}, ${d.content}, ${d.template_type}, ${d.is_default})
          returning id`
      }),
    )
    if (!rows?.[0]) fail(400, 'We could not save this note template.')
    await audit(c, { action: 'invoice_note_template.create', entityType: 'invoice_note_template', entityId: rows[0].id, after: { title: d.title } })
    return c.json({ id: rows[0].id }, 201)
  })

  .post('/note-templates/seed-defaults', requireAction('billing', 'edit'), async (c) => {
    const auth = c.get('auth')
    const inserted = await attempt(c, 'billing.note_template_seed', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const existing = await sql<{ title: string; template_type: string }[]>`
          select title, coalesce(template_type, 'note') as template_type from invoice_note_templates
           where company_id = ${auth.companyId} and is_active = true`
        const keys = new Set(existing.map((r) => `${r.template_type}:${r.title.toLowerCase()}`))
        const recommended = [
          { template_type: 'terms', title: 'Standard Payment Terms', content: '1. Booking is confirmed only after advance payment.\n2. Remaining payment must be cleared before final delivery.\n3. Taxes, travel, stay and logistics are charged as applicable.\n4. Delivery timeline depends on selected package and payment clearance.', is_default: true },
          { template_type: 'terms', title: 'Wedding Booking Terms', content: '1. 50% advance confirms the booking.\n2. Balance is due before final delivery of photos/videos.\n3. Additional events / extra hours are billed separately.\n4. Travel and stay outside city are charged at actuals.', is_default: false },
          { template_type: 'terms', title: 'Final Delivery Terms', content: '1. Edited photos and videos are delivered after full payment is received.\n2. Raw data is shared only on request and may attract additional charges.\n3. Re-edits beyond the agreed scope are chargeable.', is_default: false },
          { template_type: 'note', title: 'Thank You Note', content: 'Thank you for choosing our photography services. We loved capturing your moments.', is_default: true },
          { template_type: 'note', title: 'Payment Screenshot Note', content: 'Kindly share the payment screenshot once the transfer is complete. Please mention the invoice number while making payment.', is_default: false },
        ] as const
        const defaults = await sql<{ template_type: string }[]>`
          select coalesce(template_type, 'note') as template_type from invoice_note_templates
           where company_id = ${auth.companyId} and is_default = true and is_active = true`
        const haveDefault = new Set(defaults.map((r) => r.template_type))
        const toInsert = recommended
          .filter((r) => !keys.has(`${r.template_type}:${r.title.toLowerCase()}`))
          .map((r) => {
            let isDefault = r.is_default
            if (haveDefault.has(r.template_type)) isDefault = false
            else if (isDefault) haveDefault.add(r.template_type)
            return { ...r, is_default: isDefault }
          })
        if (toInsert.length === 0) return 0
        for (const r of toInsert) {
          await sql`insert into invoice_note_templates (company_id, template_type, title, content, is_default)
            values (${auth.companyId}, ${r.template_type}, ${r.title}, ${r.content}, ${r.is_default})`
        }
        return toInsert.length
      }),
    )
    if (inserted === null) fail(400, 'We could not seed templates.')
    await audit(c, { action: 'invoice_note_template.seed', entityType: 'invoice_note_template', entityId: auth.companyId, after: { inserted } })
    return c.json({ inserted })
  })

  .post('/note-templates/:id/default', requireAction('billing', 'edit'), async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const rows = await attempt(c, 'billing.note_template_default', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const found = await sql<{ template_type: string }[]>`
          select coalesce(template_type, 'note') as template_type from invoice_note_templates
           where id = ${id} and company_id = ${auth.companyId}`
        if (!found[0]) return []
        await sql`update invoice_note_templates set is_default = false
           where company_id = ${auth.companyId} and coalesce(template_type, 'note') = ${found[0].template_type} and is_default = true`
        return sql<{ id: string }[]>`
          update invoice_note_templates set is_default = true
           where id = ${id} and company_id = ${auth.companyId} and is_active = true returning id`
      }),
    )
    if (!rows) fail(400, 'We could not set the default.')
    if (!rows.length) fail(404, 'We could not find that note template.')
    await audit(c, { action: 'invoice_note_template.default', entityType: 'invoice_note_template', entityId: id })
    return c.json({ ok: true })
  })

  .patch('/note-templates/:id', requireAction('billing', 'edit'), async (c) => {
    const id = uuidParam(c)
    const parsed = createInvoiceNoteTemplateRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the note template details.')
    const auth = c.get('auth')
    const d = parsed.data
    const rows = await attempt(c, 'billing.note_template_update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        if (d.is_default) {
          await sql`update invoice_note_templates set is_default = false where company_id = ${auth.companyId} and coalesce(template_type, 'note') = ${d.template_type} and is_default = true and id != ${id}`
        }
        return sql<{ id: string }[]>`
          update invoice_note_templates
             set title = ${d.title}, content = ${d.content}, template_type = ${d.template_type}, is_default = ${d.is_default}
           where id = ${id} and company_id = ${auth.companyId}
           returning id`
      }),
    )
    if (!rows) fail(400, 'We could not save this note template.')
    if (!rows.length) fail(404, 'We could not find that note template.')
    await audit(c, { action: 'invoice_note_template.update', entityType: 'invoice_note_template', entityId: id, after: d })
    return c.json({ ok: true })
  })

  .delete('/note-templates/:id', requireAction('billing', 'edit'), async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const rows = await attempt(c, 'billing.note_template_delete', () =>
      withUser(c.env, auth.userId, async (sql) => {
        return sql<{ id: string }[]>`
          update invoice_note_templates set is_active = false
           where id = ${id} and company_id = ${auth.companyId} returning id`
      }),
    )
    if (!rows) fail(400, 'We could not delete this note template.')
    if (!rows.length) fail(404, 'We could not find that note template.')
    await audit(c, { action: 'invoice_note_template.delete', entityType: 'invoice_note_template', entityId: id })
    return c.json({ ok: true })
  })
