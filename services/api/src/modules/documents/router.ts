import { Hono } from 'hono'
import {
  issueQuotationRequest,
  issueReceiptRequest,
  issuedLink,
  issuedQuotation,
  publicDelivery,
  publicInvoice,
  publicQuotation,
  publicReceipt,
  respondToQuotationRequest,
  sendQuotationEmailRequest,
  sendQuotationEmailResponse,
  sendReceiptEmailRequest,
  z,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { textParam, uuidParam } from '../../lib/params'
import { withService, withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { resolveClientIp } from '../../lib/client-ip'
import { sendClientDocEmail } from '../../lib/email'
import { serve } from '../files/router'

const okResponse = z.object({ ok: z.boolean() })

/** The studio's own note goes into an HTML email; it must stay text. */
const escapeHtml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Issuing the client-facing documents.
 *
 * Each one is a row plus a token; the studio gets back a link to send however
 * they like. Nothing is emailed from here — a studio sends a quotation on
 * WhatsApp as often as by mail, and the link works either way.
 */
export const documentsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .post('/quotations', requireAction('projects', 'edit'), async (c) => {
    const parsed = issueQuotationRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please pick a project to quote.')
    const row = await attempt(c, 'documents.quotation', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ quotation_id: string; token: string }[]>`
          select quotation_id, token from issue_project_quotation(
            p_project_id => ${parsed.data.project_id},
            p_notes => ${parsed.data.notes ?? null}
          )`
        // Sending a link is showing the quotation: the public page reads the
        // project's "Show to client" switch (0190), which new projects start
        // with off. Only an explicit show_quotation: false leaves it alone.
        if (rows[0] && parsed.data.show_quotation !== false) {
          await sql`update projects set show_quotation = true
                     where id = ${parsed.data.project_id} and not show_quotation`
        }
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not create the quotation.')
    // Lovable parity extras (best-effort; snapshot stays authoritative).
    try {
      const d = parsed.data
      await withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`update project_quotations set
            branding_snapshot = coalesce(${d.branding ? sql.json(d.branding as never) : null}::jsonb, branding_snapshot),
            shoots_schedule = coalesce(${d.shoots_schedule ? sql.json(d.shoots_schedule as never) : null}::jsonb, shoots_schedule),
            terms_text = coalesce(${d.terms_text ?? null}, terms_text),
            display_prefs = coalesce(${d.display_prefs ? sql.json(d.display_prefs as never) : null}::jsonb, display_prefs),
            show_quotation = coalesce(${d.show_quotation ?? null}, show_quotation),
            expires_at = coalesce((${d.expiry_days != null ? sql`now() + make_interval(days => ${d.expiry_days})` : sql`null`})::timestamptz, expires_at)
          where id = ${row.quotation_id}`
      })
    } catch {
      // extras never fail issuance
    }
    await audit(c, {
      action: 'quotation.issue',
      entityType: 'project_quotation',
      entityId: row.quotation_id,
      after: { project_id: parsed.data.project_id },
    })
    return c.json(
      issuedQuotation.parse({ id: row.quotation_id, link: `${c.env.APP_URL}/quotation?token=${row.token}` }),
      201,
    )
  })

  // Lovable parity: revoke a quotation link (client sees invalid/expired).
  .post('/quotations/:id/revoke', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const ok = await attempt(c, 'documents.quotation_revoke', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`update project_quotations set revoked_at = now()
          where id = ${id} and company_id = ${c.get('auth').companyId}`
        return true
      }),
    )
    if (!ok) fail(400, 'We could not revoke this link.')
    await audit(c, { action: 'quotation.revoke', entityType: 'project_quotation', entityId: id })
    return c.json(okResponse.parse({ ok: true }))
  })

  // Lovable parity: send-quotation-email (Resend; provider_missing falls back to mailto/copy).
  .post('/quotations/:id/send-email', requireAction('projects', 'edit'), async (c) => {
    const parsed = sendQuotationEmailRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid email payload.')
    const id = uuidParam(c)
    const info = await attempt(c, 'documents.quotation_email_info', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ client_email: string | null; project_name: string | null; company_name: string | null }[]>`
          select cl.email as client_email, p.name as project_name, co.name as company_name
            from project_quotations q
            join projects p on p.id = q.project_id
            left join clients cl on cl.id = p.client_id
            left join companies co on co.id = q.company_id
           where q.id = ${id} and q.company_id = ${c.get('auth').companyId}`
        return rows[0] ?? null
      }),
    )
    if (!info) fail(404, 'That quotation was not found.')
    const to = parsed.data.to_email ?? info.client_email
    // Always mint a fresh link for the email so rotation is explicit.
    const token = await attempt(c, 'documents.quotation_email_token', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ token: string }[]>`
          select issue_access_token('quotation', ${id}, 720) as token`
        return rows[0]?.token ?? null
      }),
    )
    const link = `${c.env.APP_URL}/quotation?token=${token ?? ''}`
    const subject = parsed.data.subject?.replace(/[<>]/g, '')
      || `Quotation${info.project_name ? ` for ${info.project_name}` : ''} — ${info.company_name ?? 'Studio'}`
    const intro = parsed.data.message
      ? escapeHtml(parsed.data.message).replace(/\r?\n/g, '<br>')
      : `${info.company_name ?? 'The studio'} has shared a quotation${info.project_name ? ` for ${info.project_name}` : ''}. Open the link to view and respond.`
    const result = await sendClientDocEmail(c.env, to, subject, link, intro)
    try {
      await withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`insert into quotation_email_logs (company_id, quotation_id, to_email, status, error, created_by)
          values (${c.get('auth').companyId}, ${id}, ${to ?? null}, ${result.status}, ${result.error ?? null}, ${c.get('auth').userId})`
      })
    } catch { /* log table may predate migration; never fail send */ }
    return c.json(sendQuotationEmailResponse.parse({ status: result.status, error: result.error ?? null, url: result.url }))
  })

  .post('/receipts', requireAction('billing', 'view'), async (c) => {
    const parsed = issueReceiptRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please pick a payment.')
    // Lovable parity: revoke rotates out all live links for this payment.
    if (parsed.data.revoke) {
      await attempt(c, 'documents.receipt_revoke', () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          await sql`select revoke_access_token('receipt', ${parsed.data.payment_id})`
          return true
        }),
      )
      await audit(c, { action: 'receipt.revoke', entityType: 'payment', entityId: parsed.data.payment_id })
      return c.json(okResponse.parse({ ok: true }))
    }
    const ttlHours = (parsed.data.expiry_days ?? 365) * 24
    const rows = await attempt(c, 'documents.receipt', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        async (sql) => {
          if (parsed.data.rotate) {
            return sql<{ token: string }[]>`
              select rotate_access_token('receipt', ${parsed.data.payment_id}, ${ttlHours}) as token`
          }
          return sql<{ token: string }[]>`
            select issue_payment_receipt(p_payment_id => ${parsed.data.payment_id}, p_ttl_hours => ${ttlHours}) as token`
        },
      ),
    )
    const token = rows?.[0]?.token
    if (!token) fail(400, 'We could not create the receipt.')
    return c.json(issuedLink.parse({ link: `${c.env.APP_URL}/receipt?token=${token}` }), 201)
  })

  // Lovable parity: send-receipt-email. Mirrors receiptShareActions.ts semantics:
  // sent | provider_missing (open mailto / copy link) | failed (show error).
  // Multi-recipient: to_emails[] is sent one-by-one so one bad address never
  // blocks the rest; the link is minted once and shared by every recipient.
  .post('/receipts/send-email', requireAction('billing', 'view'), async (c) => {
    const body = await c.req.json().catch(() => ({})) as { payment_id?: unknown; to_email?: unknown; to_emails?: unknown }
    const pid = z.string().uuid().safeParse(body.payment_id)
    if (!pid.success) fail(422, 'Please pick a payment.')
    const parsed = sendReceiptEmailRequest.safeParse({ to_email: body.to_email ?? undefined, to_emails: body.to_emails ?? undefined })
    if (!parsed.success) fail(422, 'Invalid email payload.')
    const info = await attempt(c, 'documents.receipt_email_info', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ client_email: string | null; project_name: string | null; company_name: string | null; amount: number }[]>`
          select cl.email as client_email, p.name as project_name, co.name as company_name, rp.amount
            from received_payments rp
            join projects p on p.id = rp.project_id
            left join clients cl on cl.id = coalesce(rp.client_id, p.client_id)
            left join companies co on co.id = rp.company_id
           where rp.id = ${pid.data} and rp.company_id = ${c.get('auth').companyId}`
        return rows[0] ?? null
      }),
    )
    if (!info) fail(404, 'That payment was not found.')
    const recipients = [...(parsed.data.to_emails ?? []), ...(parsed.data.to_email ? [parsed.data.to_email] : [])]
      .map((e) => String(e).trim().toLowerCase())
      .filter(Boolean)
    const toList = recipients.length > 0 ? [...new Set(recipients)] : (info.client_email ? [info.client_email] : [])
    if (toList.length === 0) fail(422, 'Client email not found. Add an email to send the receipt.')
    const tokenRows = await attempt(c, 'documents.receipt_email_token', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ token: string }[]>`
          select issue_payment_receipt(p_payment_id => ${pid.data}, p_ttl_hours => ${365 * 24}) as token`
        return rows
      }),
    )
    const link = `${c.env.APP_URL}/receipt?token=${tokenRows?.[0]?.token ?? ''}`
    const subject = `Payment receipt${info.project_name ? ` for ${info.project_name}` : ''} — ${info.company_name ?? 'Studio'}`
    const bodyText = `${info.company_name ?? 'The studio'} has shared your payment receipt. Open the link to view and download it.`
    const sentTo: string[] = []
    const failedTo: { email: string; error: string }[] = []
    let lastStatus: 'sent' | 'provider_missing' | 'failed' = 'sent'
    let lastError: string | null = null
    for (const to of toList) {
      const result = await sendClientDocEmail(c.env, to, subject, link, bodyText)
      try {
        await withUser(c.env, c.get('auth').userId, async (sql) => {
          await sql`insert into receipt_email_logs (company_id, payment_id, to_email, status, error, created_by)
            values (${c.get('auth').companyId}, ${pid.data}, ${to ?? null}, ${result.status}, ${result.error ?? null}, ${c.get('auth').userId})`
        })
      } catch { /* pre-migration; never fail send */ }
      if (result.status === 'sent') {
        sentTo.push(to)
      } else if (result.status === 'provider_missing') {
        lastStatus = 'provider_missing'
        lastError = result.error ?? null
      } else {
        lastStatus = result.status
        lastError = result.error ?? 'Email failed to send.'
        failedTo.push({ email: to, error: result.error ?? 'Email failed to send.' })
      }
    }
    if (lastStatus === 'provider_missing' && sentTo.length === 0 && failedTo.length === 0) {
      return c.json({ status: lastStatus, error: lastError, url: link })
    }
    if (sentTo.length > 0 && failedTo.length === 0) {
      return c.json({ status: 'sent', error: null, url: link, sent_to: sentTo })
    }
    if (sentTo.length > 0) {
      return c.json({ status: 'sent', error: null, url: link, sent_to: sentTo, failed_to: failedTo })
    }
    if (lastStatus === 'provider_missing') {
      return c.json({ status: lastStatus, error: lastError, url: link })
    }
    return c.json({ status: 'failed', error: lastError ?? 'Email failed to send.', url: link, failed_to: failedTo })
  })

