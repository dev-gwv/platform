import { Link } from '@tanstack/react-router'
import { Gift } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { useMarkOfferSeen, useMyOffer } from './offer-api'
import { offerLastDay, offerPlansWords } from './offer'

/**
 * The owner's personal offer from Studio AutoPilot (0268), in one gold strip:
 * how much off which plans, the platform owner's line if there is one, and
 * the last day -- a date, never a ticking timer (owner, 14 Oct). On Home it
 * carries See the prices; on Plan & billing the cards below show the price.
 * Marked seen the first time it is on screen.
 */
export function OfferStrip({ withLink = false }: { withLink?: boolean }) {
  const offer = useMyOffer().data
  useMarkOfferSeen(offer?.id)
  if (!offer) return null
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-tone-amber/50 bg-tone-amber-soft px-4 py-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-tone-amber text-card">
        <Gift className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {offer.percent}% off {offerPlansWords(offer.tiers)}, just for you
        </p>
        <p className="text-sm text-muted-foreground">
          {offer.note ? `${offer.note} · ` : ''}On your first plan, until {offerLastDay(offer.ends_at)}.
        </p>
      </div>
      {withLink && (
        <Button asChild size="sm">
          <Link to="/settings/subscription">See the prices</Link>
        </Button>
      )}
    </div>
  )
}
