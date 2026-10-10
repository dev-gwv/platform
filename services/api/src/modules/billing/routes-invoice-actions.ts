import { Hono } from 'hono'
import { recordPaymentRequest, paymentReminderQuote, paymentReminderResult } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { explain } from '../messaging/router'

export const invoiceActionRoutes = new Hono<AppEnv>()
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

  /**
   * A link the client can open without logging in (or, with revoke, one that
   * stops working). Each call replaces the previous link.
   */

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
   * What an emailed payment reminder would cost right now (free inside the
   * month's allowance, else the email price from the wallet), and when the
   * last one went to the client. Anyone who can see the invoice.
   */
  .get('/invoices/:id/remind', async (c) => {
    const id = uuidParam(c)
    const row = await attempt(c, 'billing.invoice_remind_quote', () =>
      withUser(c.env, c.get('auth').userId, async (sql) =>
        (await sql`select * from client_payment_reminder_quote(${id})`)[0] ?? null),
    { onCode: explain })
    if (!row) fail(404, 'That invoice was not found.')
    return c.json(paymentReminderQuote.parse(row))
  })

  /**
   * "Send payment reminder": one email to the client now. An explicit action,
   * so the studio's automatic-reminder switch does not apply, but the charge
   * and the monthly email limit do. A second click inside 10 minutes returns
   * the first reminder rather than sending another.
   */
  .post('/invoices/:id/remind', requireAction('billing', 'edit'), async (c) => {
    const id = uuidParam(c)
    const row = await attempt(c, 'billing.invoice_remind', () =>
      withUser(c.env, c.get('auth').userId, async (sql) =>
        (await sql`select * from send_client_payment_reminder(${id})`)[0] ?? null),
    { onCode: explain })
    if (!row) fail(400, 'We could not send the reminder.')
    const out = paymentReminderResult.parse(row)
    if (out.id && !out.repeated) {
      await audit(c, { action: 'invoice.payment_reminder', entityType: 'invoice', entityId: id, after: { status: out.status, cost_paise: out.cost_paise } })
    }
    return c.json(out, out.status === 'queued' && !out.repeated ? 201 : 200)
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
