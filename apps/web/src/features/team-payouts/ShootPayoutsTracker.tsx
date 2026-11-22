import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { ChevronDown, CheckCircle, Clock, CalendarClock, Download, Filter, History, Undo2, Wallet } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { CREW_PAGE, crewPayouts, type CrewPayoutRow, type PayoutEntryType } from '@ipc/contracts'
import { callApi, ApiError } from '@/shared/api/client'
import { SectionTabs } from '@/shared/layout/section-tabs'
import { StatCard } from '@/shared/ui/stat-card'
import { Button } from '@/shared/ui/button'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { useUrlParam } from '@/shared/hooks/use-url-param'
import { Input, Label } from '@/shared/ui/input'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { ErrorState } from '@/shared/ui/states'
import { cn } from '@/shared/ui/cn'
import { todayInIndia } from '@/shared/ui/days-left'
import { downloadCsv, toCsv } from '@/shared/ui/csv'
import { Money, useINR } from '@/shared/money/MoneyMask'
import { PayToCard } from '@/features/team/PayToCard'
import { PaymentModePicker } from '@/features/settings/PaymentModePicker'
import { ProjectPicker } from '@/features/projects/ProjectPicker'
import { showingLine } from '@/features/tasks/open-pages'
import { usePayoutSettlements, useCreatePayoutSettlement } from './api'
import { useCrewPayoutsPage } from './pay'
import { CREW_VIEWS, crewPersonLine, crewPersonWords, crewRowLine, crewRowNote, crewRowsFor, crewViewOf, type ProjectCrewMoney } from './crew-view'

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

type SettlementEntry = {
  id: string
  slot_id: string
  entry_type: string
  amount_paid: number
  paid_date: string
  payment_mode: string | null
  payment_reference: string | null
  notes: string | null
  reverses_settlement_id?: string | null | undefined
}

/**
 * Crew money by when the shoot is: Owed now (shoots already done, minus what
 * has been paid), Upcoming (promised, not owed yet) and All. The headline is
 * the same sum the dashboard's "Who you owe" shows (one query on the server).
 *
 * A page at a time (speed check, 22 Nov): the server applies the view and
 * the filters and sends the first hundred rows, each person's totals over
 * the whole view, and Show more brings the next hundred. It used to send
 * every booking the studio ever made (3 MB for 7,500 bookings).
 */
