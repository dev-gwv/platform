import { useEffect, useState } from 'react'
import type { PlatformStudioReferral, StudioRefTerms } from '@ipc/contracts'
import { usePlatformStudioReferrals, useSaveStudioRefTerms, useSettleStudioReferral } from '@/features/studio-referrals/api'
import { referralState, termsLine } from '@/features/studio-referrals/model'
import { PlatformPage } from '@/shared/layout/PlatformPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { TONE_CHIP_STATIC } from '@/shared/ui/tone-chip'
import { cn } from '@/shared/ui/cn'

export function PlatformStudioReferralsPage() {
  return (
    <PlatformPage>
      <StudioReferralsConsole />
    </PlatformPage>
  )
}

const day = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** Who brought in whom, and what a referral earns -- the owner sets the terms here. */
function StudioReferralsConsole() {
  const q = usePlatformStudioReferrals()
  if (q.isLoading) return <SkeletonList rows={4} />
  if (q.isError || !q.data) return <ErrorState onRetry={() => void q.refetch()} />
  return (
    <>
      <PageHeader title="Studio referrals" description={`${q.data.referrals.length} studios joined through a link`} />
      <div className="flex max-w-4xl flex-col gap-5">
        <Terms terms={q.data.terms} />
        <Card>
          <CardContent className="p-0">
            {q.data.referrals.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">No studio has joined through a referral link yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {q.data.referrals.map((r) => (
                  <Row key={r.id} r={r} defaultReward={q.data.terms.reward} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))
const filled = (v: string) => (v.trim() ? 'border-success/60' : 'border-amber-400 bg-amber-50/60 dark:bg-amber-950/20')

function Terms({ terms }: { terms: StudioRefTerms }) {
  const [reward, setReward] = useState('')
  const [discount, setDiscount] = useState('')
  const [hold, setHold] = useState('')
  useEffect(() => {
    setReward(terms.reward?.toString() ?? '')
    setDiscount(terms.discount_pct?.toString() ?? '')
    setHold(terms.hold_days?.toString() ?? '')
  }, [terms])
  const save = useSaveStudioRefTerms()
  const draft = { reward: numOrNull(reward), discount_pct: numOrNull(discount), hold_days: numOrNull(hold) }
  const bad = Object.values(draft).some((v) => v != null && (Number.isNaN(v) || v < 0))
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <p className="font-semibold">What a referral earns</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Reward per paid studio (₹)
            <Input className={filled(reward)} inputMode="numeric" placeholder="e.g. 2000" value={reward} onChange={(e) => setReward(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Their discount (%)
            <Input className={filled(discount)} inputMode="numeric" placeholder="e.g. 10" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Reward due after (days)
            <Input className={filled(hold)} inputMode="numeric" placeholder="e.g. 30" value={hold} onChange={(e) => setHold(e.target.value)} />
          </label>
        </div>
        <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">
          Studios read: <span className="text-muted-foreground">{bad ? 'Check the numbers.' : termsLine(draft)}</span>
        </p>
        <Button className="self-start" disabled={bad || save.isPending} onClick={() => save.mutate(draft)}>
          Save terms
        </Button>
      </CardContent>
    </Card>
  )
}

function Row({ r, defaultReward }: { r: PlatformStudioReferral; defaultReward: number | null }) {
  const s = referralState(r)
  const settle = useSettleStudioReferral()
  const [amount, setAmount] = useState(defaultReward?.toString() ?? '')
  return (
    <li className="flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {r.studio_name} <span className="font-normal text-muted-foreground">← {r.referrer_name}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Code {r.code} · joined {day.format(new Date(r.signed_up_at))}
          {r.paid_at ? ` · paid ${day.format(new Date(r.paid_at))}` : ''}
          {r.void_reason ? ` · ${r.void_reason}` : ''}
        </p>
      </div>
      <span className={cn('rounded-full border px-2 py-0.5 text-xs font-medium', TONE_CHIP_STATIC[s.tone])}>{s.label}</span>
      {r.paid_at && !r.rewarded_at && !r.void_reason && (
        <div className="flex items-center gap-2">
          <Input className={cn('h-8 w-24', filled(amount))} inputMode="numeric" placeholder="₹" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button size="sm" disabled={settle.isPending || !amount.trim()} onClick={() => settle.mutate({ id: r.id, action: 'reward', amount: Number(amount) })}>
            Mark rewarded
          </Button>
        </div>
      )}
      {!r.void_reason && !r.rewarded_at && (
        <Button
          size="sm"
          variant="outline"
          className="hover:border-destructive hover:text-destructive"
          disabled={settle.isPending}
          onClick={() => {
            const reason = window.prompt('Why does this one not count? (e.g. same owner)')
            if (reason && reason.trim().length >= 2) settle.mutate({ id: r.id, action: 'void', reason: reason.trim() })
          }}
        >
          Not counted
        </Button>
      )}
      {(r.void_reason || r.rewarded_at) && (
        <Button size="sm" variant="outline" disabled={settle.isPending} onClick={() => settle.mutate({ id: r.id, action: 'reopen' })}>
          Undo
        </Button>
      )}
    </li>
  )
}
