import { Handshake, Heart } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { TONE_CHIP } from '@/shared/ui/tones'

/**
 * "via Riya Boutique": the partner whose QR code brought the lead in (0274),
 * on the card, the list and the drawer, so a studio with many partners can
 * see whose lead each one is (owner, 20 Oct). A wedding QR (0299) reads
 * "via Priya & Rahul's Wedding QR" with a heart: a guest at a wedding the
 * studio shot.
 */
export function PartnerChip({ name, kind, className }: { name: string; kind?: string | null | undefined; className?: string }) {
  const wedding = kind === 'wedding'
  const Icon = wedding ? Heart : Handshake
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[0.7rem] font-semibold',
        wedding ? TONE_CHIP.rose : TONE_CHIP.teal,
        className,
      )}
      title={wedding ? `A guest who scanned the QR at ${name}` : `This lead came through ${name}'s QR code`}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className="truncate">via {partnerLabel(name, kind)}</span>
    </span>
  )
}

/** "Riya Boutique", or "Priya & Rahul's Wedding QR" for a wedding QR. */
export const partnerLabel = (name: string, kind?: string | null): string => (kind === 'wedding' ? `${name} QR` : name)
