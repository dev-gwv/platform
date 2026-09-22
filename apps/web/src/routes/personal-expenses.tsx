import { useEffect, useMemo, useState, type ChangeEvent } from 'react'

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { StatCard } from '@/shared/ui/stat-card'
import { Button } from '@/shared/ui/button'
import { Input, Label, Select } from '@/shared/ui/input'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Card, CardContent } from '@/shared/ui/card'
import {
  usePersonalExpenses,
  usePersonalExpenseReport,
  useSavePersonalExpense,
  useDeletePersonalExpense,
  usePersonalExpenseAttachments,
  useAddPersonalExpenseAttachment,
  useDeletePersonalExpenseAttachment,
} from '@/features/personal-expenses/api'
import { toast } from 'sonner'
import { uploadFile } from '@/shared/api/client'
import { useParties, useCreateParty, useUpdateParty, useDeleteParty } from '@/features/parties/api'
import { PERSONAL_EXPENSE_CATEGORIES, type CreatePersonalExpenseRequest, type PersonalExpense } from '@ipc/contracts'
import { PartyPicker } from '@/features/parties/PartyPicker'

const GST_RATES = [0, 5, 12, 18, 28]
const TAX_NAMES = ['GST', 'CGST', 'SGST', 'IGST', 'Custom']
const PAGE_SIZE = 20
const todayISO = () => new Date().toISOString().slice(0, 10)
import { Plus, Search, Trash2, Edit, Wallet, Calendar, BarChart3, Download, Printer, Users, X, Paperclip } from 'lucide-react'
import { downloadCsv, toCsv } from '@/shared/ui/csv'

interface ItemLine {
  title: string
  amount: string
  qty: string
}

/**
 * The export, through the shared helper.
 *
 * Built by hand this wrapped every cell in quotes but doubled the inner
 * quotes of only the description, so a party name containing a quote broke
 * the row; and with no BOM, Excel on Windows read every rupee sign as
 * mojibake. The itemised lines are summarised into a column of their own --
 * an expense entered as five lines exported as one number, which is the
 * figure you cannot reconcile against the bill.
 */
function exportCsv(rows: PersonalExpense[]) {
  const itemised = (e: PersonalExpense): string =>
    Array.isArray(e.itemize_json) && e.itemize_json.length > 0
      ? e.itemize_json
          .map((l) => {
            const line = l as Record<string, unknown>
            const qty = Number(line['qty'] ?? 1)
            return `${String(line['title'] ?? '')} x${qty} @ ${String(line['amount'] ?? '')}`
          })
          .join('; ')
      : ''

  downloadCsv(
    `personal-expenses-${todayISO()}.csv`,
    toCsv(
      ['Date', 'Category', 'Description', 'Party', 'Amount', 'GST treatment', 'GST rate', 'Invoice number', 'Tax name', 'Tax amount', 'Reverse charge', 'Itemised lines'],
      rows.map((e) => [
        e.expense_date,
        e.category ?? '',
        e.description ?? '',
        e.party_name ?? '',
        e.amount,
        e.gst_treatment,
        e.gst_rate ?? '',
        e.invoice_number ?? '',
        e.tax_name ?? '',
        e.tax_amount ?? '',
        e.reverse_charge ? 'yes' : 'no',
        itemised(e),
      ]),
    ),
  )
}

