import { Hono } from 'hono'
import { z } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { withService } from '../../lib/db'
import { stopTokenValid } from '../../lib/onboarding-email'
import { morningStopTokenValid } from '../../lib/morning-email'
import { weeklyStopTokenValid } from '../../lib/weekly-email'

const stopRequest = z.object({ c: z.string().uuid(), t: z.string().min(16).max(128) })
const morningStopRequest = z.object({ u: z.string().uuid(), t: z.string().min(16).max(128) })

/**
 * "Stop these emails", from the footer of the onboarding emails. Public: the
 * signed link is the permission, and it only switches this studio's
 * onboarding emails off.
 */
export const publicOnboardingRouter = new Hono<AppEnv>()
  .post('/onboarding-emails/stop', async (c) => {
  const parsed = stopRequest.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success || !(await stopTokenValid(c.env, parsed.data.c, parsed.data.t))) {
    fail(400, 'This link is not valid.')
  }
  await withService(c.env, (sql) => sql`select onboarding_emails_stop(${parsed.data!.c})`)
  return c.json({ ok: true })
})
  /** "Stop these emails" from the morning email: this person's morning email only. */
  .post('/morning-email/stop', async (c) => {
    const parsed = morningStopRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success || !(await morningStopTokenValid(c.env, parsed.data.u, parsed.data.t))) {
      fail(400, 'This link is not valid.')
    }
    await withService(c.env, (sql) => sql`select morning_email_set(${parsed.data!.u}, true)`)
    return c.json({ ok: true })
  })

  /** "Stop the Monday email" from its footer: this person's Monday email only. */
  .post('/weekly-email/stop', async (c) => {
    const parsed = morningStopRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success || !(await weeklyStopTokenValid(c.env, parsed.data.u, parsed.data.t))) {
      fail(400, 'This link is not valid.')
    }
    await withService(c.env, (sql) => sql`select weekly_email_set(${parsed.data!.u}, true)`)
    return c.json({ ok: true })
  })