export function ShootPayoutsTracker() {
  const inr = useINR()
  const [viewParam, setViewParam] = useUrlParam('view', 'owed')
  const view = crewViewOf(viewParam)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [project, setProject] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [limit, setLimit] = useState(CREW_PAGE)
  const [exporting, setExporting] = useState(false)

  // One request per pause in typing, not one per letter.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])
  // Another view or filter starts again from the first page.
  useEffect(() => {
    setLimit(CREW_PAGE)
  }, [view, search, project, from, to])

  const q = useCrewPayoutsPage({ view, q: search, project_id: project, from, to }, limit)
  const rows = useMemo(() => q.data?.rows ?? [], [q.data])
  const today = q.data?.today ?? todayInIndia()
  const slotIds = useMemo(() => rows.map((r) => r.slot_id), [rows])
  const { data: settlements } = usePayoutSettlements(slotIds)
  const entries: readonly SettlementEntry[] = settlements?.entries ?? []
  const persons = useMemo(() => new Map((q.data?.persons ?? []).map((p) => [p.user_id, p])), [q.data])
  const filtering = !!(project || search || from || to)

  // The CSV is every row the view holds, not the page on screen: one read of
  // every booking, filtered here by the same rules the server uses.
  async function exportCsv() {
    setExporting(true)
    try {
      const all = await callApi('/team-payouts/shoots', { responseSchema: crewPayouts })
      const lines = crewRowsFor(all.rows, view, all.today, { project, q: search, from, to }).map((r) => [
        r.user_name ?? '',
        r.project_name ?? '',
        r.shoot_name ?? '',
        r.shoot_date,
        r.role ?? '',
        r.amount,
        r.paid,
        Math.max(0, r.amount - r.paid),
        crewRowLine(r, all.today, false),
      ])
      downloadCsv(
        `shoot-payouts-${view}-${all.today}.csv`,
        toCsv(['Person', 'Project', 'Shoot', 'Date', 'Role', 'Payout', 'Paid', 'Left', 'Status'], lines),
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'We could not make the CSV.')
    } finally {
      setExporting(false)
    }
  }

  if (q.isLoading) return <div className="py-12 text-center text-muted-foreground">Loading…</div>
  if (q.isError || !q.data) return <ErrorState onRetry={() => void q.refetch()} />
  const d = q.data
  if (d.bookings === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        No bookings yet. Book crew on a shoot to see payouts here.
      </div>
    )
  }

  const byMember = new Map<string, CrewPayoutRow[]>()
  for (const r of rows) {
    const list = byMember.get(r.user_id) ?? []
    list.push(r)
    byMember.set(r.user_id, list)
  }
  const shownCount = view === 'projects' ? d.projects.length : rows.length
  const totalCount = view === 'projects' ? d.projects_total : d.rows_total

  return (
    <div className="flex flex-col gap-4">
      {/* A phone reads the three figures as one sentence instead of three tall cards. */}
      <p className="rounded-lg border border-border bg-card p-3 text-sm sm:hidden">
        <b className="tabular-nums"><Money value={d.owed_now} /></b> is owed now for shoots already done.{' '}
        {d.upcoming > 0 && (
          <>
            <span className="tabular-nums"><Money value={d.upcoming} /></span> more is promised for shoots still to come.{' '}
          </>
        )}
        <span className="text-muted-foreground">
          Paid so far: <Money value={d.paid} />
          {d.paid_ahead > 0 ? ` (${inr(d.paid_ahead)} of it in advance)` : ''}.
        </span>
      </p>
      <div className="hidden gap-3 sm:grid sm:grid-cols-3">
        <StatCard
          label="Owed now"
          value={<Money value={d.owed_now} />}
          icon={Clock}
          hint="Shoots already done, minus what you've paid."
        />
        <StatCard
          label="Paid"
          value={<Money value={d.paid} />}
          icon={CheckCircle}
          hint={d.paid_ahead > 0 ? `${inr(d.paid_ahead)} of it in advance` : undefined}
        />
        <StatCard
          label="Upcoming"
          value={<Money value={d.upcoming} />}
          icon={CalendarClock}
          hint="Promised for future shoots. Not owed yet."
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SectionTabs
          variant="chips"
          label="Which payouts"
          tabs={CREW_VIEWS.map((v) => ({ value: v.key, label: v.label, ...(v.key === 'owed' ? { count: d.owed_count } : {}) }))}
          value={view}
          onChange={(v) => setViewParam(v)}
        />
        <div className="ml-auto flex gap-2">
          <Button variant={filtersOpen || filtering ? 'default' : 'outline'} size="sm" onClick={() => setFiltersOpen((o) => !o)}>
            <Filter className="mr-1 h-4 w-4" /> Filter
          </Button>
          {totalCount > 0 && view !== 'projects' && (
            <Button variant="outline" size="sm" onClick={() => void exportCsv()} disabled={exporting}>
              <Download className="mr-1 h-4 w-4" /> {exporting ? 'Making CSV…' : 'CSV'}
            </Button>
          )}
        </div>
      </div>

      {filtersOpen && (
        <Card>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label>Person</Label>
              <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search by name…" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Project</Label>
              <ProjectPicker value={project} onChange={(id) => setProject(id)} noneLabel="All projects" aria-label="Project" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Shoots from</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Shoots to</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </CardContent>
        </Card>
      )}

      {view === 'projects' ? (
        <ProjectCrewTable list={d.projects} total={d.project_totals} />
      ) : rows.length === 0 ? (
        view === 'owed' && !filtering ? (
          <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/5 p-4 text-sm">
            <CheckCircle className="size-5 text-success" aria-hidden /> All crew paid for shoots already done.
          </div>
        ) : (
          <div className="py-12 text-center text-muted-foreground">
            {filtering ? 'Nothing matches these filters.' : 'No shoots coming up.'}
          </div>
        )
      ) : (
        <div className="space-y-4">
          {[...byMember.entries()].map(([userId, list]) => {
            const totals = persons.get(userId)
            return (
              <div key={userId} className="space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-semibold">{list[0]!.user_name ?? 'Member'}</h3>
                  <p className="text-sm text-muted-foreground">
                    {totals ? crewPersonWords(totals, inr) : crewPersonLine(list, today, inr)}
                  </p>
                </div>
                {list.map((r) => (
                  <CrewPayoutLine key={r.slot_id} row={r} today={today} entries={entries} />
                ))}
              </div>
            )
          })}
        </div>
      )}

      {shownCount < totalCount && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <span className="text-xs text-muted-foreground tabular-nums">{showingLine(shownCount, totalCount)}</span>
          <Button type="button" variant="outline" size="sm" disabled={q.isFetching} onClick={() => setLimit((n) => n + CREW_PAGE)}>
            <ChevronDown /> {q.isFetching ? 'Loading…' : 'Show more'}
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * By project: each project's crew money on one line -- promised, paid, owed
 * now and still to come -- with the way into that project's Payouts. The
 * footer adds up every project the view holds, not only the ones shown.
 */
function ProjectCrewTable({
  list,
  total,
}: {
  list: readonly ProjectCrewMoney[]
  total: { booked: number; paid: number; owed: number; upcoming: number }
}) {
  const inr = useINR()
  if (list.length === 0) return <div className="py-12 text-center text-muted-foreground">Nothing matches these filters.</div>

  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Project</th>
              <th className="px-3 py-2 text-right font-medium">Crew payouts</th>
              <th className="px-3 py-2 text-right font-medium">Paid</th>
              <th className="px-3 py-2 text-right font-medium">Owed now</th>
              <th className="px-3 py-2 text-right font-medium">After the shoot</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.project_id ?? 'none'} className="border-t border-border">
                <td className="px-3 py-2">
                  <p className="font-medium">{p.project_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.people} {p.people === 1 ? 'person' : 'people'} · last shoot {dayLabel(p.last_shoot)}
                    {p.unset > 0 && <span className="font-medium text-warning"> · {p.unset} with no payout set</span>}
                  </p>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{inr(p.booked)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-success">{p.paid > 0 ? inr(p.paid) : '—'}</td>
                <td className={cn('px-3 py-2 text-right tabular-nums', p.owed > 0 ? 'font-semibold text-warning' : 'text-muted-foreground')}>
                  {p.owed > 0 ? inr(p.owed) : 'Nothing'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{p.upcoming > 0 ? inr(p.upcoming) : '—'}</td>
                <td className="px-3 py-2 text-right">
                  {p.project_id && (
                    <Button asChild size="sm" variant={p.owed > 0 ? 'default' : 'outline'}>
                      <Link to="/projects/$id" params={{ id: p.project_id }} search={{ tab: 'payouts' } as never}>
                        {p.owed > 0 ? 'Pay' : 'Open'}
                      </Link>
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-border bg-muted/30 font-semibold">
            <tr>
              <td className="px-3 py-2">All projects</td>
              <td className="px-3 py-2 text-right tabular-nums">{inr(total.booked)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{inr(total.paid)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{inr(total.owed)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{inr(total.upcoming)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </CardContent>
    </Card>
  )
}

function CrewPayoutLine({ row, today, entries }: { row: CrewPayoutRow; today: string; entries: readonly SettlementEntry[] }) {
  const inr = useINR()
  const [historyOpen, setHistoryOpen] = useState(false)
  const left = Math.max(0, row.amount - row.paid)
  const mine = entries.filter((e) => e.slot_id === row.slot_id)
  // A payment recorded by mistake is undone by a reversal entry (the ledger
  // keeps both, 0090); once undone it says so instead.
  const undone = new Set(mine.map((e) => e.reverses_settlement_id).filter(Boolean))
  const settle = useCreatePayoutSettlement()
  const past = row.shoot_date < today
  const settled = row.amount > 0 && left <= 0.001

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border bg-card p-3', settled && 'bg-success/[0.06]')}>
      {/* On a phone the shoot takes the full line and the money sits under it. */}
      <div className="w-full min-w-0 sm:w-auto sm:flex-1">
        <p className="font-medium">{[row.project_name, row.shoot_name].filter(Boolean).join(' · ') || 'A shoot'}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {[dayLabel(row.shoot_date), row.role].filter(Boolean).join(' · ')}
          {crewRowNote(row)}
        </p>
      </div>
      <p className={cn('text-sm tabular-nums', past && left > 0.001 ? 'font-semibold text-warning' : 'text-muted-foreground')}>
        {crewRowLine(row, today)}
      </p>
      <div className="flex items-center gap-1">
        {/* Only once there is something in it: a greyed icon on every row said nothing. */}
        {mine.length > 0 && (
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Payment history" aria-label="Payment history" onClick={() => setHistoryOpen(true)}>
            <History className="h-4 w-4" />
          </Button>
        )}
        {row.stands && row.amount > 0 && left > 0.001 && (
          <MarkPaidDialog slotId={row.slot_id} userId={row.user_id} pending={left} solid={past} />
        )}
      </div>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent title="Payment history" description={[row.user_name, row.shoot_name].filter(Boolean).join(' · ') || undefined}>
          <div className="flex flex-col gap-2">
            {mine.map((e) => (
              <div key={e.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <div>
                  <p className="font-medium capitalize">{e.entry_type}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.paid_date}
                    {e.payment_mode ? ` · ${e.payment_mode}` : ''}
                    {e.payment_reference ? ` · ${e.payment_reference}` : ''}
                  </p>
                  {e.notes && <p className="text-xs text-muted-foreground">{e.notes}</p>}
                </div>
                <span className="flex items-center gap-2">
                  <span className={e.amount_paid < 0 ? 'text-destructive' : 'text-success'}>{inr(e.amount_paid)}</span>
                  {e.amount_paid > 0 && e.entry_type !== 'reversal' && (
                    undone.has(e.id) ? (
                      <span className="text-xs text-muted-foreground">Undone</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={settle.isPending}
                        title="Recorded by mistake? Take this payment back"
                        onClick={() =>
                          settle.mutate({
                            slot_id: row.slot_id,
                            amount_paid: e.amount_paid,
                            entry_type: 'reversal',
                            reverses_settlement_id: e.id,
                            notes: 'Undone: recorded by mistake',
                          })
                        }
                      >
                        <Undo2 className="h-4 w-4" /> Undo
                      </Button>
                    )
                  )}
                </span>
              </div>
            ))}
            {mine.length === 0 && <p className="text-sm text-muted-foreground">No entries yet.</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const ENTRY_TYPES: readonly { value: PayoutEntryType; label: string; title: string }[] = [
  { value: 'payment', label: 'Payment', title: 'Money paid to them' },
  { value: 'reversal', label: 'Reversal', title: 'Correct an overpayment' },
  { value: 'adjustment', label: 'Adjustment', title: 'Any other correction' },
]

/** Amount defaults to the outstanding balance, but stays editable -- a partial payment is the norm, not an edge case. */
function MarkPaidDialog({ slotId, userId, pending, solid }: { slotId: string; userId: string; pending: number; solid?: boolean }) {
  const inr = useINR()
  const create = useCreatePayoutSettlement()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(String(pending))
  const [paidOn, setPaidOn] = useState(() => todayInIndia())
  const [mode, setMode] = useState('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [entryType, setEntryType] = useState<PayoutEntryType>('payment')
  const [error, setError] = useState<string | null>(null)
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(
    open ? `payout-settlement:${slotId}` : null,
    { amount, paidOn, mode, reference, notes, entryType },
    (v) => {
      setAmount(v.amount)
      setPaidOn(v.paidOn)
      setMode(v.mode)
      setReference(v.reference)
      setNotes(v.notes)
      setEntryType(v.entryType)
    },
  )

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const value = Number(amount)
    if (!(value > 0)) return
    try {
      await create.mutateAsync({
        slot_id: slotId,
        amount_paid: value,
        paid_date: paidOn,
        payment_mode: mode || undefined,
        payment_reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        entry_type: entryType,
      })
      draft.clear()
      setOpen(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not record this payment.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {/* Bordered, never solid: a list of six solid Pay buttons was six "main" buttons. */}
        <Button size="sm" variant="outline" className={cn(solid && 'border-primary/60 text-primary')}>
          <Wallet className="mr-1 h-4 w-4" /> Pay
        </Button>
      </DialogTrigger>
      <DialogContent title="Record a payment" description={`Still to pay: ${inr(pending)}`}>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          {open && <PayToCard userId={userId} />}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Amount (₹)</Label>
              <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Date</Label>
              <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Type</Label>
            <div role="radiogroup" aria-label="Type" className="flex flex-wrap gap-2">
              {ENTRY_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={entryType === t.value}
                  title={t.title}
                  onClick={() => setEntryType(t.value)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
                    entryType === t.value ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background hover:bg-muted',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <PaymentModePicker value={mode} onChange={setMode} />
          <div className="flex flex-col gap-1.5">
            <Label>Reference</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending || !(Number(amount) > 0)}>
              {create.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

