import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Download, Mail, MessageCircle, Wallet } from 'lucide-react'
import {
  MESSAGING_EVENTS,
  type LedgerEntry,
  type LedgerSource,
  type MessageStatus,
  type MessagingSummary,
  type OutboxMessage,
  type RechargeStatus,
} from '@ipc/contracts'
import { formatPaise, freeEmailsLeft, messagesLeft } from '@ipc/domain'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { SettingsTabs } from '@/features/settings/SettingsTabs'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatCard } from '@/shared/ui/stat-card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { Switch } from '@/shared/ui/switch'
import { RecordCard, RecordCards } from '@/shared/ui/record-card'
import { downloadCsv, toCsv } from '@/shared/ui/csv'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { cn } from '@/shared/ui/cn'
import {
  useCancelRecharge,
  useLedger,
  useMessaging,
  useRequestRecharge,
  useSaveMessagingSettings,
  useSendTest,
} from '@/features/messaging/api'

export function MessagingSettingsPage() {
  return (
    <AuthedPage module="settings">
      <Messaging />
    </AuthedPage>
  )
}

const STATUS: Record<MessageStatus, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  queued: { label: 'Waiting', tone: 'neutral' },
  sending: { label: 'Sending', tone: 'info' },
  sent: { label: 'Sent', tone: 'info' },
  delivered: { label: 'Delivered', tone: 'success' },
  read: { label: 'Read', tone: 'success' },
  failed: { label: 'Not sent', tone: 'danger' },
  skipped_no_balance: { label: 'Recharge to send', tone: 'warning' },
  skipped_opt_out: { label: 'Opted out', tone: 'neutral' },
  skipped_limit: { label: 'Monthly limit reached', tone: 'warning' },
}

