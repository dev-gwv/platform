import { StickyNote } from 'lucide-react'
import { HoverPopover } from '@/shared/ui/hover-popover'
import { cn } from '@/shared/ui/cn'

/**
 * A deliverable's note for the team (internal_notes) as a small amber chip:
 * "Album 40 sheets instead of 30, agreed on call". Hovering (or tapping)
 * shows the whole note. The studio and the team only, never the client.
 */
export function TeamNoteChip({ note, className }: { note: string | null | undefined; className?: string }) {
  const text = note?.trim()
  if (!text) return null
  return (
    <HoverPopover
      content={
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-warning">Note for the team</p>
          <p className="whitespace-pre-wrap text-sm">{text}</p>
        </div>
      }
    >
      <button
        type="button"
        onClick={(e) => e.stopPropagation()}
        aria-label={`Note for the team: ${text}`}
        className={cn(
          'inline-flex max-w-full items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning hover:bg-warning/20',
          className,
        )}
      >
        <StickyNote className="size-3.5 shrink-0" aria-hidden />
        <span className="line-clamp-1 max-w-[16rem] text-left">{text}</span>
      </button>
    </HoverPopover>
  )
}
