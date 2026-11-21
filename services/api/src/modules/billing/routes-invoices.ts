import { Hono } from 'hono'
import {
  GSTIN_REGEX,
  createInvoiceRequest,
  updateInvoiceRequest,
  gstState,
  invoiceDetail,
  invoiceListItem,
  invoiceListQuery,
  invoiceListResponse,
} from '@ipc/contracts'
import type { TransactionSql } from 'postgres'
import { computeInvoice, type GstSlab } from '@ipc/domain'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

const list = invoiceListItem.array()

/**
 * What an invoice carries beyond its totals, written after create_invoice /
 * update_invoice so those atomic RPCs stay as they are: draft or sent, the
 * GSTIN, CGST+SGST versus IGST, subject and terms, each line's HSN/SAC, unit
 * and days (by the order the lines were typed in) and the files sent with it.
 */
async function writeInvoiceExtras(
  sql: TransactionSql,
  id: string,
  req: {
    status: string
    intra_state: boolean
    subject?: string | undefined
    payment_terms?: string | undefined
    attachment_file_ids?: string[] | undefined
    lines: { hsn_sac?: string | undefined; unit?: string | undefined; days?: number | undefined }[]
  },
  gstNumber: string,
): Promise<'bad_file' | true> {
  // Only draft <-> sent is the form's to choose. Paid, part paid and
  // cancelled follow the money (update_invoice recomputes them), so an edit
  // of a part-paid invoice must not knock it back to 'sent'.
  await sql`update invoices set
      status = case when status in ('draft', 'sent') then ${req.status} else status end,
      gst_number = ${gstNumber || null},
      intra_state = ${req.intra_state},
      subject = ${req.subject?.trim() || null},
      payment_terms = ${req.payment_terms?.trim() || null}
    where id = ${id}`
  const codes = req.lines.map((l, i) => ({ i, hsn: l.hsn_sac?.trim() || null, unit: l.unit?.trim() || null, days: l.days ?? null }))
  await sql`update invoice_items it set hsn_sac = x.hsn, unit = x.unit, days = x.days
      from jsonb_to_recordset(${sql.json(codes)}::jsonb) as x(i int, hsn text, unit text, days numeric)
     where it.invoice_id = ${id} and it.sort_order = x.i`
  if (req.attachment_file_ids) {
    const ids = [...new Set(req.attachment_file_ids)]
    if (ids.length) {
      const mine = await sql<{ id: string }[]>`select id from files where id = any(${ids}::uuid[])`
      if (mine.length !== ids.length) return 'bad_file'
    }
    await sql`delete from invoice_attachments where invoice_id = ${id} and not (file_id = any(${ids}::uuid[]))`
    for (const f of ids) {
      await sql`insert into invoice_attachments (company_id, invoice_id, file_id)
                values (get_current_company_id(), ${id}, ${f}) on conflict (invoice_id, file_id) do nothing`
    }
  }
  return true
}

/** A refusal raised inside the invoice transaction, so everything before it rolls back. */
class InvoiceRefusal extends Error {
  constructor(readonly kind: 'bad_file') {
    super(kind)
  }
}

/** Run the invoice transaction; a refusal comes back as its kind, anything else is thrown on. */
async function refusalOf<T>(work: Promise<T>): Promise<T | 'bad_file'> {
  try {
    return await work
  } catch (e) {
    if (e instanceof InvoiceRefusal) return e.kind
    throw e
  }
}

