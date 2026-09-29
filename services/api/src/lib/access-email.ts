import type { Env } from '../context'
import { withService } from './db'
import { log, describeError } from './log'
import { sendOnboardingMail, type OnboardingMail } from './onboarding-email'

/**
 * The emails that tell a studio owner their free trial (0210) or paid plan
 * is running out: 7 days before, the day before, and once when it has ended
 * (0211 decides who is due). Same look as the onboarding mails: the Studio
 * AutoPilot wordmark, one heading, one line, the date, one button.
 */

export type AccessEmailKind = 'd7' | 'd1' | 'ended'

const GOLD = '#f2a618'
const NAVY = '#1b2a4a'
const INK = '#111827'
const MUTED = '#4b5563'

const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || 'there'

const base = (env: Env) => (env.APP_URL || 'https://studioautopilot.in').replace(/\/+$/, '')

const dateText = (iso: string | Date) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })

interface Copy {
  subject: string
  heading: string
  line: string
}

export function accessEmailCopy(o: { kind: AccessEmailKind; isTrial: boolean; endsAt: string | Date; name: string | null }): Copy {
  const what = o.isTrial ? 'free trial' : 'plan'
  const on = dateText(o.endsAt)
  const hi = `Hi ${firstName(o.name)}`
  if (o.kind === 'd7') {
    return {
      subject: `Your Studio AutoPilot ${what} ends in 7 days`,
      heading: `${hi}, 7 days left`,
      line: `Your ${what} ends on ${on}. Pick a plan now and your projects, team and leads carry on without a break.`,
    }
  }
  if (o.kind === 'd1') {
    return {
      subject: `Your Studio AutoPilot ${what} ends tomorrow`,
      heading: `${hi}, your ${what} ends tomorrow`,
      line: `It ends on ${on}. Pick a plan today to keep using Studio AutoPilot. Nothing you have added is lost.`,
    }
  }
  return {
    subject: `Your Studio AutoPilot ${what} has ended`,
    heading: `${hi}, your ${what} has ended`,
    line: `It ended on ${on}. Your data is safe. Pick a plan and everything is back exactly as you left it.`,
  }
}

export function accessEmail(env: Env, o: { kind: AccessEmailKind; isTrial: boolean; endsAt: string | Date; name: string | null }): OnboardingMail {
  const c = accessEmailCopy(o)
  const link = `${base(env)}/settings/subscription`
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${esc(c.subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(c.line)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:28px 10px;">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0"
               style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <tr><td style="padding:22px 28px;border-bottom:1px solid #f1f1f1;">
            <span style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${NAVY};">Studio</span><span style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${GOLD};">AutoPilot</span>
          </td></tr>
          <tr><td align="center" style="padding:32px 28px 8px;">
            <h1 style="margin:0 0 12px;font-size:26px;font-weight:800;color:${NAVY};">${esc(c.heading)}</h1>
            <p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">${esc(c.line)}</p>
          </td></tr>
          <tr><td align="center" style="padding:22px 28px 32px;">
            <a href="${esc(link)}" style="background:${GOLD};color:${INK};border:1px solid ${GOLD};display:inline-block;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;">See the plans</a>
          </td></tr>
          <tr><td style="padding:18px 28px 24px;font-size:12px;line-height:1.6;color:#6b7280;border-top:1px solid #f1f1f1;">
            <span style="color:${MUTED};">Questions? Reply to this email or press “Suggest a feature” in the app.</span><br />
            You are getting this because you own a studio on Studio AutoPilot.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
  return { subject: c.subject, html }
}

export interface AccessEmailSummary {
  due: number
  sent: number
}

/**
 * From the hourly cron. A dry run only counts. Each email is marked first and
 * sent second, so two overlapping ticks cannot send it twice.
 */
export async function runAccessEmails(env: Env, dryRun: boolean): Promise<AccessEmailSummary> {
  try {
    const due = await withService(env, (sql) =>
      sql<{ company_id: string; email: string; name: string | null; kind: AccessEmailKind; ends_at: Date; is_trial: boolean }[]>`
        select company_id, email, name, kind, ends_at, is_trial from access_email_due()`,
    )
    if (dryRun) return { due: due.length, sent: 0 }
    let sent = 0
    for (const d of due) {
      const [m] = await withService(env, (sql) =>
        sql<{ ok: boolean }[]>`select access_email_mark(${d.company_id}, ${d.kind}, ${d.ends_at}) as ok`,
      )
      if (!m?.ok) continue
      const mail = accessEmail(env, { kind: d.kind, isTrial: d.is_trial, endsAt: d.ends_at, name: d.name })
      if (await sendOnboardingMail(env, d.email, mail)) sent += 1
    }
    return { due: due.length, sent }
  } catch (e) {
    log.error({ err: describeError(e) }, 'access emails failed')
    return { due: 0, sent: 0 }
  }
}
