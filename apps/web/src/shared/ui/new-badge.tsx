import { Sparkles } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { galleryList } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAccess } from '@/shared/auth/useAccess'
import { cn } from './cn'
import { todayInIndia } from './days-left'

/**
 * Something just released, by the last day it reads "New" (India dates). The
 * owner asks for a week so studios notice it, then it goes by itself.
 */
export const NEW_UNTIL = {
  /** Import from Google Drive on the Gallery tab, and the Frameline gallery around it (31 Oct). */
  galleryDrive: '2026-11-07',
  /** Frameline's studio app inside the dashboard, Projects → Gallery app (4 Nov). */
  galleryApp: '2026-11-11',
  /** The AI menu and its Quotation Designer (9 Nov). */
  aiDesigner: '2026-11-16',
  aiReply: '2026-11-16',
  aiSequences: '2026-11-16',
  referralCards: '2026-11-17',
  aiCaptions: '2026-11-17',
} as const
export type NewFeature = keyof typeof NEW_UNTIL

/**
 * Features that read "New" until the studio has started using them, whatever
 * the date (owner, 5 Nov, of the gallery: "keep it on until they completely
 * explore it and start using it ... if they do not start using it, do not take
 * it off"). Started = the studio has made its first gallery.
 */
export const UNTIL_USED: ReadonlySet<NewFeature> = new Set(['galleryDrive', 'galleryApp'])

/** Still new today? */
export const isNew = (feature: NewFeature | undefined, today: string = todayInIndia()) => !!feature && today <= NEW_UNTIL[feature]

/** Still new for this studio: a dated feature by its last day, a gallery one until the first gallery. */
export function newFor(feature: NewFeature | undefined, studioHasGallery: boolean | null, today: string = todayInIndia()): boolean {
  if (!feature) return false
  if (UNTIL_USED.has(feature)) return studioHasGallery === false
  return isNew(feature, today)
}

/** Whether the studio has made a gallery yet; null until known, or for someone who cannot list them. */
function useStudioHasGallery(enabled: boolean): boolean | null {
  const access = useAccess()
  const allowed = enabled && access.hasAction('projects', 'edit')
  const q = useQuery({
    queryKey: ['galleries'],
    queryFn: () => callApi('/galleries', { responseSchema: galleryList }),
    staleTime: 5 * 60_000,
    enabled: allowed,
  })
  if (!allowed || !q.data) return null
  return q.data.items.length > 0
}

/** A small gold "New" pill beside a tab, a menu line or a button; gone once the feature is old or in use. */
export function NewBadge({ feature, className }: { feature: NewFeature | undefined; className?: string }) {
  const hasGallery = useStudioHasGallery(!!feature && UNTIL_USED.has(feature))
  if (!newFor(feature, hasGallery)) return null
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-full border border-tone-amber/40 bg-tone-amber-soft px-1.5 text-[10px] font-bold uppercase leading-4 tracking-wide text-tone-amber',
        className,
      )}
    >
      <Sparkles className="size-2.5" aria-hidden />
      New
    </span>
  )
}
