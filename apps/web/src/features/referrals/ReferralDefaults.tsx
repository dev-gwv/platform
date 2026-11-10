import { useEffect, useState } from 'react'
import { Gift, Sparkles } from 'lucide-react'
import type { FriendRewardType, ReferralRewardType, ReferralSettingsInput } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { parseAmount } from '@/shared/money/parse-amount'
import { TEMPLATES } from '@/features/designer/templates'
import { useReferralSettings, useSaveReferralSettings } from './api'
import { FRIEND_KINDS } from './card/ReferralCard'
import { offerHeadline } from './card/draw'
import { CardPreview, sampleCard } from './card/CardPreview'
import { useCompanyProfile } from '@/features/settings/api'

const CLIENT_KINDS: { key: ReferralRewardType; label: string }[] = [
  { key: 'fixed', label: '₹ cashback' },
  { key: 'extra_album', label: 'Extra album' },
  { key: 'free_pre_wedding', label: 'Free pre-wedding shoot' },
  { key: 'custom', label: 'Something else' },
]

const VALID = [90, 180, 365] as const

/**
 * The studio's referral defaults (owner, 10 Nov): what every booked client's
 * card offers a friend, what the client gets when a friend books, how long a
 * card is good for, and its look. Each project's card starts from these and
 * can be changed on the project's Referrals tab.
 */
