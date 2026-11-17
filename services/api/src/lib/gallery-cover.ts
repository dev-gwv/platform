import type { TransactionSql } from 'postgres'
import type { Env } from '../context'
import { withService } from './db'
import { framelineConnected, tellFramelineCover, type FramelineCover } from './frameline'
import { systemPerson } from './gallery-sync'
import { describeError, log } from './log'

/**
 * What a studio's plan covers in Frameline (0307, owner 17 Nov): Google Drive galleries, up to a number of photos
 * kept -- Pro 25,000, Studio Max 75,000, the trial 3,000, plus what the team adds; Starter nothing. Frameline is
 * told with every token we sign (`cover` in lib/frameline.ts) and counts Drive imports against it.
 */

/** The studio's cover now, or null when its plan covers nothing. */
export async function coverFor(sql: TransactionSql, companyId: string): Promise<FramelineCover | null> {
  const [r] = await sql<{ plan: string; until: Date | null; photos: number }[]>`select plan, until, photos from gallery_cover(${companyId})`
  if (!r || !r.until) return null
  return { plan: r.plan, until: new Date(r.until).toISOString(), photos: r.photos }
}

/**
 * Tells Frameline at once that a studio's cover changed (a plan given, photos added), instead of waiting for the
 * studio's next gallery call. Best effort: a studio not set up in Frameline yet gets it on its first call anyway.
 */
export async function pushCover(env: Env, companyId: string): Promise<void> {
  if (!framelineConnected(env)) return
  try {
    const facts = await withService(env, async (sql) => {
      const [co] = await sql<{ name: string | null }[]>`
        select coalesce(nullif(btrim(display_name), ''), name) as name from companies where id = ${companyId}`
      return { name: co?.name ?? '', cover: await coverFor(sql, companyId) }
    })
    await tellFramelineCover(env, { ...systemPerson(companyId, facts.name), cover: facts.cover })
  } catch (err) {
    log.warn({ err: describeError(err), companyId }, 'frameline: could not send the plan cover')
  }
}
