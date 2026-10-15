import { useState, type ReactNode } from 'react'
import {
  ArrowDown,
  BadgeCheck,
  CalendarDays,
  Check,
  ChevronDown,
  Clapperboard,
  FileSignature,
  Gem,
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
import { bestSaving, monthlyOf, percentOff, savingWords, sectionOrder, twinOf, withGst } from './price-lists'
import { perDay } from './usage'

export { withGst } from './price-lists'

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

/** The brand's own two colours (the Wordmark's): the IPC Diamond panel is drawn in them. */
const NAVY = '#1b2a4a'
const GOLD = '#f2a618'

export type PriceList = 'regular' | 'member'

export interface PlanAction {
  label: string
  icon?: LucideIcon
  note?: string
  className?: string
}

/**
 * Starter, Pro and Studio Max, twice (owner, 14 Oct): the regular price that
 * everyone pays, and right below it the IPC Diamond members' -- Diamond
 * Starter, Diamond Pro, Diamond Studio Max -- the same plans and every
 * feature at about half the price, drawn in the brand's navy and gold so the
 * saving is the thing the eye lands on. No tabs: one above the other, so the
 * two prices of a plan sit in the same column.
 *
 * Each list carries its own Pay yearly / monthly switch, kept in step, so
 * they are always compared like for like; "Every plan has every feature" and Compare plans
 * come once, because the features do not differ. A verified member reads
 * their own price first and the regular one beneath it, for comparison and
 * without buttons. Our own prices, so formatINR (never masked). Used on Plan
 * & billing and the home page.
 */
export function PlanPicker({
  regular,
  member,
  memberFirst = false,
  verified = false,
  quotes,
  onChoose,
  regularAction,
  memberAction,
  onCheckNumber,
  memberNote,
  busy,
  canChoose = true,
  chooseHint,
}: {
  regular: Plan[]
  member: Plan[]
  /** A verified member: their price first, the regular one under it for comparison. */
  memberFirst?: boolean
  verified?: boolean
  quotes?: PlanQuote[] | undefined
  onChoose: (p: Plan, quote: PlanQuote | undefined, list: PriceList) => void
  regularAction?: PlanAction | undefined
  memberAction?: PlanAction | undefined
  /** "Already a member? Check your number" in the Diamond panel's corner. */
  onCheckNumber?: (() => void) | undefined
  /** One line under the Diamond plans (the home page: check your number after signing up). */
  memberNote?: ReactNode
  busy?: boolean
  canChoose?: boolean
  chooseHint?: string
}) {
  const [payEvery, setPayEvery] = useState<'yearly' | 'monthly'>('yearly')
  const reg = tierPlans(regular, payEvery)
  const mem = tierPlans(member, payEvery)
  if (reg.length === 0 && mem.length === 0) return null
  const order = sectionOrder(memberFirst && mem.length > 0).filter((s) => (s === 'regular' ? reg.length : mem.length) > 0)

  const regularSection = (
    <section key="regular" id="regular-prices" aria-labelledby="regular-prices-title" className="scroll-mt-24">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Regular price</p>
          <h2 id="regular-prices-title" className="text-xl font-bold sm:text-2xl">
            {memberFirst ? 'What every other studio pays' : 'For every studio'}
          </h2>
          <p className="text-sm text-muted-foreground">7-day free trial · every price + 18% GST</p>
        </div>
        <PaySwitch value={payEvery} onChange={setPayEvery} label="How to pay, regular prices" />
      </div>
      <div className="grid gap-5 pt-2 md:grid-cols-3">
        {reg.map((p) => (
          <PlanCard
            key={p.id}
            plan={p}
            list="regular"
            quote={quotes?.find((q) => q.plan_id === p.id)}
            action={memberFirst ? undefined : regularAction}
            onChoose={onChoose}
            busy={busy}
            canChoose={canChoose}
            chooseHint={chooseHint}
            buttons={!memberFirst}
          />
        ))}
      </div>
    </section>
  )

  const best = bestSaving(mem, reg)
  const memberSection = (
    <section
      key="member"
      id="diamond-prices"
      aria-labelledby="diamond-prices-title"
      className="relative scroll-mt-24 overflow-hidden rounded-3xl p-4 text-white shadow-xl ring-1 sm:p-7"
      style={{ backgroundColor: NAVY, ['--tw-ring-color' as string]: `${GOLD}55` }}
    >
      {/* A soft gold glow in the corner: the panel reads as the special one. */}
      <span aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full opacity-25 blur-3xl" style={{ backgroundColor: GOLD }} />
      <span aria-hidden className="pointer-events-none absolute -bottom-32 -left-24 size-72 rounded-full bg-tone-violet opacity-20 blur-3xl" />
      <div className="relative mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className="grid size-12 shrink-0 place-items-center rounded-2xl ring-1"
            style={{ backgroundColor: `${GOLD}26`, ['--tw-ring-color' as string]: `${GOLD}66` }}
          >
            <Gem className="size-6" style={{ color: GOLD }} aria-hidden />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: GOLD }}>
              IPC Diamond members
            </p>
            <h2 id="diamond-prices-title" className="text-xl font-bold sm:text-2xl">
              The same plans, about half the price
            </h2>
            <p className="mt-0.5 text-sm text-white/75">
              Every feature · 30 days free{best > 0 ? ` · save up to ${formatINR(best)} ${payEvery === 'monthly' ? 'a month' : 'a year'}` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          {/* Its own switch, so nobody scrolls back up to change how they pay (owner, 15 Oct). */}
          <PaySwitch value={payEvery} onChange={setPayEvery} label="How to pay, IPC Diamond prices" tone="diamond" />
          {verified ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold"
              style={{ backgroundColor: GOLD, color: NAVY }}
            >
              <BadgeCheck className="size-4" aria-hidden /> You're a verified member
            </span>
          ) : (
            onCheckNumber && (
              <button
                type="button"
                onClick={onCheckNumber}
                className="rounded-full border px-3 py-1 text-sm font-medium transition-colors hover:bg-white/10"
                style={{ borderColor: `${GOLD}99`, color: GOLD }}
              >
                Already a member? Check your number
              </button>
            )
          )}
        </div>
      </div>
      <div className="relative grid gap-5 pt-2 md:grid-cols-3">
        {mem.map((p) => (
          <PlanCard
            key={p.id}
            plan={p}
            list="member"
            regular={twinOf(p, reg)}
            quote={quotes?.find((q) => q.plan_id === p.id)}
            action={memberAction}
            onChoose={onChoose}
            busy={busy}
            canChoose={canChoose}
            chooseHint={chooseHint}
            buttons
          />
        ))}
      </div>
      {memberNote && <p className="relative mt-5 text-center text-sm text-white/80">{memberNote}</p>}
    </section>
  )

  return (
    <div className="flex flex-col gap-6">
      {order.map((s, i) => (
        <div key={s} className="flex flex-col gap-6">
          {s === 'regular' ? regularSection : memberSection}
          {/* The bridge from the regular price down to the members': the one line that says why to look. */}
          {i === 0 && s === 'regular' && order.length > 1 && (
            <a
              href="#diamond-prices"
              className="mx-auto inline-flex items-center gap-2 rounded-full border border-tone-violet/40 bg-tone-violet-soft px-4 py-1.5 text-sm font-medium text-tone-violet transition-colors hover:bg-tone-violet/15"
            >
              <Gem className="size-4" aria-hidden /> IPC Diamond members get the very same plans for about half
              <ArrowDown className="size-4" aria-hidden />
            </a>
          )}
        </div>
      ))}

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

      <ComparePlans plans={reg.length > 0 ? reg : mem} />
    </div>
  )
}

