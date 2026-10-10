import type { Env } from '../context'
import { withService } from './db'
import { log, describeError } from './log'
import { timingSafeEqual } from './crypto'
import { sendOnboardingMail, signFor, type OnboardingMail } from './onboarding-email'
import { GOLD, NAVY, base, block, esc, firstName, inr, line, plural } from './morning-email'

/**
 * The Monday email (0258): one short mail to each studio's owner, Monday
 * from 8 am. What came in last week, and what the week ahead needs -- each
 * as a sentence with the one place to act. Blocks with nothing in them are
 * left out; 0258 sends nothing in a week with nothing at all.
 */

export interface WeeklyFacts {
  userId: string
  name: string | null
  studio: string
  week: string
  received: number
  receivedCount: number
  overdueAmount: number
  overdueCount: number
  dueWeekAmount: number
  dueWeekCount: number
  shootsWeek: number
  shootsUnstaffed: number
  editsLate: number
  editsDueWeek: number
  leadsNew: number
  leadsBooked: number
}

export function weeklyStopToken(env: Env, userId: string): Promise<string> {
  return signFor(env, `weekly-stop:${userId}`)
}

export async function weeklyStopTokenValid(env: Env, userId: string, token: string): Promise<boolean> {
  return timingSafeEqual(await weeklyStopToken(env, userId), token)
}

/** The blocks and the subject line, without the page around them: what a test reads. */
export function weeklyBlocks(app: string, f: WeeklyFacts): { blocks: string[]; summary: string[] } {
  const blocks: string[] = []
  const summary: string[] = []

  const money: string[] = []
  if (f.received > 0) money.push(`<strong>${inr(f.received)}</strong> came in last week (${plural(f.receivedCount, 'payment', 'payments')}).`)
  if (f.dueWeekCount > 0) money.push(`${inr(f.dueWeekAmount)} falls due this week on ${plural(f.dueWeekCount, 'invoice', 'invoices')}.`)
  if (f.overdueCount > 0) money.push(`<strong>${inr(f.overdueAmount)}</strong> is overdue on ${plural(f.overdueCount, 'invoice', 'invoices')}.`)
  if (money.length > 0) {
    if (f.received > 0) summary.push(`${inr(f.received)} in`)
    if (f.overdueCount > 0) summary.push(`${inr(f.overdueAmount)} overdue`)
    blocks.push(block('Money', money.map(line).join(''), { label: 'Open payments', href: `${app}/billing/payments` }))
  }

  if (f.shootsWeek > 0) {
    summary.push(plural(f.shootsWeek, 'shoot', 'shoots'))
    const who =
      f.shootsUnstaffed > 0
        ? ` ${f.shootsUnstaffed === f.shootsWeek ? (f.shootsWeek === 1 ? 'It has' : 'They have') : `${f.shootsUnstaffed} ${f.shootsUnstaffed === 1 ? 'has' : 'have'}`} nobody booked yet.`
        : ' Every one has its crew.'
    blocks.push(
      block('Shoots this week', line(`${plural(f.shootsWeek, 'shoot day', 'shoot days')} this week.${who}`), {
        label: f.shootsUnstaffed > 0 ? 'Book the crew' : 'Open shoots',
        href: `${app}/team-allocation`,
      }),
    )
  }

  if (f.editsLate > 0 || f.editsDueWeek > 0) {
    if (f.editsLate > 0) summary.push(`${f.editsLate} late`)
    const parts = [
      f.editsLate > 0 ? `<strong>${plural(f.editsLate, 'edit is', 'edits are')} late.</strong>` : null,
      f.editsDueWeek > 0 ? `${plural(f.editsDueWeek, 'edit is', 'edits are')} due this week.` : null,
    ].filter(Boolean) as string[]
    blocks.push(block('Editing', parts.map(line).join(''), { label: 'Open Post-Production', href: `${app}/production-board` }))
  }

  if (f.leadsNew > 0) {
    summary.push(plural(f.leadsNew, 'new lead', 'new leads'))
    blocks.push(
      block(
        'Leads',
        line(`${plural(f.leadsNew, 'new lead', 'new leads')} last week${f.leadsBooked > 0 ? `, and <strong>${f.leadsBooked} booked</strong>` : ''}.`),
        { label: 'Open leads', href: `${app}/follow-ups` },
      ),
    )
  }
  return { blocks, summary }
}

