import { Hono } from 'hono'
import { loginStudio, openFirstRequest, z } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

/**
 * Find a login (0269; owner, 17 Oct: an owner extended in Studio Access
 * Manager still landed on "Plan expired"). Every studio the login with an
 * email opens, where each one's access stands and which it opens first; and
 * the studio it should open next time it signs in. Mounted inside
 * platformRouter, so only a platform admin reaches it.
 */
export const platformLoginsRouter = new Hono<AppEnv>()
  .get('/logins', async (c) => {
    const email = (c.req.query('email') ?? '').trim()
    if (email.length < 3) fail(422, 'Type the email they sign in with.')
    const rows = await attempt(c, 'platform.login_lookup', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`select * from platform_login_lookup(${email})`),
    )
    if (!rows) fail(400, 'We could not look that login up.')
    return c.json(loginStudio.array().parse(rows))
  })

  .post('/logins/open-first', async (c) => {
    const parsed = openFirstRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick the studio.')
    const ok = await attempt(
      c,
      'platform.open_first',
      () => withUser(c.env, c.get('auth').userId, (sql) => sql`select platform_open_first(${parsed.data.email}, ${parsed.data.company_id})`),
      { onCode: (code) => (code === '22023' ? fail(422, 'That login does not open that studio.') : undefined) },
    )
    if (!ok) fail(400, 'We could not change it.')
    await audit(c, { action: 'platform.login_open_first', entityType: 'company', entityId: parsed.data.company_id, after: {} })
    return c.json(z.object({ ok: z.boolean() }).parse({ ok: true }))
  })
