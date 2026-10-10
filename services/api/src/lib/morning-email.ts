import type { Env } from '../context'
import { withService } from './db'
import { log, describeError } from './log'
import { timingSafeEqual } from './crypto'
import { sendOnboardingMail, signFor, type OnboardingMail } from './onboarding-email'

/**
 * The morning email: one short mail at 8 am to each owner and admin, with
 * what the day needs (0198 decides who is due and what goes in). At most
 * four blocks, and only the ones with something in them: today's shoots,
 * leads, tasks, money. Same look as the onboarding emails.
 */

const GOLD = '#f2a618'
const NAVY = '#1b2a4a'
const INK = '#111827'
const MUTED = '#4b5563'

export interface MorningFacts {
  userId: string
  name: string | null
  studio: string
  day: string
  shoots: { name: string; time: string | null; place: string | null }[]
  newLeads: number
  followUps: number
  tasks: number
  overdueCount: number
  overdueAmount: number
  /** Leads going cold (0205): never called, quotation quiet 3+ days, same stage 5+ days. */
  coldUncalled?: number
  coldOldestDays?: number
  coldQuietQuotes?: number
  coldStuck?: number
  /** What each caller did yesterday. */
  yesterday?: { name: string | null; calls: number; answered: number; quotes: number; booked: number }[]
}

const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const base = (env: Env) => (env.APP_URL || 'https://studioautopilot.in').replace(/\/+$/, '')
const firstName = (name: string | null) => (name ?? '').trim().split(/\s+/)[0] || 'there'
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function morningStopToken(env: Env, userId: string): Promise<string> {
  return signFor(env, `morning-stop:${userId}`)
}

export async function morningStopTokenValid(env: Env, userId: string, token: string): Promise<boolean> {
  return timingSafeEqual(await morningStopToken(env, userId), token)
}

function block(title: string, body: string, button?: { label: string; href: string }): string {
  const btn = button
    ? `<p style="margin:12px 0 0;"><a href="${esc(button.href)}" style="display:inline-block;padding:9px 16px;border-radius:8px;background:#ffffff;border:1px solid #d1d5db;color:${NAVY};font-size:13px;font-weight:600;text-decoration:none;">${esc(button.label)} &rarr;</a></p>`
    : ''
  return `
  <tr><td style="padding:10px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef0f3;border-radius:12px;">
      <tr><td style="padding:16px 18px;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:0.06em;color:${GOLD};text-transform:uppercase;">${esc(title)}</p>
        ${body}
        ${btn}
      </td></tr>
    </table>
  </td></tr>`
}

const line = (text: string) => `<p style="margin:2px 0;font-size:15px;line-height:1.55;color:${INK};">${text}</p>`

