import { Hono } from 'hono'
import { createFeatureRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { sendFeatureRequestEmail } from '../../lib/email'

/**
 * "Suggest a feature", from any screen. Anyone signed in can send one; they
 * are read by the platform's own team (see /platform/feedback), never by
 * other studios.
 */
export const feedbackRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .post('/features', async (c) => {
    const parsed = createFeatureRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please add a note, a voice note or a screenshot.')
    const auth = c.get('auth')
    const r = parsed.data
    const row = await attempt(
      c,
      'feedback.create',
      () =>
        withUser(c.env, auth.userId, async (sql) => {
          const rows = await sql<{ id: string; company_name: string | null }[]>`
            insert into feature_requests
              (company_id, user_id, body, voice_file_id, voice_seconds, screenshot_file_id, page_url, user_agent)
            values (${auth.companyId}, ${auth.userId}, ${r.body || null}, ${r.voice_file_id ?? null},
                    ${r.voice_seconds ?? null}, ${r.screenshot_file_id ?? null}, ${r.page_url ?? null},
                    ${(c.req.header('user-agent') ?? '').slice(0, 400) || null})
            returning id, (select name from companies where id = ${auth.companyId}) as company_name`
          return rows[0] ?? null
        }),
      { onCode: (code) => (code === '42501' ? fail(403, 'That file is not one of your studio’s.') : undefined) },
    )
    if (!row) fail(400, 'We could not send your suggestion. Please try again.')
    await audit(c, { action: 'feedback.feature', entityType: 'feature_request', entityId: row.id })
    await sendFeatureRequestEmail(c.env, {
      studio: row.company_name ?? 'A studio',
      person: auth.displayName || auth.email,
      page: r.page_url ?? null,
      text: r.body || null,
      hasVoice: !!r.voice_file_id,
      hasScreenshot: !!r.screenshot_file_id,
      link: `${c.env.APP_URL ?? ''}/platform/feedback`,
    })
    return c.json({ id: row.id }, 201)
  })
