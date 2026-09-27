import { Hono } from 'hono'
import { z } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { withService } from '../../lib/db'
import { stopTokenValid } from '../../lib/onboarding-email'

const stopRequest = z.object({ c: z.string().uuid(), t: z.string().min(16).max(128) })

/**
 * "Stop these emails", from the footer of the onboarding emails. Public: the
 * signed link is the permission, and it only switches this studio's
 * onboarding emails off.
 */
export const publicOnboardingRouter = new Hono<AppEnv>().post('/onboarding-emails/stop', async (c) => {
  const parsed = stopRequest.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success || !(await stopTokenValid(c.env, parsed.data.c, parsed.data.t))) {
    fail(400, 'This link is not valid.')
  }
  await withService(c.env, (sql) => sql`select onboarding_emails_stop(${parsed.data!.c})`)
  return c.json({ ok: true })
})
