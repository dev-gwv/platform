import { Handshake } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { TONE_CHIP } from '@/shared/ui/tones'

/**
 * "via Riya Boutique": the partner whose QR code brought the lead in (0274),
 * on the card, the list and the drawer, so a studio with many partners can
 * see whose lead each one is (owner, 20 Oct).
 */
export function PartnerChip({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[0.7rem] font-semibold',
        TONE_CHIP.teal,
        className,
      )}
      title={`This lead came through ${name}'s QR code`}
    >
      <Handshake className="size-3 shrink-0" aria-hidden />
      <span className="truncate">via {name}</span>
    </span>
  )
}
