import { Hono } from 'hono'
import type { TransactionSql } from 'postgres'
import {
  acceptQuoteRequest,
  createQuoteRequest,
  updateQuoteRequest,
  crmQuote,
  crmQuoteStatusResponse,
  crmUserPrefs,
  declineQuoteRequest,
  okResponse,
  publicQuote,
  sendQuoteRequest,
  sendQuoteResponse,
  setQuoteOutcomeRequest,
  updateCrmUserPrefsRequest,
} from '@ipc/contracts'
import { computeInvoice, type GstSlab } from '@ipc/domain'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { textParam, uuidParam } from '../../lib/params'
import { withService, withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { resolveClientIp } from '../../lib/client-ip'
import { sendWhatsAppText, whatsappConfigured, whatsappLink } from '../../lib/whatsapp'
import { claimRule } from './rules'

/**
 * Quotes on a deal, and each person's CRM preferences. Totals come from
 * @ipc/domain computeInvoice — the same arithmetic the invoices use — so a
 * quote that becomes an invoice adds up the same way.
 */
const edit = requireAction('crm', 'edit')
const remove = requireAction('crm', 'delete')

const selectQuotes = (sql: TransactionSql) => sql`
  select q.id, q.lead_id, l.name as lead_name, q.quote_number, q.title, q.status, q.valid_until, q.place_of_supply, q.intra_state,
         q.subtotal, q.discount, q.taxable, q.tax, q.total, q.notes, q.terms, q.sent_at, q.accepted_at, q.accepted_by_name,
         q.accepted_by_email, q.accepted_ip, q.declined_at, q.decline_reason, q.created_at,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'id', i.id, 'description', i.description, 'quantity', i.quantity, 'rate', i.rate, 'amount', i.amount,
             'gst_rate', i.gst_rate, 'taxable', i.taxable, 'cgst', i.cgst, 'sgst', i.sgst, 'igst', i.igst) order by i.sort_order)
           from crm_quote_items i where i.quote_id = q.id
         ), '[]'::jsonb) as items
  from crm_quotes q
  left join crm_leads l on l.id = q.lead_id`

export const crmQuotesRouter = new Hono<AppEnv>()
  // ── Quotes ──────────────────────────────────────────────────
  .get('/quotes', async (c) => {
    const leadId = c.req.query('lead_id')
    if (leadId && !/^[0-9a-f-]{36}$/i.test(leadId)) fail(422, 'Invalid query.')
    const rows = await attempt(c, 'crm.quotes', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        ${selectQuotes(sql)}
        where ${leadId ? sql`q.lead_id = ${leadId}` : sql`true`}
        order by q.created_at desc
        limit 500`),
    )
    if (!rows) fail(400, 'We could not load quotes.')
    return c.json(crmQuote.array().parse(rows))
  })

  .get('/quotes/:id', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.quote', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`${selectQuotes(sql)} where q.id = ${id}`),
    )
    if (!rows) fail(400, 'We could not load this quote.')
    if (!rows[0]) fail(404, 'That quote was not found.')
    return c.json(crmQuote.parse(rows[0]))
  })

  .post('/quotes', edit, async (c) => {
    const parsed = createQuoteRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the quote.')
    const v = parsed.data
    const totals = computeInvoice(
      v.lines.map((l) => ({ ...l, gst_rate: l.gst_rate as GstSlab })),
      { intraState: v.intra_state, discount: v.discount },
    )
    const items = totals.lines.map((l) => ({
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
    const row = await attempt(c, 'crm.quote_create', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [r] = await sql<{ id: string; quote_number: string }[]>`
          select * from create_quote(
            ${v.lead_id}, ${v.title ?? null}, ${v.valid_until ?? null}, ${v.place_of_supply || null}, ${v.intra_state},
            ${totals.subtotal}, ${totals.discount}, ${totals.taxable}, ${totals.tax}, ${totals.total},
            ${sql.json(items)}, ${v.notes ?? null}, ${v.terms ?? null})`
        if (!r) return null
        const [full] = await sql`${selectQuotes(sql)} where q.id = ${r.id}`
        return full ?? null
      }),
    )
    if (!row) fail(400, 'We could not create the quote.')
    const created = crmQuote.parse(row)
    await audit(c, { action: 'quote.create', entityType: 'crm_quote', entityId: created.id, after: { lead_id: v.lead_id, total: totals.total, lines: v.lines.length } })
    return c.json(created, 201)
  })

  // A draft can be corrected in full; update_quote() itself refuses once
  // it's been sent -- that's the record of the offer actually made.
  .patch('/quotes/:id', edit, async (c) => {
    const parsed = updateQuoteRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the quote.')
    const v = parsed.data
    const id = uuidParam(c)
    const totals = computeInvoice(
      v.lines.map((l) => ({ ...l, gst_rate: l.gst_rate as GstSlab })),
      { intraState: v.intra_state, discount: v.discount },
    )
    const items = totals.lines.map((l) => ({
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
      'crm.quote_update',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          await sql`select update_quote(
            ${id}, ${v.title ?? null}, ${v.valid_until ?? null}, ${v.place_of_supply || null}, ${v.intra_state},
            ${totals.subtotal}, ${totals.discount}, ${totals.taxable}, ${totals.tax}, ${totals.total},
            ${sql.json(items)}, ${v.notes ?? null}, ${v.terms ?? null})`
          const [full] = await sql`${selectQuotes(sql)} where q.id = ${id}`
          return full ?? null
        }),
      { onCode: (code) => (code === '23514' ? 'sent' : undefined) },
    )
    if (row === 'sent') fail(409, 'A quote that has been sent cannot be edited.')
    if (!row) fail(400, 'We could not update this quote.')
    const updated = crmQuote.parse(row)
    await audit(c, { action: 'quote.update', entityType: 'crm_quote', entityId: id, after: { total: totals.total, lines: v.lines.length } })
    return c.json(updated)
  })

  // Sending issues the public link; optionally the link goes out on WhatsApp
  // or by email the same way a template does.
  .post('/quotes/:id/send', edit, async (c) => {
    const parsed = sendQuoteRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid request.')
    const id = uuidParam(c)
    const v = parsed.data
    const auth = c.get('auth')
    const result = await attempt(
      c,
      'crm.quote_send',
      () =>
        withUser(c.env, auth.userId, async (sql) => {
          const [q] = await sql<{ quote_number: string; total: string; lead_id: string; name: string | null; phone_norm: string | null; email: string | null; studio: string }[]>`
            select q.quote_number, q.total, q.lead_id, l.name, l.phone_norm, l.email, co.name as studio
            from crm_quotes q join crm_leads l on l.id = q.lead_id join companies co on co.id = q.company_id
            where q.id = ${id}`
          if (!q) return 'missing' as const
          const [t] = await sql<{ token: string }[]>`select issue_quote_link(${id}, ${v.ttl_hours}) as token`
          if (!t) return null
          return { ...q, token: t.token }
        }),
      { onCode: (code, err) => (code === 'P0001' ? { rule: String((err as { message?: string })?.message ?? 'This quote cannot be sent.') } : undefined) },
    )
    if (result === 'missing') fail(404, 'That quote was not found.')
    if (!result) fail(400, 'We could not send the quote.')
    if ('rule' in result) fail(422, result.rule)

    const base = (c.env.APP_URL ?? '').replace(/\/+$/, '')
    const url = `${base}/quote/accept?token=${encodeURIComponent(result.token)}`
    const text = `Hi ${result.name ?? ''}, here is your quote ${result.quote_number} from ${result.studio} for ₹${Number(result.total).toLocaleString('en-IN')}. Review and accept it here: ${url}`
    let openUrl: string | null = null
    let delivery: 'none' | 'api' | 'link' = 'none'
    if (v.channel === 'whatsapp') {
      if (!result.phone_norm) fail(422, 'This deal has no phone number to message.')
      if (whatsappConfigured(c.env)) {
        const sent = await attempt(c, 'crm.quote_whatsapp', () => sendWhatsAppText(c.env, result.phone_norm!, text))
        if (!sent) fail(400, 'WhatsApp did not accept the message. Copy the link instead.')
        delivery = 'api'
      } else {
        openUrl = whatsappLink(result.phone_norm, text)
        delivery = 'link'
      }
    } else if (v.channel === 'email') {
      if (!result.email) fail(422, 'This deal has no email address.')
      openUrl = `mailto:${result.email}?subject=${encodeURIComponent(`Quote ${result.quote_number} from ${result.studio}`)}&body=${encodeURIComponent(text)}`
      delivery = 'link'
    }
    if (v.channel !== 'none') {
      await attempt(c, 'crm.quote_send_record', () =>
        withUser(c.env, auth.userId, (sql) => sql`
          insert into crm_activities (company_id, lead_id, type, direction, subject, body, provider, started_at)
          values (get_current_company_id(), ${result.lead_id}, ${v.channel}, 'out', ${`Quote ${result.quote_number}`}, ${text},
                  ${delivery === 'api' ? 'whatsapp' : 'manual'}, now())`),
      )
    }
    await audit(c, { action: 'quote.send', entityType: 'crm_quote', entityId: id, after: { channel: v.channel, delivery } })
    return c.json(sendQuoteResponse.parse({ url, open_url: openUrl, delivery }))
  })

  /**
   * The answer a client gave off the link — on the phone, at the studio.
   * Same transition the public page makes, with the person's name on it and
   * no token, so a quote does not sit at "sent" for ever.
   */
  .post('/quotes/:id/outcome', edit, async (c) => {
    const parsed = setQuoteOutcomeRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick an outcome.')
    const id = uuidParam(c)
    const v = parsed.data
    const result = await attempt(
      c,
      'crm.quote_outcome',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const [r] = await sql<{ status: string }[]>`
            select crm_set_quote_outcome(${id}, ${v.status}, ${v.name ?? null}, ${v.reason ?? null}) as status`
          return r ?? null
        }),
      { onCode: claimRule },
    )
    if (result && 'rule' in result) fail(422, result.rule)
    if (!result) fail(400, 'We could not record that answer.')
    await audit(c, { action: 'quote.outcome', entityType: 'crm_quote', entityId: id, after: v })
    return c.json(crmQuoteStatusResponse.parse({ status: result.status }))
  })

  // A draft can be dropped; anything sent stays as the record of the offer.
  .delete('/quotes/:id', remove, async (c) => {
    const id = uuidParam(c)
    const result = await attempt(c, 'crm.quote_delete', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [q] = await sql<{ status: string }[]>`select status from crm_quotes where id = ${id}`
        if (!q) return 'missing' as const
        if (q.status !== 'draft') return 'sent' as const
        await sql`delete from crm_quotes where id = ${id}`
        return 'ok' as const
      }),
    )
    if (result === 'missing') fail(404, 'That quote was not found.')
    if (result === 'sent') fail(409, 'A quote that has been sent cannot be deleted.')
    if (!result) fail(400, 'We could not delete this quote.')
    await audit(c, { action: 'quote.delete', entityType: 'crm_quote', entityId: id })
    return c.body(null, 204)
  })

  // ── Per-person preferences ──────────────────────────────────
  .get('/prefs', async (c) => {
    const auth = c.get('auth')
    const rows = await attempt(c, 'crm.prefs', () =>
      withUser(c.env, auth.userId, (sql) => sql<{ prefs: unknown }[]>`select prefs from crm_user_prefs where user_id = ${auth.userId}`),
    )
    if (!rows) fail(400, 'We could not load your preferences.')
    return c.json(crmUserPrefs.parse(rows[0]?.prefs ?? {}))
  })

  .put('/prefs', async (c) => {
    const parsed = updateCrmUserPrefsRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid preferences.')
    const auth = c.get('auth')
    const rows = await attempt(c, 'crm.prefs_save', () =>
      withUser(c.env, auth.userId, (sql) => sql<{ prefs: unknown }[]>`
        insert into crm_user_prefs (company_id, user_id, prefs)
        values (get_current_company_id(), ${auth.userId}, ${sql.json(parsed.data)})
        on conflict (company_id, user_id) do update set prefs = crm_user_prefs.prefs || excluded.prefs
        returning prefs`),
    )
    if (!rows) fail(400, 'We could not save your preferences.')
    return c.json(crmUserPrefs.parse(rows[0]?.prefs ?? {}))
  })

/** PUBLIC (no auth): the client views, accepts or declines a quote by token. */
export const publicQuotesRouter = new Hono<AppEnv>()
  .get('/quote/:token', async (c) => {
    const token = textParam(c, 'token', 400)
    const rows = await attempt(c, 'quote.public_get', () =>
      withService(c.env, (sql) => sql<{ q: unknown }[]>`select get_quote_for_token(${token}) as q`),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    if (!rows[0]?.q) fail(404, 'This link is invalid or has expired.')
    // The letterhead rides beside the quote; a quote without it still opens.
    const head = await attempt(c, 'quote.public_letterhead', () =>
      withService(c.env, (sql) => sql<Record<string, unknown>[]>`
        select coalesce(nullif(btrim(co.display_name), ''), co.name) as name, co.legal_name,
               coalesce(nullif(co.invoice_logo_url, ''), nullif(co.avatar_url, '')) as logo_url,
               co.invoice_gst_number as gstin, co.invoice_phone as phone, co.invoice_email as email,
               co.website, co.invoice_address as address, co.document_footer_note as footer_note,
               case when th.is_custom_theme then coalesce(th.primary_color, th.custom_color) end as brand_color,
               q.sent_at as issued_at
          from access_tokens t
          join crm_quotes q on q.id = t.subject_id
          join companies co on co.id = q.company_id
          left join company_theme_settings th on th.company_id = co.id
         where t.purpose = 'quote_accept'
           and t.token_hash = encode(sha256(convert_to(${token}, 'UTF8')), 'hex')
         limit 1`),
    )
    return c.json(publicQuote.parse({ ...(rows[0].q as object), letterhead: head?.[0] ?? null }))
  })

  .post('/quote/:token/accept', async (c) => {
    const parsed = acceptQuoteRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please enter your name to accept.')
    const token = textParam(c, 'token', 400)
    const ip = resolveClientIp(c.req.raw.headers, c.env.CLIENT_IP_HEADER)
    const ua = c.req.header('User-Agent') ?? null
    const rows = await attempt(c, 'quote.public_accept', () =>
      withService(c.env, (sql) => sql<{ ok: boolean }[]>`
        select accept_quote(${token}, ${parsed.data.name}, ${parsed.data.email ?? null}, ${ip === 'unknown' ? null : ip}, ${ua}) as ok`),
    )
    if (!rows) fail(400, 'We could not record your acceptance.')
    if (rows[0]?.ok === false) fail(409, 'This quote can no longer be accepted through this link.')
    return c.json(okResponse.parse({ ok: true }))
  })

  .post('/quote/:token/decline', async (c) => {
    const parsed = declineQuoteRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid request.')
    const token = textParam(c, 'token', 400)
    const rows = await attempt(c, 'quote.public_decline', () =>
      withService(c.env, (sql) => sql<{ ok: boolean }[]>`select decline_quote(${token}, ${parsed.data.reason ?? null}) as ok`),
    )
    if (!rows) fail(400, 'We could not record your answer.')
    if (rows[0]?.ok === false) fail(409, 'This quote can no longer be answered through this link.')
    return c.json(okResponse.parse({ ok: true }))
  })
