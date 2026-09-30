import { Hono } from 'hono'
import { emailDelivery, emailHealth, emailLogRow, emailTestRequest, emailTestResult } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withService } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { deliver } from '../../lib/email'

/** "Studio AutoPilot <noreply@mail.studioautopilot.in>" → "mail.studioautopilot.in". */
export function domainOf(from: string | undefined | null): string | null {
  if (!from) return null
  const address = /<([^>]+)>/.exec(from)?.[1] ?? from.trim()
  const at = address.lastIndexOf('@')
  return at > 0 ? address.slice(at + 1).toLowerCase() : null
}

/**
 * The platform's email check (0217): is a key set, is the sending domain
 * verified with Resend, what happened to the last emails, and a one-press test
 * send. "The mail did not arrive" is answered here instead of guessed at.
 *
 * Mounted inside platformRouter, so only a platform admin reaches it. The key
 * itself never leaves the server -- only whether one is set.
 */
export const platformEmailRouter = new Hono<AppEnv>()
  .get('/', async (c) => {
    const env = c.env
    const fromDomain = domainOf(env.EMAIL_FROM)

    let domain: { name: string; status: string } | null = null
    let note: string | null = null
    if (!env.RESEND_API_KEY) {
      note = 'No email key is set on the server, so nothing is sent at all.'
    } else if (!fromDomain) {
      note = 'The server has no sender address (EMAIL_FROM).'
    } else {
      try {
        const res = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } })
        if (res.status === 401 || res.status === 403) {
          note = 'This key can only send, so it cannot read the domain list. Open resend.com → Domains to see whether the domain is verified.'
        } else if (!res.ok) {
          note = `Resend answered ${res.status} when asked for the domain list.`
        } else {
          const body = (await res.json().catch(() => ({}))) as { data?: { name?: string; status?: string }[] }
          const hit = (body.data ?? []).find((d) => (d.name ?? '').toLowerCase() === fromDomain)
          if (hit?.name) domain = { name: hit.name, status: hit.status ?? 'unknown' }
          else note = `${fromDomain} is not added in Resend. Add it under Domains and put its records in the DNS.`
        }
      } catch {
        note = 'Could not reach Resend.'
      }
    }

    const data = await attempt(c, 'platform.email_health', () =>
      withService(env, async (sql) => {
        const recent = await sql`
          select id, kind, to_address, subject, status, provider_message_id, error, created_at
            from email_log order by created_at desc limit 60`
        const [counts] = await sql<{ sent: number; failed: number; skipped: number }[]>`
          select count(*) filter (where status = 'sent')::int as sent,
                 count(*) filter (where status = 'failed')::int as failed,
                 count(*) filter (where status = 'skipped')::int as skipped
            from email_log where created_at > now() - interval '7 days'`
        return { recent, counts }
      }),
    )
    if (!data) fail(400, 'We could not read the email log.')

    return c.json(
      emailHealth.parse({
        key_set: !!env.RESEND_API_KEY,
        from: env.EMAIL_FROM || null,
        from_domain: fromDomain,
        app_url: env.APP_URL || null,
        domain,
        domain_note: note,
        last_7_days: data.counts ?? { sent: 0, failed: 0, skipped: 0 },
        recent: emailLogRow.array().parse(data.recent.map((r) => ({ ...r, created_at: new Date(r['created_at'] as string).toISOString() }))),
      }),
    )
  })

  /** Send one test email and say exactly what Resend answered. */
  .post('/test', async (c) => {
    const parsed = emailTestRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please give an email address.')
    const r = await deliver(
      c.env,
      {
        to: parsed.data.to,
        subject: 'Studio AutoPilot test email',
        text: 'This is a test from Studio AutoPilot. If you can read it, email is working.',
        html: '<p>This is a test from <b>Studio AutoPilot</b>.</p><p>If you can read it, email is working.</p>',
      },
      { kind: 'test' },
    )
    await audit(c, { action: 'platform.email_test', entityType: 'email', entityId: null, after: { status: r.status } })
    return c.json(emailTestResult.parse({ status: r.status, id: r.id ?? null, error: r.error ?? null }))
  })

  /** Ask Resend what became of one sent email: delivered, bounced, complained… */
  .get('/:id/delivery', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'platform.email_row', () =>
      withService(c.env, (sql) => sql<{ provider_message_id: string | null }[]>`
        select provider_message_id from email_log where id = ${id}`),
    )
    if (!rows) fail(400, 'We could not read that email.')
    const pid = rows[0]?.provider_message_id
    if (!rows.length) fail(404, 'That email was not found.')
    if (!pid || !c.env.RESEND_API_KEY) return c.json(emailDelivery.parse({ last_event: null, note: 'This email never reached Resend.' }))
    try {
      const res = await fetch(`https://api.resend.com/emails/${encodeURIComponent(pid)}`, {
        headers: { Authorization: `Bearer ${c.env.RESEND_API_KEY}` },
      })
      if (res.status === 401 || res.status === 403) {
        return c.json(emailDelivery.parse({ last_event: null, note: 'This key can only send; open the email in resend.com → Emails to see what happened.' }))
      }
      if (!res.ok) return c.json(emailDelivery.parse({ last_event: null, note: `Resend answered ${res.status}.` }))
      const body = (await res.json().catch(() => ({}))) as { last_event?: string }
      return c.json(emailDelivery.parse({ last_event: body.last_event ?? null, note: null }))
    } catch {
      return c.json(emailDelivery.parse({ last_event: null, note: 'Could not reach Resend.' }))
    }
  })
