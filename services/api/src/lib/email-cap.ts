import type { Context } from 'hono'
import type { AppEnv } from '../context'
import { withService } from './db'
import { attempt } from './attempt'
import { fail } from '../middleware/errors'

/**
 * A studio's daily ceiling on the emails it sends to people outside the app
 * (audit, 21 Nov): documents, receipts, terms and crew terms all go from our
 * own sending address, so a trial studio could otherwise use the app as a free
 * mail cannon and burn the domain's reputation for everyone. A paying studio
 * gets room for a busy season; a trial gets enough to try it properly.
 */
export const EMAIL_CAP_PAID = 200
export const EMAIL_CAP_TRIAL = 30
/** The kinds a studio sends with a button; each counts against the ceiling. */
export const CAPPED_KINDS = ['client_doc', 'team_terms'] as const

export const emailCapFor = (paid: boolean): number => (paid ? EMAIL_CAP_PAID : EMAIL_CAP_TRIAL)

export const overEmailCap = (sentToday: number, paid: boolean): boolean => sentToday >= emailCapFor(paid)

export const emailCapMessage = (cap: number): string =>
  `Your studio has sent ${cap} emails in the last 24 hours, the most for a day. ` +
  'Copy the link and send it on WhatsApp, or email it again tomorrow.'

/**
 * Sends counted in this process, as a backstop for when the log cannot be read
 * (the log is still the truth whenever it can be). Keyed by studio, kept a day.
 */
const local = new Map<string, number[]>()
const DAY_MS = 86_400_000

function localCount(companyId: string, now: number): number {
  const kept = (local.get(companyId) ?? []).filter((t) => now - t < DAY_MS)
  local.set(companyId, kept)
  return kept.length
}

/** Test seam: forget the in-process counts. */
export function resetLocalEmailCounts(): void {
  local.clear()
}

/**
 * Refuses with 429 once the studio has reached its ceiling, else notes one
 * send. Call it just before a capped send. A paid studio is one whose plan has
 * not ended, or one that is open for life (a platform admin's).
 */
export async function claimStudioEmail(c: Context<AppEnv>): Promise<void> {
  const companyId = c.get('auth').companyId
  const now = Date.now()
  const facts = await attempt(c, 'email.cap', () =>
    withService(c.env, async (sql) => {
      const [co] = await sql<{ paid: boolean }[]>`
        select (coalesce(plan_expiry > now(), false)
                or coalesce(grandfathered_until > now() + interval '1 year', false)) as paid
          from companies where id = ${companyId}`
      const [n] = await sql<{ n: number }[]>`
        select count(*)::int as n from email_log
         where company_id = ${companyId}
           and kind in ${sql([...CAPPED_KINDS])}
           and created_at > now() - interval '24 hours'`
      return { paid: co?.paid === true, sent: n?.n ?? 0 }
    }),
  )
  const paid = facts?.paid ?? false
  const sent = Math.max(facts?.sent ?? 0, localCount(companyId, now))
  if (overEmailCap(sent, paid)) fail(429, emailCapMessage(emailCapFor(paid)))
  local.get(companyId)!.push(now)
}
