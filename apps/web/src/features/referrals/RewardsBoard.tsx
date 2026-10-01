import { useState } from 'react'
import { Gift } from 'lucide-react'
import type { ReferralCampaign, ReferralSubmission } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { useRewardSubmissions, useUpdateSubmissionStatus } from './api'

const who = (s: ReferralSubmission) => s.referring_client_name ?? s.referrer_name ?? 'A client'
const whom = (s: ReferralSubmission) => s.referred_name ?? s.client_name

/**
 * The thank-yous owed: every client whose referral booked and is due a
 * reward, beside the ones already given. Marking one given asks what was
 * given, starting from the campaign's reward, so the total is real money.
 */
export function RewardsBoard({ campaigns }: { campaigns: readonly ReferralCampaign[] }) {
  const due = useRewardSubmissions('due')
  const given = useRewardSubmissions('given')
  const dueRows = due.data?.items ?? []
  const givenRows = given.data?.items ?? []
  const givenTotal = givenRows.reduce((s, r) => s + (r.reward_amount ?? 0), 0)
  const rewardOf = (s: ReferralSubmission) => campaigns.find((c) => c.id === s.campaign_id)?.reward_value ?? 0

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        {dueRows.length === 0 ? 'No rewards waiting.' : `${dueRows.length} ${dueRows.length === 1 ? 'reward is' : 'rewards are'} waiting to be given.`}{' '}
        {givenRows.length > 0 && `${formatINR(givenTotal)} given to ${givenRows.length} ${givenRows.length === 1 ? 'client' : 'clients'} so far.`}
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <Column title="To give" count={dueRows.length} tone="amber">
          {dueRows.length === 0 ? (
            <Empty>When a referred couple books, mark their referral "Reward due" and it shows here.</Empty>
          ) : (
            dueRows.map((s) => <DueCard key={s.id} s={s} suggested={rewardOf(s)} />)
          )}
        </Column>
        <Column title="Given" count={givenRows.length} tone="green">
          {givenRows.length === 0 ? (
            <Empty>Nothing given yet.</Empty>
          ) : (
            givenRows.map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm">
                <Gift className="size-4 shrink-0 text-success" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{who(s)}</span>
                  <span className="text-muted-foreground"> · for {whom(s)}</span>
                </span>
                <span className="tabular-nums">{s.reward_amount ? formatINR(s.reward_amount) : '—'}</span>
              </li>
            ))
          )}
        </Column>
      </div>
    </div>
  )
}

function DueCard({ s, suggested }: { s: ReferralSubmission; suggested: number }) {
  const update = useUpdateSubmissionStatus()
  const [amount, setAmount] = useState(suggested ? String(suggested) : '')
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-warning/50 bg-warning/5 px-3 py-2">
      <div className="min-w-[10rem] flex-1">
        <p className="truncate text-sm font-medium">{who(s)}</p>
        <p className="truncate text-xs text-muted-foreground">
          Referred {whom(s)}
          {s.project_name ? ` · ${s.project_name}` : ''} · {s.campaign_name}
        </p>
      </div>
      <Input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="decimal"
        placeholder="₹"
        aria-label={`Reward for ${who(s)}`}
        className="w-24"
      />
      <Button
        size="sm"
        disabled={update.isPending}
        onClick={() => update.mutate({ id: s.id, reward_status: 'given', ...(Number(amount) > 0 ? { reward_amount: Number(amount) } : {}) })}
      >
        <Gift /> Given
      </Button>
    </li>
  )
}

function Column({ title, count, tone, children }: { title: string; count: number; tone: 'amber' | 'green'; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <span className={cn('size-2 rounded-full', tone === 'amber' ? 'bg-warning' : 'bg-success')} aria-hidden />
          {title} <span className="font-normal text-muted-foreground">{count}</span>
        </p>
        <ul className="flex flex-col gap-1.5">{children}</ul>
      </CardContent>
    </Card>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <li className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">{children}</li>
}