/**
 * Pay yearly / Pay monthly. Each price list carries one (owner, 15 Oct: the
 * Diamond prices are a scroll away from the regular ones), and both drive the
 * same setting, so the two prices of a plan are always compared like for like.
 */
function PaySwitch({
  value,
  onChange,
  label,
  tone = 'regular',
}: {
  value: 'yearly' | 'monthly'
  onChange: (v: 'yearly' | 'monthly') => void
  label: string
  tone?: 'regular' | 'diamond'
}) {
  const diamond = tone === 'diamond'
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'inline-flex rounded-full border p-0.5',
        diamond ? 'border-white/30 bg-white/10' : 'border-border bg-card shadow-sm',
      )}
    >
      {(['yearly', 'monthly'] as const).map((i) => {
        const on = value === i
        return (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(i)}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
              diamond
                ? on
                  ? 'font-semibold'
                  : 'text-white/80 hover:bg-white/10'
                : on
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent',
            )}
            style={diamond && on ? { backgroundColor: GOLD, color: NAVY } : undefined}
          >
            {i === 'yearly' ? 'Pay yearly · save more' : 'Pay monthly'}
          </button>
        )
      })}
    </div>
  )
}

/** One plan: its price a month + GST, the total with GST, what it includes, and its one button. */
function PlanCard({
  plan: p,
  list,
  regular,
  quote,
  action,
  onChoose,
  busy,
  canChoose,
  chooseHint,
  buttons,
}: {
  plan: Plan
  list: PriceList
  /** For a member plan: the same plan at the regular price, struck through beside it. */
  regular?: Plan | undefined
  quote: PlanQuote | undefined
  action: PlanAction | undefined
  onChoose: (p: Plan, quote: PlanQuote | undefined, list: PriceList) => void
  busy?: boolean | undefined
  canChoose: boolean
  chooseHint?: string | undefined
  buttons: boolean
}) {
  const member = list === 'member'
  const highlight = p.badge === 'Most Popular'
  const words = quoteWords(p, quote, formatINR)
  const Icon = action?.icon
  const line = words.line ?? (words.disabled ? null : (action?.note ?? null))
  const day = perDay(p)
  const monthly = monthlyOf(p)
  const save = member ? savingWords(p, regular, formatINR) : null
  const off = member ? percentOff(p, regular) : 0
  return (
    <Card
      className={cn(
        'relative flex flex-col',
        member && 'border-0 text-foreground shadow-lg',
        highlight && !member && 'border-primary ring-2 ring-primary',
      )}
      style={member && highlight ? { boxShadow: `0 0 0 3px ${GOLD}, 0 10px 30px -10px ${GOLD}80` } : undefined}
    >
      {highlight && (
        <span
          className={cn(
            'absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-0.5 text-xs font-semibold',
            !member && 'bg-primary text-primary-foreground',
          )}
          style={member ? { backgroundColor: GOLD, color: NAVY } : undefined}
        >
          Most popular
        </span>
      )}
      <CardContent className="flex flex-1 flex-col gap-4 p-5">
        <div>
          <p className="flex items-center gap-1.5 text-lg font-semibold">
            {member && <Gem className="size-4 shrink-0" style={{ color: GOLD }} aria-hidden />}
            {p.name}
          </p>
          {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
        </div>
        <div>
          <p className="text-3xl font-bold tabular-nums">
            {formatINR(monthly)}
            <span className="whitespace-nowrap text-sm font-normal text-muted-foreground">
              {' '}/month <span className="font-semibold text-foreground">+ 18% GST</span>
            </span>
          </p>
          {regular && monthlyOf(regular) > monthly && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span>
                Regular <span className="line-through">{formatINR(monthlyOf(regular))}</span>
                {off > 0 && <span className="font-semibold text-success"> · {off}% off</span>}
              </span>
              {save && <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-semibold text-success">{save}</span>}
            </p>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
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
        {buttons && (
          <div className="mt-auto flex flex-col gap-1.5">
            <Button
              variant={highlight ? 'default' : 'outline'}
              className={action && !words.disabled ? action.className : undefined}
              onClick={() => onChoose(p, quote, list)}
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
        )}
      </CardContent>
    </Card>
  )
}

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
                      {p.name.replace(/^Diamond /, '')}
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
            <p className="border-t border-border px-3 py-2 text-center text-xs text-muted-foreground">
              The same for the regular and the IPC Diamond plans: only the price differs.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