/**
 * PUBLIC (no auth): what the client opens.
 *
 * service_role because the reader has no session; every query is scoped by the
 * token, which resolves to exactly one row.
 */
export const publicDocumentsRouter = new Hono<AppEnv>()
  .get('/quotation/:token', async (c) => {
    const token = textParam(c, 'token', 400)
    const rows = await attempt(c, 'documents.public_quotation', () =>
      withService(c.env, (sql) => sql`select * from get_quotation_for_token(p_raw => ${token})`),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    if (!rows[0]) fail(404, 'This link is invalid or has expired.')
    return c.json(publicQuotation.parse(rows[0]))
  })

  .post('/quotation/:token/respond', async (c) => {
    const parsed = respondToQuotationRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please say yes or no.')
    // A name is the signature on an acceptance; declining asks for nothing.
    if (parsed.data.accept && (parsed.data.name ?? '').trim().length < 2) {
      fail(422, 'Please type your name to accept.')
    }
    const token = textParam(c, 'token', 400)
    const ip = resolveClientIp(c.req.raw.headers, c.env.CLIENT_IP_HEADER)
    const rows = await attempt(c, 'documents.quotation_respond', () =>
      withService(
        c.env,
        (sql) => sql<{ ok: boolean }[]>`
          select respond_to_quotation(
            p_raw => ${token},
            p_accept => ${parsed.data.accept},
            p_name => ${parsed.data.name ?? null},
            p_ip => ${ip === 'unknown' ? null : ip},
            p_user_agent => ${c.req.header('User-Agent') ?? null}
          ) as ok`,
      ),
    )
    if (!rows) fail(400, 'We could not record your answer.')
    if (rows[0]?.ok === false) fail(409, 'This quotation has already been answered, or the link has expired.')
    return c.json(okResponse.parse({ ok: true }))
  })

  .get('/receipt/:token', async (c) => {
    const token = textParam(c, 'token', 400)
    const rows = await attempt(c, 'documents.public_receipt', () =>
      withService(c.env, (sql) => sql`select * from get_receipt_for_token(p_raw => ${token})`),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    if (!rows[0]) fail(404, 'This link is invalid or has expired.')
    return c.json(publicReceipt.parse(rows[0]))
  })

  .get('/invoice/:token', async (c) => {
    const token = textParam(c, 'token', 400)
    const rows = await attempt(c, 'documents.public_invoice', () =>
      withService(c.env, (sql) => sql<{ doc: unknown }[]>`select get_invoice_for_token(p_raw => ${token}) as doc`),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    if (!rows[0]?.doc) fail(404, 'This link is invalid or has expired.')
    return c.json(publicInvoice.parse(rows[0].doc))
  })

  // A file the studio attached to the invoice, downloaded by the client
  // through the invoice link itself: no account, nothing else reachable.
  .get('/invoice/:token/files/:file', async (c) => {
    const token = textParam(c, 'token', 400)
    const file = uuidParam(c, 'file')
    const rows = await attempt(c, 'documents.public_invoice_file', () =>
      withService(c.env, (sql) => sql<{ name: string; mime: string; bytes: Buffer }[]>`
        select * from invoice_attachment_for_token(p_raw => ${token}, p_file => ${file})`),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    if (!rows[0]) fail(404, 'This file is not available.')
    return serve(rows[0])
  })

  .get('/delivery/:token', async (c) => {
    const token = textParam(c, 'token', 400)
    const rows = await attempt(c, 'documents.public_delivery', () =>
      withService(c.env, (sql) => sql`select * from get_delivery_for_token(p_raw => ${token})`),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    if (!rows[0]) fail(404, 'This link is invalid, expired, or the work is not ready yet.')
    return c.json(publicDelivery.parse(rows[0]))
  })