function PersonalExpensesContent({ report }: { report?: boolean | undefined }) {
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [category, setCategory] = useState<string>('all')
  const [partyId, setPartyId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [gst, setGst] = useState('')
  const [reverse, setReverse] = useState('')
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'category'>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<PersonalExpense | null>(null)
  const [partiesOpen, setPartiesOpen] = useState(false)
  const [detail, setDetail] = useState<PersonalExpense | null>(null)

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, refetch } = usePersonalExpenses({
    search: debouncedSearch,
    category: category === 'all' ? undefined : category,
    party_id: partyId || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    min_amount: minAmount || undefined,
    max_amount: maxAmount || undefined,
    gst_treatment: gst || undefined,
    reverse_charge: reverse || undefined,
  })

  const deleteMutation = useDeletePersonalExpense()

  const allItems = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data])
  const sorted = useMemo(() => {
    const rows = [...allItems]
    rows.sort((a, b) => {
      let cmp = 0
      if (sortBy === 'amount') cmp = a.amount - b.amount
      else if (sortBy === 'category') cmp = (a.category ?? '').localeCompare(b.category ?? '')
      else cmp = a.expense_date < b.expense_date ? -1 : a.expense_date > b.expense_date ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
    return rows
  }, [allItems, sortBy, sortDir])

  const summary = data?.pages[0]?.summary
  const activeCount = [debouncedSearch.trim(), category !== 'all' ? category : '', partyId, dateFrom, dateTo, minAmount, maxAmount, gst, reverse].filter(Boolean).length

  function resetFilters() {
    setSearch('')
    setCategory('all')
    setPartyId('')
    setDateFrom('')
    setDateTo('')
    setMinAmount('')
    setMaxAmount('')
    setGst('')
    setReverse('')
    setPage(1)
  }

  // Client-side pagination over the loaded (server-filtered) set; "Load more"
  // pulls the next cursor page from the API.
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const cards = useMemo(() => {
    const total = sorted.reduce((s, e) => s + e.amount, 0)
    return {
      total,
      count: sorted.length,
      reverse: sorted.filter((e) => e.reverse_charge).length,
      gst: sorted.filter((e) => e.gst_treatment === 'gst_applicable').length,
      party: sorted.filter((e) => e.party_id).length,
      uncat: sorted.filter((e) => !e.category).length,
    }
  }, [sorted])

  const categoryLabels: Record<string, string> = {
    travel: 'Travel',
    food: 'Food',
    accommodation: 'Accommodation',
    supplies: 'Supplies',
    communication: 'Communication',
    equipment: 'Equipment',
    other: 'Other',
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Personal Expenses"
        description="Track your personal expenses"
        actions={
          <div className="no-print flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setPartiesOpen(true)}>
              <Users /> Parties
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportCsv(sorted)} disabled={sorted.length === 0}>
              <Download /> Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()} disabled={sorted.length === 0}>
              <Printer /> Print
            </Button>
            <ReportDialog autoOpen={report} />
            <Button onClick={() => { setEditing(null); setDialogOpen(true) }} size="sm">
              <Plus /> Add Expense
            </Button>
          </div>
        }
      />

      {/* SummaryCards (Lovable parity) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label={`Total${activeCount > 0 ? ' (filtered)' : ''}`} value={`₹${cards.total.toLocaleString()}`} icon={Wallet} />
        <StatCard label="Entries" value={cards.count} icon={BarChart3} />
        <StatCard label="Party-linked" value={cards.party} icon={Users} />
        <StatCard label="GST entries" value={cards.gst} icon={BarChart3} />
        <StatCard label="Reverse charge" value={cards.reverse} icon={BarChart3} />
      </div>
      {summary && (
        <p className="text-xs text-muted-foreground">
          Server totals: {summary.total_count} expenses · ₹{summary.total_amount.toLocaleString()} · this month ₹{summary.this_month_amount.toLocaleString()} ({summary.this_month_count})
          {cards.uncat > 0 ? ` · ${cards.uncat} uncategorized in view` : ''}
        </p>
      )}

      {/* Filter bar: search + category tabs + party/date/amount/gst/reverse/sort.
          Controls, not content -- they do not belong on the printed sheet. */}
      <Card className="no-print">
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search description, invoice, party..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} className="pl-9" />
            </div>
            <Button variant="ghost" size="sm" onClick={resetFilters} disabled={activeCount === 0}>
              <X /> Clear{activeCount > 0 ? ` (${activeCount})` : ''}
            </Button>
          </div>
          <FilterTabs
            value={category}
            onChange={(v) => { setCategory(v); setPage(1) }}
            tabs={[
              { label: 'All', value: 'all' },
              ...PERSONAL_EXPENSE_CATEGORIES.map((c) => ({ label: categoryLabels[c] ?? c, value: c })),
            ]}
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label>Party</Label>
              <Select value={partyId} onChange={(e) => { setPartyId(e.target.value); setPage(1) }}>
                <option value="">All parties</option>
                <PartyOptions />
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>From</Label>
              <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1) }} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>To</Label>
              <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1) }} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1.5">
                <Label>Min ₹</Label>
                <Input inputMode="decimal" value={minAmount} onChange={(e) => { setMinAmount(e.target.value); setPage(1) }} placeholder="0" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Max ₹</Label>
                <Input inputMode="decimal" value={maxAmount} onChange={(e) => { setMaxAmount(e.target.value); setPage(1) }} placeholder="—" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>GST treatment</Label>
              <Select value={gst} onChange={(e) => { setGst(e.target.value); setPage(1) }}>
                <option value="">All</option>
                <option value="non_gst">No GST</option>
                <option value="gst_applicable">GST applicable</option>
                <option value="exempt">Exempt</option>
                <option value="reverse_charge">Reverse charge</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Reverse charge</Label>
              <Select value={reverse} onChange={(e) => { setReverse(e.target.value); setPage(1) }}>
                <option value="">Any</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Sort by</Label>
              <Select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
                <option value="date">Date</option>
                <option value="amount">Amount</option>
                <option value="category">Category</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Direction</Label>
              <Select value={sortDir} onChange={(e) => setSortDir(e.target.value as typeof sortDir)}>
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : isError ? (
        <div className="rounded-lg border border-border bg-card p-4 text-center">
          <p className="text-sm text-destructive">Could not load expenses.</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => void refetch()}>Retry</Button>
        </div>
      ) : (
      <div className="space-y-2">
        {pageRows.map((item) => (
          <div key={item.id} className="flex items-center justify-between rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50">
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setDetail(item)}>
              <div className="flex items-center gap-2">
                <span className="font-medium">₹{item.amount.toLocaleString()}</span>
                {item.category && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    {categoryLabels[item.category] ?? item.category}
                  </span>
                )}
                {item.reverse_charge && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">RCM</span>
                )}
              </div>
              {item.description && <p className="mt-1 truncate text-sm text-muted-foreground">{item.description}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                {item.expense_date}
                {item.party_name ? ` · ${item.party_name}` : ''}
                {item.invoice_number ? ` · ${item.invoice_number}` : ''}
              </p>
            </button>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => { setEditing(item); setDialogOpen(true) }}>
                <Edit className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Delete" onClick={() => { if (confirm('Delete this expense?')) deleteMutation.mutate(item.id) }}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
        {sorted.length === 0 && <div className="py-12 text-center text-muted-foreground">{activeCount > 0 ? 'No expenses match your filters.' : 'No expenses found.'}</div>}
        <div className="flex flex-col gap-2">
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Page {safePage} of {totalPages} · {sorted.length} loaded</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Previous</Button>
                <Button size="sm" variant="outline" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>Next</Button>
              </div>
            </div>
          )}
          {hasNextPage && (
            <Button variant="outline" className="w-full" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
              {isFetchingNextPage ? 'Loading...' : 'Load more from server'}
            </Button>
          )}
        </div>
      </div>
      )}

      <ExpenseDialog open={dialogOpen} onOpenChange={setDialogOpen} initial={editing} />

      {/* Detail dialog, with the bills attached to this expense */}
      <Dialog open={!!detail} onOpenChange={(v) => { if (!v) setDetail(null) }}>
        <DialogContent title="Expense detail" description={detail ? `₹${detail.amount.toLocaleString()} · ${detail.expense_date}` : undefined}>
          {detail && (
            <div className="flex flex-col gap-3 text-sm">
              <dl className="grid gap-2">
                <div className="flex justify-between"><dt className="text-muted-foreground">Category</dt><dd>{detail.category ?? '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Party</dt><dd>{detail.party_name ?? '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Invoice</dt><dd>{detail.invoice_number ?? '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Amount is</dt><dd>{detail.amount_is ?? '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Tax</dt><dd>{detail.tax_name ?? '—'}{detail.tax_amount != null ? ` · ₹${detail.tax_amount}` : ''}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Reverse charge</dt><dd>{detail.reverse_charge ? 'Yes' : 'No'}</dd></div>
                {detail.description && <div><dt className="text-muted-foreground">Description</dt><dd className="whitespace-pre-wrap">{detail.description}</dd></div>}
              </dl>
              <AttachmentsPanel expenseId={detail.id} />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDetail(null)}>Close</Button>
                <Button onClick={() => { setEditing(detail); setDetail(null); setDialogOpen(true) }}>Edit</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <PartyManager open={partiesOpen} onOpenChange={setPartiesOpen} />
    </div>
  )
}

function PartyOptions() {
  const { data } = useParties()
  return (
    <>
      {(data ?? []).map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </>
  )
}

/** Full CRUD parties manager (Lovable parity). */
function PartyManager({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [search, setSearch] = useState('')
  const debounced = useDebounce(search, 300)
  const { data, isLoading, refetch } = useParties(debounced.trim() ? { search: debounced.trim() } : undefined)
  const create = useCreateParty()
  const update = useUpdateParty()
  const remove = useDeleteParty()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'vendor' | 'freelancer' | 'other'>('vendor')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [gstin, setGstin] = useState('')
  const [address, setAddress] = useState('')
  const [state, setState] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  function reset() {
    setEditingId(null)
    setName('')
    setKind('vendor')
    setPhone('')
    setEmail('')
    setGstin('')
    setAddress('')
    setState('')
  }

  async function onSave() {
    if (!name.trim()) return
    const body = {
      name: name.trim(),
      kind,
      phone: phone.trim() || null,
      email: email.trim() || null,
      gstin: gstin.trim() || null,
      address: address.trim() || null,
      state: state.trim() || null,
    }
    if (editingId) await update.mutateAsync({ id: editingId, patch: body })
    else await create.mutateAsync(body)
    reset()
    void refetch()
  }

  function startEdit(p: { id: string; name: string; kind: 'vendor' | 'freelancer' | 'other'; phone?: string | null | undefined; email?: string | null | undefined; gstin?: string | null | undefined; address?: string | null | undefined; state?: string | null | undefined }) {
    setEditingId(p.id)
    setName(p.name)
    setKind(p.kind)
    setPhone(p.phone ?? '')
    setEmail(p.email ?? '')
    setGstin(p.gstin ?? '')
    setAddress(p.address ?? '')
    setState(p.state ?? '')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Parties" description="Vendors, freelancers, and others. Used by company and personal expenses.">
        <div className="flex flex-col gap-3">
          <Input placeholder="Search parties…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="grid gap-2 rounded-lg border p-3">
            <p className="text-sm font-medium">{editingId ? 'Edit party' : 'Add party'}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex flex-col gap-1"><Label>Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="flex flex-col gap-1"><Label>Kind</Label>
                <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                  <option value="vendor">Vendor</option>
                  <option value="freelancer">Freelancer</option>
                  <option value="other">Other</option>
                </Select>
              </div>
              <div className="flex flex-col gap-1"><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
              <div className="flex flex-col gap-1"><Label>Email</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div className="flex flex-col gap-1"><Label>GSTIN</Label><Input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} /></div>
              <div className="flex flex-col gap-1"><Label>State</Label><Input value={state} onChange={(e) => setState(e.target.value)} /></div>
              <div className="flex flex-col gap-1 sm:col-span-2"><Label>Address</Label><Input value={address} onChange={(e) => setAddress(e.target.value)} /></div>
            </div>
            <div className="flex justify-end gap-2">
              {editingId && <Button variant="ghost" size="sm" onClick={reset}>Cancel</Button>}
              <Button size="sm" onClick={() => void onSave()} disabled={!name.trim() || create.isPending || update.isPending}>{editingId ? 'Save' : 'Add party'}</Button>
            </div>
          </div>
          {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
            <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border">
              {(data ?? []).map((p) => (
                <li key={p.id} className="flex items-center gap-2 p-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{p.name} <span className="text-xs text-muted-foreground">({p.kind})</span></p>
                    <p className="truncate text-xs text-muted-foreground">{[p.gstin, p.phone, p.email].filter(Boolean).join(' · ') || '—'}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => startEdit(p)}>Edit</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={remove.isPending} onClick={() => { if (confirm(`Remove ${p.name}?`)) void remove.mutateAsync(p.id).then(() => void refetch()) }}>Remove</Button>
                </li>
              ))}
              {(data ?? []).length === 0 && <li className="p-3 text-sm text-muted-foreground">No parties yet.</li>}
            </ul>
          )}
          <div className="flex justify-end"><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** The bills attached to one expense: upload, list, remove. */
function AttachmentsPanel({ expenseId }: { expenseId: string }) {
  const { data, isLoading } = usePersonalExpenseAttachments(expenseId)
  const add = useAddPersonalExpenseAttachment()
  const remove = useDeletePersonalExpenseAttachment()
  const [fileName, setFileName] = useState('')
  const [fileUrl, setFileUrl] = useState('')
  const [uploading, setUploading] = useState(false)

  /**
   * Bills are uploaded, not linked. The panel keeps the URL pair underneath for
   * a receipt that genuinely lives somewhere else (a Drive link a client sent),
   * but the upload is the path people actually use.
   */
  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget
    const f = input.files?.[0]
    if (!f) return
    setUploading(true)
    uploadFile(f)
      .then((stored) => add.mutateAsync({ id: expenseId, file_name: stored.name, file_url: stored.url }))
      .then(() => toast.success('Attachment added'))
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : 'We could not upload that file.'))
      .finally(() => {
        setUploading(false)
        input.value = ''
      })
  }

  return (
    <div className="rounded-lg border p-3">
      <p className="flex items-center gap-2 text-sm font-medium"><Paperclip className="size-4" /> Attachments</p>
      {isLoading ? <p className="mt-2 text-sm text-muted-foreground">Loading…</p> : (
        <ul className="mt-2 flex flex-col gap-1.5 text-sm">
          {(data ?? []).map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{a.file_name ?? a.file_url ?? a.id}</span>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void remove.mutate(a.id)}>Remove</Button>
            </li>
          ))}
          {(data ?? []).length === 0 && <li className="text-sm text-muted-foreground">No attachments yet. Upload the bill scan below.</li>}
        </ul>
      )}
      <div className="mt-3">
        <Label htmlFor={`att-${expenseId}`}>Upload a bill</Label>
        <Input
          id={`att-${expenseId}`}
          type="file"
          className="mt-1"
          accept="image/png,image/jpeg,image/webp,application/pdf,text/csv,text/plain"
          disabled={uploading || add.isPending}
          onChange={onPick}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {uploading ? 'Uploading…' : 'PDF, PNG, JPG, WEBP, CSV or TXT. Max 10 MB.'}
        </p>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-muted-foreground">Or link a file hosted elsewhere</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Input placeholder="File name (bill.pdf)" value={fileName} onChange={(e) => setFileName(e.target.value)} />
          <Input placeholder="File URL (https://…)" value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} />
        </div>
      </details>
      <div className="mt-2 flex justify-end">
        <Button size="sm" variant="outline" disabled={!fileName.trim() || !fileUrl.trim() || add.isPending} onClick={() => { void add.mutateAsync({ id: expenseId, file_name: fileName.trim(), file_url: fileUrl.trim() }).then(() => { setFileName(''); setFileUrl('') }) }}>
          Attach link
        </Button>
      </div>
    </div>
  )
}

