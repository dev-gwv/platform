import type { TransactionSql } from 'postgres'
import type { FramelineGallery, FramelinePerson } from './frameline'

/**
 * Keeps project_galleries (0261, 0264) in step with what Frameline says about
 * a project's gallery, and rings the bell when new photos have arrived.
 *
 * Called with the service role from two places: the Gallery tab's read (each
 * time Frameline answers) and Frameline's gallery-changed notice
 * (POST /webhooks/frameline). Both pass the company the row must belong to,
 * so a notice can never touch another studio's row.
 */

/**
 * Who Studio AutoPilot is when nobody pressed anything: a read Frameline
 * answers by the company alone. Never an owner, so it can never set a
 * Frameline studio up.
 */
export function systemPerson(companyId: string, companyName: string): FramelinePerson {
  return {
    auth: { userId: 'studioautopilot-sync', companyId, isOwner: false, displayName: 'Studio AutoPilot', email: '' },
    companyName,
    emailVerified: false,
  }
}

/** Saves Frameline's answer. Returns false when the project has no gallery row here. */
export async function saveGallerySnapshot(sql: TransactionSql, companyId: string, projectId: string, g: FramelineGallery): Promise<boolean> {
  const rows = await sql<{ announced: number; created_by: string | null; project_name: string }[]>`
    with prev as (
      select project_id, photos_announced, created_by from project_galleries
       where project_id = ${projectId} and company_id = ${companyId}
       for update
    )
    update project_galleries g
       set event_id = ${g.eventId}, short_id = ${g.shortId}, gallery_url = ${g.galleryUrl},
           pin = ${g.pin}, full_access_pin = ${g.fullAccessPin ?? null},
           photo_count = ${g.photoCount}, status = ${g.status.slice(0, 32)},
           visits = ${g.visits ?? 0}, guests = coalesce(${g.guests ?? null}::int, g.guests),
           expires_at = ${g.expiresAt ?? null}, synced_at = now(),
           photos_announced = greatest(g.photos_announced, ${g.photoCount})
      from prev, projects p
     where g.project_id = prev.project_id and p.id = g.project_id
    returning prev.photos_announced as announced, prev.created_by, p.name as project_name`
  const row = rows[0]
  if (!row) return false
  if (g.photoCount > row.announced) await announcePhotos(sql, companyId, projectId, row.project_name, g.photoCount, row.created_by)
  return true
}

/** "23 photos are in Priya & Rahul's gallery" for the studio's admins and whoever made the gallery, once per count. */
async function announcePhotos(sql: TransactionSql, companyId: string, projectId: string, projectName: string, count: number, createdBy: string | null) {
  const title = `${count} ${count === 1 ? 'photo is' : 'photos are'} in the ${projectName} gallery`
  const body = 'Send the link and PIN to your client from the Gallery tab.'
  await sql`
    select create_notification(${companyId}, r, 'gallery_photos', ${title}, ${body},
             ${`gallery_photos:${projectId}:${count}`}, 'project', ${projectId}::uuid,
             'info', ${`/projects/${projectId}?tab=gallery`}, ${sql.json({ photo_count: count })})
      from (select notification_admin_recipients(${companyId}) as r
            union select ${createdBy}::uuid where ${createdBy}::uuid is not null) who`
}

/**
 * Whether the client's page shows the gallery: only once photos are in (an
 * empty gallery behind a PIN reads as broken to a couple), and never after it
 * closed in Frameline. `facts` is the kept row's count and expiry.
 */
export function galleryForClient<G>(
  gallery: G | null | undefined,
  facts: { photo_count: number | null; expires_at: string | null } | null | undefined,
  now: number = Date.now(),
): G | null {
  if (!gallery || !facts) return null
  if (!facts.photo_count || facts.photo_count <= 0) return null
  if (facts.expires_at) {
    const t = Date.parse(facts.expires_at)
    if (Number.isFinite(t) && t <= now) return null
  }
  return gallery
}
