import { Sparkles } from 'lucide-react'
import { cn } from './cn'
import { todayInIndia } from './days-left'

/**
 * Something just released, by the last day it reads "New" (India dates). The
 * owner asks for a week so studios notice it, then it goes by itself.
 */
export const NEW_UNTIL = {
  /** Import from Google Drive on the Gallery tab, and the Frameline gallery around it (31 Oct). */
  galleryDrive: '2026-11-07',
} as const
export type NewFeature = keyof typeof NEW_UNTIL

/** Still new today? */
export const isNew = (feature: NewFeature | undefined, today: string = todayInIndia()) => !!feature && today <= NEW_UNTIL[feature]

/** A small gold "New" pill beside a tab, a menu line or a button; nothing once the week is over. */
export function NewBadge({ feature, className }: { feature: NewFeature | undefined; className?: string }) {
  if (!isNew(feature)) return null
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
