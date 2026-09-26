import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type {
  MessageCategory,
  MessageStatus,
  PlatformPrice,
  PlatformRechargeRequest,
  PlatformWallet,
  RechargeStatus,
  SaveWhatsappTemplate,
  TemplateStatus,
  WhatsappTemplate,
} from '@ipc/contracts'
import { formatPaise, messagePricePaise, templatePlaceholderCount } from '@ipc/domain'
import { PlatformPage } from '@/shared/layout/PlatformPage'
import { PageHeader } from '@/shared/layout/page-header'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input, Label, Select, Textarea } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { StatusBadge } from '@/shared/ui/status-badge'
import { StatCard } from '@/shared/ui/stat-card'
import {
  useAdjustWallet,
  useCreditWallet,
  usePlatformMargin,
  usePlatformMessagingStatus,
  usePlatformOutbox,
  usePlatformPrices,
  usePlatformRequests,
  usePlatformTemplates,
  usePlatformWallets,
  useRejectRecharge,
  useSaveTemplate,
  useSetOverdraft,
  useSetPrice,
} from '@/features/messaging/api'

export function PlatformMessagingPage() {
  return (
    <PlatformPage>
      <Console />
    </PlatformPage>
  )
}

type Tab = 'wallets' | 'requests' | 'prices' | 'templates' | 'messages' | 'margin'

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })

/** "12.50" rupees typed by a person, to paise. NaN when it is not a number. */
const toPaise = (rupees: string) => (rupees.trim() === '' ? Number.NaN : Math.round(Number(rupees) * 100))

function Console() {
  const [tab, setTab] = useState<Tab>('requests')
  const pending = usePlatformRequests('pending')
  const status = usePlatformMessagingStatus()
  const [credit, setCredit] = useState<{ wallet?: PlatformWallet; request?: PlatformRechargeRequest } | null>(null)

  return (
    <>
      <PageHeader title="Messaging" description="Studio wallets, recharges, prices and WhatsApp templates." />
      {status.data && (!status.data.whatsapp_live || !status.data.webhook_signed) && (
        <p className="mb-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          {!status.data.whatsapp_live
            ? 'WhatsApp is not connected: set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN. Until then every WhatsApp message fails and is refunded.'
            : 'Delivery receipts are ignored until META_APP_SECRET is set.'}
        </p>
      )}
      <div className="max-w-full overflow-x-auto">
        <FilterTabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'requests', label: 'Requests', count: pending.data?.length },
            { value: 'wallets', label: 'Wallets' },
            { value: 'prices', label: 'Prices' },
            { value: 'templates', label: 'Templates' },
            { value: 'messages', label: 'Messages' },
            { value: 'margin', label: 'Margin' },
          ]}
        />
      </div>
      <div className="mt-4">
        {tab === 'requests' && <Requests onCredit={(request) => setCredit({ request })} />}
        {tab === 'wallets' && <Wallets onCredit={(wallet) => setCredit({ wallet })} />}
        {tab === 'prices' && <Prices />}
        {tab === 'templates' && <Templates />}
        {tab === 'messages' && <Messages />}
        {tab === 'margin' && <Margin />}
      </div>
      {credit && <CreditDialog {...credit} onClose={() => setCredit(null)} />}
    </>
  )
}

function Loading<T>({ q, empty, children }: { q: { isLoading: boolean; isError: boolean; data?: T[] | undefined; refetch: () => unknown }; empty: string; children: (rows: T[]) => ReactNode }) {
  if (q.isLoading) return <SkeletonList rows={4} />
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />
  if (!q.data?.length) return <EmptyState title={empty} />
  return <>{children(q.data)}</>
}

// ── requests ─────────────────────────────────────────────────────

const REQ_TONE = { pending: 'warning', fulfilled: 'success', rejected: 'danger', cancelled: 'neutral' } as const
const REQ_LABEL: Record<RechargeStatus, string> = { pending: 'Waiting', fulfilled: 'Credited', rejected: 'Closed', cancelled: 'Cancelled' }

