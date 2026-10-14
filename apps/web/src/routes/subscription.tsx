import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { MessageCircle, TrendingUp } from 'lucide-react'
import { plan, planQuote, subscriptionStatus, type Plan, type PlanQuote } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { UsageCard } from '@/features/billing/UsageCard'
import { PlanPicker } from '@/features/billing/PlanPicker'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { formatINR, humanize } from '@/shared/ui/format'
import { useTalkToUs } from '@/features/billing/talk-to-us'
import { PLAN_SOURCE_LABEL } from '@ipc/domain'
import { PlanExpiryBanner } from '@/features/billing/PlanExpiryBanner'
import { DiamondCheckDialog } from '@/features/billing/DiamondCheckDialog'

const plans = plan.array()
const WHATSAPP = 'border-0 bg-[#25D366] text-white hover:bg-[#1ebe5b] hover:text-white'

export function SubscriptionPage() {
  // allowExpired: the renewal page stays reachable precisely when lapsed
  // (router.tsx renewalLayout). The admin billing allowlist (expired owner can
  // still open settings + subscription) is enforced in ModuleRouteGuard.
  return (
    <AuthedPage module="settings_subscription">
      <Subscription />
    </AuthedPage>
  )
}

function Subscription() {
  const { session } = useAuth()
  const talk = useTalkToUs()
  // Both price lists, for everyone (owner, 14 Oct): the regular one on top and
  // the IPC Diamond members' below it -- Diamond Starter, Pro and Studio Max.
  const regular = useQuery({
    queryKey: ['public', 'plans'],
    queryFn: () => callApi('/public/plans', { responseSchema: plans }),
    staleTime: 5 * 60_000,
  })
  const member = useQuery({
    queryKey: ['public', 'plans', 'member'],
    queryFn: () => callApi('/public/plans?list=member', { responseSchema: plans }),
    staleTime: 5 * 60_000,
  })
  // Talk to us on WhatsApp on a member price first checks the number (null = closed).
  const [checking, setChecking] = useState<{ plan: Plan | null; quote?: PlanQuote | undefined } | null>(null)
  // What paying for each plan would mean now: buy, renew, upgrade for the difference, or later (0242).
  const quotes = useQuery({
    queryKey: ['subscription', 'quotes'],
    queryFn: () => callApi('/subscription/quotes', { responseSchema: planQuote.array() }),
    enabled: !!session,
  })
  // Lovable parity: extended status (current/latest/can_purchase/webhook + history + recovery).
  const status = useQuery({
    queryKey: ['subscription', 'status'],
    queryFn: () => callApi('/subscription/status', { responseSchema: subscriptionStatus }),
    enabled: !!session,
    retry: false,
  })
  const diamond = status.data?.member_tier === 'diamond'

  const gateTone = { active: 'success', grace: 'warning', grandfathered: 'info', expired: 'danger' } as const

  return (
    <>
      <PlanExpiryBanner />
      <PageHeader
        title="Plan & billing"
        actions={
          session && (
            <StatusBadge tone={gateTone[session.plan_gate]}>
              {status.data ? PLAN_SOURCE_LABEL[status.data.plan_source] : humanize(session.plan_gate)}
            </StatusBadge>
          )
        }
      />
      {/* One line only when a payment is in flight; the card below says the rest. */}
      {status.data?.latest_order_status && status.data.latest_order_status !== 'paid' && (
        <p className="mb-2 text-sm text-muted-foreground">Latest payment: {humanize(status.data.latest_order_status)}</p>
      )}
      {/* When it ends, in one line anyone can read: the free trial (7 days, 30 for IPC Diamond members, 0214)
          or the paid plan, with the days left in big type. */}
      {status.data?.access_until && (
        <Card
          className={`mb-4 border-l-4 ${
            (status.data.days_left ?? 0) < 0
              ? 'border-l-destructive'
              : (status.data.days_left ?? 0) <= 7
                ? 'border-l-tone-amber'
                : 'border-l-tone-green'
          }`}
        >
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {status.data.plan_source === 'trial' ? 'Your free trial' : 'Your plan'}
              </p>
              <p className="text-2xl font-bold tabular-nums">
                {(status.data.days_left ?? 0) < 0
                  ? 'Ended'
                  : `${status.data.days_left} day${status.data.days_left === 1 ? '' : 's'} left`}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              {(status.data.days_left ?? 0) < 0 ? 'Ended on ' : 'Ends on '}
              <strong className="text-foreground">
                {new Date(status.data.access_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
              </strong>
              .{' '}
              {status.data.plan_source === 'trial'
                ? 'Pick a plan below to keep everything running after that.'
                : 'Paying again extends from that date, so nothing is lost by renewing early.'}
            </p>
          </CardContent>
        </Card>
      )}
      {regular.isLoading || member.isLoading ? (
        <SkeletonCards count={3} />
      ) : regular.isError && member.isError ? (
        <ErrorState
          onRetry={() => {
            void regular.refetch()
            void member.refetch()
          }}
        />
      ) : (regular.data ?? []).length === 0 && (member.data ?? []).length === 0 ? (
        <EmptyState
          title="No plans are on offer yet"
          description="Plans are published by the platform. Until one is, your studio keeps its current access."
        />
      ) : (
        <PlanPicker
          regular={regular.data ?? []}
          member={member.data ?? []}
          memberFirst={diamond}
          verified={diamond}
          quotes={quotes.data}
          onChoose={(p, q, list) => {
            // The member price goes to WhatsApp only once the number is on the IPC list.
            if (list === 'member' && !diamond) setChecking({ plan: p, quote: q })
            else talk.open(p, q?.kind, list === 'member')
          }}
          regularAction={{ label: talk.label, icon: MessageCircle, note: "We'll set it up on a short call.", className: WHATSAPP }}
          memberAction={{ label: talk.label, icon: MessageCircle, note: diamond ? "We'll set it up on a short call." : 'We check your IPC number first.', className: WHATSAPP }}
          onCheckNumber={session?.is_owner ? () => setChecking({ plan: null }) : undefined}
          canChoose={!!session?.is_owner}
          chooseHint="Only the studio owner can change the plan."
        />
      )}
      <DiamondCheckDialog
        open={!!checking}
        plan={checking?.plan ?? null}
        onClose={() => setChecking(null)}
        onWhatsApp={(p) => talk.open(p, checking?.quote?.kind, true)}
        onSeeRegular={() => document.getElementById('regular-prices')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      />
      {/* Never a timer (owner, 14 Oct): one honest sentence. */}
      <p className="mx-auto mt-6 flex max-w-2xl items-start justify-center gap-2 rounded-xl border border-tone-amber/40 bg-tone-amber-soft px-4 py-3 text-center text-sm font-medium">
        <TrendingUp className="mt-0.5 size-4 shrink-0 text-tone-amber" aria-hidden />
        Prices will go up as we add servers and grow our technical team. Buy now and today's price is yours.
      </p>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        Every price is plus 18% GST. Message us and we'll set your plan up on a short call. Paying means you agree to the{' '}
        <Link to="/terms-and-conditions" className="text-primary hover:underline">Terms</Link> and the{' '}
        <Link to="/refund-policy" className="text-primary hover:underline">Refund Policy</Link>.
      </p>
      <UsageCard className="mt-6" />

      {status.data?.history && status.data.history.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Payment history</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {status.data.history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{h.plan_name ?? 'Plan'}{h.created_at ? ` · ${new Date(h.created_at).toLocaleDateString('en-IN')}` : ''}</span>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {h.amount != null && <span className="tabular-nums">{formatINR(h.amount)}</span>}
                    {h.status && <StatusBadge>{humanize(h.status)}</StatusBadge>}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  )
}
