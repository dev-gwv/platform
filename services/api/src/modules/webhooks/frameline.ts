import { Hono } from 'hono'
import { framelineNotice as notice } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { withService } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { readFramelineGallery, verifyFramelineNotice } from '../../lib/frameline'
import { saveGallerySnapshot, systemPerson } from '../../lib/gallery-sync'

/**
 * POST /webhooks/frameline: Frameline saying one of our projects' galleries
 * changed (photos uploaded, PIN or settings changed). Sent by its minute cron,
 * signed with the shared secret (verifyFramelineNotice).
 *
 * The notice is only "go and look": the gallery is read back through the
 * signed API and saved (saveGallerySnapshot), which also rings the bell when
 * new photos arrived. So the body is never trusted beyond which project, and a
 * replayed notice does nothing a fresh read would not.
 *
 * Answers 204 when done, 404 when we do not know the project (Frameline then
 * stops trying), 401 for a bad token and 503 when Frameline could not be read
 * back (Frameline retries).
 */
export const framelineWebhookRouter = new Hono<AppEnv>().post('/frameline', async (c) => {
  const token = /^Bearer\s+(.+)$/i.exec(c.req.header('authorization') ?? '')?.[1]
  const from = await verifyFramelineNotice(c.env, token)
  if (!from) return c.json({ error: 'not a Frameline notice' }, 401)
  const parsed = notice.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success || parsed.data.companyId !== from.companyId) return c.json({ error: 'bad notice' }, 400)
  const { companyId, projectId } = parsed.data

  const known = await attempt(c, 'frameline.notice.find', () =>
    withService(c.env, async (sql) => {
      const [row] = await sql<{ name: string }[]>`
        select coalesce(co.display_name, co.name, '') as name
          from project_galleries g join companies co on co.id = g.company_id
         where g.project_id = ${projectId} and g.company_id = ${companyId}`
      return { row: row ?? null }
    }),
  )
  // null: the database failed, so Frameline should retry; { row: null }: not a gallery we know.
  if (!known) return c.json({ error: 'try again' }, 503)
  if (!known.row) return c.json({ error: 'unknown project' }, 404)

  const r = await readFramelineGallery(c.env, systemPerson(companyId, known.row.name), projectId)
  if (!r.ok) return c.json({ error: 'could not read the gallery back' }, r.kind === 'missing' ? 404 : 503)
  const saved = await attempt(c, 'frameline.notice.save', () => withService(c.env, (sql) => saveGallerySnapshot(sql, companyId, projectId, r.data)))
  if (!saved) return c.json({ error: 'could not save' }, 503)
  return c.body(null, 204)
})