function Requests({ onCredit }: { onCredit: (r: PlatformRechargeRequest) => void }) {
  const [status, setStatus] = useState<RechargeStatus | 'all'>('pending')
  const q = usePlatformRequests(status === 'all' ? null : status)
  const reject = useRejectRecharge()
  return (
    <>
      <FilterTabs
        className="mb-3"
        value={status}
        onChange={setStatus}
        tabs={[
          { value: 'pending', label: 'Waiting' },
          { value: 'all', label: 'All' },
        ]}
      />
      <Loading q={q} empty="No recharge requests">
        {(rows) => (
          <div className="flex flex-col gap-3">
            {rows.map((r) => (
              <Card key={r.id}>
                <CardContent className="flex flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {r.company_name} · {formatPaise(r.amount_paise)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {when(r.created_at)}
                        {r.requested_by_name ? ` · by ${r.requested_by_name}` : ''} · balance {formatPaise(r.balance_paise)}
                      </p>
                    </div>
                    <StatusBadge tone={REQ_TONE[r.status]}>{REQ_LABEL[r.status]}</StatusBadge>
                  </div>
                  {r.note && <p className="text-sm">“{r.note}”</p>}
                  {r.admin_note && <p className="text-xs text-muted-foreground">Our note: {r.admin_note}</p>}
                  {r.status === 'pending' && (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => onCredit(r)}>
                        Credit wallet
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={reject.isPending}
                        onClick={() => {
                          const note = window.prompt('Why is this request being closed? The studio sees this.') ?? null
                          if (note !== null) reject.mutate({ id: r.id, note })
                        }}
                      >
                        Close without credit
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Loading>
    </>
  )
}

function CreditDialog({ wallet, request, onClose }: { wallet?: PlatformWallet; request?: PlatformRechargeRequest; onClose: () => void }) {
  const credit = useCreditWallet()
  const [amount, setAmount] = useState(request ? String(request.amount_paise / 100) : '')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const companyId = request?.company_id ?? wallet?.company_id ?? ''
  const name = request?.company_name ?? wallet?.company_name ?? ''
  const paise = toPaise(amount)
  const valid = Number.isFinite(paise) && paise > 0 && paise <= 10000000 && reference.trim().length > 0

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    credit.mutate(
      {
        company_id: companyId,
        amount_paise: paise,
        reference: reference.trim(),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(request ? { request_id: request.id } : {}),
      },
      { onSuccess: onClose },
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Credit ${name}`} description="Only after the money has reached our account.">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <Label htmlFor="credit-amount">Amount (₹)</Label>
            <Input id="credit-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="credit-ref">Payment reference</Label>
            <Input id="credit-ref" value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} placeholder="UTR or receipt number" className="mt-1" />
          </div>
          <div>
            <Label htmlFor="credit-note">Note (optional)</Label>
            <Input id="credit-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className="mt-1" />
          </div>
          <Button type="submit" disabled={!valid || credit.isPending}>
            Credit {Number.isFinite(paise) && paise > 0 ? formatPaise(paise) : ''}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── wallets ──────────────────────────────────────────────────────

function Wallets({ onCredit }: { onCredit: (w: PlatformWallet) => void }) {
  const q = usePlatformWallets()
  const [search, setSearch] = useState('')
  const [adjust, setAdjust] = useState<PlatformWallet | null>(null)
  const [overdraft, setOverdraft] = useState<PlatformWallet | null>(null)
  const rows = useMemo(
    () => (q.data ?? []).filter((w) => w.company_name.toLowerCase().includes(search.trim().toLowerCase())),
    [q.data, search],
  )
  const total = (q.data ?? []).reduce((s, w) => s + w.balance_paise, 0)
  const month = (q.data ?? []).reduce((s, w) => s + w.month_charged_paise, 0)

  return (
    <>
      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <StatCard label="Held in all wallets" value={formatPaise(total)} />
        <StatCard label="Charged this month" value={formatPaise(month)} />
      </div>
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search studios" aria-label="Search studios" className="mb-3 sm:max-w-xs" />
      <Loading q={{ ...q, data: rows }} empty="No studios">
        {(list) => (
          <div className="flex flex-col gap-2">
            {list.map((w) => (
              <Card key={w.company_id}>
                <CardContent className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{w.company_name}</p>
                    <p className="text-xs text-muted-foreground">
                      This month: {w.month_whatsapp} WhatsApp · {w.month_emails} emails · {formatPaise(w.month_charged_paise)}
                      {w.overdraft_paise > 0 ? ` · overdraft ${formatPaise(w.overdraft_paise)}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`font-semibold tabular-nums ${w.balance_paise < w.low_balance_paise ? 'text-warning' : ''}`}>{formatPaise(w.balance_paise)}</span>
                    {w.pending_requests > 0 && <StatusBadge tone="warning">Request waiting</StatusBadge>}
                    <Button size="sm" variant="outline" onClick={() => onCredit(w)}>
                      Credit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setAdjust(w)}>
                      Adjust
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setOverdraft(w)}>
                      Overdraft
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Loading>
      {adjust && <AdjustDialog wallet={adjust} onClose={() => setAdjust(null)} />}
      {overdraft && <OverdraftDialog wallet={overdraft} onClose={() => setOverdraft(null)} />}
    </>
  )
}

function AdjustDialog({ wallet, onClose }: { wallet: PlatformWallet; onClose: () => void }) {
  const adjust = useAdjustWallet()
  const [dir, setDir] = useState<'add' | 'take'>('add')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const paise = toPaise(amount)
  const valid = Number.isFinite(paise) && paise > 0 && paise <= 10000000 && note.trim().length > 0
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Adjust ${wallet.company_name}`} description={`Balance now ${formatPaise(wallet.balance_paise)}. The reason is kept in the history.`}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) adjust.mutate({ company_id: wallet.company_id, amount_paise: dir === 'add' ? paise : -paise, note: note.trim() }, { onSuccess: onClose })
          }}
        >
          <FilterTabs value={dir} onChange={setDir} tabs={[{ value: 'add', label: 'Add' }, { value: 'take', label: 'Take away' }]} />
          <div>
            <Label htmlFor="adj-amount">Amount (₹)</Label>
            <Input id="adj-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="adj-note">Reason</Label>
            <Input id="adj-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className="mt-1" placeholder="Goodwill credit, wrong charge…" />
          </div>
          <Button type="submit" disabled={!valid || adjust.isPending}>
            Save adjustment
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function OverdraftDialog({ wallet, onClose }: { wallet: PlatformWallet; onClose: () => void }) {
  const set = useSetOverdraft()
  const [amount, setAmount] = useState(String(wallet.overdraft_paise / 100))
  const paise = toPaise(amount)
  const valid = Number.isFinite(paise) && paise >= 0 && paise <= 100000
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Overdraft for ${wallet.company_name}`} description="How far below ₹0 messages may still go out. 0 means never below zero.">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) set.mutate({ company_id: wallet.company_id, overdraft_paise: paise }, { onSuccess: onClose })
          }}
        >
          <div>
            <Label htmlFor="od-amount">Overdraft (₹0 to ₹1,000)</Label>
            <Input id="od-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1" />
          </div>
          <Button type="submit" disabled={!valid || set.isPending}>
            Save
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── prices ───────────────────────────────────────────────────────