export const invoiceRoutes = new Hono<AppEnv>()
  .get('/states', async (c) => {
    const rows = await attempt(c, 'billing.states', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`select code, name from state_master order by name`),
    )
    if (!rows) fail(400, 'We could not load states.')
    return c.json(gstState.array().parse(rows))
  })

  .get('/invoices', async (c) => {
    // Server filters + pagination. No query params = legacy array of all rows,
    // so older clients keep working; any filter/page param returns the envelope
    // with a summary computed over the filtered set (not just the page).
    const rawQuery = {
      search: c.req.query('search'),
      status: c.req.query('status'),
      client_id: c.req.query('client_id'),
      project_id: c.req.query('project_id'),
      from: c.req.query('from'),
      to: c.req.query('to'),
      page: c.req.query('page'),
      page_size: c.req.query('page_size'),
    }
    const hasParams = Object.values(rawQuery).some((v) => v !== undefined && String(v).trim() !== '')
    if (!hasParams) {
      const rows = await attempt(c, 'billing.invoices', () =>
        withUser(
          c.env,
          c.get('auth').userId,
          (sql) => sql`
            select i.id, i.invoice_number, i.invoice_date, i.total, i.balance_due, i.status,
                   cl.name as client_name, cl.phone as client_phone,
                   i.project_id, pj.name as project_name, i.due_date, i.taxable
            from invoices i
            left join clients cl on cl.id = i.client_id
            left join projects pj on pj.id = i.project_id
            order by i.invoice_date desc`,
        ),
      )
      if (!rows) fail(400, 'We could not load invoices.')
      return c.json(list.parse(rows))
    }

    const parsed = invoiceListQuery.safeParse({
      ...rawQuery,
      search: rawQuery.search?.trim() ? rawQuery.search.trim() : undefined,
      status: rawQuery.status?.trim() ? rawQuery.status.trim() : undefined,
      client_id: rawQuery.client_id?.trim() ? rawQuery.client_id.trim() : undefined,
      project_id: rawQuery.project_id?.trim() ? rawQuery.project_id.trim() : undefined,
      from: rawQuery.from?.trim() ? rawQuery.from.trim() : undefined,
      to: rawQuery.to?.trim() ? rawQuery.to.trim() : undefined,
    })
    if (!parsed.success) fail(422, 'Please check the filter details.')
    const q = parsed.data
    const status = (q.status ?? '').toLowerCase()
    const search = (q.search ?? '').trim()
    const offset = (q.page - 1) * q.page_size

    const result = await attempt(c, 'billing.invoices_filtered', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const statusCond =
          !status || status === 'all'
            ? sql`true`
            : status === 'pending'
              ? sql`i.balance_due > 0 and i.status != 'cancelled'`
              : status === 'overdue'
                ? sql`i.balance_due > 0 and i.status not in ('cancelled', 'draft') and i.due_date is not null and i.due_date < (now() at time zone 'Asia/Kolkata')::date`
                : status === 'due_soon'
                  ? sql`i.balance_due > 0 and i.status not in ('cancelled', 'draft') and i.due_date between (now() at time zone 'Asia/Kolkata')::date and (now() at time zone 'Asia/Kolkata')::date + 7`
                  : sql`i.status = ${status}`
        const items = await sql`
          select i.id, i.invoice_number, i.invoice_date, i.total, i.balance_due, i.status,
                 cl.name as client_name, cl.phone as client_phone,
                 i.project_id, pj.name as project_name, i.due_date, i.taxable
            from invoices i
            left join clients cl on cl.id = i.client_id
            left join projects pj on pj.id = i.project_id
           where ${statusCond}
             and ${search ? sql`(i.invoice_number ilike ${'%' + search + '%'} or cl.name ilike ${'%' + search + '%'})` : sql`true`}
             and ${q.client_id ? sql`i.client_id = ${q.client_id}` : sql`true`}
             and ${q.project_id ? sql`i.project_id = ${q.project_id}` : sql`true`}
             and ${q.from ? sql`i.invoice_date >= ${q.from}` : sql`true`}
             and ${q.to ? sql`i.invoice_date <= ${q.to}` : sql`true`}
           order by i.invoice_date desc
           limit ${q.page_size} offset ${offset}`
        const agg = await sql`
          select count(*)::int as total_invoices,
                 -- A cancelled invoice is no longer owed, so it adds nothing.
                 coalesce(sum(i.total) filter (where i.status <> 'cancelled'), 0)::float as billed,
                 coalesce(sum(i.total - i.balance_due) filter (where i.status <> 'cancelled'), 0)::float as paid,
                 coalesce(sum(i.balance_due) filter (where i.status <> 'cancelled'), 0)::float as pending,
                 count(*)::int as total
            from invoices i
            left join clients cl on cl.id = i.client_id
           where ${statusCond}
             and ${search ? sql`(i.invoice_number ilike ${'%' + search + '%'} or cl.name ilike ${'%' + search + '%'})` : sql`true`}
             and ${q.client_id ? sql`i.client_id = ${q.client_id}` : sql`true`}
             and ${q.project_id ? sql`i.project_id = ${q.project_id}` : sql`true`}
             and ${q.from ? sql`i.invoice_date >= ${q.from}` : sql`true`}
             and ${q.to ? sql`i.invoice_date <= ${q.to}` : sql`true`}`
        const s = agg[0] as { total_invoices: number; billed: number; paid: number; pending: number; total: number }
        return {
          items,
          summary: { total_invoices: s.total_invoices, billed: s.billed, paid: s.paid, pending: s.pending },
          total: s.total,
          page: q.page,
          page_size: q.page_size,
        }
      }),
    )
    if (!result) fail(400, 'We could not load invoices.')
    return c.json(invoiceListResponse.parse(result))
  })

  .post('/invoices', requireAction('billing', 'create'), async (c) => {
    const parsed = createInvoiceRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the invoice details.')
    const req = parsed.data

    // Lovable parity gates: per-invoice GSTIN format, place-of-supply when
    // tax applies, and at least one taxed line on a GST invoice.
    const gstNumber = (req.gst_number ?? '').trim().toUpperCase()
    if (gstNumber && !GSTIN_REGEX.test(gstNumber)) {
      fail(422, 'GSTIN format looks invalid. Expected 15-char GSTIN like 27ABCDE1234F1Z5.')
    }
    const hasTaxRate = req.lines.some((l) => Number(l.gst_rate) > 0)
    if (gstNumber) {
      if (!req.place_of_supply?.trim()) fail(422, 'Place of Supply is required for GST invoices.')
      if (!hasTaxRate) fail(422, 'At least one item must have a tax rate for GST invoices.')
    } else if (hasTaxRate && !req.place_of_supply?.trim()) {
      fail(422, 'Place of Supply is required for GST invoices.')
    }
    // 'none' means no discount regardless of the numeric value sent.
    const effectiveDiscount = req.discount_type === 'none' ? 0 : req.discount
    const effectiveDiscountType = req.discount_type === 'none' ? 'flat' : req.discount_type

    // The one source of GST truth — same tested engine everywhere.
    const totals = computeInvoice(
      req.lines.map((l) => ({ ...l, gst_rate: l.gst_rate as GstSlab })),
      { intraState: req.intra_state, discount: effectiveDiscount, discountType: effectiveDiscountType },
    )
    const items = totals.lines.map((l) => ({
      subtext: l.subtext ?? null,
      description: l.description,
      quantity: l.quantity,
      rate: l.rate,
      amount: l.amount,
      gst_rate: l.gst_rate,
      taxable: l.taxable,
      cgst: l.cgst,
      sgst: l.sgst,
      igst: l.igst,
    }))

    // Money already received goes on the invoice as it is made, so it is
    // never a draft: a draft cannot be paid.
    const attachIds = req.attach_payment_ids ?? []
    const status = req.payment || attachIds.length > 0 ? 'sent' : req.status
    // One transaction: the invoice, its extras, the advance it takes and the
    // payment recorded with it land together or not at all, so a failure
    // never leaves an orphan invoice holding a number and a plan slot.
    let stage = 'create' as 'create' | 'extras' | 'attach' | 'pay'
    const row = await attempt(
      c,
      'billing.invoice_create',
      () =>
        refusalOf(
          withUser(c.env, c.get('auth').userId, async (sql) => {
            const rows = await sql<{ id: string; invoice_number: string }[]>`
            select * from create_invoice(
              p_client_id => ${req.client_id},
              p_project_id => ${req.project_id},
              p_place_of_supply => ${req.place_of_supply?.trim() || null},
              p_invoice_date => ${req.invoice_date ?? null},
              p_due_date => ${req.due_date ?? null},
              p_subtotal => ${totals.subtotal},
              p_discount => ${totals.discount},
              p_taxable => ${totals.taxable},
              p_tax => ${totals.tax},
              p_total => ${totals.total},
              p_items => ${sql.json(items)},
              p_notes => ${req.notes ?? null},
              p_template_id => ${req.template_id ?? null},
              p_invoice_number => ${req.invoice_number ?? null},
              p_discount_type => ${req.discount_type},
              p_bank_details => ${req.bank_details ?? null},
              p_terms => ${req.terms ?? null}
            )`
            const made = rows[0]
            if (!made) return null
            stage = 'extras'
            const extras = await writeInvoiceExtras(sql, made.id, { ...req, status }, gstNumber)
            if (extras === 'bad_file') throw new InvoiceRefusal('bad_file')
            // The project's advance counts against this invoice: the same
            // ledger rows, now linked, so the invoice reads partly paid and the
            // project's received total does not move. The trigger on
            // received_payments recomputes the invoice's paid and balance.
            if (attachIds.length > 0 && req.project_id) {
              stage = 'attach'
              await sql`
                update received_payments set invoice_id = ${made.id}
                 where id = any(${attachIds}::uuid[])
                   and project_id = ${req.project_id}
                   and invoice_id is null
                   and status = 'paid'`
            }
            if (req.payment) {
              stage = 'pay'
              const pay = req.payment
              await sql`select record_invoice_payment(
                p_invoice_id => ${made.id},
                p_amount => ${pay.amount},
                p_paid_on => ${pay.paid_on ?? null},
                p_mode => ${pay.mode ?? null},
                p_reference => ${pay.reference ?? null},
                p_notes => ${null})`
            }
            return made
          }),
        ),
      {
        onCode: (code) =>
          stage === 'create' && code === '23505' ? 'taken' : stage === 'create' && code === '23514' ? 'needs_number' : undefined,
      },
    )
    if (row === 'taken') fail(409, 'An invoice with this number already exists.')
    if (row === 'needs_number') fail(422, 'Your studio types its own invoice numbers. Type a number for this invoice.')
    if (row === 'bad_file') fail(422, 'One of the attached files was not found.')
    if (!row) {
      if (stage === 'attach') fail(400, 'The advance could not be applied, so the invoice was not saved. Please try again.')
      if (stage === 'pay') fail(400, 'The payment could not be recorded, so the invoice was not saved. Check the amount and try again.')
      fail(400, 'We could not create the invoice.')
    }
    await audit(c, {
      action: 'invoice.create',
      entityType: 'invoice',
      entityId: row.id,
      after: { invoice_number: row.invoice_number, total: totals.total, client_id: req.client_id },
    })
    return c.json({ id: row.id, invoice_number: row.invoice_number }, 201)
  })

  .get('/invoices/:id', async (c) => {
    const id = uuidParam(c)
    const row = await attempt(c, 'billing.invoice', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`
          select i.id, i.invoice_number, i.invoice_date, i.due_date, i.status, i.place_of_supply,
                 i.intra_state, i.client_id, i.project_id, i.template_id,
                 i.subtotal, i.discount, i.discount_type, i.taxable, i.tax, i.total, i.amount_paid, i.balance_due,
                 i.notes, i.bank_details, i.terms, i.created_at, i.gst_number, i.subject, i.payment_terms,
                 cl.name as client_name, cl.gstin as client_gstin, cl.address as client_address,
                 cl.phone as client_phone, cl.email as client_email,
                 pj.name as project_name,
                 coalesce(
                   (select it.layout_json from invoice_templates it where it.id = i.template_id),
                   (select it.layout_json from invoice_templates it where it.company_id = i.company_id and it.is_default = true limit 1)
                 ) as template_layout,
                 coalesce((
                   select jsonb_agg(jsonb_build_object(
                     'id', it.id, 'description', it.description, 'subtext', it.subtext, 'quantity', it.quantity,
                     'rate', it.rate, 'amount', it.amount, 'gst_rate', it.gst_rate,
                     'cgst', it.cgst, 'sgst', it.sgst, 'igst', it.igst, 'hsn_sac', it.hsn_sac,
                     'unit', it.unit, 'days', it.days)
                     order by it.sort_order, it.id)
                   from invoice_items it where it.invoice_id = i.id
                 ), '[]'::jsonb) as items,
                 coalesce((
                   select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'mime', f.mime, 'size_bytes', f.size_bytes)
                                    order by ia.created_at)
                     from invoice_attachments ia join files f on f.id = ia.file_id
                    where ia.invoice_id = i.id
                 ), '[]'::jsonb) as attachments,
                  -- From the ledger (0145), not the retired invoice_payments
                  -- table: a payment recorded on the project against this
                  -- invoice has to appear here too, or the two screens go on
                  -- telling different stories about the same money.
                  coalesce((
                    select jsonb_agg(jsonb_build_object(
                      'id', pmt.id, 'amount', pmt.amount, 'paid_on', pmt.paid_on, 'mode', pmt.mode,
                      'reference', pmt.reference, 'notes', pmt.notes, 'status', pmt.status)
                      order by pmt.paid_on)
                    from received_payments pmt where pmt.invoice_id = i.id
                  ), '[]'::jsonb) as payments
           from invoices i
          left join clients cl on cl.id = i.client_id
          left join projects pj on pj.id = i.project_id
          where i.id = ${id}`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(404, 'That invoice was not found.')
    return c.json(invoiceDetail.parse(row))
  })

  // Full resend, same as creation. An invoice with money on it can still be
  // changed (owner, 26 Oct), as long as its new total is not below what was
  // received; update_invoice() (0284) holds that rule and refuses a
  // cancelled invoice until it is reopened.
  .patch('/invoices/:id', requireAction('billing', 'edit'), async (c) => {
    const parsed = updateInvoiceRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the invoice details.')
    const req = parsed.data
    const id = uuidParam(c)

    const patchGstNumber = (req.gst_number ?? '').trim().toUpperCase()
    if (patchGstNumber && !GSTIN_REGEX.test(patchGstNumber)) {
      fail(422, 'GSTIN format looks invalid. Expected 15-char GSTIN like 27ABCDE1234F1Z5.')
    }
    const patchHasTax = req.lines.some((l) => Number(l.gst_rate) > 0)
    if (patchGstNumber) {
      if (!req.place_of_supply?.trim()) fail(422, 'Place of Supply is required for GST invoices.')
      if (!patchHasTax) fail(422, 'At least one item must have a tax rate for GST invoices.')
    } else if (patchHasTax && !req.place_of_supply?.trim()) {
      fail(422, 'Place of Supply is required for GST invoices.')
    }
    const patchDiscount = req.discount_type === 'none' ? 0 : req.discount
    const patchDiscountType = req.discount_type === 'none' ? 'flat' : req.discount_type

    const totals = computeInvoice(
      req.lines.map((l) => ({ ...l, gst_rate: l.gst_rate as GstSlab })),
      { intraState: req.intra_state, discount: patchDiscount, discountType: patchDiscountType },
    )
    const items = totals.lines.map((l) => ({
      subtext: l.subtext ?? null,
      description: l.description,
      quantity: l.quantity,
      rate: l.rate,
      amount: l.amount,
      gst_rate: l.gst_rate,
      taxable: l.taxable,
      cgst: l.cgst,
      sgst: l.sgst,
      igst: l.igst,
    }))

    // One transaction: the totals, the extras and a new number land together,
    // so a refused number or a missing file never leaves half an edit behind.
    const number = req.invoice_number?.trim()
    let editStage = 'update' as 'update' | 'extras' | 'renumber'
    const ok = await attempt(
      c,
      'billing.invoice_update',
      () =>
        refusalOf(
          withUser(c.env, c.get('auth').userId, async (sql) => {
            await sql`select update_invoice(
              p_invoice_id => ${id},
              p_client_id => ${req.client_id},
              p_project_id => ${req.project_id},
              p_place_of_supply => ${req.place_of_supply?.trim() || null},
              p_intra_state => ${req.intra_state},
              p_invoice_date => ${req.invoice_date ?? null},
              p_due_date => ${req.due_date ?? null},
              p_subtotal => ${totals.subtotal},
              p_discount => ${totals.discount},
              p_taxable => ${totals.taxable},
              p_tax => ${totals.tax},
              p_total => ${totals.total},
              p_items => ${sql.json(items)},
              p_notes => ${req.notes ?? null},
              p_template_id => ${req.template_id ?? null},
              p_discount_type => ${req.discount_type},
              p_bank_details => ${req.bank_details ?? null},
              p_terms => ${req.terms ?? null}
            )`
            // Preserve the extras from creation: status transitions (draft<->sent),
            // the GSTIN snapshot, subject, terms, HSN/SAC and attachments.
            editStage = 'extras'
            const extras = await writeInvoiceExtras(sql, id, req, patchGstNumber)
            if (extras === 'bad_file') throw new InvoiceRefusal('bad_file')
            // A new number, if one was typed (unique per studio).
            if (number) {
              editStage = 'renumber'
              await sql`update invoices set invoice_number = ${number} where id = ${id} and invoice_number <> ${number}`
            }
            return true as const
          }),
        ),
      {
        onCode: (code, err) => {
          if (editStage === 'renumber' && code === '23505') return 'taken'
          if (editStage === 'update' && code === '23514') {
            return String((err as Error)?.message ?? '').includes('cancelled') ? 'cancelled' : 'below_paid'
          }
          return undefined
        },
      },
    )
    if (ok === 'cancelled') fail(409, 'This invoice is cancelled. Reopen it first, then edit it.')
    if (ok === 'below_paid') fail(409, 'The new total is less than the money already received on this invoice. Move or delete a payment first, then lower it.')
    if (ok === 'taken') fail(409, `Another invoice is already numbered ${number}. Pick a different number.`)
    if (ok === 'bad_file') fail(422, 'One of the attached files was not found.')
    if (!ok) fail(400, 'We could not update this invoice.')
    await audit(c, { action: 'invoice.update', entityType: 'invoice', entityId: id, after: { total: totals.total, client_id: req.client_id } })
    return c.json({ ok: true })
  })

  .delete('/invoices/:id', requireAction('billing', 'delete'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(
      c,
      'billing.invoice_delete',
      () =>
        withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
          delete from invoices i where i.id = ${id} and i.amount_paid = 0
             and not exists (select 1 from received_payments rp where rp.invoice_id = i.id)
          returning i.id`),
    )
    if (!rows) fail(400, 'We could not delete this invoice.')
    if (!rows.length) fail(409, 'This invoice has a payment on it. Move or delete the payment first, or cancel the invoice instead.')
    await audit(c, { action: 'invoice.delete', entityType: 'invoice', entityId: id })
    return c.body(null, 204)
  })
