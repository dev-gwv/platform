import type { MyOffer, Plan } from '@ipc/contracts'
import type { PriceList } from './PlanPicker'

type Offer = NonNullable<MyOffer>

/**
 * A personal offer from the platform owner (0268): a percent off the first
 * plan, on the plans it names. It is for the regular price, and for the
 * Diamond price only when the offer says so.
 */
export function offerFor(offer: MyOffer | undefined, p: Pick<Plan, 'tier'>, list: PriceList): Offer | null {
  if (!offer || !p.tier || !offer.tiers.includes(p.tier)) return null
  if (list === 'member' && !offer.for_diamond) return null
  return offer
}

/** The price after the offer, to the rupee. */
export const offerPrice = (n: number, percent: number): number => Math.round((n * (100 - percent)) / 100)

/** The last day of the offer, in India: "Sunday, 19 October". The offer runs to the end of it. */
export function offerLastDay(endsAt: string): string {
  return new Date(new Date(endsAt).getTime() - 1).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Asia/Kolkata',
  })
}

const TIER_NAME: Record<Offer['tiers'][number], string> = { starter: 'Starter', pro: 'Pro', max: 'Studio Max' }

/** "any plan", "Pro", "Starter or Pro". */
export function offerPlansWords(tiers: Offer['tiers']): string {
  if (tiers.length >= 3) return 'any plan'
  return tiers.map((t) => TIER_NAME[t]).join(' or ')
}
