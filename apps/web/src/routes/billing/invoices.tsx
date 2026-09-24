import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Copy, Download, Eye, IndianRupee, Mail, MessageCircle, Plus } from 'lucide-react'
import type { InvoiceListItem } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { useAccess } from '@/shared/auth/useAccess'
import { useUrlParam } from '@/shared/hooks/use-url-param'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { Button } from '@/shared/ui/button'
import { Input, Select } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { RecordCard, RecordCards } from '@/shared/ui/record-card'
import { RowMenu } from '@/shared/ui/row-menu'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { downloadCsv, toCsv } from '@/shared/ui/csv'
import { useInvoices } from '@/features/billing/api'
import { NewInvoiceDialog } from '@/features/billing/NewInvoiceDialog'
import { RecordPaymentDialog } from '@/features/billing/RecordPaymentDialog'
import { dueText, invoiceBadge, isOverdue, shortDate } from '@/features/billing/status'
import { copyInvoiceLink, emailInvoice, whatsappInvoice } from '@/features/billing/share'
import { useClients } from '@/features/clients/api'
import { useProjects } from '@/features/projects/api'

const PAGE_SIZE = 25

/** The questions people ask of their invoices, as tabs. */
const VIEWS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Unpaid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'due_soon', label: 'Due this week' },
  { value: 'paid', label: 'Paid' },
  { value: 'draft', label: 'Drafts' },
  { value: 'cancelled', label: 'Cancelled' },
] as const

export function InvoicesPage() {
  return (
    <AuthedPage module="billing">
      <Invoices />
    </AuthedPage>
  )
}

/**
 * Every invoice, with its project beside it. Filters live in the address, so
 * "this project's invoices" or "what is overdue" is a link that can be sent.
 */
