import { Hono, type Context } from 'hono'
import { galleryOpenLink, projectGallery } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withService, withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { todayInIndia } from '../../lib/dates'
import {
  createFramelineGallery,
  framelineConnected,
  framelineSignInUrl,
  readFramelineGallery,
  type FramelinePerson,
} from '../../lib/frameline'

/**
 * A project's photo gallery in Frameline, the gallery add-on (0261).
 *
 * Who runs projects makes it and opens it; Frameline keeps the photos and its
 * own billing. The guests' link and PIN are kept here so the Gallery tab and
 * the client's tracking page never wait on another app to draw.
 */

interface GalleryRow {
  event_id: string
  short_id: string
  gallery_url: string
  pin: string | null
  created_at: string
}

/** Who the person is, for Frameline. A failed read means "not confirmed": never the other way round. */
async function personOf(c: Context<AppEnv>): Promise<FramelinePerson> {
  const auth = c.get('auth')
  const facts = await attempt(c, 'gallery.person', () =>
    withService(c.env, async (sql) => {
      const [co] = await sql<{ name: string | null }[]>`
        select coalesce(display_name, name) as name from companies where id = ${auth.companyId}`
      const [au] = await sql<{ v: boolean }[]>`
        select au.email_verified as v from auth.users au where au.id = auth_identity_of(${auth.userId})`
      return { companyName: co?.name ?? '', emailVerified: au?.v === true }
    }),
  )
  return { auth, companyName: facts?.companyName ?? '', emailVerified: facts?.emailVerified ?? false }
}

/** The kept gallery, or `{ row: null }` before there is one; null itself means the read failed. */
const readRow = (c: Context<AppEnv>, projectId: string) =>
  attempt(c, 'gallery.read', () =>
    withUser(c.env, c.get('auth').userId, async (sql) => {
      const rows = await sql<GalleryRow[]>`
        select event_id, short_id, gallery_url, pin,
               to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at
          from project_galleries where project_id = ${projectId}`
      return { row: rows[0] ?? null }
    }),
  )

export const projectGalleryRoutes = new Hono<AppEnv>()
  /** The tab: the gallery if there is one, and what Frameline says about it now. */
  .get('/:id/gallery', requireAction('projects', 'edit'), async (c) => {
    const projectId = uuidParam(c)
    const read = await readRow(c, projectId)
    if (!read) fail(400, 'We could not load the gallery.')
    const { row } = read
    const connected = framelineConnected(c.env)
    let live = null
    if (connected && row) {
      const r = await readFramelineGallery(c.env, await personOf(c), projectId)
      if (r.ok) live = { photo_count: r.data.photoCount, status: r.data.status }
    }
    return c.json(
      projectGallery.parse({
        connected,
        gallery: row ? { gallery_url: row.gallery_url, short_id: row.short_id, pin: row.pin, created_at: row.created_at } : null,
        live,
      }),
    )
  })

  /** "Create gallery": made once per project in Frameline, then kept here. */
  .post('/:id/gallery', requireAction('projects', 'edit'), async (c) => {
    const projectId = uuidParam(c)
    if (!framelineConnected(c.env)) fail(503, 'The gallery add-on is not connected yet. Ask us on WhatsApp to switch it on.')
    const auth = c.get('auth')

    // The project's name, and the day the gallery is for: the wedding if there
    // is one, else the first shoot, else today.
    const found = await attempt(c, 'gallery.project', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const [p] = await sql<{ name: string }[]>`select name from projects where id = ${projectId}`
        if (!p) return { project: null }
        const [s] = await sql<{ d: string | null }[]>`
          select to_char(shoot_date, 'YYYY-MM-DD') as d from shoots
           where project_id = ${projectId} and shoot_date is not null and status <> 'cancelled'
           order by (name ~* 'wedding' and name !~* '(pre|post)[\\s-]*wedding') desc, shoot_date
           limit 1`
        return { project: { name: p.name, date: s?.d ?? null } }
      }),
    )
    if (!found) fail(400, 'We could not read the project.')
    const project = found.project
    if (!project) fail(404, 'Project not found.')

    const r = await createFramelineGallery(c.env, await personOf(c), {
      id: projectId,
      name: project.name,
      date: `${project.date ?? todayInIndia()}T00:00:00.000Z`,
      city: '',
    })
    if (!r.ok) {
      if (r.kind === 'owner_first') fail(409, 'Your studio’s owner needs to make the first gallery. After that, anyone who runs projects can.')
      fail(503, 'The gallery app did not answer. Please try again in a minute.')
    }

    const saved = await attempt(c, 'gallery.save', () =>
      withUser(c.env, auth.userId, (sql) => sql`
        insert into project_galleries (project_id, company_id, event_id, short_id, gallery_url, pin, created_by)
        values (${projectId}, ${auth.companyId}, ${r.data.eventId}, ${r.data.shortId}, ${r.data.galleryUrl}, ${r.data.pin}, ${auth.userId})
        on conflict (project_id) do update
          set event_id = excluded.event_id, short_id = excluded.short_id,
              gallery_url = excluded.gallery_url, pin = excluded.pin`),
    )
    if (!saved) fail(400, 'The gallery was made but we could not save its link. Press Create gallery again.')
    await audit(c, {
      action: 'project.gallery_create',
      entityType: 'project',
      entityId: projectId,
      after: { event_id: r.data.eventId, short_id: r.data.shortId },
    })
    return c.json(
      projectGallery.parse({
        connected: true,
        gallery: { gallery_url: r.data.galleryUrl, short_id: r.data.shortId, pin: r.data.pin, created_at: r.data.createdAt },
        live: { photo_count: r.data.photoCount, status: r.data.status },
      }),
    )
  })

  /**
   * "Open gallery": a sign-in link into Frameline as this person, at this
   * project's event (or the events list before there is one). Good for one
   * minute and once, so the page asks for it at the moment it is pressed.
   */
  .post('/:id/gallery/open', requireAction('projects', 'edit'), async (c) => {
    const projectId = uuidParam(c)
    if (!framelineConnected(c.env)) fail(503, 'The gallery add-on is not connected yet. Ask us on WhatsApp to switch it on.')
    const read = await readRow(c, projectId)
    if (!read) fail(400, 'We could not open the gallery.')
    const url = await framelineSignInUrl(c.env, await personOf(c), read.row ? `/events/${read.row.event_id}` : '/events')
    return c.json(galleryOpenLink.parse({ url }))
  })
