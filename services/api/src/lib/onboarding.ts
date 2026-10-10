import type { Env } from '../context'
import { withService } from './db'
import { log, describeError } from './log'
import { nudgeMail, sendOnboardingMail, welcomeMail, type SetupStep } from './onboarding-email'

/**
 * The welcome email, once, to a studio owner who has just confirmed their
 * address. Marked before it is sent, so a double click on the link cannot
 * send two. Never throws: sign-in must not wait on or fail with the mail.
 */
export async function sendWelcomeFor(env: Env, uid: string): Promise<void> {
  try {
    const row = await withService(env, async (sql) => {
      const [w] = await sql<{ company_id: string; email: string; name: string | null }[]>`
        select * from onboarding_welcome_for(${uid})`
      if (!w) return null
      const [m] = await sql<{ ok: boolean }[]>`select onboarding_email_mark(${uid}, 'welcome') as ok`
      return m?.ok ? w : null
    })
    if (!row) return
    await sendOnboardingMail(env, row.email, await welcomeMail(env, { companyId: row.company_id, name: row.name }))
  } catch (e) {
    log.error({ err: describeError(e) }, 'onboarding welcome failed')
  }
}

interface OnboardingNudgeSummary {
  due: number
  sent: number
}

/**
 * The day 1 / 3 / 7 nudges, from the hourly cron. A dry run only counts.
 * Each is marked first and sent second: at most once, even if two ticks
 * overlap.
 */
export async function runOnboardingNudges(env: Env, dryRun: boolean): Promise<OnboardingNudgeSummary> {
  const due = await withService(env, (sql) =>
    sql<{ company_id: string; user_id: string; email: string; name: string | null; kind: string; step: number }[]>`
      select * from onboarding_email_due()`,
  )
  if (dryRun) return { due: due.length, sent: 0 }
  let sent = 0
  for (const d of due) {
    const [m] = await withService(env, (sql) =>
      sql<{ ok: boolean }[]>`select onboarding_email_mark(${d.user_id}, ${d.kind}) as ok`,
    )
    if (!m?.ok) continue
    const mail = await nudgeMail(env, { companyId: d.company_id, name: d.name, step: d.step as SetupStep })
    if (await sendOnboardingMail(env, d.email, mail)) sent += 1
  }
  return { due: due.length, sent }
}
