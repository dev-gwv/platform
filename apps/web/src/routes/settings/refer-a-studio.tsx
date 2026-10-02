import { Copy, Gift, MessageCircle, Store } from 'lucide-react'
import { toast } from 'sonner'
import { useMyStudioReferrals } from '@/features/studio-referrals/api'
import { referralState, summaryLine, termsLine } from '@/features/studio-referrals/model'
import { shareText } from '@/features/studio-referrals/studio-ref'
import { useAmountsHidden } from '@/shared/money/MoneyMask'
import { useAuth } from '@/shared/auth/AuthProvider'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { IconTile } from '@/shared/ui/icon-tile'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { TONE_CHIP_STATIC } from '@/shared/ui/tone-chip'
import { cn } from '@/shared/ui/cn'

export function ReferAStudioPage() {
  return (
    <AuthedPage module="settings_subscription">
      <ReferAStudio />
    </AuthedPage>
  )
}

const day = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * Refer a studio (0237): the studio's own link, what a referral earns, and
 * the studios that joined through it. The terms are the platform owner's;
 * until they are set the page says they are being finalised.
 */
function ReferAStudio() {
  const { session } = useAuth()
  useAmountsHidden()
  const q = useMyStudioReferrals()
  const studio = session?.studios.find((s) => s.company_id === session.company_id)?.company_name ?? 'My studio'

  if (q.isLoading) return <SkeletonList rows={3} />
  if (q.isError || !q.data) return <ErrorState onRetry={() => void q.refetch()} />
  const { link, terms, referrals } = q.data

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      toast.success('Link copied. Paste it to a studio you know.')
    } catch {
      toast.error('Could not copy. Press and hold the link to copy it.')
    }
  }

  return (
    <>
      <PageHeader title="Refer a studio" />
      <div className="flex max-w-3xl flex-col gap-5">
        <Card className="overflow-hidden">
          <div className="h-1.5 bg-gradient-to-r from-[#1b2a4a] via-tone-violet to-[#f2a618]" aria-hidden />
          <CardContent className="flex flex-col gap-4 p-5">
            <div className="flex items-start gap-3">
              <IconTile icon={Gift} tone="amber" size="lg" />
              <div>
                <p className="text-lg font-semibold">Know a studio that should run on AutoPilot?</p>
                <p className="text-sm text-muted-foreground">{termsLine(terms)}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <code className="flex min-w-0 flex-1 items-center truncate rounded-md border border-input bg-muted/40 px-3 py-2 text-sm">
                {link}
              </code>
              <div className="flex gap-2">
                <Button onClick={() => void copy()}>
                  <Copy /> Copy link
                </Button>
                <Button asChild className="bg-[#25D366] text-white hover:bg-[#1ebe5b]">
                  <a href={`https://wa.me/?text=${encodeURIComponent(shareText(studio, link))}`} target="_blank" rel="noreferrer">
                    <MessageCircle /> Share
                  </a>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3 p-5">
            <p className="font-semibold">{summaryLine(referrals)}</p>
            {referrals.length > 0 && (
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {referrals.map((r) => {
                  const s = referralState(r)
                  return (
                    <li key={r.id} className="flex items-center gap-3 p-3">
                      <IconTile icon={Store} tone={s.tone} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{r.studio_name}</p>
                        <p className="text-xs text-muted-foreground">
                          Joined {day.format(new Date(r.signed_up_at))}
                          {r.paid_at ? ` · paid ${day.format(new Date(r.paid_at))}` : ''}
                          {r.void_reason ? ` · ${r.void_reason}` : ''}
                        </p>
                      </div>
                      <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium', TONE_CHIP_STATIC[s.tone])}>
                        {s.label}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
