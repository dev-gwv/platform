import { Sparkles } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { galleryList, type HintNote } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAccess } from '@/shared/auth/useAccess'
import { cn } from './cn'
import { todayInIndia } from './days-left'
import { useHints, useSetHint } from '@/features/team/hints-api'

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
  /** Ad scripts for a model to read to camera (10 Nov). */
  aiAdScripts: '2026-11-17',
  /** Daily tasks that come back by themselves, and Crew payouts under Money (14 Nov). */
  dailyTasks: '2026-11-21',
  crewPayouts: '2026-11-21',
} as const
export type NewFeature = keyof typeof NEW_UNTIL

/**
 * Features that read "New" until the studio has started using them, whatever
 * the date (owner, 5 Nov, of the gallery: "keep it on until they completely
 * explore it and start using it ... if they do not start using it, do not take
 * it off"). Started = the studio has made its first gallery.
 */
export const UNTIL_USED: ReadonlySet<NewFeature> = new Set(['galleryDrive'])

/**
 * Features that read "New" for each person until that person starts using
 * them, whatever the date or the studio (owner, 11 Nov, of Photo sharing:
 * "put a new sign for all the people because this is a new feature for them
 * ... once they start using it, we should take it off"). Kept on their row
 * (`users.hints.photo_sharing`): `shown` counts their visits to the page,
 * `closed` is set once they create, open, share, copy or print a gallery.
 */
export const PER_PERSON: ReadonlySet<NewFeature> = new Set(['galleryApp'])

/** Visits to Photo sharing that count as having started using it. */
export const PHOTO_SHARING_VISITS = 5

/** Has this person started using Photo sharing? Unknown (still loading) reads as yes, so no pill flashes. */
export function photoSharingUsed(note: HintNote | undefined, loaded: boolean): boolean {
  if (!loaded) return true
  if (!note) return false
  return note.closed || note.shown >= PHOTO_SHARING_VISITS
}

/** Still new today? */
export const isNew = (feature: NewFeature | undefined, today: string = todayInIndia()) => !!feature && today <= NEW_UNTIL[feature]

/**
 * Still new: a dated feature by its last day, a studio one until the first
 * gallery, a per-person one until this person has used it.
 */
export function newFor(
  feature: NewFeature | undefined,
  studioHasGallery: boolean | null,
  today: string = todayInIndia(),
  personUsed = true,
): boolean {
  if (!feature) return false
  if (PER_PERSON.has(feature)) return !personUsed
  if (UNTIL_USED.has(feature)) return studioHasGallery === false
  return isNew(feature, today)
}

/** Whether the studio has made a gallery yet; null until known, or for someone who cannot list them. */
function useStudioHasGallery(enabled: boolean): boolean | null {
  const access = useAccess()
  const allowed = enabled && access.hasAction('projects', 'edit')
  const q = useQuery({
    // The quick list: our own rows, without waiting on Frameline.
    queryKey: ['galleries-exists'],
    queryFn: () => callApi('/galleries?quick=1', { responseSchema: galleryList }),
    staleTime: 5 * 60_000,
    enabled: allowed,
  })
  if (!allowed || !q.data) return null
  return q.data.items.length > 0
}

/** This person's Photo sharing note: used yet, and how many visits. */
export function usePhotoSharingNote() {
  const q = useHints()
  const note = q.data?.photo_sharing
  return { used: photoSharingUsed(note, !!q.data), visits: note?.shown ?? 0 }
}

/** Whether a feature still reads "New" for the signed-in person. */
export function useIsNew(feature: NewFeature | undefined): boolean {
  const hasGallery = useStudioHasGallery(!!feature && UNTIL_USED.has(feature))
  const person = usePhotoSharingNote()
  return newFor(feature, hasGallery, todayInIndia(), person.used)
}

/** Takes Photo sharing's "New" off for this person: they created, opened, shared or printed a gallery. */
export function useMarkPhotoSharingUsed() {
  const q = useHints()
  const set = useSetHint()
  /** True once it is saved or already was; false while the person's notes are still loading. */
  return (): boolean => {
    const note = q.data?.photo_sharing
    if (!q.data) return false
    if (note?.closed) return true
    set.mutate({ key: 'photo_sharing', value: { shown: note?.shown ?? 0, closed: true } })
    return true
  }
}

/** Counts one visit to Photo sharing for this person, once per page open. */
export function useCountPhotoSharingVisit() {
  const q = useHints()
  const set = useSetHint()
  const done = useRef(false)
  useEffect(() => {
    if (done.current || !q.data) return
    done.current = true
    const note = q.data.photo_sharing
    if (note?.closed) return
    set.mutate({ key: 'photo_sharing', value: { shown: (note?.shown ?? 0) + 1, closed: false } })
  }, [q.data, set])
}

/**
 * The "New" pill beside a tab, a menu line or a button; gone once the feature
 * is old or in use. `loud` is the solid gold one that pulses for a person's
 * first visits (Photo sharing's menu line, owner 11 Nov: "it should be
 * noticeable"); `dot` is the gold dot drawn over an icon when the label is hidden.
 */
export function NewBadge({ feature, className, loud }: { feature: NewFeature | undefined; className?: string; loud?: boolean }) {
  const show = useIsNew(feature)
  const person = usePhotoSharingNote()
  if (!show) return null
  if (loud) {
    return (
      <span
        className={cn(
          'relative inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[#d4a537] px-2 text-[10px] font-extrabold uppercase leading-5 tracking-wider text-[#14213d] shadow-sm ring-2 ring-[#d4a537]/30',
          className,
        )}
      >
        {person.visits < 3 && <span className="absolute inset-0 animate-ping rounded-full bg-[#d4a537]/40" aria-hidden />}
        <Sparkles className="relative size-3" aria-hidden />
        <span className="relative">New</span>
      </span>
    )
  }
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

/** A gold dot over a menu icon while the sidebar is folded, so "New" is still seen. */
export function NewDot({ feature, className }: { feature: NewFeature | undefined; className?: string }) {
  if (!useIsNew(feature)) return null
  return (
    <span
      className={cn('absolute right-1 top-1 size-2.5 rounded-full bg-[#d4a537] ring-2 ring-background', className)}
      aria-label="New"
    />
  )
}