function Invoices() {
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const access = useAccess()
  const canInvoice = access.hasAction('billing', 'create')
  const canRecord = access.hasAction('billing', 'edit')
  const [status, setStatus] = useUrlParam('status', 'all')
  const [clientId, setClientId] = useUrlParam('client')
  const [projectId, setProjectId] = useUrlParam('project')
  const [from, setFrom] = useUrlParam('from')
  const [to, setTo] = useUrlParam('to')
  const [search, setSearch] = useUrlParam('q')
  const [searchInput, setSearchInput] = useState(search)
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [recording, setRecording] = useState<InvoiceListItem | null>(null)
  const { data: clientsData } = useClients()
  const clients = Array.isArray(clientsData) ? clientsData : (clientsData?.items ?? [])
  const { data: projects } = useProjects()

  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput.trim() !== search) {
        setSearch(searchInput.trim())
        setPage(1)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput, search, setSearch])

  const { data, isLoading, isError, refetch, isFetching } = useInvoices({
    search,
    status,
    client_id: clientId || undefined,
    project_id: projectId || undefined,
    from: from || undefined,
    to: to || undefined,
    page,
    page_size: PAGE_SIZE,
  })
  const items = data?.items ?? []
  const summary = data?.summary
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const clientProjects = (projects ?? []).filter((p) => !clientId || p.client_id === clientId)
  const pickedProject = (projects ?? []).find((p) => p.id === projectId)
  const anyFilter = !!search || status !== 'all' || !!clientId || !!projectId || !!from || !!to
  const change = (fn: () => void) => {
    fn()
    setPage(1)
  }

  function resetFilters() {
    setSearchInput('')
    change(() => {
      setSearch('')
      setStatus('all')
      setClientId('')
      setProjectId('')
      setFrom('')
      setTo('')
    })
  }

  function exportCsv() {
    const csv = toCsv(
      ['Number', 'Client', 'Project', 'Date', 'Due', 'Total', 'Balance', 'Status'],
      items.map((inv) => [inv.invoice_number, inv.client_name ?? '', inv.project_name ?? '', inv.invoice_date, inv.due_date ?? '', inv.total, inv.balance_due, invoiceBadge(inv).label]),
    )
    downloadCsv(`invoices-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  const actionsFor = (inv: InvoiceListItem) => {
    const sendable = inv.status !== 'draft' && inv.status !== 'cancelled'
    const owed = inv.balance_due > 0 && sendable
    return (
      <div className="flex items-center justify-end gap-1">
        {owed && canRecord && (
          <Button size="sm" variant="outline" onClick={() => setRecording(inv)}>
            <IndianRupee /> Record
          </Button>
        )}
        <RowMenu
          label={`More for ${inv.invoice_number}`}
          items={[
            { label: 'Open invoice', icon: <Eye className="size-4" />, onSelect: () => void navigate({ to: '/billing/invoices/$id', params: { id: inv.id } }) },
            ...(sendable
              ? [
                  { label: owed && isOverdue(inv) ? 'WhatsApp reminder' : 'Send on WhatsApp', icon: <MessageCircle className="size-4" />, onSelect: () => void whatsappInvoice(inv, owed && isOverdue(inv)) },
                  { label: 'Send by email', icon: <Mail className="size-4" />, onSelect: () => void emailInvoice(inv, owed && isOverdue(inv)) },
                  { label: 'Copy client link', icon: <Copy className="size-4" />, onSelect: () => void copyInvoiceLink(inv.id) },
                ]
              : []),
          ]}
        />
      </div>
    )
  }

  return (
    <>
      <PageHeader
        title="Invoices"
        description={pickedProject ? `Invoices for ${pickedProject.name}.` : 'Every invoice, with the project it belongs to.'}
        actions={
          canInvoice && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New invoice
            </Button>
          )
        }
      />
      {creating && <NewInvoiceDialog initial={projectId && pickedProject ? { project_id: projectId, client_id: pickedProject.client_id } : undefined} onClose={() => setCreating(false)} />}

      <div className="mb-3 flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Which invoices">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            role="tab"
            aria-selected={status === v.value}
            onClick={() => change(() => setStatus(v.value))}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1 text-sm transition-colors',
              status === v.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted',
              v.value === 'overdue' && status !== v.value && 'text-destructive',
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search number or client…" className="w-full sm:w-56" aria-label="Search invoices" />
        <Select
          value={clientId}
          onChange={(e) => change(() => {
            setClientId(e.target.value)
            setProjectId('')
          })}
          className="w-full sm:w-44"
          aria-label="Filter by client"
        >
          <option value="">All clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select value={projectId} onChange={(e) => change(() => setProjectId(e.target.value))} className="w-full sm:w-52" aria-label="Filter by project">
          <option value="">All projects</option>
          {clientProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Input type="date" value={from} onChange={(e) => change(() => setFrom(e.target.value))} className="w-full sm:w-40" aria-label="From date" />
        <Input type="date" value={to} onChange={(e) => change(() => setTo(e.target.value))} className="w-full sm:w-40" aria-label="To date" />
        {anyFilter && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            Clear
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={items.length === 0} className="ml-auto">
          <Download /> CSV
        </Button>
      </div>

      {summary && (
        <p className="mb-3 text-sm text-muted-foreground">
          {summary.total_invoices} invoice{summary.total_invoices === 1 ? '' : 's'} · Billed <b className="text-foreground">{formatINR(summary.billed)}</b> · Paid{' '}
          <b className="text-tone-green">{formatINR(summary.paid)}</b> · Unpaid <b className={cn(summary.pending > 0 && 'text-warning')}>{formatINR(summary.pending)}</b>
          {isFetching ? ' · Refreshing…' : ''}
        </p>
      )}

      {isLoading ? (
        <SkeletonList rows={5} columns={6} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : total === 0 ? (
        anyFilter ? (
          <EmptyState title="No invoices match" description="Try another tab, or clear the filters." />
        ) : (
          <EmptyState
            title="No invoices yet"
            description="Raise one here, or from a project's Billing tab."
            action={
              canInvoice ? (
                <Button onClick={() => setCreating(true)}>
                  <Plus /> New invoice
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          {isMobile ? (
            <RecordCards>
              {items.map((inv) => {
                const badge = invoiceBadge(inv)
                return (
                  <RecordCard
                    key={inv.id}
                    title={
                      <Link to="/billing/invoices/$id" params={{ id: inv.id }} className="hover:underline">
                        {inv.invoice_number}
                      </Link>
                    }
                    subtitle={`${inv.client_name ?? '—'}${inv.project_name ? ` · ${inv.project_name}` : ''}`}
                    badge={<StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>}
                    fields={[
                      { label: 'Total', value: formatINR(inv.total) },
                      { label: 'Balance', value: formatINR(inv.balance_due), strong: true },
                      { label: 'Date', value: shortDate(inv.invoice_date) },
                      { label: 'Due', value: dueText(inv) ?? shortDate(inv.due_date) },
                    ]}
                    actions={actionsFor(inv)}
                  />
                )
              })}
            </RecordCards>
          ) : (
            <div className="table-wrap rounded-lg border border-border">
              <table className="table-sticky w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Number</th>
                    <th className="px-3 py-2 font-medium">Client · Project</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Due</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                    <th className="px-3 py-2 text-right font-medium">Balance</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((inv) => {
                    const badge = invoiceBadge(inv)
                    const late = isOverdue(inv)
                    return (
                      <tr key={inv.id} className="border-t border-border">
                        <td className="px-3 py-2 font-medium">
                          <Link to="/billing/invoices/$id" params={{ id: inv.id }} className="hover:underline">
                            {inv.invoice_number}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <div>{inv.client_name ?? '—'}</div>
                          {inv.project_id && (
                            <Link to="/projects/$id" params={{ id: inv.project_id }} search={{ tab: 'billing' }} className="text-xs text-primary hover:underline">
                              {inv.project_name}
                            </Link>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{shortDate(inv.invoice_date)}</td>
                        <td className={cn('whitespace-nowrap px-3 py-2 text-muted-foreground', late && 'font-medium text-destructive')}>
                          {dueText(inv) ?? shortDate(inv.due_date)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatINR(inv.total)}</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">{inv.status === 'cancelled' ? '—' : formatINR(inv.balance_due)}</td>
                        <td className="px-3 py-2">
                          <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                        </td>
                        <td className="px-3 py-2">{actionsFor(inv)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                Page {page} of {totalPages} · {total} total
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                  <ChevronLeft /> Prev
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                  Next <ChevronRight />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      {recording && (
        <RecordPaymentDialog
          target={{ kind: 'invoice', invoiceId: recording.id, invoiceNumber: recording.invoice_number }}
          suggested={recording.balance_due}
          onClose={() => setRecording(null)}
        />
      )}
    </>
  )
}
