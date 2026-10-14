import { useState } from 'react'
import {
  CalendarDays,
  Check,
  ChevronDown,
  Clapperboard,
  FileSignature,
  HardDrive,
  Inbox,
  Receipt,
  UserCheck,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { Plan, PlanQuote } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { IconTile } from '@/shared/ui/icon-tile'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { COMPARE, INCLUDED, quoteWords, tierPlans, type Cell } from './plan-features'
import { perDay } from './usage'

const ICONS: Record<(typeof INCLUDED)[number]['icon'], LucideIcon> = {
  inbox: Inbox,
  'file-signature': FileSignature,
  receipt: Receipt,
  calendar: CalendarDays,
  clapperboard: Clapperboard,
  'hard-drive': HardDrive,
  'user-check': UserCheck,
  wallet: Wallet,
}

/**
 * Starter, Pro and Studio Max, kept easy on the eyes (owner, 3 Oct): a
 * yearly/monthly switch, three cards of at most three lines, one row of
 * "every plan has every feature" chips, and "Compare plans" -- closed until
 * pressed -- with only the rows that differ. Our own prices, so formatINR
 * (never masked). Used on Plan & billing and the home page.
 *
 * `action` names what the button does when it is not checkout: "Talk to us
 * on WhatsApp" inside the app, "Start 7-day free trial" on the home page.
 * A plan that must wait (a lower one, mid-year) keeps its "From 15 Oct".
 */
export function PlanPicker({
  plans,
  quotes,
  onChoose,
  busy,
  canChoose = true,
  chooseHint,
  action,
  regular,
}: {
  plans: Plan[]
  /** The regular price list, shown struck through beside a member's price (0262). */
  regular?: Plan[] | undefined
  quotes?: PlanQuote[] | undefined
  onChoose: (p: Plan, quote: PlanQuote | undefined) => void
  action?: { label: string; icon?: LucideIcon; note?: string; className?: string } | undefined
  busy?: boolean
  canChoose?: boolean
  chooseHint?: string
}) {
  const [payEvery, setPayEvery] = useState<'yearly' | 'monthly'>('yearly')
  const shown = tierPlans(plans, payEvery)
  if (shown.length === 0) return null
  return (
    <div className="flex flex-col items-center gap-6">
      <div className="inline-flex rounded-full border border-border bg-card p-0.5" role="radiogroup" aria-label="How to pay">
        {(['yearly', 'monthly'] as const).map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={payEvery === i}
            onClick={() => setPayEvery(i)}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
              payEvery === i ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {i === 'yearly' ? 'Pay yearly · save more' : 'Pay monthly'}
          </button>
        ))}
      </div>

      <div className="grid w-full gap-5 pt-2 md:grid-cols-3">
        {shown.map((p) => {
          const highlight = p.badge === 'Most Popular'
          const quote = quotes?.find((q) => q.plan_id === p.id)
          const words = quoteWords(p, quote, formatINR)
          const Icon = action?.icon
          const line = words.line ?? (words.disabled ? null : (action?.note ?? null))
          const day = perDay(p)
          const monthly = monthlyOf(p)
          const was = regular?.find((r) => r.tier === p.tier && r.billing_interval === p.billing_interval)
          return (
            <Card key={p.id} className={cn('relative flex flex-col', highlight && 'border-primary ring-2 ring-primary')}>
              {highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-primary-foreground">
                  Most popular
                </span>
              )}
              <CardContent className="flex flex-1 flex-col gap-4 p-5">
                <div>
                  <p className="text-lg font-semibold">{p.name}</p>
                  {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
                </div>
                <div>
                  <p className="text-3xl font-bold tabular-nums">
                    {formatINR(monthly)}
                    <span className="whitespace-nowrap text-sm font-normal text-muted-foreground">
                      {' '}/month <span className="font-semibold text-foreground">+ 18% GST</span>
                    </span>
                  </p>
                  {was && monthlyOf(was) > monthly && (
                    <p className="text-sm text-muted-foreground">
                      Regular <span className="line-through">{formatINR(monthlyOf(was))}</span>
                      <span className="ml-1.5 font-medium text-success">· {Math.round((1 - monthly / monthlyOf(was)) * 100)}% off for members</span>
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {day != null ? (
                      <>
                        {formatINR(p.price)} a year · <span className="font-medium text-success">just {formatINR(day)} a day</span>
                      </>
                    ) : (
                      'Billed every month'
                    )}
                  </p>
                  {/* GST is always 18%, on every plan (owner, 14 Oct): the total is said, never left to work out. */}
                  <p className="text-sm font-medium">
                    {formatINR(withGst(p.price))} with GST{p.billing_interval === 'monthly' ? ' a month' : ' a year'}
                  </p>
                </div>
                <ul className="flex flex-col gap-2 text-sm">
                  {(p.features ?? []).map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto flex flex-col gap-1.5">
                  <Button
                    variant={highlight ? 'default' : 'outline'}
                    className={action && !words.disabled ? action.className : undefined}
                    onClick={() => onChoose(p, quote)}
                    disabled={busy || words.disabled || !canChoose}
                    title={canChoose ? undefined : chooseHint}
                  >
                    {busy ? (
                      'Processing…'
                    ) : action && !words.disabled ? (
                      <>
                        {Icon && <Icon aria-hidden />} {action.label}
                      </>
                    ) : (
                      words.button
                    )}
                  </Button>
                  {line && <p className="text-center text-xs text-muted-foreground">{line}</p>}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="flex w-full flex-col items-center gap-3">
        <p className="text-sm font-semibold">Every plan has every feature</p>
        <ul className="flex flex-wrap justify-center gap-2">
          {INCLUDED.map((f) => (
            <li key={f.label} className="flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-3 text-sm">
              <IconTile icon={ICONS[f.icon]} tone={f.tone} size="sm" className="rounded-full" />
              {f.label}
            </li>
          ))}
        </ul>
      </div>

      <ComparePlans plans={shown} />
    </div>
  )
}

/** Every plan carries 18% GST on top, as create_payment_order charges it. */
export const withGst = (price: number) => Math.round(price * 1.18)

const monthlyOf = (p: Plan) => (p.billing_interval === 'monthly' ? p.price : (p.monthly_equivalent ?? Math.round(p.price / 12)))

function CellView({ c }: { c: Cell }) {
  if (c.kind === 'yes') return <Check className="mx-auto size-4 text-success" aria-label="Included" />
  if (c.kind === 'no') return <X className="mx-auto size-4 text-muted-foreground/60" aria-label="Not included" />
  return <span className={cn('text-xs sm:text-sm', c.text === 'Unlimited' ? 'font-medium' : 'tabular-nums')}>{c.text}</span>
}

/** Closed until pressed; only the rows that differ between the plans. */
function ComparePlans({ plans }: { plans: Plan[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex w-full flex-col items-center gap-3">
      {/* A real button, easy to see (owner, 14 Oct: "the Compare plans button should be clearly visible"). */}
      <Button
        variant="outline"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="border-2 border-primary px-6 font-semibold text-primary hover:bg-primary/10 hover:text-primary"
      >
        {open ? 'Hide the comparison' : 'Compare plans'}
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
      </Button>
      {open && (
        <Card className="w-full max-w-3xl">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-3 pl-3 text-left font-medium text-muted-foreground" />
                  {plans.map((p) => (
                    <th key={p.id} className={cn('w-20 px-1.5 py-3 text-center font-semibold sm:w-28 sm:px-3', p.badge === 'Most Popular' && 'text-primary')}>
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE.map((r) => (
                  <tr key={r.label} className="border-b border-border last:border-0">
                    <td className="py-3 pl-3 pr-1.5 text-xs sm:text-sm">{r.label}</td>
                    {plans.map((p) => (
                      <td key={p.id} className="whitespace-nowrap px-1.5 py-3 text-center sm:px-3">
                        <CellView c={r.cell(p)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
