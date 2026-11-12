import { Hono } from 'hono'
import { welcomeResult } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { withService } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { daysBetween, welcomeFor } from '../../lib/welcome'

/**
 * POST /auth/welcome: called once by the app after sign-in while the person's
 * `welcome` note is unset. Puts the welcome in their bell when it is due
 * (lib/welcome.ts) and writes the note either way, so it is asked once per
 * person, never per device. The alert's dedupe key keeps a race to one row.
 */
export const welcomeRoutes = new Hono<AppEnv>().post('/welcome', requireAuth, async (c) => {
  const a = c.get('auth')
  const out = await attempt(c, 'auth.welcome', () =>
    withService(c.env, async (sql) => {
      const [me] = await sql<{ hints: Record<string, unknown> | null; login_at: Date; studio_at: Date; studio: string | null }[]>`
        select u.hints, u.created_at as login_at, co.created_at as studio_at, co.name as studio
          from users u join companies co on co.id = u.company_id
         where u.user_id = ${a.userId} and u.company_id = ${a.companyId} and u.deleted_at is null`
      if (!me) return null
      if (me.hints?.welcome) return { sent: false, kind: null }
      const w = welcomeFor({
        isOwner: a.isOwner,
        role: a.role,
        studioDays: daysBetween(me.studio_at),
        loginDays: daysBetween(me.login_at),
        studioName: me.studio ?? '',
      })
      if (w) {
        await sql`
          insert into notifications (company_id, recipient_uid, type, title, body, deep_link, dedupe_key)
          values (${a.companyId}, ${a.userId}, ${w.type}, ${w.title}, ${w.body}, ${w.link}, ${w.dedupe})
          on conflict do nothing`
      }
      await sql`
        update users set hints = coalesce(hints, '{}'::jsonb) || jsonb_build_object('welcome', ${sql.json({ shown: 1, closed: true })}::jsonb)
         where user_id = ${a.userId} and deleted_at is null`
      return { sent: !!w, kind: w?.kind ?? null }
    }),
  )
  if (!out) fail(400, 'We could not load that.')
  return c.json(welcomeResult.parse(out))
})
