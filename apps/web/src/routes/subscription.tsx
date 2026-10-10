import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Check, MessageCircle, Mail, Sparkles } from 'lucide-react'
import { plan, planQuote, subscriptionStatus } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { UsageCard } from '@/features/billing/UsageCard'
import { perDay } from '@/features/billing/usage'
import { PlanPicker } from '@/features/billing/PlanPicker'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { formatINR, humanize } from '@/shared/ui/format'
import { useTalkToUs } from '@/features/billing/talk-to-us'
import { PLAN_SOURCE_LABEL } from '@ipc/domain'
import { PlanExpiryBanner } from '@/features/billing/PlanExpiryBanner'
import { DiamondVerifyCard } from '@/features/billing/DiamondVerifyCard'

const plans = plan.array()

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
  const TalkIcon = talk.via === 'whatsapp' ? MessageCircle : Mail
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['subscription', 'plans'],
    queryFn: () => callApi('/subscription/plans', { responseSchema: plans }),
    enabled: !!session,
  })
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
      <UsageCard className="mb-4" />
      {/* Outsiders see one price; an IPC Diamond member proves it here (0214). */}
      {status.data && session?.is_owner && <DiamondVerifyCard status={status.data} className="mb-4" />}

      {isLoading ? (
        <SkeletonCards count={3} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="No plans are on offer yet"
          description="Plans are published by the platform. Until one is, your studio keeps its current access."
        />
      ) : (
        <>
        {/* Starter, Pro and Studio Max (0242): three short cards, the chips, Compare plans. */}
        <PlanPicker
          plans={data}
          quotes={quotes.data}
          onChoose={(p, q) => talk.open(p, q?.kind)}
          action={{ label: talk.label, icon: TalkIcon, note: "We'll set it up on a short call." }}
          canChoose={!!session?.is_owner}
          chooseHint="Only the studio owner can change the plan."
        />
        {data.some((p) => !p.tier) && (
        <div className="grid gap-4 md:grid-cols-3">
          {data.filter((p) => !p.tier).map((p) => {
            // A studio already inside its plan is renewing, not choosing.
            const renewing = !status.data?.can_purchase
            const free = p.price <= 0
            const highlight = p.badge === 'Most Popular'
            const saver = p.badge === 'Maximum Savings'
            const label = free ? 'Free Trial Included' : talk.label
            return (
              <Card
                key={p.id}
                className={
                  highlight
                    ? 'border-primary ring-2 ring-primary'
                    : saver
                      ? 'border-success ring-2 ring-success/60'
                      : undefined
                }
              >
                <CardHeader>
                  {p.badge && (
                    <StatusBadge tone={saver ? 'success' : 'info'} className="w-fit">
                      {p.badge}
                    </StatusBadge>
                  )}
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="size-4 text-primary" />
                    {p.name}
                  </CardTitle>
                  <p className="text-xl font-semibold">
                    {formatINR(p.price)}
                    <span className="text-sm font-normal text-muted-foreground">
                      {' '}
                      / {p.billing_interval === 'biennial' ? '2 years' : p.billing_interval === 'yearly' ? 'year' : 'month'}
                    </span>
                  </p>
                  {/* The figure people actually compare plans on. */}
                  {p.monthly_equivalent != null && p.billing_interval !== 'monthly' && (
                    <p className="text-sm text-muted-foreground">
                      {formatINR(p.monthly_equivalent)}/month, paid up front
                    </p>
                  )}
                  {perDay(p) != null && <p className="text-sm font-medium text-success">Just {formatINR(perDay(p)!)} a day</p>}
                  <p className="text-xs text-muted-foreground">
                    {p.billing_label ?? ''}
                    {p.billing_label ? ' · ' : ''}+ GST (18%)
                  </p>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {p.savings_label && (
                    <p className="rounded-md bg-success/10 px-2.5 py-1.5 text-sm font-medium text-success">
                      {p.savings_label}
                    </p>
                  )}
                  {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
                  {p.features && p.features.length > 0 ? (
                    <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
                      {p.features.map((f) => (
                        <li key={f} className="flex items-center gap-2">
                          <Check className="size-4 shrink-0 text-success" /> {f}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
                      <li className="flex items-center gap-2">
                        <Check className="size-4 text-success" /> All studio features
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="size-4 text-success" /> GST invoicing
                      </li>
                    </ul>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {p.currency ?? 'INR'}{p.duration_days ? ` · ${p.duration_days} days` : ''}
                  </p>
                  <Button
                    variant={highlight || saver ? 'default' : 'outline'}
                    onClick={() => talk.open(p, renewing ? 'renew' : 'buy')}
                    disabled={free || !session?.is_owner}
                    title={session?.is_owner ? undefined : 'Only the studio owner can change the plan.'}
                  >
                    {!free && <TalkIcon aria-hidden />} {label}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
        )}
        </>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Prices exclude 18% GST. Message us and we'll set your plan up on a short call. Paying means you agree to the{' '}
        <Link to="/terms-and-conditions" className="text-primary hover:underline">Terms</Link> and the{' '}
        <Link to="/refund-policy" className="text-primary hover:underline">Refund Policy</Link>.
      </p>

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
