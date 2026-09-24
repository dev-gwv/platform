import { useState, type FormEvent } from 'react'
import { Plus, Wallet, Pencil, Trash2, Search, Download, Printer, Tags, X, Eye } from 'lucide-react'
import type { CreateExpenseRequest, Expense } from '@ipc/contracts'

const todayISO = () => new Date().toISOString().slice(0, 10)
const GST_RATES = [0, 5, 12, 18, 28]
const PAGE_SIZE = 20
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { HowToUse } from '@/shared/ui/how-to-use'
import { SkeletonList } from '@/shared/ui/skeleton'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { RecordCard, RecordCards } from '@/shared/ui/record-card'
import { downloadCsv, toCsv } from '@/shared/ui/csv'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { formatINR, humanize } from '@/shared/ui/format'
import { StatCard } from '@/shared/ui/stat-card'
import { Card, CardContent } from '@/shared/ui/card'
import { useExpensePage, useCreateExpense, useUpdateExpense, useDeleteExpense, useExpenseSummary } from '@/features/financials/api'
import { useProjects } from '@/features/projects/api'
import { PartyPicker } from '@/features/parties/PartyPicker'
import { useConfirm } from '@/shared/ui/confirm'
import { useActiveLookups, useCreateCustomLookup, useUpdateCustomLookup, useDeleteCustomLookup } from '@/features/settings/api'
import { useAuth } from '@/shared/auth/AuthProvider'

/** Pick a studio-defined expense category, or add one inline without leaving the form (owner only). */
function ExpenseCategoryPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { session } = useAuth()
  const { data: categories } = useActiveLookups('expense_category')
  const createLookup = useCreateCustomLookup()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  async function onAdd() {
    if (!name.trim()) return
    await createLookup.mutateAsync({ category: 'expense_category', value: name.trim() })
    onChange(name.trim())
    setAdding(false)
    setName('')
  }

  if (adding) {
    return (
      <div className="flex flex-col gap-1.5">
        <Label>New category</Label>
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Travel" autoFocus />
          <Button type="button" size="sm" onClick={() => void onAdd()} disabled={!name.trim() || createLookup.isPending}>
            Add
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label>Category</Label>
      <Select
        value={value}
        onChange={(e) => {
          if (e.target.value === '__add__') setAdding(true)
          else onChange(e.target.value)
        }}
      >
        <option value="">Uncategorised</option>
        {/* An older entry logged before a category was renamed or removed still shows its own text, unselected from the list. */}
        {value && !(categories ?? []).some((c) => c.value === value) && <option value={value}>{value}</option>}
        {(categories ?? []).map((c) => (
          <option key={c.id} value={c.value}>
            {c.value}
          </option>
        ))}
        {/* Non-owners still see and use the list above -- adding a new one is a settings change. */}
        {session?.is_owner && <option value="__add__">+ Add new category…</option>}
      </Select>
    </div>
  )
}

/**
 * The export, through the shared helper.
 *
 * This used to build the file by hand: it wrapped every cell in quotes but
 * doubled the inner quotes of only one of them, so a party name containing a
 * quote broke the row — and with no BOM, Excel on Windows read every rupee
 * sign as mojibake. Both are exactly what `downloadCsv` exists to prevent.
 */
function exportCsv(rows: Expense[]) {
  downloadCsv(
    `company-expenses-${todayISO()}.csv`,
    toCsv(
      ['Date', 'Category', 'Description', 'Project', 'Party', 'Amount', 'GST treatment', 'GST rate', 'Invoice number', 'Reverse charge'],
      rows.map((e) => [
        e.expense_date,
        e.category ?? '',
        e.description ?? '',
        e.project_id ?? '',
        e.party_name ?? '',
        e.amount,
        e.gst_treatment,
        e.gst_rate ?? '',
        e.invoice_number ?? '',
        e.reverse_charge ? 'yes' : 'no',
      ]),
    ),
  )
}

export function CompanyExpensesPage() {
  return (
    <AuthedPage module="company_expenses">
      <Expenses />
    </AuthedPage>
  )
}