/** Full expense form (Lovable parity): invoice/amount-is/tax/reverse/itemized/preview/review. */
function ExpenseDialog({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (v: boolean) => void; initial: PersonalExpense | null }) {
  const save = useSavePersonalExpense()
  const isEdit = !!initial
  const [expenseDate, setExpenseDate] = useState(todayISO())
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [amountText, setAmountText] = useState('')
  const [amountIs, setAmountIs] = useState<'including_tax' | 'excluding_tax'>('excluding_tax')
  const [partyId, setPartyId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [gstTreatment, setGstTreatment] = useState<CreatePersonalExpenseRequest['gst_treatment']>('non_gst')
  const [gstRate, setGstRate] = useState('')
  const [reverse, setReverse] = useState(false)
  const [taxNameSelect, setTaxNameSelect] = useState('GST')
  const [taxName, setTaxName] = useState('GST')
  const [taxAmount, setTaxAmount] = useState('')
  const [taxManual, setTaxManual] = useState(false)
  const [itemized, setItemized] = useState(false)
  const [lines, setLines] = useState<ItemLine[]>([])

  useEffect(() => {
    if (!open) return
    if (initial) {
      setExpenseDate(initial.expense_date ?? todayISO())
      setDescription(initial.description ?? '')
      setCategory(initial.category ?? '')
      setAmountText(String(initial.amount ?? ''))
      setAmountIs(initial.amount_is === 'including_tax' ? 'including_tax' : 'excluding_tax')
      setPartyId(initial.party_id ?? '')
      setInvoiceNumber(initial.invoice_number ?? '')
      setGstTreatment((initial.gst_treatment as CreatePersonalExpenseRequest['gst_treatment']) ?? 'non_gst')
      setGstRate(initial.gst_rate == null ? '' : String(initial.gst_rate))
      setReverse(!!initial.reverse_charge)
      const tn = initial.tax_name ?? 'GST'
      setTaxName(tn)
      setTaxNameSelect(TAX_NAMES.includes(tn) ? tn : 'Custom')
      setTaxAmount(initial.tax_amount == null ? '' : String(initial.tax_amount))
      setTaxManual(false)
      const parsed = Array.isArray(initial.itemize_json) ? (initial.itemize_json as Record<string, unknown>[]) : []
      setItemized(parsed.length > 0)
      setLines(parsed.map((l) => ({ title: String(l['title'] ?? ''), amount: String(l['amount'] ?? ''), qty: String(l['qty'] ?? '1') })))
    } else {
      setExpenseDate(todayISO())
      setDescription('')
      setCategory('')
      setAmountText('')
      setAmountIs('excluding_tax')
      setPartyId('')
      setInvoiceNumber('')
      setGstTreatment('non_gst')
      setGstRate('')
      setReverse(false)
      setTaxNameSelect('GST')
      setTaxName('GST')
      setTaxAmount('')
      setTaxManual(false)
      setItemized(false)
      setLines([])
    }
  }, [open, initial])

  const amountNum = Number(amountText) || 0
  const rateNum = Number(gstRate) || 0
  // Auto tax preview unless manually overridden or itemized.
  useEffect(() => {
    if (!open || itemized || taxManual || gstTreatment !== 'gst_applicable') return
    const base = amountIs === 'including_tax' && rateNum > 0 ? (amountNum * 100) / (100 + rateNum) : amountNum
    const tax = (base * rateNum) / 100
    const next = tax === 0 ? '' : String(Math.round(tax * 100) / 100)
    setTaxAmount((cur) => (cur === next ? cur : next))
  }, [open, itemized, taxManual, gstTreatment, amountNum, rateNum, amountIs])

  const itemSubtotal = lines.reduce((s, l) => s + (Number(l.amount) || 0) * (Number(l.qty) || 1), 0)
  const itemTax = gstTreatment === 'gst_applicable' ? (itemSubtotal * rateNum) / 100 : 0
  const itemTotal = amountIs === 'including_tax' ? itemSubtotal : itemSubtotal + itemTax

  useEffect(() => {
    if (!open || !itemized || lines.length === 0) return
    setAmountText(String(Math.round((amountIs === 'including_tax' ? itemSubtotal : itemSubtotal) * 100) / 100))
    if (!taxManual) setTaxAmount(itemTax === 0 ? '' : String(Math.round(itemTax * 100) / 100))
  }, [open, itemized, lines, amountIs, itemSubtotal, itemTax, taxManual])

  const taxNum = Number(taxAmount) || 0
  const grandTotal = amountIs === 'including_tax' ? amountNum : amountNum + taxNum

  function handleSubmit() {
    if (amountNum <= 0) return
    const body: CreatePersonalExpenseRequest = {
      amount: amountNum,
      expense_date: expenseDate,
      category: (category || null) as CreatePersonalExpenseRequest['category'],
      description: description.trim() || null,
      party_id: partyId || null,
      gst_treatment: gstTreatment,
      gst_rate: gstRate === '' ? null : Number(gstRate),
      invoice_number: invoiceNumber.trim() || null,
      amount_is: amountIs,
      tax_name: (taxNameSelect === 'Custom' ? taxName.trim() : taxNameSelect) || null,
      tax_amount: taxAmount === '' ? null : Number(taxAmount),
      reverse_charge: reverse,
      itemize_json: itemized && lines.length > 0 ? lines.map((l) => ({ title: l.title, amount: Number(l.amount) || 0, qty: Number(l.qty) || 1 })) : null,
    }
    save.mutate({ id: initial?.id, body }, { onSuccess: () => onOpenChange(false) })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={isEdit ? 'Edit Expense' : 'Add Expense'} description="Invoice, tax, reverse charge, and itemized lines included.">
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Amount (₹) *</Label><Input inputMode="decimal" value={amountText} disabled={itemized && lines.length > 0} onChange={(e) => setAmountText(e.target.value)} placeholder="0.00" /></div>
            <div><Label>Date</Label><Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Category</Label>
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Select category</option>
                {PERSONAL_EXPENSE_CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
              </Select>
            </div>
            <div><Label>Invoice number</Label><Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="INV-001" /></div>
          </div>
          <PartyPicker value={partyId} onChange={setPartyId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Amount is</Label>
              <Select value={amountIs} onChange={(e) => setAmountIs(e.target.value as typeof amountIs)}>
                <option value="excluding_tax">Excluding tax</option>
                <option value="including_tax">Including tax</option>
              </Select>
            </div>
            <label className="flex items-end gap-2 pb-1 text-sm">
              <input type="checkbox" checked={reverse} onChange={(e) => {
                const v = e.target.checked
                setReverse(v)
                setGstTreatment(v ? 'reverse_charge' : 'gst_applicable')
              }} />
              Reverse charge
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>GST treatment</Label>
              <Select value={gstTreatment} onChange={(e) => {
                const v = e.target.value as CreatePersonalExpenseRequest['gst_treatment']
                setGstTreatment(v)
                if (v === 'reverse_charge') setReverse(true)
                if (v === 'non_gst') { setReverse(false); setGstRate(''); setTaxAmount('') }
                if (v === 'exempt') { setGstRate('0'); setTaxAmount('') }
              }}>
                <option value="non_gst">No GST</option>
                <option value="gst_applicable">GST applicable</option>
                <option value="exempt">Exempt</option>
                <option value="reverse_charge">Reverse charge</option>
              </Select>
            </div>
            {gstTreatment === 'gst_applicable' && (
              <div><Label>GST rate %</Label>
                <Select value={gstRate === '' ? '' : gstRate} onChange={(e) => { setGstRate(e.target.value); setTaxManual(false) }}>
                  <option value="">Pick rate</option>
                  {GST_RATES.map((r) => (<option key={r} value={String(r)}>{r}%</option>))}
                </Select>
              </div>
            )}
          </div>
          {gstTreatment !== 'non_gst' && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div><Label>Tax name</Label>
                <Select value={taxNameSelect} onChange={(e) => { setTaxNameSelect(e.target.value); if (e.target.value !== 'Custom') setTaxName(e.target.value) }}>
                  {TAX_NAMES.map((t) => (<option key={t} value={t}>{t}</option>))}
                </Select>
                {taxNameSelect === 'Custom' && <Input className="mt-2" value={taxName} onChange={(e) => setTaxName(e.target.value)} placeholder="Custom tax name" />}
              </div>
              <div><Label>Tax amount ₹</Label><Input inputMode="decimal" value={taxAmount} onChange={(e) => { setTaxAmount(e.target.value); setTaxManual(true) }} />{taxManual && <p className="mt-1 text-xs text-amber-600">Manual override</p>}</div>
              <div><Label>Preview total</Label><p className="pt-2 text-sm font-semibold">₹{grandTotal.toLocaleString()}</p></div>
            </div>
          )}
          <div className="rounded-lg border p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={itemized} onChange={(e) => setItemized(e.target.checked)} />
              Itemized lines
            </label>
            {itemized && (
              <div className="mt-2 flex flex-col gap-2">
                {lines.map((l, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2">
                    <Input className="col-span-6" placeholder="Item title" value={l.title} onChange={(e) => setLines((prev) => prev.map((p, j) => (j === i ? { ...p, title: e.target.value } : p)))} />
                    <Input className="col-span-3" inputMode="decimal" placeholder="Amount" value={l.amount} onChange={(e) => setLines((prev) => prev.map((p, j) => (j === i ? { ...p, amount: e.target.value } : p)))} />
                    <Input className="col-span-2" inputMode="numeric" placeholder="Qty" value={l.qty} onChange={(e) => setLines((prev) => prev.map((p, j) => (j === i ? { ...p, qty: e.target.value } : p)))} />
                    <Button size="sm" variant="ghost" className="col-span-1" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}>×</Button>
                  </div>
                ))}
                <div><Button size="sm" variant="outline" onClick={() => setLines((prev) => [...prev, { title: '', amount: '', qty: '1' }])}>Add line</Button></div>
                <p className="text-xs text-muted-foreground">Subtotal ₹{itemSubtotal.toLocaleString()} · Tax ₹{itemTax.toLocaleString()} · Total ₹{itemTotal.toLocaleString()}</p>
              </div>
            )}
          </div>
          <div><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was this expense for?" /></div>
          {/* Review step */}
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="font-medium">Review</p>
            <div className="mt-1 grid gap-1 sm:grid-cols-3">
              <div><span className="text-muted-foreground">Amount</span><div className="font-semibold">₹{amountNum.toLocaleString()}</div></div>
              <div><span className="text-muted-foreground">Tax</span><div>₹{taxNum.toLocaleString()}</div></div>
              <div><span className="text-muted-foreground">Total</span><div className="font-semibold">₹{grandTotal.toLocaleString()}</div></div>
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={amountNum <= 0 || save.isPending}>{save.isPending ? 'Saving...' : 'Save'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function firstOfMonth(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

/** Category and day breakdown for a date range — the backend's had this since round 1, the UI never asked for it. */
function ReportDialog({ autoOpen }: { autoOpen?: boolean | undefined } = {}) {
  const [open, setOpen] = useState(autoOpen ?? false)
  const [startDate, setStartDate] = useState(firstOfMonth())
  const [endDate, setEndDate] = useState(todayISO())
  const { data, isLoading, isError } = usePersonalExpenseReport(open ? startDate : '', open ? endDate : '')

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <BarChart3 /> Report
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Personal expense report" description="Category and day-by-day breakdown for a date range.">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>From</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} max={endDate} />
            </div>
            <div>
              <Label>To</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate} />
            </div>
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : isError ? (
            <p className="text-sm text-destructive">Could not load the report.</p>
          ) : !data ? null : (
            <>
              <div className="rounded-lg border bg-muted/30 p-3 text-center">
                <p className="text-xs text-muted-foreground">Total, {data.period_start} to {data.period_end}</p>
                <p className="text-xl font-semibold">₹{data.total_amount.toLocaleString()}</p>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">By category</p>
                {data.by_category.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No expenses in this range.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {data.by_category.map((c) => (
                      <li key={c.category ?? '—'} className="flex items-center justify-between text-sm">
                        <span>
                          {c.category ?? 'Uncategorised'} <span className="text-muted-foreground">({c.count})</span>
                        </span>
                        <span className="font-medium">₹{c.amount.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {data.daily_breakdown.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium">By day</p>
                  <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                    {data.daily_breakdown.map((d) => (
                      <li key={d.date} className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Calendar className="size-3" />{d.date}</span>
                        <span>₹{d.amount.toLocaleString()} · {d.count} {d.count === 1 ? 'expense' : 'expenses'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
      </Dialog>
    </>
  )
}

export function PersonalExpensesPage({ report }: { report?: boolean } = {}) {
  return (
    <AuthedPage module="personal_expenses">
      <PersonalExpensesContent report={report} />
    </AuthedPage>
  )
}
