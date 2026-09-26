import { useEffect, useMemo, useState } from 'react'
import { Check, Download, Eye, Search, Trash2, Users, X } from 'lucide-react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { HowToUse } from '@/shared/ui/how-to-use'
import { Input, Select } from '@/shared/ui/input'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { SkeletonList } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { useConfirm } from '@/shared/ui/confirm'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { downloadCsv, toCsv } from '@/shared/ui/csv'
import { cn } from '@/shared/ui/cn'
import { useClient, useClients, useDeleteClient } from '@/features/clients/api'
import { ClientFormDialog } from '@/features/clients/ClientFormDialog'
import { AddMorePrompt, useFromSetup } from '@/features/onboarding/setup-flow'
import { ClientDetailDialog } from '@/features/clients/ClientDetailDialog'
import type { Client } from '@ipc/contracts'

export function ClientsListPage() {
  return (
    <AuthedPage module="clients">
      <ClientsList />
    </AuthedPage>
  )
}

/**
 * ?client=<id> opens that client's drawer.
 *
 * The list is paginated on the server, so a client linked to from elsewhere —
 * a converted lead, a project — is usually not on the page that loads. This
 * fetches the one client by id rather than hunting for it in `rows`, which
 * is why the link works for the two-hundredth client as well as the second.
 */
function useDeepLinkedClient(open: (c: Client) => void) {
  const id = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('client') ?? ''
  const { data } = useClient(id)
  useEffect(() => {
    // Keyed on the fetched client alone: re-running whenever `open` changed
    // identity would re-open the drawer the moment the user closed it.
    if (data) open(data)
  }, [data, open])
}

const SORTS = [
  { value: 'recent', label: 'Recent first' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'city', label: 'City (A–Z)' },
] as const

const added = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