export function ReferralDefaults({ canEdit }: { canEdit: boolean }) {
  const q = useReferralSettings()
  const save = useSaveReferralSettings()
  const [f, setF] = useState<ReferralSettingsInput | null>(null)
  const [friendValue, setFriendValue] = useState('')
  const [clientValue, setClientValue] = useState('')
  const company = useCompanyProfile()

  useEffect(() => {
    if (q.data && !f) {
      setF(q.data)
      setFriendValue(q.data.friend_reward_value ? String(q.data.friend_reward_value) : '')
      setClientValue(q.data.reward_value ? String(q.data.reward_value) : '')
    }
  }, [q.data, f])

  if (!f) return null
  const set = (patch: Partial<ReferralSettingsInput>) => setF({ ...f, ...patch })
  const friendType = (f.friend_reward_type ?? 'fixed') as FriendRewardType
  const clientType = (f.reward_type ?? 'fixed') as ReferralRewardType
  const chip = (on: boolean) =>
    cn(
      'rounded-full border px-3 py-1 text-sm',
      on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:border-primary/50',
    )

  function onSave() {
    if (!f) return
    save.mutate({
      ...f,
      friend_reward_value: friendType === 'fixed' || friendType === 'percentage' ? parseAmount(friendValue) : 0,
      reward_value: clientType === 'fixed' ? parseAmount(clientValue) : 0,
    })
  }

  return (
    <Card>
      <CardContent className="grid gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <div className="flex min-w-0 flex-col gap-5">
        <div>
          <p className="flex items-center gap-2 font-semibold">
            <Sparkles className="size-4 text-primary" aria-hidden /> Referral cards for every client
          </p>
          <p className="text-sm text-muted-foreground">
            Each booked client gets a card to forward, starting from these. Change one client’s own card under AI → Referral cards, or on their project.
          </p>
        </div>

        <section className="flex flex-col gap-2">
          <p className="text-sm font-medium">A friend who books gets</p>
          <div className="flex flex-wrap gap-1.5">
            {FRIEND_KINDS.map((k) => (
              <button key={k.key} type="button" disabled={!canEdit} aria-pressed={friendType === k.key} className={chip(friendType === k.key)} onClick={() => set({ friend_reward_type: k.key })}>
                {k.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {(friendType === 'fixed' || friendType === 'percentage') && (
              <Input
                aria-label={friendType === 'fixed' ? 'Rupees off' : 'Percent off'}
                inputMode="numeric"
                value={friendValue}
                disabled={!canEdit}
                onChange={(e) => setFriendValue(e.target.value)}
                placeholder={friendType === 'fixed' ? '₹ e.g. 10,000' : '% e.g. 10'}
                className={cn('w-40', !friendValue.trim() && 'border-tone-amber/60 bg-tone-amber-soft/30')}
              />
            )}
            {friendType !== 'none' && (
              <Input
                aria-label="On the card, in a few words"
                value={f.friend_reward_title ?? ''}
                disabled={!canEdit}
                maxLength={120}
                onChange={(e) => set({ friend_reward_title: e.target.value || null })}
                placeholder={offerHeadline(friendType, parseAmount(friendValue), null)}
                className="min-w-0 flex-1"
              />
            )}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Gift className="size-4 text-muted-foreground" aria-hidden /> Your client gets, for each friend who books
          </p>
          <div className="flex flex-wrap gap-1.5">
            {CLIENT_KINDS.map((k) => (
              <button key={k.key} type="button" disabled={!canEdit} aria-pressed={clientType === k.key} className={chip(clientType === k.key)} onClick={() => set({ reward_type: k.key })}>
                {k.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {clientType === 'fixed' && (
              <Input
                aria-label="Cashback in rupees"
                inputMode="numeric"
                value={clientValue}
                disabled={!canEdit}
                onChange={(e) => setClientValue(e.target.value)}
                placeholder="₹ e.g. 5,000"
                className={cn('w-40', !clientValue.trim() && 'border-tone-amber/60 bg-tone-amber-soft/30')}
              />
            )}
            <Input
              aria-label="The reward, in a few words"
              value={f.reward_title ?? ''}
              disabled={!canEdit}
              maxLength={120}
              onChange={(e) => set({ reward_title: e.target.value || null })}
              placeholder="e.g. ₹5,000 cashback, or an extra album"
              className="min-w-0 flex-1"
            />
          </div>
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          <section className="flex flex-col gap-1.5">
            <Label>A card is good for</Label>
            <div className="flex flex-wrap gap-1.5">
              {VALID.map((d) => (
                <button key={d} type="button" disabled={!canEdit} aria-pressed={f.valid_days === d} className={chip(f.valid_days === d)} onClick={() => set({ valid_days: d })}>
                  {d === 365 ? '1 year' : `${d / 30} months`}
                </button>
              ))}
            </div>
          </section>
          <section className="flex flex-col gap-1.5">
            <Label>Card look</Label>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  disabled={!canEdit}
                  aria-pressed={f.card_look === t.key}
                  title={t.name}
                  onClick={() => set({ card_look: t.key })}
                  className={cn(
                    'flex items-center gap-1 rounded-full border px-2 py-1 text-xs',
                    f.card_look === t.key ? 'border-primary ring-1 ring-primary' : 'border-border',
                  )}
                >
                  <span className="size-3 rounded-full border border-black/10" style={{ background: t.theme.background }} />
                  <span className="size-3 rounded-full border border-black/10" style={{ background: t.theme.accent }} />
                  {t.name}
                </button>
              ))}
            </div>
          </section>
        </div>

        {canEdit && (
          <div className="flex justify-end">
            <Button disabled={save.isPending} onClick={onSave}>
              {save.isPending ? 'Saving…' : 'Save defaults'}
            </Button>
          </div>
        )}
        </div>
        <div className="flex flex-col gap-2 lg:sticky lg:top-4 lg:self-start">
          <p className="text-sm font-medium">How the card looks</p>
          <CardPreview
            look={f.card_look}
            data={sampleCard(company.data?.display_name || company.data?.name || 'Your studio', {
              friendType,
              friendValue: parseAmount(friendValue) ?? 0,
              friendTitle: f.friend_reward_title ?? null,
              validDays: f.valid_days,
            })}
          />
          <p className="text-xs text-muted-foreground">Drawn for a sample couple. Each client’s card carries their own name.</p>
        </div>
      </CardContent>
    </Card>
  )
}
