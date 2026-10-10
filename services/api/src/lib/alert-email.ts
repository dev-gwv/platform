import type { Env } from '../context'
import { withService } from './db'
import { deliver } from './email'
import { log, describeError } from './log'

/**
 * Email copies of a team member's alerts (0227). An alert about work given to
 * them -- a booking, a task, an edit to start, cards to hand over -- that is
 * still unread fifteen minutes after it was made goes out once by email, all
 * of one person's in a single message. Read it in the app first and no email
 * comes. Anyone turns the copies off on My profile.
 */

const GOLD = '#f2a618'
const NAVY = '#1b2a4a'
const INK = '#111827'

const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || 'there'

const base = (env: Env) => (env.APP_URL || 'https://studioautopilot.in').replace(/\/+$/, '')

export interface AlertRow {
  notification_id: string
  company_id: string
  studio_name: string | null
  recipient_uid: string
  email: string
  name: string | null
  type: string
  title: string
  body: string | null
  deep_link: string | null
}

/** Only paths inside the app become links; anything else opens Home. */
export function alertLink(env: Env, deepLink: string | null): string {
  const path = deepLink && /^\/(?!\/)[\w\-/?=&.%]*$/.test(deepLink) ? deepLink : '/'
  return `${base(env)}${path}`
}

export function alertEmail(env: Env, rows: readonly AlertRow[]): { subject: string; html: string; text: string } {
  const first = rows[0]!
  const studio = first.studio_name?.trim() || 'your studio'
  const subject = rows.length === 1 ? first.title : `${rows.length} things waiting for you at ${studio}`
  const items = rows
    .map(
      (r) => `<tr><td style="padding:12px 0;border-top:1px solid #f1f1f1;">
            <a href="${esc(alertLink(env, r.deep_link))}" style="font-size:15px;font-weight:700;color:${NAVY};text-decoration:none;">${esc(r.title)}</a>
            ${r.body ? `<div style="margin-top:3px;font-size:14px;line-height:1.5;color:#4b5563;">${esc(r.body)}</div>` : ''}
          </td></tr>`,
    )
    .join('')
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${esc(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:28px 10px;">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0"
               style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <tr><td style="padding:22px 28px;border-bottom:1px solid #f1f1f1;">
            <span style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${NAVY};">Studio</span><span style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${GOLD};">AutoPilot</span>
          </td></tr>
          <tr><td style="padding:26px 28px 6px;">
            <h1 style="margin:0 0 6px;font-size:22px;font-weight:800;color:${NAVY};">Hi ${esc(firstName(first.name))}, from ${esc(studio)}</h1>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table>
          </td></tr>
          <tr><td align="center" style="padding:18px 28px 30px;">
            <a href="${esc(base(env))}/" style="background:${GOLD};color:${INK};border:1px solid ${GOLD};display:inline-block;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;">Open my day</a>
          </td></tr>
          <tr><td style="padding:16px 28px 22px;font-size:12px;line-height:1.6;color:#6b7280;border-top:1px solid #f1f1f1;">
            You get this when an alert in the app is still unread after 15 minutes. Turn these emails off on My profile.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
  const text = [
    `Hi ${firstName(first.name)}, from ${studio}`,
    '',
    ...rows.map((r) => `- ${r.title}${r.body ? ` -- ${r.body}` : ''}\n  ${alertLink(env, r.deep_link)}`),
    '',
    'Turn these emails off on My profile.',
  ].join('\n')
  return { subject, html, text }
}

interface AlertEmailSummary {
  due: number
  people: number
  sent: number
}

/**
 * From the hourly cron. A dry run only counts. Alerts are claimed before the
 * email goes, so two overlapping ticks never send one twice.
 */
export async function runAlertEmails(env: Env, dryRun: boolean): Promise<AlertEmailSummary> {
  try {
    const due = await withService(env, (sql) => sql<AlertRow[]>`select * from alert_email_due(500)`)
    const byPerson = new Map<string, AlertRow[]>()
    for (const r of due) {
      const k = `${r.company_id}:${r.recipient_uid}`
      byPerson.set(k, [...(byPerson.get(k) ?? []), r])
    }
    if (dryRun) return { due: due.length, people: byPerson.size, sent: 0 }
    let sent = 0
    for (const rows of byPerson.values()) {
      const claimed = await withService(env, (sql) =>
        sql<{ id: string }[]>`select alert_email_mark(${rows.map((r) => r.notification_id)}::uuid[]) as id`,
      )
      const mine = new Set(claimed.map((c) => c.id))
      const send = rows.filter((r) => mine.has(r.notification_id)).slice(0, 10)
      if (send.length === 0) continue
      const mail = alertEmail(env, send)
      const r = await deliver(env, { to: send[0]!.email, ...mail }, { kind: 'staff_alert', companyId: send[0]!.company_id })
      // Anything claimed beyond the first ten rides on this email's outcome:
      // they were in the app all along, and a wall of alerts helps nobody.
      await withService(env, (sql) => sql`select alert_email_result(${[...mine]}::uuid[], ${r.status})`)
      if (r.status === 'sent') sent += 1
    }
    return { due: due.length, people: byPerson.size, sent }
  } catch (e) {
    log.error({ err: describeError(e) }, 'alert emails failed')
    return { due: 0, people: 0, sent: 0 }
  }
}
