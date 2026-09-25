import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, Sparkles, CheckCircle2, XCircle } from 'lucide-react'
import {
  plan,
  createOrderResponse,
  activateResponse,
  subscriptionStatus,
  type ActivateRequest,
  type Plan,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { SettingsTabs } from '@/features/settings/SettingsTabs'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { formatINR, humanize } from '@/shared/ui/format'
import { openCheckout } from '@/features/billing/razorpay-checkout'
import { PLAN_SOURCE_LABEL } from '@ipc/domain'
import { PlanExpiryBanner } from '@/features/billing/PlanExpiryBanner'

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

type Outcome = { tone: 'success' | 'error' | 'info'; text: string }

function Subscription() {
  const { session, refresh } = useAuth()
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [dialog, setDialog] = useState<'success' | 'failed' | null>(null)
  const [failedMsg, setFailedMsg] = useState('')
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['subscription', 'plans'],
    queryFn: () => callApi('/subscription/plans', { responseSchema: plans }),
    enabled: !!session,
  })
  // Lovable parity: extended status (current/latest/can_purchase/webhook + history + recovery).
  const status = useQuery({
    queryKey: ['subscription', 'status'],
    queryFn: () => callApi('/subscription/status', { responseSchema: subscriptionStatus }),
    enabled: !!session,
    retry: false,
  })

  const subscribe = useMutation({
    mutationFn: async (p: Plan) => {
      const order = await callApi('/subscription/order', {
        method: 'POST',
        body: { plan_id: p.id },
        responseSchema: createOrderResponse,
      })

      let proof: ActivateRequest
      if (order.razorpay_order_id && order.key_id) {
        // Real checkout: the signature Razorpay hands back is the proof the
        // API verifies before touching the plan.
        const paid = await openCheckout({
          keyId: order.key_id,
          razorpayOrderId: order.razorpay_order_id,
          amountRupees: order.amount,
          currency: order.currency,
          studioName: 'IPC Studios',
          description: `${p.name} plan`,
          prefill: { name: session?.display_name ?? '', email: session?.email ?? '' },
        })
        if (!paid) return null
        proof = {
          order_id: order.order_id,
          payment_id: paid.razorpay_payment_id,
          signature: paid.razorpay_signature,
        }
      } else {
        // No provider configured: the API allows this only on a dev bench and
        // refuses it anywhere else.
        proof = { order_id: order.order_id, payment_id: 'pay_demo' }
      }
      return callApi('/subscription/activate', {
        method: 'POST',
        body: proof,
        responseSchema: activateResponse,
      })
    },
    onSuccess: async (r) => {
      if (!r) {
        setOutcome({ tone: 'info', text: 'Checkout was closed before paying. Nothing was charged.' })
        return
      }
      setOutcome({
        tone: 'success',
        text: `Plan active until ${new Date(r.expires_at).toLocaleDateString('en-IN')}.`,
      })
      setDialog('success')
      await refresh()
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : 'Could not activate.'
      setOutcome({ tone: 'error', text: msg })
      setFailedMsg(msg)
      setDialog('failed')
    },
  })

  const gateTone = { active: 'success', grace: 'warning', grandfathered: 'info', expired: 'danger' } as const
  const outcomeClass = {
    success: 'bg-success/10 text-success',
    error: 'bg-destructive/10 text-destructive',
    info: 'bg-muted text-muted-foreground',
  }

  return (
    <>
      <PlanExpiryBanner />
      <PageHeader
        title="Subscription"
        description="Manage your studio's plan."
        actions={
          session && (
            <StatusBadge tone={gateTone[session.plan_gate]}>{humanize(session.plan_gate)}</StatusBadge>
          )
        }
      />
      <SettingsTabs />
      {status.data && (
        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-1 p-4 text-sm">
            <span><span className="text-muted-foreground">Current: </span><strong>{status.data.plan_name ?? status.data.plan_key ?? '—'}</strong></span>
            {!status.data.can_purchase && <StatusBadge tone="success">Current plan</StatusBadge>}
            {/* "Active" reads the same on a free trial and on two years
                paid up. Which one it is decides what to say on a renewal
                call, so it belongs beside the plan name. */}
            <span>
              <span className="text-muted-foreground">Source: </span>
              <strong>{PLAN_SOURCE_LABEL[status.data.plan_source]}</strong>
            </span>
            {status.data.latest_order_status && (
              <span><span className="text-muted-foreground">Latest payment: </span>{humanize(status.data.latest_order_status)}</span>
            )}
            {status.data.webhook_configured === false && session?.is_owner && (
              <span className="text-xs text-muted-foreground">Automatic renewal receipts are off (provider webhook not configured) — renewals still activate on checkout.</span>
            )}
          </CardContent>
        </Card>
      )}
      {session?.plan_expiry && (
        <p className="mb-4 text-sm text-muted-foreground">
          Current plan runs until {new Date(session.plan_expiry).toLocaleDateString('en-IN')}. Paying
          again extends from that date, so nothing is lost by renewing early.
        </p>
      )}
      {outcome && (
        <p role="status" className={`mb-4 rounded-md px-3 py-2 text-sm ${outcomeClass[outcome.tone]}`}>
          {outcome.text}
        </p>
      )}

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
        <div className="grid gap-4 md:grid-cols-3">
          {data.map((p) => {
            // A studio already inside its plan is renewing, not choosing.
            const renewing = !status.data?.can_purchase
            const free = p.price <= 0
            const highlight = p.badge === 'Most Popular'
            const saver = p.badge === 'Maximum Savings'
            const label = free
              ? 'Free Trial Included'
              : subscribe.isPending
                ? 'Processing…'
                : renewing
                  ? `Renew · ${p.name.replace(/^IPC\s+/i, '')}`
                  : `Choose ${p.name.replace(/^IPC\s+/i, '')}`
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
                    onClick={() => subscribe.mutate(p)}
                    disabled={subscribe.isPending || free || !session?.is_owner}
                    title={session?.is_owner ? undefined : 'Only the studio owner can change the plan.'}
                  >
                    {label}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Prices exclude 18% GST. Paying means you agree to the{' '}
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
            <p className="mt-2 text-xs text-muted-foreground">
              Charged but plan not active? Re-open checkout — replaying a paid order recovers it without charging again.
            </p>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialog === 'success'} onOpenChange={(o) => { if (!o) setDialog(null) }}>
        <DialogContent>
          <div className="flex flex-col items-center gap-2 p-4 text-center">
            <CheckCircle2 className="size-10 text-success" />
            <h2 className="font-semibold">Payment successful</h2>
            <p className="text-sm text-muted-foreground">{outcome?.text ?? 'Your plan is active.'}</p>
            <Button onClick={() => setDialog(null)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === 'failed'} onOpenChange={(o) => { if (!o) setDialog(null) }}>
        <DialogContent>
          <div className="flex flex-col items-center gap-2 p-4 text-center">
            <XCircle className="size-10 text-destructive" />
            <h2 className="font-semibold">Payment failed</h2>
            <p className="text-sm text-muted-foreground">{failedMsg || 'The payment did not go through. Nothing was charged — try again.'}</p>
            <Button variant="outline" onClick={() => setDialog(null)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