export async function morningMail(env: Env, f: MorningFacts): Promise<OnboardingMail> {
  const app = base(env)
  const blocks: string[] = []
  const summary: string[] = []

  if (f.shoots.length > 0) {
    summary.push(plural(f.shoots.length, 'shoot', 'shoots'))
    blocks.push(
      block(
        'Today',
        f.shoots
          .map((s) =>
            line(
              `<strong>${esc(s.name)}</strong>${s.time ? ` · ${esc(s.time)}` : ''}${s.place ? ` · <span style="color:${MUTED};">${esc(s.place)}</span>` : ''}`,
            ),
          )
          .join(''),
        { label: 'Open shoots', href: `${app}/shoots` },
      ),
    )
  }
  if (f.newLeads > 0 || f.followUps > 0) {
    const parts = [
      f.newLeads > 0 ? `${plural(f.newLeads, 'new lead', 'new leads')} since yesterday` : null,
      f.followUps > 0 ? `${plural(f.followUps, 'follow-up', 'follow-ups')} due today` : null,
    ].filter(Boolean) as string[]
    summary.push(plural(f.newLeads + f.followUps, 'lead', 'leads'))
    blocks.push(block('Leads', parts.map(line).join(''), { label: 'Open leads', href: `${app}/follow-ups` }))
  }
  if (f.tasks > 0) {
    summary.push(plural(f.tasks, 'task', 'tasks'))
    blocks.push(
      block('Tasks', line(`${plural(f.tasks, 'task is', 'tasks are')} due or late`), {
        label: 'Open tasks',
        href: `${app}/tasks`,
      }),
    )
  }
  if (f.overdueCount > 0) {
    summary.push(`${inr(f.overdueAmount)} overdue`)
    blocks.push(
      block(
        'Money',
        line(`<strong>${inr(f.overdueAmount)}</strong> overdue on ${plural(f.overdueCount, 'invoice', 'invoices')}`),
        { label: 'Open invoices', href: `${app}/billing/invoices?status=overdue` },
      ),
    )
  }

  const cold = [
    (f.coldUncalled ?? 0) > 0
      ? `${plural(f.coldUncalled!, 'lead', 'leads')} nobody has called yet${(f.coldOldestDays ?? 0) > 1 ? ` (the oldest ${f.coldOldestDays} days ago)` : ''}`
      : null,
    (f.coldQuietQuotes ?? 0) > 0 ? `${plural(f.coldQuietQuotes!, 'quotation', 'quotations')} quiet for 3 days or more` : null,
    (f.coldStuck ?? 0) > 0 ? `${plural(f.coldStuck!, 'lead', 'leads')} stuck in the same stage for 5 days or more` : null,
  ].filter(Boolean) as string[]
  if (cold.length > 0) {
    summary.push(`${(f.coldUncalled ?? 0) + (f.coldQuietQuotes ?? 0) + (f.coldStuck ?? 0)} going cold`)
    blocks.push(block('Leads going cold', cold.map(line).join(''), { label: "Open Today's calls", href: `${app}/follow-ups/queue` }))
  }
  if (f.yesterday && f.yesterday.length > 0) {
    blocks.push(
      block(
        'Yesterday',
        f.yesterday
          .map((y) =>
            line(
              `<strong>${esc(firstName(y.name))}</strong> · ${plural(y.calls, 'call', 'calls')} (${y.answered} answered)` +
                `${y.quotes > 0 ? ` · ${plural(y.quotes, 'quotation', 'quotations')}` : ''}${y.booked > 0 ? ` · <strong>${y.booked} booked</strong>` : ''}`,
            ),
          )
          .join(''),
      ),
    )
  }

  const dayLabel = new Date(`${f.day}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
  const stop = `${app}/stop-emails?m=${f.userId}&t=${await morningStopToken(env, f.userId)}`
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>Your day at ${esc(f.studio)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(summary.join(' · '))}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:28px 10px;">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0"
               style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <tr><td style="padding:22px 28px;border-bottom:1px solid #f1f1f1;">
            <span style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${NAVY};">Studio</span><span style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${GOLD};">AutoPilot</span>
          </td></tr>
          <tr><td style="padding:26px 28px 8px;">
            <h1 style="margin:0 0 6px;font-size:24px;font-weight:800;color:${NAVY};">Good morning, ${esc(firstName(f.name))}</h1>
            <p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">${esc(dayLabel)} at ${esc(f.studio)}.</p>
          </td></tr>
          ${blocks.join('')}
          <tr><td style="padding:22px 28px 26px;font-size:12px;line-height:1.6;color:#6b7280;">
            <a href="${esc(app)}" style="color:${NAVY};font-weight:600;text-decoration:none;">Open Studio AutoPilot</a><br />
            You get this each morning as an owner or admin of ${esc(f.studio)}. <a href="${esc(stop)}" style="color:#6b7280;">Stop these emails</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
  return { subject: `Today: ${summary.join(' · ')}`, html }
}

interface MorningSummary {
  due: number
  sent: number
}

/** From the hourly cron. Each is marked first and sent second: once a day, even if two ticks overlap. */
export async function runMorningEmails(env: Env, dryRun: boolean): Promise<MorningSummary> {
  const due = await withService(env, (sql) =>
    sql<
      {
        user_id: string
        company_id: string
        email: string
        name: string | null
        studio: string
        day: string
        shoots: MorningFacts['shoots']
        new_leads: number
        follow_ups: number
        tasks: number
        overdue_count: number
        overdue_amount: string | number
        cold_uncalled: number
        cold_oldest_days: number
        cold_quiet_quotes: number
        cold_stuck: number
        yesterday: NonNullable<MorningFacts['yesterday']>
      }[]
    >`select * from morning_email_due()`,
  )
  if (dryRun) return { due: due.length, sent: 0 }
  let sent = 0
  for (const d of due) {
    try {
      const [m] = await withService(env, (sql) =>
        sql<{ ok: boolean }[]>`select morning_email_mark(${d.user_id}, ${d.company_id}, ${d.day}) as ok`,
      )
      if (!m?.ok) continue
      const mail = await morningMail(env, {
        userId: d.user_id,
        name: d.name,
        studio: d.studio,
        day: d.day,
        shoots: d.shoots,
        newLeads: d.new_leads,
        followUps: d.follow_ups,
        tasks: d.tasks,
        overdueCount: d.overdue_count,
        overdueAmount: Number(d.overdue_amount),
        coldUncalled: d.cold_uncalled,
        coldOldestDays: d.cold_oldest_days,
        coldQuietQuotes: d.cold_quiet_quotes,
        coldStuck: d.cold_stuck,
        yesterday: d.yesterday,
      })
      if (await sendOnboardingMail(env, d.email, mail)) sent += 1
    } catch (e) {
      log.error({ err: describeError(e) }, 'morning email failed')
    }
  }
  return { due: due.length, sent }
}