const REQUEST: Record<RechargeStatus, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }> = {
  pending: { label: 'Waiting', tone: 'warning' },
  fulfilled: { label: 'Added', tone: 'success' },
  rejected: { label: 'Not added', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

export const SOURCE_LABEL: Record<LedgerSource, string> = {
  recharge_manual: 'Recharge',
  razorpay: 'Online payment',
  whatsapp: 'WhatsApp message',
  email: 'Email',
  adjustment: 'Adjustment',
  refund: 'Refund',
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })

function Section({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('mt-8', className)}>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Messaging() {
  const { session } = useAuth()
  const q = useMessaging()

  if (!session?.is_owner) {
    return (
      <>
        <PageHeader title="Messaging" />
        <SettingsTabs />
        <EmptyState title="Only the studio owner can see this" description="The messaging wallet is the studio's money." />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Messaging"
        description={
          q.data && !q.data.whatsapp_enabled
            ? 'Emails to your team and clients, paid from your messaging wallet.'
            : 'WhatsApp and email to your team, paid from your messaging wallet.'
        }
      />
      <SettingsTabs />
      {q.isLoading ? (
        <SkeletonCards />
      ) : q.isError || !q.data ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (
        <Loaded data={q.data} />
      )}
    </>
  )
}

function Loaded({ data }: { data: MessagingSummary }) {
  const wa = data.whatsapp_enabled
  const whatsappPrice = data.prices.find((p) => p.channel === 'whatsapp' && p.category === 'utility')
  const emailPrice = data.prices.find((p) => p.channel === 'email')
  const u = data.usage
  const notSent = u.skipped_no_balance + u.skipped_limit
  return (
    <>
      {data.wallet.low && (
        <div role="alert" className="mb-4 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p>
            Your balance is low ({formatPaise(data.wallet.balance_paise)}). Recharge so your messages keep going out.
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <BalanceCard data={data} pricePaise={(wa ? whatsappPrice : emailPrice)?.price_paise ?? 0} />
        <RechargeCard data={data} />
      </div>

      <Section title="This month" description="Messages sent for your studio since the 1st.">
        <div className={cn('grid gap-3', wa ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
          {wa && (
            <StatCard
              label="WhatsApp"
              icon={MessageCircle}
              value={`${u.whatsapp_count} sent`}
              hint={`${formatPaise(u.whatsapp_paise)} used`}
            />
          )}
          <StatCard
            label="Emails"
            icon={Mail}
            value={`${u.email_month_count.toLocaleString('en-IN')} sent`}
            hint={`${freeEmailsLeft(u.email_free_used, u.email_free_monthly)} of ${u.email_free_monthly} free left${
              u.email_charged_count ? ` · ${formatPaise(u.email_paise)} used` : ''
            } · limit ${u.email_monthly_cap.toLocaleString('en-IN')} a month`}
          />
          <StatCard
            label="Not sent"
            icon={AlertTriangle}
            value={notSent}
            hint={
              u.skipped_limit
                ? `${u.skipped_limit} over the monthly limit, ${u.skipped_no_balance} for low balance`
                : 'Skipped because the balance was too low'
            }
          />
        </div>
      </Section>

      <EventsSection data={data} />

      <Section title="Prices" description="What your studio pays. Nothing else is added.">
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {wa && (
              <PriceRow label="WhatsApp message" value={whatsappPrice ? `${formatPaise(whatsappPrice.price_paise)} each` : 'Not set yet'} />
            )}
            <PriceRow
              label="Email"
              value={
                emailPrice
                  ? `${emailPrice.free_monthly} free a month, then ${formatPaise(emailPrice.price_paise)} each`
                  : 'Not set yet'
              }
            />
            <PriceRow label="Emails a month" value={`Up to ${u.email_monthly_cap.toLocaleString('en-IN')}`} />
            <PriceRow label="Failed or skipped messages" value="Free. Any charge is returned." />
          </CardContent>
        </Card>
      </Section>

      <RecentSection recent={data.recent} />
      <LedgerSection whatsapp={wa} />
    </>
  )
}

function PriceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
      <span>{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
}

function BalanceCard({ data, pricePaise }: { data: MessagingSummary; pricePaise: number }) {
  const save = useSaveMessagingSettings()
  const [low, setLow] = useState(String(data.wallet.low_balance_paise / 100))
  useEffect(() => setLow(String(data.wallet.low_balance_paise / 100)), [data.wallet.low_balance_paise])
  const left = messagesLeft(data.wallet.balance_paise, pricePaise)
  const lowPaise = Math.round(Number(low) * 100)
  const lowValid = Number.isFinite(lowPaise) && lowPaise >= 0 && lowPaise <= 10000000

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Wallet balance</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">{formatPaise(data.wallet.balance_paise)}</p>
            {pricePaise > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Enough for about {Number.isFinite(left) ? left.toLocaleString('en-IN') : 'unlimited'}{' '}
                {data.whatsapp_enabled ? 'WhatsApp messages' : 'paid emails'}
              </p>
            )}
          </div>
          <span className="rounded-md bg-primary/10 p-2 text-primary">
            <Wallet className="size-5" aria-hidden />
          </span>
        </div>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (lowValid) save.mutate({ low_balance_paise: lowPaise })
          }}
        >
          <div className="min-w-0 flex-1">
            <Label htmlFor="low-balance">Warn me below (₹)</Label>
            <Input id="low-balance" inputMode="decimal" value={low} onChange={(e) => setLow(e.target.value)} className="mt-1" />
          </div>
          <Button type="submit" variant="outline" disabled={!lowValid || save.isPending || lowPaise === data.wallet.low_balance_paise}>
            Save
          </Button>
        </form>
        {data.whatsapp_enabled && !data.wallet.whatsapp_live && (
          <p className="text-xs text-muted-foreground">WhatsApp sending is not switched on for the platform yet. Nothing is charged until it is.</p>
        )}
      </CardContent>
    </Card>
  )
}

const CHIPS = [50000, 100000, 200000]

function RechargeCard({ data }: { data: MessagingSummary }) {
  const ask = useRequestRecharge()
  const cancel = useCancelRecharge()
  const [amount, setAmount] = useState<number | 'custom'>(100000)
  const [custom, setCustom] = useState('')
  const [note, setNote] = useState('')
  const pending = data.requests.find((r) => r.status === 'pending')
  const latest = data.requests[0]
  const paise = amount === 'custom' ? Math.round(Number(custom) * 100) : amount
  const valid = Number.isFinite(paise) && paise >= 10000 && paise <= 10000000

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div>
          <p className="font-medium">Add money</p>
          <p className="text-sm text-muted-foreground">Pay the IPC Studios team, then send a request. We add it to your wallet once the payment is confirmed.</p>
        </div>
        {pending ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
            <span>
              {formatPaise(pending.amount_paise)} requested on {when(pending.created_at)}
            </span>
            <span className="flex items-center gap-2">
              <StatusBadge tone="warning">Waiting</StatusBadge>
              <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(pending.id)}>
                Cancel
              </Button>
            </span>
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (!valid) return
              ask.mutate(
                { amount_paise: paise, ...(note.trim() ? { note: note.trim() } : {}) },
                { onSuccess: () => { setNote(''); setCustom('') } },
              )
            }}
          >
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Amount">
              {CHIPS.map((c) => (
                <Button key={c} type="button" size="sm" role="radio" aria-checked={amount === c} variant={amount === c ? 'default' : 'outline'} onClick={() => setAmount(c)}>
                  {formatPaise(c)}
                </Button>
              ))}
              <Button type="button" size="sm" role="radio" aria-checked={amount === 'custom'} variant={amount === 'custom' ? 'default' : 'outline'} onClick={() => setAmount('custom')}>
                Other
              </Button>
            </div>
            {amount === 'custom' && (
              <div>
                <Label htmlFor="recharge-amount">Amount (₹100 to ₹1,00,000)</Label>
                <Input id="recharge-amount" inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value)} className="mt-1" placeholder="1500" />
              </div>
            )}
            <div>
              <Label htmlFor="recharge-note">Payment note (optional)</Label>
              <Input id="recharge-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} className="mt-1" placeholder="UPI reference or how you paid" />
            </div>
            <Button type="submit" disabled={!valid || ask.isPending} className="self-start">
              Request {valid ? formatPaise(paise) : 'recharge'}
            </Button>
          </form>
        )}
        {!pending && latest && latest.status !== 'pending' && (
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            Last request: {formatPaise(latest.amount_paise)} <StatusBadge tone={REQUEST[latest.status].tone}>{REQUEST[latest.status].label}</StatusBadge>
            {latest.admin_note && <span>· {latest.admin_note}</span>}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function EventsSection({ data }: { data: MessagingSummary }) {
  const save = useSaveMessagingSettings()
  const test = useSendTest()
  const [local, setLocal] = useState(data.settings)
  useEffect(() => setLocal(data.settings), [data.settings])

  const flip = (event: (typeof data.settings)[number]['event'], channel: 'whatsapp' | 'email', on: boolean) => {
    const next = local.map((s) => (s.event === event ? { ...s, [channel]: on } : s))
    setLocal(next)
    const row = next.find((s) => s.event === event)!
    save.mutate({ events: [row] }, { onError: () => setLocal(data.settings) })
  }

  const wa = data.whatsapp_enabled
  return (
    <Section
      title="What gets sent"
      description={
        wa
          ? "A copy of these alerts goes to the person's WhatsApp or email. All are off until you switch them on."
          : 'A copy of these alerts goes to the person by email. All are off until you switch them on.'
      }
    >
      <Card>
        <CardContent className="divide-y divide-border p-0">
          {MESSAGING_EVENTS.map((e) => {
            const s = local.find((x) => x.event === e.key) ?? { event: e.key, whatsapp: false, email: false }
            return (
              <div key={e.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium">{e.label}</p>
                  <p className="text-sm text-muted-foreground">{e.detail}</p>
                </div>
                <div className="flex shrink-0 gap-6">
                  {wa && !e.emailOnly && (
                    <Switch label="WhatsApp" checked={s.whatsapp} disabled={save.isPending} onChange={(on) => flip(e.key, 'whatsapp', on)} className="w-auto" />
                  )}
                  <Switch label="Email" checked={s.email} disabled={save.isPending} onChange={(on) => flip(e.key, 'email', on)} className="w-auto" />
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
      <div className="mt-3 flex flex-wrap gap-2">
        {wa && (
          <Button variant="outline" size="sm" disabled={test.isPending} onClick={() => test.mutate('whatsapp')}>
            <MessageCircle aria-hidden /> Send me a test WhatsApp
          </Button>
        )}
        <Button variant="outline" size="sm" disabled={test.isPending} onClick={() => test.mutate('email')}>
          <Mail aria-hidden /> Send me a test email
        </Button>
      </div>
    </Section>
  )
}

function RecentSection({ recent }: { recent: OutboxMessage[] }) {
  return (
    <Section title="Recent messages" description="The last 25 messages for your studio.">
      {!recent.length ? (
        <EmptyState title="No messages yet" description="Switch on an alert above and messages show up here." />
      ) : (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {recent.map((m) => (
              <div key={m.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {m.channel === 'whatsapp' ? 'WhatsApp' : 'Email'} to {m.to_address}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {when(m.created_at)}
                    {m.subject ? ` · ${m.subject}` : ''}
                    {m.error && m.status !== 'skipped_no_balance' ? ` · ${m.error}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {m.cost_paise > 0 && (
                    <span className={cn('tabular-nums text-xs', m.refunded && 'line-through text-muted-foreground')}>{formatPaise(m.cost_paise)}</span>
                  )}
                  <StatusBadge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</StatusBadge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </Section>
  )
}

function LedgerSection({ whatsapp }: { whatsapp: boolean }) {
  const [source, setSource] = useState<LedgerSource | ''>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const q = useLedger({ source, from, to })
  const isMobile = useIsMobile()
  const rows = q.data ?? []

  const csv = () =>
    downloadCsv(
      'wallet-history.csv',
      toCsv(
        ['Date', 'Type', 'Amount (₹)', 'Balance after (₹)', 'Reference', 'Note'],
        rows.map((r) => [
          new Date(r.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
          SOURCE_LABEL[r.source],
          ((r.kind === 'credit' ? 1 : -1) * r.amount_paise) / 100,
          r.balance_after / 100,
          r.reference,
          r.note,
        ]),
      ),
    )

  return (
    <Section title="Wallet history" description="Every rupee in and out.">
      <div className="mb-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
        <div className="col-span-2 sm:w-48">
          <Label htmlFor="ledger-source">Type</Label>
          <Select id="ledger-source" value={source} onChange={(e) => setSource(e.target.value as LedgerSource | '')} className="mt-1">
            <option value="">Everything</option>
            {(Object.keys(SOURCE_LABEL) as LedgerSource[]).filter((s) => whatsapp || s !== 'whatsapp').map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ledger-from">From</Label>
          <Input id="ledger-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="ledger-to">To</Label>
          <Input id="ledger-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1" />
        </div>
        <Button variant="outline" onClick={csv} disabled={!rows.length} className="col-span-2 sm:col-span-1">
          <Download aria-hidden /> Download CSV
        </Button>
      </div>
      {q.isLoading ? (
        <SkeletonCards />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : !rows.length ? (
        <EmptyState title="Nothing here yet" description="Recharges, messages and refunds show up here." />
      ) : isMobile ? (
        <RecordCards>
          {rows.map((r) => (
            <RecordCard
              key={r.id}
              title={SOURCE_LABEL[r.source]}
              subtitle={when(r.created_at)}
              badge={<Amount r={r} />}
              fields={[
                { label: 'Balance after', value: formatPaise(r.balance_after) },
                { label: 'Reference', value: r.reference ?? r.note ?? '—' },
              ]}
            />
          ))}
        </RecordCards>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 text-right font-medium">Balance after</th>
                  <th className="px-4 py-2 font-medium">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-4 py-2">{when(r.created_at)}</td>
                    <td className="px-4 py-2">{SOURCE_LABEL[r.source]}</td>
                    <td className="px-4 py-2 text-right"><Amount r={r} /></td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatPaise(r.balance_after)}</td>
                    <td className="max-w-64 truncate px-4 py-2 text-muted-foreground">{[r.reference, r.note].filter(Boolean).join(' · ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </Section>
  )
}

function Amount({ r }: { r: LedgerEntry }) {
  return (
    <span className={cn('font-medium tabular-nums', r.kind === 'credit' ? 'text-success' : 'text-foreground')}>
      {r.kind === 'credit' ? '+' : '−'}
      {formatPaise(r.amount_paise)}
    </span>
  )
}
