import { Hono } from 'hono'
import {
  GSTIN_REGEX,
  createInvoiceBankAccountRequest,
  createInvoiceRequest,
  createReceivedPaymentRequest,
  updateInvoiceRequest,
  updateReceivedPaymentRequest,
  gstState,
  invoiceBankAccount,
  invoiceBankAccountList,
  billingOverview,
  invoiceDetail,
  invoiceListItem,
  invoiceListQuery,
  invoiceListResponse,
  receivedPayment,
  receivedPaymentListQuery,
  receivedPaymentListResponse,
  recordPaymentRequest,
  createInvoiceTemplateRequest,
  invoiceTemplate,
  invoiceTemplateList,
  createInvoiceNoteTemplateRequest,
  invoiceNoteTemplateList,
  paymentReceipt,
  invoiceItemPreset,
  upsertInvoiceItemPresetRequest,
  z,
} from '@ipc/contracts'
import type { TransactionSql } from 'postgres'
import { computeInvoice, type GstSlab } from '@ipc/domain'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction, requireModule } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

const list = invoiceListItem.array()

/**
 * What an invoice carries beyond its totals, written after create_invoice /
 * update_invoice so those atomic RPCs stay as they are: draft or sent, the
 * GSTIN, CGST+SGST versus IGST, subject and terms, each line's HSN/SAC (by
 * the order the lines were typed in) and the files sent with it.
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
    lines: { hsn_sac?: string | undefined }[]
  },
  gstNumber: string,
): Promise<'bad_file' | true> {
  await sql`update invoices set
      status = ${req.status},
      gst_number = ${gstNumber || null},
      intra_state = ${req.intra_state},
      subject = ${req.subject?.trim() || null},
      payment_terms = ${req.payment_terms?.trim() || null}
    where id = ${id}`
  const codes = req.lines.map((l, i) => ({ i, hsn: l.hsn_sac?.trim() || null }))
  await sql`update invoice_items it set hsn_sac = x.hsn
      from jsonb_to_recordset(${sql.json(codes)}::jsonb) as x(i int, hsn text)
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

export const billingRouter = new Hono<AppEnv>()
  .use('*', requireAuth)
  .use('*', requireModule('billing')) // finance gate: owner or a finance profile

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
                ? sql`i.balance_due > 0 and i.status not in ('cancelled', 'draft') and i.due_date is not null and i.due_date < current_date`
                : status === 'due_soon'
                  ? sql`i.balance_due > 0 and i.status not in ('cancelled', 'draft') and i.due_date between current_date and current_date + 7`
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

    const row = await attempt(
      c,
      'billing.invoice_create',
      () =>
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
          return rows[0] ?? null
        }),
      { onCode: (code) => (code === '23505' ? 'taken' : undefined) },
    )
    if (row === 'taken') fail(409, 'An invoice with this number already exists.')
    if (!row) fail(400, 'We could not create the invoice.')
    // Money already received goes on the invoice as it is made, so it is
    // never a draft: a draft cannot be paid.
    const status = req.payment ? 'sent' : req.status
    const extras = await attempt(c, 'billing.invoice_extras', () =>
      withUser(c.env, c.get('auth').userId, (sql) => writeInvoiceExtras(sql, row.id, { ...req, status }, gstNumber)),
    )
    if (extras === 'bad_file') fail(422, 'One of the attached files was not found.')
    if (req.payment) {
      const pay = req.payment
      const paid = await attempt(c, 'billing.invoice_create_payment', () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          await sql`select record_invoice_payment(
            p_invoice_id => ${row.id},
            p_amount => ${pay.amount},
            p_paid_on => ${pay.paid_on ?? null},
            p_mode => ${pay.mode ?? null},
            p_reference => ${pay.reference ?? null},
            p_notes => ${null})`
          return true
        }),
      )
      if (!paid) fail(400, `Invoice ${row.invoice_number} was created, but the payment could not be recorded. Record it from the invoice.`)
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
                     'cgst', it.cgst, 'sgst', it.sgst, 'igst', it.igst, 'hsn_sac', it.hsn_sac)
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

  // Full resend, same as creation: once a payment is recorded the totals are
  // a ledger fact, not a draft, so update_invoice() itself refuses those.
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

    const ok = await attempt(
      c,
      'billing.invoice_update',
      () =>
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
          return true
        }),
      { onCode: (code) => (code === '23514' ? 'has_payment' : undefined) },
    )
    if (ok === 'has_payment') fail(409, 'A payment has already been recorded against this invoice — it can no longer be edited.')
    if (!ok) fail(400, 'We could not update this invoice.')
    // Preserve the extras from creation: status transitions (draft↔sent),
    // the GSTIN snapshot, subject, terms, HSN/SAC and attachments.
    const extras = await attempt(c, 'billing.invoice_extras_update', () =>
      withUser(c.env, c.get('auth').userId, (sql) => writeInvoiceExtras(sql, id, req, patchGstNumber)),
    )
    if (extras === 'bad_file') fail(422, 'One of the attached files was not found.')
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
          delete from invoices where id = ${id} and amount_paid = 0 returning id`),
    )
    if (!rows) fail(400, 'We could not delete this invoice.')
    if (!rows.length) fail(404, 'That invoice was not found, or already has a payment recorded.')
    await audit(c, { action: 'invoice.delete', entityType: 'invoice', entityId: id })
    return c.body(null, 204)
  })

  /**
   * The Billing overview: what is still owed across every project, which
   * invoices are late or nearly due, and what came in lately. One request, so
   * the page opens on the answer instead of on filters.
   */
  .get('/overview', async (c) => {
    const data = await attempt(c, 'billing.overview', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [head] = await sql`
          select
            coalesce((
              select sum(greatest(p.total_cost - coalesce((
                select sum(rp.amount) from received_payments rp
                 where rp.project_id = p.id and rp.status = 'paid'), 0), 0))
                from projects p where p.status <> 'cancelled'), 0)::float as to_collect,
            (select count(*) from invoices i
              where i.balance_due > 0 and i.status not in ('cancelled', 'draft')
                and i.due_date < current_date)::int as overdue_count,
            coalesce((select sum(i.balance_due) from invoices i
              where i.balance_due > 0 and i.status not in ('cancelled', 'draft')
                and i.due_date < current_date), 0)::float as overdue_amount,
            (select count(*) from invoices i
              where i.balance_due > 0 and i.status not in ('cancelled', 'draft')
                and i.due_date between current_date and current_date + 7)::int as due_soon_count,
            coalesce((select sum(i.balance_due) from invoices i
              where i.balance_due > 0 and i.status not in ('cancelled', 'draft')
                and i.due_date between current_date and current_date + 7), 0)::float as due_soon_amount,
            coalesce((select sum(rp.amount) from received_payments rp
              where rp.status = 'paid' and rp.paid_on >= date_trunc('month', current_date)), 0)::float as received_this_month,
            coalesce((select sum(i.total) from invoices i
              where i.status not in ('cancelled', 'draft') and i.invoice_date >= date_trunc('month', current_date)), 0)::float as invoiced_this_month`
        const due = await sql`
          select i.id, i.invoice_number, i.invoice_date, i.due_date, i.total, i.balance_due, i.status,
                 cl.name as client_name, cl.phone as client_phone, i.project_id, pj.name as project_name
            from invoices i
            left join clients cl on cl.id = i.client_id
            left join projects pj on pj.id = i.project_id
           where i.balance_due > 0 and i.status not in ('cancelled', 'draft')
           order by i.due_date nulls last, i.invoice_date
           limit 25`
        const h = head as Record<string, number>
        return {
          to_collect: h.to_collect,
          overdue: { count: h.overdue_count, amount: h.overdue_amount },
          due_soon: { count: h.due_soon_count, amount: h.due_soon_amount },
          received_this_month: h.received_this_month,
          invoiced_this_month: h.invoiced_this_month,
          due_invoices: due,
        }
      }),
    )
    if (!data) fail(400, 'We could not load billing.')
    return c.json(billingOverview.parse(data))
  })

  /**
   * A link the client can open without logging in (or, with revoke, one that
   * stops working). Each call replaces the previous link.
   */
  // A draft becomes a sent invoice: its link can now be shared and it can be paid.
  .post('/invoices/:id/send', requireAction('billing', 'edit'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'billing.invoice_send', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ status: string }[]>`
        update invoices set status = case when status = 'draft' then 'sent' else status end
         where id = ${id} and company_id = ${c.get('auth').companyId}
        returning status`),
    )
    if (!rows) fail(400, 'We could not send this invoice.')
    if (!rows[0]) fail(404, 'That invoice was not found.')
    if (rows[0].status === 'cancelled') fail(409, 'This invoice is cancelled.')
    await audit(c, { action: 'invoice.send', entityType: 'invoice', entityId: id })
    return c.json({ ok: true, status: rows[0].status })
  })

  .post('/invoices/:id/share', requireAction('billing', 'view'), async (c) => {
    const id = uuidParam(c)
    const body = (await c.req.json().catch(() => ({}))) as { revoke?: unknown }
    const revoke = body.revoke === true
    const rows = await attempt(c, 'billing.invoice_share', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const inv = await sql<{ status: string }[]>`select status from invoices where id = ${id}`
        if (!inv[0]) return { missing: true as const }
        if (revoke) {
          await sql`select revoke_access_token('invoice', ${id})`
          return { token: null }
        }
        if (inv[0].status === 'cancelled' || inv[0].status === 'draft') return { unsendable: inv[0].status }
        const t = await sql<{ token: string }[]>`select rotate_access_token('invoice', ${id}, ${24 * 365}) as token`
        return { token: t[0]?.token ?? null }
      }),
    )
    if (!rows) fail(400, 'We could not make the link.')
    if ('missing' in rows) fail(404, 'That invoice was not found.')
    if ('unsendable' in rows) {
      fail(409, rows.unsendable === 'draft' ? 'This invoice is still a draft. Mark it as sent first.' : 'This invoice is cancelled.')
    }
    await audit(c, { action: revoke ? 'invoice.share_revoke' : 'invoice.share', entityType: 'invoice', entityId: id })
    if (revoke) return c.json({ ok: true })
    if (!rows.token) fail(400, 'We could not make the link.')
    return c.json({ link: `${c.env.APP_URL}/invoice?token=${rows.token}` }, 201)
  })

  /**
   * Cancel an invoice, even one with money against it. The money stays: each
   * payment is kept on the project (it was the project's money all along),
   * just no longer against this invoice. The client's link stops working.
   */
  .post('/invoices/:id/cancel', requireAction('billing', 'edit'), async (c) => {
    const id = uuidParam(c)
    const result = await attempt(
      c,
      'billing.invoice_cancel',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const inv = await sql<{ project_id: string | null; status: string }[]>`
            select project_id, status from invoices where id = ${id} for update`
          if (!inv[0]) return 'missing' as const
          if (inv[0].status === 'cancelled') return 'ok' as const
          const orphan = await sql`
            select 1 from received_payments where invoice_id = ${id} and project_id is null and ${inv[0].project_id}::uuid is null limit 1`
          if (orphan.length) return 'orphan' as const
          await sql`
            update received_payments
               set project_id = coalesce(project_id, ${inv[0].project_id}::uuid), invoice_id = null
             where invoice_id = ${id}`
          await sql`update invoices set status = 'cancelled', balance_due = 0 where id = ${id}`
          await sql`select revoke_access_token('invoice', ${id})`
          return 'ok' as const
        }),
    )
    if (!result) fail(400, 'We could not cancel this invoice.')
    if (result === 'missing') fail(404, 'That invoice was not found.')
    if (result === 'orphan') fail(409, 'This invoice has payments and no project to keep them on. Move or delete those payments first.')
    await audit(c, { action: 'invoice.cancel', entityType: 'invoice', entityId: id })
    return c.json({ ok: true })
  })

  .post('/invoices/:id/payments', requireAction('billing', 'edit'), async (c) => {
    const parsed = recordPaymentRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the payment details.')
    const d = parsed.data
    const id = uuidParam(c)
    const ok = await attempt(c, 'billing.payment', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`select record_invoice_payment(
          p_invoice_id => ${id},
          p_amount => ${d.amount},
          p_paid_on => ${d.paid_on ?? null},
          p_mode => ${d.mode ?? null},
          p_reference => ${d.reference ?? null},
          p_notes => ${d.notes ?? null})`
        return true
      }),
    )
    if (!ok) fail(400, 'We could not record the payment.')
    await audit(c, { action: 'invoice.payment', entityType: 'invoice', entityId: id, after: d })
    return c.body(null, 204)
  })

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

  // ── Standalone received_payments module (Lovable billing parity) ──
  // Project-linked cash in/out, independent of GST invoices. List supports
  // search/status/date/client/project/gst/amount/sort/page; summary is over
  // the filtered set, not just the page.
  .get('/payments', async (c) => {
    const parsed = receivedPaymentListQuery.safeParse({
      search: c.req.query('search')?.trim() || undefined,
      status: c.req.query('status')?.trim() || undefined,
      client_id: c.req.query('client_id')?.trim() || undefined,
      project_id: c.req.query('project_id')?.trim() || undefined,
      date_from: c.req.query('date_from')?.trim() || c.req.query('from')?.trim() || undefined,
      date_to: c.req.query('date_to')?.trim() || c.req.query('to')?.trim() || undefined,
      is_gst: c.req.query('is_gst') ?? undefined,
      amount_min: c.req.query('amount_min') ?? c.req.query('amountMin') ?? undefined,
      amount_max: c.req.query('amount_max') ?? c.req.query('amountMax') ?? undefined,
      sort_by: c.req.query('sort_by')?.trim() || c.req.query('sortBy')?.trim() || undefined,
      sort_direction: c.req.query('sort_direction')?.trim() || c.req.query('sortDir')?.trim() || undefined,
      page: c.req.query('page') ?? undefined,
      page_size: c.req.query('page_size') ?? c.req.query('pageSize') ?? undefined,
    })
    if (!parsed.success) fail(422, 'Please check the filter details.')
    const q = parsed.data
    const status = (q.status ?? 'all').toLowerCase()
    const search = (q.search ?? '').trim()
    const searchLike = search ? `%${search}%` : null

    const rows = await attempt(c, 'billing.payments_list', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const base = await sql`
          -- LEFT join, deliberately: since 0145 a payment can be against an
          -- invoice with no project, and an inner join would drop those rows
          -- from the list entirely -- money that exists and cannot be seen.
          select rp.id, rp.project_id, p.name as project_name,
                 rp.invoice_id, i.invoice_number,
                 coalesce(rp.client_id, p.client_id, i.client_id) as client_id,
                 cl.name as client_name, cl.phone as client_phone, cl.email as client_email,
                 rp.amount, rp.description, rp.status,
                 coalesce(rp.is_gst, false) as is_gst, rp.gst_number,
                 coalesce(to_char(rp.date_received, 'YYYY-MM-DD'), to_char(rp.paid_on, 'YYYY-MM-DD')) as date_received,
                 rp.file_url, rp.receipt_number, rp.mode, rp.reference, rp.created_at
            from received_payments rp
            left join projects p on p.id = rp.project_id
            left join invoices i on i.id = rp.invoice_id
            left join clients cl on cl.id = coalesce(rp.client_id, p.client_id, i.client_id)
           where rp.company_id = ${c.get('auth').companyId}`
        // The tiles: over every payment, not the filtered set.
        const [tiles] = await sql<{ this_month: number; this_fy: number; promised: number }[]>`
          select coalesce(sum(amount) filter (where status = 'paid' and coalesce(date_received, paid_on) >= date_trunc('month', current_date)), 0)::float as this_month,
                 coalesce(sum(amount) filter (where status = 'paid' and fy_label(coalesce(date_received, paid_on)) = fy_label(current_date)), 0)::float as this_fy,
                 coalesce(sum(amount) filter (where status = 'pending'), 0)::float as promised
            from received_payments where company_id = ${c.get('auth').companyId}`
        type R = {
          id: string; project_id: string | null; project_name: string | null;
          invoice_id: string | null; invoice_number: string | null; client_id: string | null;
          client_name: string | null; client_phone: string | null; client_email: string | null;
          amount: string | number; description: string | null; status: string;
          is_gst: boolean; gst_number: string | null; date_received: string | null;
          file_url: string | null; receipt_number: string | null; mode: string | null; reference: string | null; created_at: string;
        }
        let filtered = (base as unknown as R[]).filter((r) => {
          if (status === 'paid' || status === 'pending') {
            if ((r.status ?? 'paid') !== status) return false
          } else if (status === 'gst') {
            if (!r.is_gst) return false
          }
          if (q.is_gst !== undefined && !!r.is_gst !== q.is_gst) return false
          if (q.client_id && r.client_id !== q.client_id) return false
          if (q.project_id && r.project_id !== q.project_id) return false
          if (q.mode && (r.mode ?? '').toLowerCase() !== q.mode.toLowerCase()) return false
          if (q.date_from && (!r.date_received || r.date_received < q.date_from)) return false
          if (q.date_to && (!r.date_received || r.date_received > q.date_to)) return false
          const amt = Number(r.amount)
          if (q.amount_min !== undefined && amt < q.amount_min) return false
          if (q.amount_max !== undefined && amt > q.amount_max) return false
          if (searchLike) {
            const hay = [r.client_name ?? '', r.project_name ?? '', r.description ?? '', r.gst_number ?? '', r.receipt_number ?? '', r.reference ?? '']
              .join(' ').toLowerCase()
            if (!hay.includes(search.toLowerCase())) return false
          }
          return true
        })
        // Sort in JS (allowlisted) so COALESCE(date_received, paid_on) and
        // joined names sort identically with or without the 0123 columns.
        const dir = q.sort_direction === 'asc' ? 1 : -1
        const key = (r: R): string | number => {
          switch (q.sort_by) {
            case 'amount': return Number(r.amount)
            case 'client_name': return (r.client_name ?? '').toLowerCase()
            case 'project_name': return (r.project_name ?? '').toLowerCase()
            case 'status': return r.status ?? ''
            case 'created_at': return r.created_at ?? ''
            case 'date_received':
            default: return r.date_received ?? r.created_at ?? ''
          }
        }
        filtered = [...filtered].sort((a, b) => {
          const ka = key(a); const kb = key(b)
          if (typeof ka === 'number' && typeof kb === 'number') return (ka - kb) * dir
          return String(ka).localeCompare(String(kb)) * dir
        })
        const list = filtered.map((r) => ({
          id: r.id,
          project_id: r.project_id,
          project_name: r.project_name,
          // Selected, typed, and then dropped here — the schema's
          // `.default(null)` filled the hole without a word, so the list
          // showed every payment as belonging to no invoice while the invoice
          // itself listed the same payment. A field is only real when the
          // read path returns it.
          invoice_id: r.invoice_id,
          invoice_number: r.invoice_number,
          client_id: r.client_id,
          client_name: r.client_name,
          client_phone: r.client_phone,
          client_email: r.client_email,
          amount: Number(r.amount),
          description: r.description,
          status: (r.status === 'pending' ? 'pending' : 'paid') as 'paid' | 'pending',
          is_gst: !!r.is_gst,
          gst_number: r.gst_number,
          date_received: r.date_received,
          file_url: r.file_url,
          receipt_number: r.receipt_number,
          mode: r.mode,
          reference: r.reference,
          created_at: new Date(r.created_at).toISOString(),
        }))
        return { list, tiles: tiles ?? { this_month: 0, this_fy: 0, promised: 0 } }
      }),
    )
    if (!rows) fail(400, 'We could not load payments.')
    const items = receivedPayment.array().parse(rows.list)
    const totalReceived = items.filter((i) => i.status === 'paid').reduce((s, i) => s + i.amount, 0)
    const pendingAmt = items.filter((i) => i.status === 'pending').reduce((s, i) => s + i.amount, 0)
    const summary = {
      total_received_amount: totalReceived,
      pending_amount: pendingAmt,
      paid_count: items.filter((i) => i.status === 'paid').length,
      pending_count: items.filter((i) => i.status === 'pending').length,
      gst_count: items.filter((i) => i.is_gst).length,
      received_this_month: rows.tiles.this_month,
      received_this_fy: rows.tiles.this_fy,
      promised_amount: rows.tiles.promised,
    }
    const start = (q.page - 1) * q.page_size
    const pageItems = items.slice(start, start + q.page_size)
    return c.json(
      receivedPaymentListResponse.parse({
        items: pageItems,
        summary,
        total: items.length,
        page: q.page,
        page_size: q.page_size,
      }),
    )
  })

  .get('/payments/:id', async (c) => {
    const id = uuidParam(c)
    const row = await attempt(c, 'billing.payment_get', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`
          -- LEFT join, deliberately: since 0145 a payment can be against an
          -- invoice with no project, and an inner join would drop those rows
          -- from the list entirely -- money that exists and cannot be seen.
          select rp.id, rp.project_id, p.name as project_name,
                 rp.invoice_id, i.invoice_number,
                 coalesce(rp.client_id, p.client_id, i.client_id) as client_id,
                 cl.name as client_name, cl.phone as client_phone, cl.email as client_email,
                 rp.amount, rp.description, rp.status,
                 coalesce(rp.is_gst, false) as is_gst, rp.gst_number,
                 coalesce(to_char(rp.date_received, 'YYYY-MM-DD'), to_char(rp.paid_on, 'YYYY-MM-DD')) as date_received,
                 rp.file_url, rp.receipt_number, rp.mode, rp.reference, rp.created_at
            from received_payments rp
            left join projects p on p.id = rp.project_id
            left join invoices i on i.id = rp.invoice_id
            left join clients cl on cl.id = coalesce(rp.client_id, p.client_id, i.client_id)
           where rp.id = ${id} and rp.company_id = ${c.get('auth').companyId}`
        const r = rows[0] as Record<string, unknown> | undefined
        if (!r) return null
        return {
          ...r,
          amount: Number((r as { amount: string | number }).amount),
          status: ((r as { status: string }).status === 'pending' ? 'pending' : 'paid'),
          is_gst: !!((r as { is_gst: unknown }).is_gst),
          created_at: new Date((r as { created_at: string }).created_at).toISOString(),
        }
      }),
    )
    if (!row) fail(404, 'That payment was not found.')
    return c.json(receivedPayment.parse(row))
  })

  // The receipt as the client sees it, for the studio's own receipt page:
  // letterhead, client, project value and the invoice lines it paid for.
  .get('/payments/:id/receipt', async (c) => {
    const id = uuidParam(c)
    const row = await attempt(c, 'billing.payment_receipt', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<Record<string, unknown>[]>`
          select rp.id, rp.project_id, rp.invoice_id, rp.created_at,
                 rp.amount, coalesce(to_char(rp.date_received, 'YYYY-MM-DD'), to_char(rp.paid_on, 'YYYY-MM-DD'),
                                     to_char(rp.created_at, 'YYYY-MM-DD')) as paid_on,
                 rp.mode, rp.reference,
                 p.name as project_name, p.status::text as project_status,
                 cl.name as client_name, cl.phone as client_phone, cl.email as client_email, cl.address as client_address,
                 coalesce(co.display_name, co.name) as company_name,
                 coalesce(p.total_cost, i.total, 0) as total_cost,
                 case when p.id is not null
                      then (select coalesce(sum(x.amount), 0) from received_payments x where x.project_id = p.id and x.status = 'paid')
                      else (select coalesce(sum(x.amount), 0) from received_payments x where x.invoice_id = i.id and x.status = 'paid')
                 end as received_total,
                 coalesce(co.invoice_logo_url, co.avatar_url) as logo_url, co.invoice_gst_number as gstin,
                 co.invoice_phone as company_phone, co.invoice_email as company_email, co.invoice_address as company_address,
                 co.legal_name as company_legal_name, co.website as company_website, co.document_footer_note,
                 coalesce(rp.description, rp.notes) as description,
                 case when rp.status = 'pending' then 'pending' else 'paid' end as status,
                 rp.receipt_number, coalesce(rp.is_gst, false) as is_gst, rp.gst_number as payment_gst_number,
                 i.invoice_number
            from received_payments rp
            left join projects p on p.id = rp.project_id
            left join invoices i on i.id = rp.invoice_id
            left join clients cl on cl.id = coalesce(rp.client_id, p.client_id, i.client_id)
            left join companies co on co.id = rp.company_id
           where rp.id = ${id} and rp.company_id = ${c.get('auth').companyId}`
        const r = rows[0]
        if (!r) return null
        const num = (v: unknown) => (v == null ? 0 : Number(v))
        return {
          ...r,
          amount: num(r.amount),
          total_cost: num(r.total_cost),
          received_total: num(r.received_total),
          created_at: new Date(r.created_at as string).toISOString(),
        }
      }),
    )
    if (!row) fail(404, 'That payment was not found.')
    return c.json(paymentReceipt.parse(row))
  })

  .post('/payments', requireAction('billing', 'create'), async (c) => {
    const parsed = createReceivedPaymentRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the payment details.')
    const d = parsed.data
    const auth = c.get('auth')
    const row = await attempt(c, 'billing.payment_create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        // Either link, or both. The contract already refused neither; each one
        // given still has to belong to this studio.
        let projectClient: string | null = null
        if (d.project_id) {
          const proj = await sql<{ id: string; client_id: string | null }[]>`
            select id, client_id from projects where id = ${d.project_id} and company_id = ${auth.companyId}`
          if (!proj[0]) return 'bad_project' as const
          projectClient = proj[0].client_id
        }
        let invoiceClient: string | null = null
        let invoiceProject: string | null = null
        if (d.invoice_id) {
          const inv = await sql<{ id: string; client_id: string | null; project_id: string | null }[]>`
            select id, client_id, project_id from invoices
             where id = ${d.invoice_id} and company_id = ${auth.companyId}`
          if (!inv[0]) return 'bad_invoice' as const
          invoiceClient = inv[0].client_id
          invoiceProject = inv[0].project_id
        }
        if (d.client_id) {
          const cl = await sql<{ id: string }[]>`
            select id from clients where id = ${d.client_id} and company_id = ${auth.companyId}`
          if (!cl[0]) return 'bad_client' as const
        }
        // A payment against an invoice belongs to that invoice's project too,
        // unless one was named — otherwise settling an invoice would leave the
        // project's own figures untouched, which is the split this replaced.
        const projectId = d.project_id ?? invoiceProject ?? null
        const clientId = d.client_id ?? projectClient ?? invoiceClient ?? null
        const dateReceived = d.date_received ?? new Date().toISOString().slice(0, 10)
        const gst = (d.gst_number ?? '').trim() || null
        const made = await sql<{ id: string }[]>`
          insert into received_payments
            (company_id, project_id, invoice_id, client_id, amount, description, status, is_gst, gst_number, date_received, file_url, paid_on, recorded_by)
          values (${auth.companyId}, ${projectId}, ${d.invoice_id ?? null}, ${clientId}, ${d.amount},
                  ${d.description?.trim() || null}, ${d.status}, ${d.is_gst}, ${gst},
                  ${dateReceived}, ${d.file_url?.trim() || null}, ${dateReceived}, ${auth.userId})
          returning id`
        return made[0] ?? null
      }),
    )
    if (row === 'bad_project') fail(422, 'Selected project does not belong to this studio.')
    if (row === 'bad_invoice') fail(422, 'Selected invoice does not belong to this studio.')
    if (row === 'bad_client') fail(422, 'Selected client does not belong to this studio.')
    if (!row) fail(400, 'We could not save this payment.')
    await audit(c, { action: 'received_payment.create', entityType: 'received_payment', entityId: row.id, after: d })
    return c.json({ id: row.id }, 201)
  })

  .patch('/payments/:id', requireAction('billing', 'edit'), async (c) => {
    const parsed = updateReceivedPaymentRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the payment details.')
    const d = parsed.data
    const id = uuidParam(c)
    const auth = c.get('auth')
    const outcome = await attempt(c, 'billing.payment_update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const existing = await sql<{ id: string; is_gst: boolean; gst_number: string | null }[]>`
          select id, coalesce(is_gst, false) as is_gst, gst_number from received_payments
           where id = ${id} and company_id = ${auth.companyId}`
        if (!existing[0]) return 'missing' as const
        if (d.project_id) {
          const proj = await sql<{ id: string }[]>`
            select id from projects where id = ${d.project_id} and company_id = ${auth.companyId}`
          if (!proj[0]) return 'bad_project' as const
        }
        if (d.client_id) {
          const cl = await sql<{ id: string }[]>`
            select id from clients where id = ${d.client_id} and company_id = ${auth.companyId}`
          if (!cl[0]) return 'bad_client' as const
        }
        const nextIsGst = d.is_gst ?? existing[0]?.is_gst ?? false
        const nextGst = (d.gst_number !== undefined ? (d.gst_number?.trim() || null) : (existing[0]?.gst_number ?? null))
        if (nextIsGst && (!nextGst || nextGst.trim().length < 5)) {
          return 'bad_gst' as const
        }
        await sql`update received_payments set
            project_id = coalesce(${d.project_id ?? null}, project_id),
            client_id = coalesce(${d.client_id ?? null}, client_id),
            amount = coalesce(${d.amount ?? null}, amount),
            description = ${d.description !== undefined ? (d.description?.trim() || null) : sql`description`},
            status = coalesce(${d.status ?? null}, status),
            is_gst = coalesce(${d.is_gst ?? null}, is_gst),
            gst_number = ${nextIsGst ? nextGst : null},
            date_received = coalesce(${d.date_received ?? null}, date_received),
            paid_on = coalesce(${d.date_received ?? null}, paid_on),
            file_url = ${d.file_url !== undefined ? (d.file_url?.trim() || null) : sql`file_url`}
          where id = ${id} and company_id = ${auth.companyId}`
        return 'ok' as const
      }),
    )
    if (outcome === 'missing') fail(404, 'That payment was not found.')
    if (outcome === 'bad_project') fail(422, 'Selected project does not belong to this studio.')
    if (outcome === 'bad_client') fail(422, 'Selected client does not belong to this studio.')
    if (outcome === 'bad_gst') fail(422, 'GST number is required when GST applies.')
    if (!outcome) fail(400, 'We could not save this payment.')
    await audit(c, { action: 'received_payment.update', entityType: 'received_payment', entityId: id, after: d })
    return c.json({ ok: true })
  })

  .delete('/payments/:id', requireAction('billing', 'delete'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'billing.payment_delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        delete from received_payments where id = ${id} and company_id = ${c.get('auth').companyId} returning id`),
    )
    if (!rows) fail(400, 'We could not delete this payment.')
    if (!rows.length) fail(404, 'That payment was not found.')
    await audit(c, { action: 'received_payment.delete', entityType: 'received_payment', entityId: id })
    return c.body(null, 204)
  })

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

  // ── Bank accounts (reusable invoice bank/UPI snapshots) ─────
  .get('/bank-accounts', async (c) => {
    const rows = await attempt(c, 'billing.bank_accounts_list', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select id, company_id, label, holder, bank, number, ifsc, upi, branch, notes,
               is_default, is_active, created_at
          from invoice_bank_accounts
         where company_id = ${c.get('auth').companyId} and is_active = true
         order by is_default desc, created_at desc`),
    )
    if (!rows) fail(400, 'We could not load bank accounts.')
    return c.json(invoiceBankAccountList.parse({ items: rows }))
  })

  .post('/bank-accounts', requireAction('billing', 'edit'), async (c) => {
    const parsed = createInvoiceBankAccountRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the bank account details.')
    const auth = c.get('auth')
    const d = parsed.data
    const rows = await attempt(c, 'billing.bank_account_create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        if (d.is_default) {
          await sql`update invoice_bank_accounts set is_default = false where company_id = ${auth.companyId} and is_default = true`
        }
        const norm = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
        const normUpper = (v: unknown): string | null => {
          const n = norm(v)
          return n ? n.toUpperCase() : null
        }
        const holder: string | null = norm(d.holder)
        const bank: string | null = norm(d.bank)
        const number: string | null = norm(d.number)
        const ifsc: string | null = normUpper(d.ifsc)
        const upi: string | null = norm(d.upi)
        const branch: string | null = norm(d.branch)
        const notes: string | null = norm(d.notes)
        return sql`
          insert into invoice_bank_accounts (company_id, label, holder, bank, number, ifsc, upi, branch, notes, is_default)
          values (${auth.companyId}, ${d.label.trim()}, ${holder}, ${bank}, ${number},
                  ${ifsc}, ${upi}, ${branch}, ${notes}, ${d.is_default})
          returning id, company_id, label, holder, bank, number, ifsc, upi, branch, notes, is_default, is_active, created_at`
      }),
    )
    if (!rows?.[0]) fail(400, 'We could not save this bank account.')
    await audit(c, { action: 'invoice_bank_account.create', entityType: 'invoice_bank_account', entityId: rows[0].id, after: { label: d.label } })
    return c.json(invoiceBankAccount.parse(rows[0]), 201)
  })

  .patch('/bank-accounts/:id', requireAction('billing', 'edit'), async (c) => {
    const id = uuidParam(c)
    const parsed = createInvoiceBankAccountRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the bank account details.')
    const auth = c.get('auth')
    const d = parsed.data
    const rows = await attempt(c, 'billing.bank_account_update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        if (d.is_default) {
          await sql`update invoice_bank_accounts set is_default = false where company_id = ${auth.companyId} and is_default = true and id != ${id}`
        }
        const norm = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
        const normUpper = (v: unknown): string | null => {
          const n = norm(v)
          return n ? n.toUpperCase() : null
        }
        const holder: string | null = norm(d.holder)
        const bank: string | null = norm(d.bank)
        const number: string | null = norm(d.number)
        const ifsc: string | null = normUpper(d.ifsc)
        const upi: string | null = norm(d.upi)
        const branch: string | null = norm(d.branch)
        const notes: string | null = norm(d.notes)
        return sql<{ id: string }[]>`
          update invoice_bank_accounts
             set label = ${d.label.trim()}, holder = ${holder}, bank = ${bank},
                 number = ${number}, ifsc = ${ifsc},
                 upi = ${upi}, branch = ${branch}, notes = ${notes},
                 is_default = ${d.is_default}
           where id = ${id} and company_id = ${auth.companyId} and is_active = true
           returning id`
      }),
    )
    if (!rows) fail(400, 'We could not save this bank account.')
    if (!rows.length) fail(404, 'We could not find that bank account.')
    await audit(c, { action: 'invoice_bank_account.update', entityType: 'invoice_bank_account', entityId: id, after: d })
    return c.json({ ok: true })
  })

  .post('/bank-accounts/:id/default', requireAction('billing', 'edit'), async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const rows = await attempt(c, 'billing.bank_account_default', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const found = await sql<{ id: string }[]>`
          select id from invoice_bank_accounts where id = ${id} and company_id = ${auth.companyId} and is_active = true`
        if (!found.length) return []
        await sql`update invoice_bank_accounts set is_default = false where company_id = ${auth.companyId} and is_default = true`
        return sql<{ id: string }[]>`
          update invoice_bank_accounts set is_default = true
           where id = ${id} and company_id = ${auth.companyId} returning id`
      }),
    )
    if (!rows) fail(400, 'We could not set the default.')
    if (!rows.length) fail(404, 'We could not find that bank account.')
    await audit(c, { action: 'invoice_bank_account.default', entityType: 'invoice_bank_account', entityId: id })
    return c.json({ ok: true })
  })

  .delete('/bank-accounts/:id', requireAction('billing', 'edit'), async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const rows = await attempt(c, 'billing.bank_account_delete', () =>
      withUser(c.env, auth.userId, (sql) => sql<{ id: string }[]>`
        update invoice_bank_accounts set is_active = false, is_default = false
         where id = ${id} and company_id = ${auth.companyId} returning id`),
    )
    if (!rows) fail(400, 'We could not delete this bank account.')
    if (!rows.length) fail(404, 'We could not find that bank account.')
    await audit(c, { action: 'invoice_bank_account.delete', entityType: 'invoice_bank_account', entityId: id })
    return c.json({ ok: true })
  })