const PRICE_ROWS: ReadonlyArray<{ channel: 'whatsapp' | 'email'; category: MessageCategory; label: string }> = [
  { channel: 'whatsapp', category: 'utility', label: 'WhatsApp · utility' },
  { channel: 'whatsapp', category: 'marketing', label: 'WhatsApp · marketing' },
  { channel: 'whatsapp', category: 'authentication', label: 'WhatsApp · authentication' },
  { channel: 'email', category: 'email', label: 'Email' },
]

function Prices() {
  const q = usePlatformPrices()
  if (q.isLoading) return <SkeletonList rows={4} />
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />
  const all = q.data ?? []
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">Studios see only the final price. A change applies to messages sent from now on.</p>
      {PRICE_ROWS.map((r) => (
        <PriceEditor key={r.category} label={r.label} channel={r.channel} category={r.category} current={all.find((p) => p.category === r.category)} history={all.filter((p) => p.category === r.category)} />
      ))}
    </div>
  )
}

function PriceEditor({ label, channel, category, current, history }: { label: string; channel: 'whatsapp' | 'email'; category: MessageCategory; current: PlatformPrice | undefined; history: PlatformPrice[] }) {
  const save = useSetPrice()
  const [cost, setCost] = useState(String(current?.meta_cost_paise ?? 0))
  const [pct, setPct] = useState(String(current?.markup_pct ?? 0))
  const [fixed, setFixed] = useState(String(current?.markup_fixed_paise ?? 0))
  const [free, setFree] = useState(String(current?.free_monthly ?? 0))
  const n = { cost: Number(cost), pct: Number(pct), fixed: Number(fixed), free: Number(free) }
  const valid =
    Number.isInteger(n.cost) && n.cost >= 0 && Number.isFinite(n.pct) && n.pct >= 0 && n.pct <= 1000 &&
    Number.isInteger(n.fixed) && n.fixed >= 0 && Number.isInteger(n.free) && n.free >= 0
  const price = valid ? messagePricePaise({ meta_cost_paise: n.cost, markup_pct: n.pct, markup_fixed_paise: n.fixed }) : null
  const [showHistory, setShowHistory] = useState(false)

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-semibold">{label}</p>
          <p className="text-sm">
            Studio pays <span className="font-semibold tabular-nums">{price !== null ? formatPaise(price) : '—'}</span>
            {price !== null && <span className="text-muted-foreground"> · margin {formatPaise(price - n.cost)}</span>}
          </p>
        </div>
        <form
          className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) save.mutate({ channel, category, meta_cost_paise: n.cost, markup_pct: n.pct, markup_fixed_paise: n.fixed, ...(channel === 'email' ? { free_monthly: n.free } : {}) })
          }}
        >
          <div>
            <Label htmlFor={`${category}-cost`}>{channel === 'email' ? 'Provider cost (paise)' : 'Meta cost (paise)'}</Label>
            <Input id={`${category}-cost`} inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor={`${category}-pct`}>Markup %</Label>
            <Input id={`${category}-pct`} inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor={`${category}-fixed`}>Plus (paise)</Label>
            <Input id={`${category}-fixed`} inputMode="numeric" value={fixed} onChange={(e) => setFixed(e.target.value)} className="mt-1" />
          </div>
          {channel === 'email' ? (
            <div>
              <Label htmlFor={`${category}-free`}>Free a month</Label>
              <Input id={`${category}-free`} inputMode="numeric" value={free} onChange={(e) => setFree(e.target.value)} className="mt-1" />
            </div>
          ) : (
            <div className="hidden sm:block" />
          )}
          <Button type="submit" disabled={!valid || save.isPending}>
            Save
          </Button>
        </form>
        {history.length > 1 && (
          <div>
            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setShowHistory((s) => !s)}>
              {showHistory ? 'Hide' : 'Show'} earlier prices ({history.length - 1})
            </Button>
            {showHistory && (
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {history.slice(1).map((h) => (
                  <li key={h.id}>
                    From {when(h.effective_from)}: cost {h.meta_cost_paise}p + {h.markup_pct}% + {h.markup_fixed_paise}p = {formatPaise(h.price_paise)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── templates ────────────────────────────────────────────────────

const TPL_TONE = { approved: 'success', pending: 'warning', rejected: 'danger', paused: 'neutral' } as const

function Templates() {
  const q = usePlatformTemplates()
  const [edit, setEdit] = useState<WhatsappTemplate | 'new' | null>(null)
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Create each template in WhatsApp Manager first, then mark it approved here once Meta approves it.</p>
        <Button size="sm" onClick={() => setEdit('new')}>
          New template
        </Button>
      </div>
      <Loading q={q} empty="No templates">
        {(rows) => (
          <div className="flex flex-col gap-3">
            {rows.map((t) => (
              <Card key={t.id}>
                <CardContent className="flex flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{t.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.meta_template_name} · {t.language} · {t.category}
                      </p>
                    </div>
                    <StatusBadge tone={TPL_TONE[t.status]} className="capitalize">{t.status}</StatusBadge>
                  </div>
                  <p className="whitespace-pre-wrap rounded-md bg-muted p-2 text-sm">{t.body}</p>
                  {t.variables.length > 0 && (
                    <p className="text-xs text-muted-foreground">{t.variables.map((v, i) => `{{${i + 1}}} ${v}`).join(' · ')}</p>
                  )}
                  <Button size="sm" variant="outline" className="self-start" onClick={() => setEdit(t)}>
                    Edit
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Loading>
      {edit && <TemplateDialog template={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  )
}

function TemplateDialog({ template, onClose }: { template: WhatsappTemplate | null; onClose: () => void }) {
  const save = useSaveTemplate()
  const [v, setV] = useState<SaveWhatsappTemplate>(() => ({
    key: template?.key ?? '',
    name: template?.name ?? '',
    meta_template_name: template?.meta_template_name ?? '',
    language: template?.language ?? 'en',
    category: template?.category ?? 'utility',
    body: template?.body ?? '',
    variables: template?.variables ?? [],
    status: template?.status ?? 'pending',
  }))
  const set = <K extends keyof SaveWhatsappTemplate>(k: K, val: SaveWhatsappTemplate[K]) => setV((s) => ({ ...s, [k]: val }))
  const placeholders = templatePlaceholderCount(v.body)
  const valid = /^[a-z0-9_]{2,60}$/.test(v.key) && v.name.trim() && /^[a-z0-9_]{1,250}$/.test(v.meta_template_name) && v.body.trim()

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={template ? `Edit ${template.name}` : 'New template'}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) save.mutate({ ...v, variables: v.variables.slice(0, placeholders) }, { onSuccess: onClose })
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="tpl-key">Key</Label>
              <Input id="tpl-key" value={v.key} disabled={!!template} onChange={(e) => set('key', e.target.value)} className="mt-1" placeholder="payment_due" />
            </div>
            <div>
              <Label htmlFor="tpl-name">Name</Label>
              <Input id="tpl-name" value={v.name} onChange={(e) => set('name', e.target.value)} className="mt-1" />
            </div>
            <div className="col-span-2">
              <Label htmlFor="tpl-meta">Name in WhatsApp Manager</Label>
              <Input id="tpl-meta" value={v.meta_template_name} onChange={(e) => set('meta_template_name', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="tpl-lang">Language</Label>
              <Input id="tpl-lang" value={v.language} onChange={(e) => set('language', e.target.value)} className="mt-1" placeholder="en" />
            </div>
            <div>
              <Label htmlFor="tpl-cat">Category</Label>
              <Select id="tpl-cat" value={v.category} onChange={(e) => set('category', e.target.value as SaveWhatsappTemplate['category'])} className="mt-1">
                <option value="utility">Utility</option>
                <option value="marketing">Marketing</option>
                <option value="authentication">Authentication</option>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="tpl-body">Message (use {'{{1}}'}, {'{{2}}'}… for the values)</Label>
            <Textarea id="tpl-body" rows={4} value={v.body} onChange={(e) => set('body', e.target.value)} className="mt-1" />
          </div>
          {Array.from({ length: placeholders }, (_, i) => (
            <div key={i}>
              <Label htmlFor={`tpl-var-${i}`}>What {`{{${i + 1}}}`} means</Label>
              <Input
                id={`tpl-var-${i}`}
                value={v.variables[i] ?? ''}
                onChange={(e) => {
                  const next = [...v.variables]
                  next[i] = e.target.value
                  set('variables', next)
                }}
                className="mt-1"
              />
            </div>
          ))}
          <div>
            <Label htmlFor="tpl-status">Status at Meta</Label>
            <Select id="tpl-status" value={v.status} onChange={(e) => set('status', e.target.value as TemplateStatus)} className="mt-1">
              <option value="pending">Pending (not sent)</option>
              <option value="approved">Approved (sends)</option>
              <option value="rejected">Rejected</option>
              <option value="paused">Paused</option>
            </Select>
          </div>
          <Button type="submit" disabled={!valid || save.isPending}>
            Save template
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── messages ─────────────────────────────────────────────────────

const MSG_FILTERS: ReadonlyArray<{ value: MessageStatus | 'all'; label: string }> = [
  { value: 'failed', label: 'Failed' },
  { value: 'skipped_no_balance', label: 'No balance' },
  { value: 'queued', label: 'Waiting' },
  { value: 'all', label: 'All' },
]

function Messages() {
  const [status, setStatus] = useState<MessageStatus | 'all'>('failed')
  const q = usePlatformOutbox(status === 'all' ? null : status)
  return (
    <>
      <div className="mb-3 max-w-full overflow-x-auto">
        <FilterTabs value={status} onChange={setStatus} tabs={MSG_FILTERS} />
      </div>
      <Loading q={q} empty="Nothing here">
        {(rows) => (
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {rows.map((m) => (
                <div key={m.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {m.company_name} · {m.channel === 'whatsapp' ? 'WhatsApp' : 'Email'} · {m.template_key ?? 'message'}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {when(m.created_at)} · {m.to_address}
                      {m.error ? ` · ${m.error}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs">
                    {m.cost_paise > 0 && <span className="tabular-nums">{formatPaise(m.cost_paise)}{m.refunded ? ' refunded' : ''}</span>}
                    <StatusBadge className="capitalize">{m.status.replace(/_/g, ' ')}</StatusBadge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </Loading>
    </>
  )
}

// ── margin ───────────────────────────────────────────────────────

function Margin() {
  const [months, setMonths] = useState(6)
  const q = usePlatformMargin(months)
  const rows = q.data ?? []
  const sum = (k: 'charged_paise' | 'cost_paise' | 'margin_paise') => rows.reduce((s, r) => s + r[k], 0)
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="margin-months">Period</Label>
          <Select id="margin-months" value={String(months)} onChange={(e) => setMonths(Number(e.target.value))} className="mt-1 w-40">
            <option value="1">This month</option>
            <option value="3">3 months</option>
            <option value="6">6 months</option>
            <option value="12">12 months</option>
          </Select>
        </div>
      </div>
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <StatCard label="Charged to studios" value={formatPaise(sum('charged_paise'))} />
        <StatCard label="Meta and email cost" value={formatPaise(sum('cost_paise'))} />
        <StatCard label="Margin" value={formatPaise(sum('margin_paise'))} />
      </div>
      <Loading q={q} empty="No messages sent in this period">
        {(list) => (
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {list.map((r) => (
                <div key={`${r.month}-${r.channel}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span className="font-medium">
                    {r.month} · {r.channel === 'whatsapp' ? 'WhatsApp' : 'Email'} · {r.messages.toLocaleString('en-IN')}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatPaise(r.charged_paise)} − {formatPaise(r.cost_paise)} = <span className="font-semibold text-foreground">{formatPaise(r.margin_paise)}</span>
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </Loading>
    </>
  )
}
