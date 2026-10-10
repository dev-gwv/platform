import { Hono } from 'hono'
import {
  createReceivedPaymentRequest,
  updateReceivedPaymentRequest,
  receivedPayment,
  receivedPaymentListQuery,
  receivedPaymentListResponse,
  paymentReceipt,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { todayInIndia } from '../../lib/dates'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

export const receivedPaymentRoutes = new Hono<AppEnv>()
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
        const [tiles] = await sql<{ this_month: number; this_fy: number; promised: number; promised_count: number }[]>`
          select coalesce(sum(amount) filter (where status = 'paid' and coalesce(date_received, paid_on) >= date_trunc('month', current_date)), 0)::float as this_month,
                 coalesce(sum(amount) filter (where status = 'paid' and fy_label(coalesce(date_received, paid_on)) = fy_label(current_date)), 0)::float as this_fy,
                 coalesce(sum(amount) filter (where status = 'pending'), 0)::float as promised,
                 (count(*) filter (where status = 'pending'))::int as promised_count
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
        return { list, tiles: tiles ?? { this_month: 0, this_fy: 0, promised: 0, promised_count: 0 } }
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
      promised_count: rows.tiles.promised_count,
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
        const dateReceived = d.date_received ?? todayInIndia()
        const gst = (d.gst_number ?? '').trim() || null
        const made = await sql<{ id: string }[]>`
          insert into received_payments
            (company_id, project_id, invoice_id, client_id, amount, description, status, is_gst, gst_number, date_received, file_url, paid_on, mode, reference, recorded_by)
          values (${auth.companyId}, ${projectId}, ${d.invoice_id ?? null}, ${clientId}, ${d.amount},
                  ${d.description?.trim() || null}, ${d.status}, ${d.is_gst}, ${gst},
                  ${dateReceived}, ${d.file_url?.trim() || null}, ${dateReceived}, ${d.mode?.trim() || null},
                  ${d.reference?.trim() || null}, ${auth.userId})
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
        const existing = await sql<{ id: string; is_gst: boolean; gst_number: string | null; project_id: string | null; invoice_id: string | null }[]>`
          select id, coalesce(is_gst, false) as is_gst, gst_number, project_id, invoice_id from received_payments
           where id = ${id} and company_id = ${auth.companyId}`
        if (!existing[0]) return 'missing' as const
        if (d.project_id) {
          const proj = await sql<{ id: string }[]>`
            select id from projects where id = ${d.project_id} and company_id = ${auth.companyId}`
          if (!proj[0]) return 'bad_project' as const
        }
        // Moving to another invoice (or off one). The invoice's project comes
        // with it unless a project was named, the way a new payment works, and
        // a named project must be the invoice's own. Both invoices' totals are
        // recomputed by received_payments_sync_invoice (0145).
        let nextProject = d.project_id !== undefined ? d.project_id : existing[0].project_id
        const nextInvoice = d.invoice_id !== undefined ? d.invoice_id : existing[0].invoice_id
        if (d.invoice_id) {
          const inv = await sql<{ project_id: string | null }[]>`
            select project_id from invoices where id = ${d.invoice_id} and company_id = ${auth.companyId}`
          if (!inv[0]) return 'bad_invoice' as const
          const invProject = inv[0].project_id
          if (invProject) {
            if (d.project_id === undefined) nextProject = invProject
            else if (d.project_id && d.project_id !== invProject) return 'mismatch' as const
          }
        }
        if (!nextProject && !nextInvoice) return 'unlinked' as const
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
            project_id = ${nextProject},
            invoice_id = ${nextInvoice},
            client_id = coalesce(${d.client_id ?? null}, client_id),
            amount = coalesce(${d.amount ?? null}, amount),
            description = ${d.description !== undefined ? (d.description?.trim() || null) : sql`description`},
            status = coalesce(${d.status ?? null}, status),
            is_gst = coalesce(${d.is_gst ?? null}, is_gst),
            gst_number = ${nextIsGst ? nextGst : null},
            date_received = coalesce(${d.date_received ?? null}, date_received),
            paid_on = coalesce(${d.date_received ?? null}, paid_on),
            file_url = ${d.file_url !== undefined ? (d.file_url?.trim() || null) : sql`file_url`},
            mode = ${d.mode !== undefined ? (d.mode?.trim() || null) : sql`mode`},
            reference = ${d.reference !== undefined ? (d.reference?.trim() || null) : sql`reference`}
          where id = ${id} and company_id = ${auth.companyId}`
        return 'ok' as const
      }),
    )
    if (outcome === 'missing') fail(404, 'That payment was not found.')
    if (outcome === 'bad_project') fail(422, 'Selected project does not belong to this studio.')
    if (outcome === 'bad_client') fail(422, 'Selected client does not belong to this studio.')
    if (outcome === 'bad_invoice') fail(422, 'Selected invoice does not belong to this studio.')
    if (outcome === 'mismatch') fail(422, 'That invoice belongs to another project.')
    if (outcome === 'unlinked') fail(422, 'Choose the project or the invoice this payment is against.')
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
