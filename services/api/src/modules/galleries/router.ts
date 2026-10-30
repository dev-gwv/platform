import { Hono } from 'hono'
import { framelineAccount, galleryList, galleryOpenLink, openFramelineRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction, requireOwner } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withService, withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { driveOut, FRAMELINE_SAYS, framelineConnected, framelineSignInUrl, framelineTrouble, listFramelineGalleries, nameMissing, readFramelineStudio } from '../../lib/frameline'
import { saveGallerySnapshot } from '../../lib/gallery-sync'
import { personOf } from '../projects/routes-gallery'

/**
 * The studio's Frameline galleries across projects (Projects → Galleries) and
 * the Frameline studio behind the company (Settings → Messaging → Gallery),
 * with its Google Drive (connected in Frameline, shown here).
 * A project's own gallery is modules/projects/routes-gallery.ts.
 */

interface ListRow {
  project_id: string
  project_name: string
  client_name: string | null
  gallery_url: string
  pin: string | null
  full_access_pin: string | null
  photo_count: number
  visits: number
  expires_at: string | null
  status: string | null
}


export const galleriesRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  /** Every project with a gallery, freshest figures first asked of Frameline. */
  .get('/', requireAction('projects', 'edit'), async (c) => {
    const auth = c.get('auth')
    const connected = framelineConnected(c.env)
    let fresh = false
    if (connected) {
      const r = await listFramelineGalleries(c.env, await personOf(c))
      if (r.ok) {
        fresh = true
        await attempt(c, 'galleries.sync', () =>
          withService(c.env, async (sql) => {
            for (const g of r.data.items) await saveGallerySnapshot(sql, auth.companyId, g.projectId, g)
          }),
        )
      }
    }
    const rows = await attempt(c, 'galleries.list', () =>
      withUser(c.env, auth.userId, (sql) => sql<ListRow[]>`
        select g.project_id, p.name as project_name, cl.name as client_name, g.gallery_url, g.pin, g.full_access_pin,
               g.photo_count, g.visits, g.status,
               to_char(g.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as expires_at
          from project_galleries g
          join projects p on p.id = g.project_id
          left join clients cl on cl.id = p.client_id
         order by g.created_at desc
         limit 500`),
    )
    if (!rows) fail(400, 'We could not load the galleries.')
    return c.json(galleryList.parse({ connected, fresh, items: rows }))
  })

  /** The Frameline studio: linked yet, plan, wallet and photos used. The owner's (the wallet is theirs). */
  .get('/account', requireOwner(), async (c) => {
    const empty = { linked: false, studio_name: null, plan: null, valid_till: null, wallet_rupees: null, photos_used: null, photos_limit: null, galleries: 0 }
    if (!framelineConnected(c.env)) return c.json(framelineAccount.parse({ connected: false, reachable: false, ...empty }))
    const r = await readFramelineStudio(c.env, await personOf(c))
    // A blip ("try again") told apart from a link that is wrong until we fix it (Book a support call).
    if (!r.ok) {
      console.error(`[galleries] Frameline studio read failed: ${r.kind} ${r.status}`)
      return c.json(framelineAccount.parse({ connected: true, reachable: false, trouble: framelineTrouble(r.kind), ...empty }))
    }
    const s = r.data
    return c.json(
      framelineAccount.parse({
        connected: true,
        reachable: true,
        linked: s.linked,
        studio_name: s.studioName,
        plan: s.plan,
        valid_till: s.validTill,
        wallet_rupees: s.walletRupees,
        photos_used: s.photosUsed,
        photos_limit: s.photosLimit,
        galleries: s.galleries,
        drive: driveOut(s.drive),
      }),
    )
  })

  /**
   * "Open Frameline": signed in as the owner, on Frameline's home (plan, wallet,
   * every event), or with `to: 'drive'` on its Google Drive settings, where the
   * owner connects Drive (Google's own consent page) and sets new galleries to
   * keep their originals there.
   */
  .post('/account/open', requireOwner(), async (c) => {
    if (!framelineConnected(c.env)) fail(503, FRAMELINE_SAYS.not_connected)
    const asked = openFramelineRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!asked.success) fail(400, 'We could not open Frameline.')
    const person = await personOf(c)
    // The owner's first sign-in makes their Frameline studio: never as "Studio".
    if (nameMissing(person)) fail(503, FRAMELINE_SAYS.no_name)
    return c.json(galleryOpenLink.parse({ url: await framelineSignInUrl(c.env, person, asked.data.to === 'drive' ? '/settings/drive' : '/') }))
  })
