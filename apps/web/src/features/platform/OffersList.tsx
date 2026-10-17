import { usePlatformOffers, useCancelOffer } from './api'
import { offerState } from './activity'
import { SkeletonList } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { Button } from '@/shared/ui/button'
import { TONE_CHIP } from '@/shared/ui/tones'
import { cn } from '@/shared/ui/cn'

const day = (iso: string) =>
  new Date(new Date(iso).getTime() - 1).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
const TIER: Record<string, string> = { starter: 'Starter', pro: 'Pro', max: 'Studio Max' }

/**
 * Every offer made (0268), newest first: who got it, how much, until when,
 * and where it stands -- Sent → Seen → Asked on WhatsApp → Paid -- so a few
 * rounds show which discount actually brings a studio in. A live one can be
 * ended; the studio stops seeing it at once.
 */
export function OffersList() {
  const offers = usePlatformOffers()
  const cancel = useCancelOffer()
  if (offers.isLoading) return <SkeletonList rows={4} columns={5} />
  if (offers.isError) return <ErrorState onRetry={() => void offers.refetch()} />
  const rows = offers.data ?? []
  if (rows.length === 0) {
    return <EmptyState title="No offers yet" description="Tick studios on the Studios tab and press Make an offer." />
  }
  const now = Date.now()
  const count = (label: string) => rows.filter((o) => offerState(o, now).label.startsWith(label)).length
  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">
        {rows.length} sent · {count('Seen') + count('Asked') + count('Paid')} seen · {count('Asked') + count('Paid')} asked on WhatsApp ·{' '}
        <span className="font-medium text-foreground">{count('Paid')} paid</span>
      </p>
      <div className="table-wrap rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Studio</th>
              <th className="px-4 py-3 font-medium">Offer</th>
              <th className="px-4 py-3 font-medium">Last day</th>
              <th className="px-4 py-3 font-medium">Where it stands</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const st = offerState(o, now)
              const live = !o.used_at && !o.cancelled_at && new Date(o.ends_at).getTime() > now
              return (
                <tr key={o.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium">{o.studio}</td>
                  <td className="px-4 py-3">
                    <span className="font-semibold">{o.percent}% off</span>{' '}
                    <span className="text-muted-foreground">
                      {o.tiers.length >= 3 ? 'any plan' : o.tiers.map((t) => TIER[t]).join(', ')}
                      {o.for_diamond && ' · Diamond too'}
                    </span>
                    {o.note && <p className="text-xs text-muted-foreground">“{o.note}”</p>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{day(o.ends_at)}</td>
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-xs font-medium', TONE_CHIP[st.tone])}>{st.label}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {live && (
                      <Button size="sm" variant="ghost" className="hover:text-destructive" disabled={cancel.isPending} onClick={() => cancel.mutate(o.id)}>
                        End offer
                      </Button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
