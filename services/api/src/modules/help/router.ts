import { Hono } from 'hono'
import { helpContent, helpFaq, saveHelpContactsRequest, saveHelpFaqRequest, saveHelpVideoRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requirePlatformAdmin } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withService } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

/**
 * Help & Tutorials (0236). What Help shows is public -- the /help page works
 * signed out, from an email -- and only a platform admin changes it.
 */
async function readHelp(env: AppEnv['Bindings']) {
  return withService(env, async (sql) => {
    const [s] = await sql<{ support_whatsapp: string | null; support_email: string | null }[]>`
      select support_whatsapp, support_email from platform_settings limit 1`
    const faqs = await sql`select id, question, answer, sort_order from help_faqs order by sort_order, created_at`
    const videos = await sql`select page_key, title, url from help_videos order by page_key`
    return { support_whatsapp: s?.support_whatsapp ?? null, support_email: s?.support_email ?? null, faqs, videos }
  })
}

export const publicHelpRouter = new Hono<AppEnv>().get('/help', async (c) => {
  const data = await attempt(c, 'help.public', () => readHelp(c.env))
  if (!data) fail(503, 'Help is not available right now. Please try again in a moment.')
  c.header('Cache-Control', 'public, max-age=60')
  return c.json(helpContent.parse(data))
})

const pageKey = (c: { req: { param: (k: string) => string | undefined } }) => {
  const k = c.req.param('key') ?? ''
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(k)) fail(400, 'Unknown page.')
  return k
}

export const platformHelpRouter = new Hono<AppEnv>()
  .use('*', requireAuth, requirePlatformAdmin())

  .get('/help', async (c) => {
    const data = await attempt(c, 'platform.help', () => readHelp(c.env))
    if (!data) fail(400, 'We could not load Help.')
    return c.json(helpContent.parse(data))
  })

  .put('/help/contacts', async (c) => {
    const parsed = saveHelpContactsRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the details.')
    const wa = parsed.data.support_whatsapp || null
    const email = parsed.data.support_email || null
    const ok = await attempt(c, 'platform.help_contacts', () =>
      withService(c.env, (sql) => sql`update platform_settings set support_whatsapp = ${wa}, support_email = ${email}, updated_at = now()`),
    )
    if (!ok) fail(400, 'We could not save the contacts.')
    await audit(c, { action: 'platform.help_contacts', entityType: 'platform_settings', entityId: null, after: { support_whatsapp: wa, support_email: email } })
    return c.json({ support_whatsapp: wa, support_email: email })
  })

  .post('/help/faqs', async (c) => {
    const parsed = saveHelpFaqRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the question.')
    const rows = await attempt(c, 'platform.help_faq_add', () =>
      withService(c.env, (sql) => sql`
        insert into help_faqs (question, answer, sort_order)
        values (${parsed.data.question}, ${parsed.data.answer},
                ${parsed.data.sort_order ?? sql`coalesce((select max(sort_order) from help_faqs), 0) + 10`})
        returning id, question, answer, sort_order`),
    )
    if (!rows?.[0]) fail(400, 'We could not add the question.')
    await audit(c, { action: 'platform.help_faq_add', entityType: 'help_faq', entityId: rows[0].id as string })
    return c.json(helpFaq.parse(rows[0]), 201)
  })

  .patch('/help/faqs/:id', async (c) => {
    const id = uuidParam(c)
    const parsed = saveHelpFaqRequest.partial().safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success || Object.keys(parsed.data).length === 0) fail(422, 'Nothing to change.')
    const rows = await attempt(c, 'platform.help_faq_edit', () =>
      withService(c.env, (sql) => sql`
        update help_faqs set ${sql(parsed.data)}, updated_at = now() where id = ${id}
        returning id, question, answer, sort_order`),
    )
    if (!rows?.[0]) fail(404, 'That question was not found.')
    await audit(c, { action: 'platform.help_faq_edit', entityType: 'help_faq', entityId: id })
    return c.json(helpFaq.parse(rows[0]))
  })

  .delete('/help/faqs/:id', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'platform.help_faq_delete', () =>
      withService(c.env, (sql) => sql`delete from help_faqs where id = ${id} returning id`),
    )
    if (!rows?.[0]) fail(404, 'That question was not found.')
    await audit(c, { action: 'platform.help_faq_delete', entityType: 'help_faq', entityId: id })
    return c.body(null, 204)
  })

  .put('/help/videos/:key', async (c) => {
    const key = pageKey(c)
    const parsed = saveHelpVideoRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the link.')
    const ok = await attempt(c, 'platform.help_video', () =>
      withService(c.env, (sql) => sql`
        insert into help_videos (page_key, title, url) values (${key}, ${parsed.data.title}, ${parsed.data.url})
        on conflict (page_key) do update set title = excluded.title, url = excluded.url, updated_at = now()`),
    )
    if (!ok) fail(400, 'We could not save the video.')
    await audit(c, { action: 'platform.help_video', entityType: 'help_video', entityId: null, after: { page_key: key, ...parsed.data } })
    return c.json({ page_key: key, ...parsed.data })
  })

  .delete('/help/videos/:key', async (c) => {
    const key = pageKey(c)
    await attempt(c, 'platform.help_video_delete', () => withService(c.env, (sql) => sql`delete from help_videos where page_key = ${key}`))
    await audit(c, { action: 'platform.help_video_delete', entityType: 'help_video', entityId: null, after: { page_key: key } })
    return c.body(null, 204)
  })