function ClientsList() {
  // Arriving from the setup journey's "add your first client": the form is
  // already open, and saving asks whether to add another or move on.
  const fromSetup = useFromSetup()
  const [adding, setAdding] = useState(
    () => new URLSearchParams(window.location.search).get('add') === '1',
  )
  const [justAdded, setJustAdded] = useState(false)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'recent' | 'name' | 'city'>('recent')
  const [relation, setRelation] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 25
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [viewing, setViewing] = useState<Client | null>(null)
  useDeepLinkedClient(setViewing)

  const { data, isLoading, isError, refetch } = useClients({
    page,
    page_size: pageSize,
    ...(search.trim() ? { search: search.trim() } : {}),
    sort,
    ...(relation.trim() ? { relation: relation.trim() } : {}),
    ...(from ? { created_from: from } : {}),
    ...(to ? { created_to: to } : {}),
  })
  const del = useDeleteClient()
  const confirm = useConfirm()
  const isMobile = useIsMobile()

  const rows = useMemo(() => (data && !Array.isArray(data) ? data.items : []), [data])
  const total = !data || Array.isArray(data) ? 0 : data.total
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const allTicked = rows.length > 0 && rows.every((c) => selected.has(c.id))
  const toggleAll = () => setSelected(allTicked ? new Set() : new Set(rows.map((c) => c.id)))
  const toggleOne = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const exporting = useMemo(
    () => (selected.size ? rows.filter((c) => selected.has(c.id)) : rows),
    [rows, selected],
  )

  function exportCsv() {
    downloadCsv(
      'clients.csv',
      toCsv(
        ['Name', 'Phone', 'Email', 'City', 'Relation', 'Address', 'Notes', 'Created'],
        exporting.map((c) => [
          c.name,
          c.phone ?? '',
          c.email ?? '',
          c.city ?? '',
          c.relation ?? '',
          c.address ?? '',
          c.notes ?? '',
          c.created_at.slice(0, 10),
        ]),
      ),
    )
  }

  async function onDelete(id: string, name: string) {
    const yes = await confirm({
      title: `Delete ${name}?`,
      description: 'Clients with linked projects cannot be deleted.',
      destructive: true,
      confirmLabel: 'Delete',
    })
    if (!yes) return
    del.mutate(id)
  }

  function resetPage() {
    setPage(1)
  }

  return (
    <>
      <PageHeader
        title="Clients"
        description="Everyone your studio works with."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={exportCsv} disabled={exporting.length === 0}>
              <Download /> {selected.size ? `Export (${selected.size})` : 'Export CSV'}
            </Button>
            <ClientFormDialog />
          </div>
        }
      />

      <ClientFormDialog
        hideTrigger
        nudge={fromSetup}
        open={adding}
        onOpenChange={setAdding}
        onCreated={() => setJustAdded(true)}
      />
      <AddMorePrompt
        open={justAdded}
        title="Client added"
        description="Add another client now, or carry on — you can add clients any time, including while creating a project."
        moreLabel="Add another client"
        fromSetup={fromSetup}
        step="client"
        onMore={() => {
          setJustAdded(false)
          setAdding(true)
        }}
        onDone={() => setJustAdded(false)}
      />

      <HowToUse
        className="mt-4"
        title="Clients"
        description="Your booked clients and customer records — saved once, reused by every project."
        steps={[
          'Add the client’s name and contact details.',
          'Open the profile to see their history and documents.',
          'Create their wedding or event project from there.',
        ]}
      />

      <div className="mt-4 grid grid-cols-1 gap-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-6">
        <label className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage() }}
            placeholder="Search name, phone, email, city…"
            aria-label="Search clients"
            className="pl-9"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">Sort</span>
          <Select value={sort} onChange={(e) => { setSort(e.target.value as typeof sort); resetPage() }} aria-label="Sort clients" className="w-full">
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </label>
        <Input value={relation} onChange={(e) => { setRelation(e.target.value); resetPage() }} placeholder="Relation: referral, repeat…" aria-label="Filter by relation" />
        <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); resetPage() }} aria-label="Added from" />
        <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); resetPage() }} aria-label="Added to" />
        <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-6">
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setRelation(''); setFrom(''); setTo(''); setSort('recent'); setSelected(new Set()); resetPage() }}>
            <X /> Clear filters
          </Button>
          {selected.size > 0 && (
            <span className="text-xs text-muted-foreground">{selected.size} selected</span>
          )}
        </div>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <SkeletonList rows={5} columns={5} />
        ) : isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No clients found"
            description="Try a different search, or add a new client."
            action={<ClientFormDialog />}
          />
        ) : isMobile ? (
          <div className="flex flex-col gap-3">
            {rows.map((c) => (
              <div key={c.id} className="rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-2">
                  <button type="button" className="text-left" onClick={() => setViewing(c)}>
                    <p className="font-medium hover:underline">{c.name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {[c.phone, c.city, c.relation].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </button>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="outline" size="icon" aria-label={`View ${c.name}`} onClick={() => setViewing(c)}>
                      <Eye />
                    </Button>
                    <ClientFormDialog client={c} />
                    <Button variant="outline" size="icon" aria-label={`Delete ${c.name}`} onClick={() => void onDelete(c.id, c.name)}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="table-wrap rounded-lg border border-border">
            <table className="table-sticky w-full min-w-[60rem] text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <Tick checked={allTicked} onToggle={toggleAll} label={allTicked ? 'Clear the selection' : 'Select every client listed'} />
                  </th>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Phone</th>
                  <th className="px-4 py-2 font-medium">City</th>
                  <th className="px-4 py-2 font-medium">Relation</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Address</th>
                  <th className="px-4 py-2 font-medium">Added</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className={cn('border-t border-border hover:bg-muted/30', selected.has(c.id) && 'bg-primary/5')}>
                    <td className="px-3 py-2">
                      <Tick checked={selected.has(c.id)} onToggle={() => toggleOne(c.id)} label={`Select ${c.name}`} />
                    </td>
                    <td className="px-4 py-2 font-medium">
                      <button type="button" className="flex items-center gap-2 hover:underline" onClick={() => setViewing(c)}>
                        <Users className="size-4 text-muted-foreground" />
                        {c.name}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{c.phone ?? '—'}</td>
                    <td className="px-4 py-2 text-muted-foreground">{c.city ?? '—'}</td>
                    <td className="px-4 py-2">
                      {c.relation ? <StatusBadge tone="neutral">{c.relation}</StatusBadge> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{c.email ?? '—'}</td>
                    <td className="max-w-48 truncate px-4 py-2 text-muted-foreground" title={c.address ?? undefined}>
                      {c.address ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{added.format(new Date(c.created_at))}</td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1">
                        <Button variant="outline" size="icon" aria-label={`View ${c.name}`} onClick={() => setViewing(c)}>
                          <Eye />
                        </Button>
                        <ClientFormDialog client={c} />
                        <Button variant="outline" size="icon" aria-label={`Delete ${c.name}`} onClick={() => void onDelete(c.id, c.name)}>
                          <Trash2 />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>Page {page} of {totalPages} · {total} clients</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
            </div>
          </div>
        )}
      </div>

      <ClientDetailDialog client={viewing} open={!!viewing} onOpenChange={(v) => { if (!v) setViewing(null) }} />
    </>
  )
}

function Tick({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onToggle() }}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors',
        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input hover:border-primary/50',
      )}
    >
      {checked && <Check className="size-3" aria-hidden />}
    </button>
  )
}