export async function weeklyMail(env: Env, f: WeeklyFacts): Promise<OnboardingMail> {
  const app = base(env)
  const { blocks, summary } = weeklyBlocks(app, f)
  const stop = `${app}/stop-emails?w=${f.userId}&t=${await weeklyStopToken(env, f.userId)}`
  const weekLabel = new Date(`${f.week}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>Your week at ${esc(f.studio)}</title>
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
            <h1 style="margin:0 0 6px;font-size:24px;font-weight:800;color:${NAVY};">Your week, ${esc(firstName(f.name))}</h1>
            <p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">Week of ${esc(weekLabel)} at ${esc(f.studio)}.</p>
          </td></tr>
          ${blocks.join('')}
          <tr><td style="padding:22px 28px 26px;font-size:12px;line-height:1.6;color:#6b7280;">
            <a href="${esc(app)}" style="color:${NAVY};font-weight:600;text-decoration:none;">Open Studio AutoPilot</a><br />
            You get this every Monday as the owner of ${esc(f.studio)}. <a href="${esc(stop)}" style="color:#6b7280;">Stop the Monday email</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
  return { subject: `This week: ${summary.join(' · ')}`, html }
}

/** From the hourly cron. Marked first, sent second: once a week, even if two ticks overlap. */
export async function runWeeklyEmails(env: Env, dryRun: boolean): Promise<{ due: number; sent: number }> {
  const due = await withService(env, (sql) =>
    sql<
      {
        user_id: string
        company_id: string
        email: string
        name: string | null
        studio: string
        week: string
        received: string | number
        received_count: number
        overdue_amount: string | number
        overdue_count: number
        due_week_amount: string | number
        due_week_count: number
        shoots_week: number
        shoots_unstaffed: number
        edits_late: number
        edits_due_week: number
        leads_new: number
        leads_booked: number
      }[]
    >`
      select user_id, company_id, email, name, studio, week::text as week, received, received_count,
             overdue_amount, overdue_count, due_week_amount, due_week_count, shoots_week, shoots_unstaffed,
             edits_late, edits_due_week, leads_new, leads_booked
        from weekly_email_due()`,
  )
  if (dryRun) return { due: due.length, sent: 0 }
  let sent = 0
  for (const d of due) {
    try {
      const [m] = await withService(env, (sql) =>
        sql<{ ok: boolean }[]>`select weekly_email_mark(${d.user_id}, ${d.company_id}, ${d.week}::date) as ok`,
      )
      if (!m?.ok) continue
      const mail = await weeklyMail(env, {
        userId: d.user_id,
        name: d.name,
        studio: d.studio,
        week: d.week,
        received: Number(d.received),
        receivedCount: d.received_count,
        overdueAmount: Number(d.overdue_amount),
        overdueCount: d.overdue_count,
        dueWeekAmount: Number(d.due_week_amount),
        dueWeekCount: d.due_week_count,
        shootsWeek: d.shoots_week,
        shootsUnstaffed: d.shoots_unstaffed,
        editsLate: d.edits_late,
        editsDueWeek: d.edits_due_week,
        leadsNew: d.leads_new,
        leadsBooked: d.leads_booked,
      })
      if (await sendOnboardingMail(env, d.email, mail)) sent += 1
    } catch (e) {
      log.error({ err: describeError(e) }, 'weekly email failed')
    }
  }
  return { due: due.length, sent }
}