function Expenses() {
  const confirm = useConfirm()
  const isMobile = useIsMobile()
  const { data: projects } = useProjects()
  const { data: categories } = useActiveLookups('expense_category')
  const del = useDeleteExpense()

  // Lovable parity filters: search/category/project/date/amount + sort + pagination.
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [projectId, setProjectId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [sort, setSort] = useState<'date' | 'amount'>('date')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState<Expense | null>(null)
  const [catsOpen, setCatsOpen] = useState(false)
  const [gst, setGst] = useState('')

  // One set of filters, read by the list, its count and the tiles above it.
  const filters = {
    search: search.trim() || undefined,
    category: category || undefined,
    project_id: projectId || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    min_amount: minAmount || undefined,
    max_amount: maxAmount || undefined,
    gst: gst || undefined,
  }
  const { data: serverSummary } = useExpenseSummary(filters)
  const { data: pageData, isLoading, isError, refetch, isFetching } = useExpensePage({
    ...filters,
    sort,
    dir,
    page,
    page_size: PAGE_SIZE,
  })

  const activeCount = [search.trim(), category, projectId, dateFrom, dateTo, minAmount, maxAmount, gst].filter(Boolean).length

  function resetFilters() {
    setSearch('')
    setCategory('')
    setProjectId('')
    setDateFrom('')
    setDateTo('')
    setMinAmount('')
    setMaxAmount('')
    setGst('')
    setPage(1)
  }

  // The server sorts and pages. Sorting here would only have reordered the
  // rows already fetched, and paging here capped the whole screen at the
  // first 200 expenses with nothing to say so.
  const sorted = pageData?.items ?? []
  const total = pageData?.total ?? 0

  // Counted in SQL over the whole filtered set, not over this page.
  const summary = {
    total: serverSummary?.total ?? 0,
    count: serverSummary?.count ?? 0,
    linked: serverSummary?.linked_count ?? 0,
    general: (serverSummary?.count ?? 0) - (serverSummary?.linked_count ?? 0),
    cats: serverSummary?.category_count ?? 0,
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = sorted

  async function onDelete(e: Expense) {
    const yes = await confirm({
      title: 'Delete this expense?',
      description: `${e.category ?? 'Uncategorised'} · ${formatINR(e.amount)}. This cannot be undone.`,
      destructive: true,
      confirmLabel: 'Delete',
    })
    if (yes) del.mutate(e.id)
  }

  function onSort(field: 'date' | 'amount') {
    if (sort === field) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSort(field)
      setDir('desc')
    }
  }

  return (
    <>
      <PageHeader
        title="Company expenses"
        description={`Total ${formatINR(summary.total)} · ${summary.count} entries`}
        actions={
          <div className="no-print flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setCatsOpen(true)}>
              <Tags /> Categories
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportCsv(sorted)} disabled={sorted.length === 0}>
              <Download /> Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()} disabled={sorted.length === 0}>
              <Printer /> Print Report
            </Button>
            <AddExpenseDialog />
          </div>
        }
      />

      <HowToUse
        className="no-print mt-4"
        title="Track studio expenses"
        description="What the studio spends on itself — team payments, travel, rent, equipment, editing and operations."
        steps={[
          'Add the category and amount.',
          'Link it to a project when the cost belongs to one.',
          'Read it back on Monthly profit and the project’s margin.',
        ]}
      />

      {/* SummaryCards. Money comes from the server, over the whole date range —
          summing the rows on screen made "Total" mean "total of this page". */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <StatCard label="Total" value={formatINR(serverSummary?.total ?? summary.total)} icon={Wallet} />
        <StatCard label="Entries" value={String(serverSummary?.count ?? summary.count)} icon={Wallet} />
        <StatCard label="Tax" value={formatINR(serverSummary?.tax_total ?? 0)} icon={Wallet} />
        <StatCard label="Reverse charge" value={formatINR(serverSummary?.rcm_total ?? 0)} icon={Wallet} />
        <StatCard label="Project-linked" value={String(summary.linked)} icon={Wallet} />
        <StatCard label="Categories used" value={String(summary.cats)} icon={Tags} />
      </div>

      {/* Filter bar. Which filters produced the report is worth knowing, but
          a row of empty inputs on a printed sheet is not -- the figures above
          already reflect them. */}
      <Card className="no-print mt-4">
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="Search description, invoice…" className="pl-9" />
            </div>
            <Button variant="ghost" size="sm" onClick={resetFilters} disabled={activeCount === 0}>
              <X /> Clear filters{activeCount > 0 ? ` (${activeCount})` : ''}
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label>Category</Label>
              <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1) }}>
                <option value="">All categories</option>
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={c.value}>{c.value}</option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Project</Label>
              <Select value={projectId} onChange={(e) => { setProjectId(e.target.value); setPage(1) }}>
                <option value="">All projects</option>
                {(projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              {/* Two tiles above this bar count tax and reverse charge, and
                  there was no way to see the rows behind either figure. */}
              <Label>GST</Label>
              <Select value={gst} onChange={(e) => { setGst(e.target.value); setPage(1) }} aria-label="Filter by GST">
                <option value="">Any GST treatment</option>
                <option value="gst_applicable">GST applicable</option>
                <option value="exempt">Exempt</option>
                <option value="non_gst">No GST</option>
                <option value="reverse_charge">Reverse charge</option>
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
            <div className="flex flex-col gap-1.5">
              <Label>Min amount ₹</Label>
              <Input inputMode="decimal" value={minAmount} onChange={(e) => { setMinAmount(e.target.value); setPage(1) }} placeholder="0" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Max amount ₹</Label>
              <Input inputMode="decimal" value={maxAmount} onChange={(e) => { setMaxAmount(e.target.value); setPage(1) }} placeholder="No limit" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Sort by</Label>
              <Select value={sort} onChange={(e) => onSort(e.target.value as 'date' | 'amount')}>
                <option value="date">Date</option>
                <option value="amount">Amount</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Direction</Label>
              <Select value={dir} onChange={(e) => setDir(e.target.value as 'asc' | 'desc')}>
                <option value="desc">Newest / largest first</option>
                <option value="asc">Oldest / smallest first</option>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="mt-4"><SkeletonList rows={5} columns={5} /></div>
      ) : isError ? (
        <div className="mt-4"><ErrorState onRetry={() => void refetch()} /></div>
      ) : sorted.length === 0 ? (
        <div className="mt-4">
          <EmptyState title={activeCount > 0 ? 'No expenses match your filters' : 'No expenses logged'} description={activeCount > 0 ? 'Try changing or clearing your filters.' : 'Track studio costs to see accurate profit.'} action={activeCount > 0 ? <Button variant="outline" onClick={resetFilters}>Clear filters</Button> : <AddExpenseDialog />} />
        </div>
      ) : (
        <>
          {isFetching && <p className="mt-3 text-xs text-muted-foreground">Refreshing…</p>}
          <div className="mt-4">
          {isMobile ? (
            <RecordCards>
              {pageRows.map((e) => (
                <RecordCard
                  key={e.id}
                  title={
                    <span className="flex items-center gap-2">
                      <Wallet className="size-4 text-muted-foreground" />
                      {e.category ?? '—'}
                    </span>
                  }
                  subtitle={e.description ?? '—'}
                  badge={e.is_fixed_overhead ? <StatusBadge tone="info">overhead</StatusBadge> : undefined}
                  fields={[
                    { label: 'Date', value: e.expense_date },
                    { label: 'GST', value: humanize(e.gst_treatment) },
                    { label: 'Amount', value: formatINR(e.amount), strong: true },
                  ]}
                  actions={
                    <div className="flex gap-1">
                      <Button variant="outline" size="icon" title="View" onClick={() => setDetail(e)}><Eye /></Button>
                      <AddExpenseDialog expense={e} trigger={<Button variant="outline" size="icon"><Pencil /></Button>} />
                      <Button variant="outline" size="icon" onClick={() => void onDelete(e)}><Trash2 /></Button>
                    </div>
                  }
                />
              ))}
            </RecordCards>
          ) : (
          <div className="table-wrap rounded-lg border border-border">
            <table className="table-sticky w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Category</th>
                  <th className="px-4 py-2 font-medium">Description</th>
                  <th className="px-4 py-2 font-medium"><button type="button" className="hover:text-foreground" onClick={() => onSort('date')}>Date {sort === 'date' ? (dir === 'asc' ? '↑' : '↓') : ''}</button></th>
                  <th className="px-4 py-2 font-medium">GST</th>
                  <th className="px-4 py-2 text-right font-medium"><button type="button" className="hover:text-foreground" onClick={() => onSort('amount')}>Amount {sort === 'amount' ? (dir === 'asc' ? '↑' : '↓') : ''}</button></th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="px-4 py-2 font-medium">
                      <span className="flex items-center gap-2">
                        <Wallet className="size-4 text-muted-foreground" />
                        {e.category ?? '—'}
                        {e.is_fixed_overhead && <StatusBadge tone="info">overhead</StatusBadge>}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{e.description ?? '—'}</td>
                    <td className="px-4 py-2 text-muted-foreground">{e.expense_date}</td>
                    <td className="px-4 py-2 text-muted-foreground">{humanize(e.gst_treatment)}</td>
                    <td className="px-4 py-2 text-right font-medium">{formatINR(e.amount)}</td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" title="View" onClick={() => setDetail(e)}><Eye /></Button>
                        <AddExpenseDialog expense={e} trigger={<Button size="sm" variant="ghost" title="Edit"><Pencil /></Button>} />
                        <Button size="sm" variant="ghost" title="Delete" onClick={() => void onDelete(e)}><Trash2 /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          </div>

          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Page {safePage} of {totalPages} · {sorted.length} total</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Previous</Button>
                <Button size="sm" variant="outline" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Detail dialog (Lovable parity) */}
      <Dialog open={!!detail} onOpenChange={(v) => { if (!v) setDetail(null) }}>
        <DialogContent title="Expense detail" description={detail ? `${detail.category ?? 'Uncategorised'} · ${formatINR(detail.amount)}` : undefined}>
          {detail && (
            <dl className="grid gap-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Amount</dt>
                <dd className="text-lg font-semibold">{formatINR(detail.amount)}</dd>
              </div>
              <div className="flex items-center justify-between"><dt className="text-muted-foreground">Date</dt><dd>{detail.expense_date}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-muted-foreground">Category</dt><dd>{detail.category ?? 'Uncategorised'}</dd></div>
              <div><dt className="text-muted-foreground">Description</dt><dd className="mt-0.5 whitespace-pre-wrap">{detail.description ?? '—'}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-muted-foreground">Party</dt><dd>{detail.party_name ?? '—'}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-muted-foreground">GST</dt><dd>{humanize(detail.gst_treatment)}{detail.gst_rate != null ? ` · ${detail.gst_rate}%` : ''}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-muted-foreground">Invoice</dt><dd>{detail.invoice_number ?? '—'}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-muted-foreground">Tax</dt><dd>{detail.tax_name ?? '—'}{detail.tax_amount != null ? ` · ${formatINR(detail.tax_amount)}` : ''}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-muted-foreground">Reverse charge</dt><dd>{detail.reverse_charge ? 'Yes' : 'No'}</dd></div>
              {Array.isArray(detail.itemize_json) && detail.itemize_json.length > 0 && (
                <div><dt className="text-muted-foreground">Itemized lines ({detail.itemize_json.length})</dt></div>
              )}
            </dl>
          )}
        </DialogContent>
      </Dialog>

      <CategoryManager open={catsOpen} onOpenChange={setCatsOpen} />
    </>
  )
}

function CategoryManager({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { session } = useAuth()
  const { data, isLoading, refetch } = useActiveLookups('expense_category')
  const create = useCreateCustomLookup()
  const update = useUpdateCustomLookup()
  const remove = useDeleteCustomLookup()
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  async function onAdd() {
    if (!name.trim()) return
    await create.mutateAsync({ category: 'expense_category', value: name.trim() })
    setName('')
    void refetch()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Expense categories" description="Studio-wide categories used to filter and report expenses.">
        <div className="flex flex-col gap-3">
          {session?.is_owner && (
            <div className="flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name" />
              <Button size="sm" onClick={() => void onAdd()} disabled={!name.trim() || create.isPending}>Add</Button>
            </div>
          )}
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border">
              {(data ?? []).map((c) => (
                <li key={c.id} className="flex items-center gap-2 p-2 text-sm">
                  {editingId === c.id ? (
                    <>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="flex-1" />
                      <Button size="sm" onClick={() => { void update.mutateAsync({ id: c.id, patch: { value: editName.trim() } }).then(() => { setEditingId(null); void refetch() }) }} disabled={!editName.trim() || update.isPending}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 font-medium">{c.value}</span>
                      {session?.is_owner && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => { setEditingId(c.id); setEditName(c.value) }}>Rename</Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { void remove.mutateAsync(c.id).then(() => void refetch()) }}>Remove</Button>
                        </>
                      )}
                    </>
                  )}
                </li>
              ))}
              {(data ?? []).length === 0 && <li className="p-3 text-sm text-muted-foreground">No categories yet.</li>}
            </ul>
          )}
          <div className="flex justify-end">
            <DialogClose asChild><Button variant="outline">Close</Button></DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function AddExpenseDialog({
  expense,
  trigger,
  presetProjectId,
  defaultOpen = false,
  onClosed,
}: {
  expense?: Expense
  trigger?: React.ReactNode
  presetProjectId?: string
  /** Open on mount (editing from a row menu); `onClosed` fires when it shuts. */
  defaultOpen?: boolean
  onClosed?: () => void
} = {}) {
  const isEdit = !!expense
  const create = useCreateExpense()
  const update = useUpdateExpense()
  const { data: projects } = useProjects()
  const [open, setOpenState] = useState(defaultOpen)
  const setOpen = (v: boolean) => {
    setOpenState(v)
    if (!v) onClosed?.()
  }
  const [category, setCategory] = useState(expense?.category ?? '')
  const [description, setDescription] = useState(expense?.description ?? '')
  const [amount, setAmount] = useState(String(expense?.amount ?? ''))
  const [expenseDate, setExpenseDate] = useState(expense?.expense_date ?? todayISO())
  const [projectId, setProjectId] = useState(expense?.project_id ?? presetProjectId ?? '')
  const [partyId, setPartyId] = useState(expense?.party_id ?? '')
  const [overhead, setOverhead] = useState(expense?.is_fixed_overhead ?? false)
  const [gstTreatment, setGstTreatment] = useState<CreateExpenseRequest['gst_treatment']>(expense?.gst_treatment ?? 'non_gst')
  const [gstRate, setGstRate] = useState(expense?.gst_rate ?? 18)
  const [invoiceNumber, setInvoiceNumber] = useState(expense?.invoice_number ?? '')
  const [taxName, setTaxName] = useState(expense?.tax_name ?? '')
  const [taxAmount, setTaxAmount] = useState(expense?.tax_amount != null ? String(expense.tax_amount) : '')
  const [reverse, setReverse] = useState(expense?.reverse_charge ?? false)
  const [error, setError] = useState<string | null>(null)
  // From a project's tab the project is already known, so its picker and the
  // "shared overhead" option are noise. Tax paperwork is folded until asked for.
  const projectMode = !!presetProjectId && !isEdit
  const [showTax, setShowTax] = useState(
    !!(expense && (expense.gst_treatment !== 'non_gst' || expense.invoice_number || expense.tax_name || expense.tax_amount)),
  )

  function reset() {
    setCategory('')
    setDescription('')
    setAmount('')
    setExpenseDate(todayISO())
    // Added from a project: the next one belongs to it too. (Clearing this
    // saved the second expense unlinked, and it vanished from the tab.)
    setProjectId(presetProjectId ?? '')
    setPartyId('')
    setOverhead(false)
    setGstTreatment('non_gst')
    setGstRate(18)
    setInvoiceNumber('')
    setTaxName('')
    setTaxAmount('')
    setReverse(false)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      // A fixed-overhead expense is shared across every project (see
      // Settings → Financials); pinning it to one project too would count
      // it twice.
      const shared = {
        project_id: overhead ? null : projectId || null,
        party_id: partyId || null,
        amount: amount.trim() ? Number(amount) : 0,
        expense_date: expenseDate,
        is_fixed_overhead: overhead,
        gst_treatment: gstTreatment,
        ...(gstTreatment === 'gst_applicable' ? { gst_rate: gstRate } : {}),
        ...(invoiceNumber.trim() ? { invoice_number: invoiceNumber.trim() } : {}),
        ...(taxName.trim() ? { tax_name: taxName.trim() } : {}),
        ...(taxAmount.trim() ? { tax_amount: Number(taxAmount) } : {}),
        ...(reverse ? { reverse_charge: true } : {}),
      }
      if (isEdit) {
        // Editing resends category/description explicitly (null clears them)
        // instead of a falsy value silently dropping the key from the patch.
        await update.mutateAsync({
          id: expense.id,
          patch: { ...shared, category: category.trim() || null, description: description.trim() || null },
        })
      } else {
        const body: CreateExpenseRequest = {
          ...shared,
          ...(category.trim() ? { category: category.trim() } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
        }
        await create.mutateAsync(body)
      }
      setOpen(false)
      if (!isEdit) reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${isEdit ? 'update' : 'add'} the expense.`)
    }
  }

  const busy = create.isPending || update.isPending

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus /> Add expense
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title={isEdit ? 'Edit expense' : 'Add expense'} description={projectMode ? 'A cost for this project — it counts against its profit.' : 'Log a studio or project cost.'}>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <ExpenseCategoryPicker value={category} onChange={setCategory} />
            <div className="flex flex-col gap-1.5">
              <Label>Amount ₹</Label>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <PartyPicker value={partyId} onChange={setPartyId} />

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Date</Label>
              <Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
            </div>
            {!projectMode && (
            <div className="flex flex-col gap-1.5">
              <Label>Project</Label>
              <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={overhead}>
                <option value="">{overhead ? 'Shared across all projects' : 'Not linked to a project'}</option>
                {(projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            )}
          </div>

          {!projectMode && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={overhead}
              onChange={(e) => {
                setOverhead(e.target.checked)
                if (e.target.checked) setProjectId('')
              }}
            />
            Fixed overhead (shared equally across every active project)
          </label>
          )}

          {!showTax ? (
            <button type="button" onClick={() => setShowTax(true)} className="self-start text-xs font-medium text-primary hover:underline">
              + GST, invoice number or tax
            </button>
          ) : (
          <>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>GST treatment</Label>
              <Select value={gstTreatment} onChange={(e) => setGstTreatment(e.target.value as CreateExpenseRequest['gst_treatment'])}>
                <option value="non_gst">No GST</option>
                <option value="gst_applicable">GST applicable</option>
                <option value="exempt">Exempt</option>
                <option value="reverse_charge">Reverse charge</option>
              </Select>
            </div>
            {gstTreatment === 'gst_applicable' && (
              <div className="flex flex-col gap-1.5">
                <Label>GST rate</Label>
                <Select value={gstRate} onChange={(e) => setGstRate(Number(e.target.value))}>
                  {GST_RATES.map((r) => (
                    <option key={r} value={r}>
                      {r}%
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Invoice number</Label>
              <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="INV-001" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Tax name</Label>
              <Input value={taxName} onChange={(e) => setTaxName(e.target.value)} placeholder="GST" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Tax amount ₹</Label>
              <Input inputMode="decimal" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} placeholder="0" />
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} />
              Reverse charge
            </label>
          </div>
          </>
          )}

          {error && (
            <p id="form-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
