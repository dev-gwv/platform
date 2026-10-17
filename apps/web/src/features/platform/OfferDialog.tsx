import { useState } from 'react'
import { Gift } from 'lucide-react'
import type { OfferTier } from '@ipc/contracts'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Button } from '@/shared/ui/button'
import { Input, Label } from '@/shared/ui/input'
import { DateField, toIso } from '@/shared/ui/date-field'
import { Switch } from '@/shared/ui/switch'
import { cn } from '@/shared/ui/cn'
import { todayInIndia } from '@/shared/ui/days-left'
import { useMakeOffers } from './api'

const PERCENTS = [10, 15, 20, 25] as const
const TIERS: { key: OfferTier; label: string }[] = [
  { key: 'starter', label: 'Starter' },
  { key: 'pro', label: 'Pro' },
  { key: 'max', label: 'Studio Max' },
]

const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  return toIso(d)
}

/**
 * Make an offer for the studios ticked in Studio Access Manager (0268; owner,
 * 17 Oct): a percent off their first plan, on the plans picked, until the end
 * of a day. Regular price only unless "Diamond members too" is on; studios
 * that have bought before are skipped by the database, and the toast names
 * them. Nothing is charged: the studio sees the offer on Home and Plan &
 * billing and talks to us on WhatsApp.
 */
export function OfferDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const make = useMakeOffers()
  const today = todayInIndia()
  const [percent, setPercent] = useState<number>(20)
  const [custom, setCustom] = useState('')
  const [tiers, setTiers] = useState<OfferTier[]>(['starter', 'pro', 'max'])
  const [until, setUntil] = useState(plusDays(today, 2))
  const [note, setNote] = useState('')
  const [diamond, setDiamond] = useState(false)

  const pct = custom ? Number(custom) : percent
  const pctOk = Number.isInteger(pct) && pct >= 1 && pct <= 90
  const ready = pctOk && tiers.length > 0 && until >= today
  const toggle = (t: OfferTier) => setTiers((v) => (v.includes(t) ? v.filter((x) => x !== t) : [...v, t]))
  const chip = (on: boolean) =>
    cn(
      'rounded-full border px-3 py-1 text-sm font-medium transition-colors',
      on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:border-primary',
    )

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent
        title={`Make an offer to ${ids.length} studio${ids.length === 1 ? '' : 's'}`}
        description="Off their first plan only. Studios that have bought before are left out."
      >
        <div className="flex flex-col gap-4 text-sm">
          <div className="flex flex-col gap-1.5">
            <Label>Discount</Label>
            <div className="flex flex-wrap items-center gap-2">
              {PERCENTS.map((p) => (
                <button key={p} type="button" className={chip(!custom && percent === p)} onClick={() => { setPercent(p); setCustom('') }}>
                  {p}% off
                </button>
              ))}
              <Input
                inputMode="numeric"
                aria-label="Your own discount, percent"
                placeholder="Own %"
                value={custom}
                onChange={(e) => setCustom(e.target.value.replace(/\D/g, '').slice(0, 2))}
                className={cn('w-24', custom && !pctOk && 'border-destructive')}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>On which plans</Label>
            <div className={cn('flex flex-wrap gap-2 rounded-lg p-1', tiers.length === 0 && 'border border-dashed border-warning/60 bg-warning/5')}>
              {TIERS.map((t) => (
                <button key={t.key} type="button" aria-pressed={tiers.includes(t.key)} className={chip(tiers.includes(t.key))} onClick={() => toggle(t.key)}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Last day</Label>
            <div className="flex flex-wrap items-center gap-2">
              {[
                { label: 'Today', at: today },
                { label: '3 days', at: plusDays(today, 2) },
                { label: 'A week', at: plusDays(today, 6) },
              ].map((o) => (
                <button key={o.label} type="button" className={chip(until === o.at)} onClick={() => setUntil(o.at)}>
                  {o.label}
                </button>
              ))}
              <DateField aria-label="Last day of the offer" value={until} min={today} onChange={(e) => setUntil(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="offer-note">A line from you (optional)</Label>
            <Input id="offer-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. For being one of our busiest studios" />
          </div>

          <div className="rounded-lg border border-border p-3">
            <Switch
              checked={diamond}
              onChange={setDiamond}
              label="IPC Diamond members too"
              description="Off by default: their price is already about half."
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              disabled={!ready || make.isPending}
              onClick={() =>
                make.mutate(
                  { company_ids: ids, percent: pct, tiers, until, note: note.trim() || undefined, for_diamond: diamond },
                  { onSuccess: () => { onDone(); onClose() } },
                )
              }
            >
              <Gift className="size-4" /> {make.isPending ? 'Sending…' : `Send ${pctOk ? `${pct}% off` : 'offer'}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
