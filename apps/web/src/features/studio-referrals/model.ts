import type { StudioReferralRow, StudioRefTerms } from '@ipc/contracts'
import { screenINR } from '@/shared/money/hide'

type RefTone = 'blue' | 'green' | 'violet' | 'amber' | 'rose' | 'teal'

/** Where one referred studio stands, as a coloured chip. */
export function referralState(r: Pick<StudioReferralRow, 'paid_at' | 'rewarded_at' | 'reward_amount' | 'void_reason'>): {
  label: string
  tone: RefTone
} {
  if (r.void_reason) return { label: 'Not counted', tone: 'rose' }
  if (r.rewarded_at) return { label: r.reward_amount ? `Rewarded ${screenINR(r.reward_amount)}` : 'Rewarded', tone: 'violet' }
  if (r.paid_at) return { label: 'On a paid plan', tone: 'green' }
  return { label: 'Joined · on trial', tone: 'blue' }
}

/** What a referral earns, in a sentence -- or that it is still being decided. */
export function termsLine(t: StudioRefTerms): string {
  if (t.reward == null && t.discount_pct == null) {
    return 'Rewards are being finalised. Every studio that joins with your link now is counted for you.'
  }
  const parts: string[] = []
  if (t.reward != null) parts.push(`${screenINR(t.reward)} for every studio that starts a paid plan`)
  if (t.discount_pct != null) parts.push(`they get ${Number(t.discount_pct)}% off their first plan`)
  const line = parts.join(', and ')
  const hold = t.hold_days ? ` Your reward is due ${t.hold_days} days after they pay.` : ''
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}.${hold}`
}

/** "3 studios joined · 1 on a paid plan", or the nudge when there are none. */
export function summaryLine(rows: Pick<StudioReferralRow, 'paid_at' | 'void_reason'>[]): string {
  const live = rows.filter((r) => !r.void_reason)
  if (live.length === 0) return 'No studios yet. Send your link to one you know.'
  const paid = live.filter((r) => r.paid_at).length
  const joined = `${live.length} ${live.length === 1 ? 'studio' : 'studios'} joined`
  return paid ? `${joined} · ${paid} on a paid plan` : `${joined} · none on a paid plan yet`
}
