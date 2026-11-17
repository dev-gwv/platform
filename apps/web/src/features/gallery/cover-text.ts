import type { GalleryCover } from '@ipc/contracts'

/** Photos included in each plan, as the cards and the guide say them (0307). */
export const COVER_PHOTOS = { pro: 25_000, max: 75_000, trial: 3_000 } as const

const n = (x: number) => x.toLocaleString('en-IN')
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })

/** How full the allowance is, 0 to 1. */
export const coverShare = (c: Pick<GalleryCover, 'photos' | 'used'>) => (c.photos > 0 ? Math.min(1, c.used / c.photos) : 1)

/** "4,200 of 25,000 photos kept · included in your Pro plan until 17 Dec 2026." */
export function coverSentence(c: GalleryCover): string {
  const plan = c.plan === 'Trial' ? 'your trial' : c.plan === 'Open for life' ? 'your studio' : `your ${c.plan} plan`
  if (!c.active) return `Your plan ended on ${day(c.until)}. Galleries stay open; renew to import from Google Drive again.`
  const left = Math.max(0, c.photos - c.used)
  const head = `${n(c.used)} of ${n(c.photos)} photos kept · included in ${plan} until ${day(c.until)}.`
  if (left === 0) return `${head} Delete an old gallery to make room, or ask us for more.`
  return left / Math.max(1, c.photos) < 0.1 ? `${head} Only ${n(left)} left.` : head
}
