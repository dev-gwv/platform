import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Download, RefreshCcw } from 'lucide-react'
import type { MonthlySalary } from '@ipc/contracts'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { downloadCsv } from '@/shared/ui/csv'
import { formatINR } from '@/shared/ui/format'
import { useGenerateMonthlySalaries, useMonthlySalaries, useUpdateMonthlySalary } from './api'
import { PayToCard } from './PayToCard'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral'> = {
  paid: 'success',
  partially_paid: 'warning',
  partial: 'warning',
  unpaid: 'neutral',
}

const statusLabel = (s: string) =>
  s === 'partially_paid' || s === 'partial' ? 'Partially paid' : s === 'paid' ? 'Paid' : 'Unpaid'

/**
 * Monthly salary ledger: generate one row per active member per calendar
 * month, then track paid against base. Wires the existing monthly-salary
 * hooks (previously unused by any screen).
 */
export function SalariesTab() {
  const access = useAccess()
  const { session } = useAuth()
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<MonthlySalary | null>(null)

  const list = useMonthlySalaries({ month, year, status, search: search || undefined })
  const generate = useGenerateMonthlySalaries()

  const canManage = !!session?.is_owner || session?.role === 'admin'
  const rows = useMemo(() => list.data?.items ?? [], [list.data])
  const totals = list.data?.totals

  if (!access.hasModule('team_salaries')) {
    return (
      <Card className="mt-6">
        <CardContent className="py-16 text-center">
          <p className="font-medium">Salaries are restricted</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Ask the studio owner to grant you the Team salaries module if you need this.
          </p>
        </CardContent>
      </Card>
    )
  }

  async function onGenerate() {
    try {
      const res = await generate.mutateAsync({ month, year })
      toast.success(`Created ${res.created_count}, skipped ${res.skipped_existing_count}.`)
      if (res.errors.length) toast.warning(res.errors.join(' '))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to generate salaries.')
    }
  }

  function exportCsv() {
    if (rows.length === 0) {
      toast.error('Nothing to export.')
      return
    }
    const lines = rows.map((r) =>
      [
        r.name ?? '', r.email ?? '', r.phone ?? '',
        String(r.base_amount), String(r.paid_amount),
        String(Math.max(0, r.base_amount - r.paid_amount)), r.status,
      ]
        .map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v))
        .join(','),
    )
    downloadCsv(
      `salaries-${year}-${String(month).padStart(2, '0')}.csv`,
      ['Name,Email,Phone,Base,Paid,Pending,Status', ...lines].join('\n'),
    )
  }

  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - 2 + i)

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Salary management</h2>
          <p className="text-sm text-muted-foreground">
            Generate and track monthly salaries for your team.{' '}
            <Link to="/payroll" className="font-medium text-primary underline-offset-2 hover:underline">
              Pay the month from attendance in Payroll
            </Link>
            {list.isFetching && list.data ? ' · refreshing…' : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
            <Download /> Export CSV
          </Button>
          {canManage && (
            <Button onClick={() => void onGenerate()} disabled={generate.isPending}>
              <RefreshCcw /> {generate.isPending ? 'Generating…' : 'Generate salaries'}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label>Month</Label>
          <Select value={String(month)} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => (
              <option key={m} value={String(i + 1)}>{m}</option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Year</Label>
          <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Status</Label>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All</option>
            <option value="unpaid">Unpaid</option>
            <option value="partially_paid">Partially paid</option>
            <option value="paid">Paid</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Search</Label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, email, phone"
          />
        </div>
      </div>

      {totals && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Stat label="Total base" value={formatINR(totals.base)} />
          <Stat label="Total paid" value={formatINR(totals.paid)} />
          <Stat label="Total pending" value={formatINR(totals.pending)} />
          <Stat label="Paid" value={String(totals.paid_count)} />
          <Stat label="Partially paid" value={String(totals.partial_count)} />
          <Stat label="Unpaid" value={String(totals.unpaid_count)} />
        </div>
      )}

      {list.isLoading ? (
        <SkeletonList rows={5} columns={6} />
      ) : list.isError ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-4">
            <EmptyState
              title="No salary records for this period."
              description={
                canManage
                  ? 'Click Generate salaries to create rows for active employees.'
                  : 'Ask an admin to generate salaries for this month.'
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="table-wrap rounded-lg border border-border">
          <table className="table-sticky w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Employee</th>
                <th className="px-4 py-2 text-right font-medium">Base</th>
                <th className="px-4 py-2 text-right font-medium">Paid</th>
                <th className="px-4 py-2 text-right font-medium">Pending</th>
                <th className="px-4 py-2 font-medium">Status</th>
                {canManage && <th className="px-4 py-2"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-2">
                    <p className="font-medium">{r.name ?? r.user_id}</p>
                    {r.email && <p className="text-xs text-muted-foreground">{r.email}</p>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatINR(r.base_amount)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatINR(r.paid_amount)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatINR(Math.max(0, r.base_amount - r.paid_amount))}
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge tone={STATUS_TONE[r.status] ?? 'neutral'}>{statusLabel(r.status)}</StatusBadge>
                  </td>
                  {canManage && (
                    <td className="px-4 py-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                        Update
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <UpdateSalaryDialog row={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  )
}

/**
 * Update one ledger row. Overpayments are refused by the server unless the
 * caller confirms — the first save asks, the retry sends status paid to
 * confirm (matching the server's overpay guard).
 */
function UpdateSalaryDialog({ row, onClose }: { row: MonthlySalary; onClose: () => void }) {
  const update = useUpdateMonthlySalary()
  const [paid, setPaid] = useState(String(row.paid_amount))
  const [confirmingOverpay, setConfirmingOverpay] = useState(false)

  async function save(paidAmount: number, opts?: { markPaid?: boolean; markUnpaid?: boolean }) {
    try {
      if (opts?.markUnpaid) {
        await update.mutateAsync({ id: row.id, patch: { paid_amount: 0, status: 'unpaid' } })
      } else if (opts?.markPaid) {
        await update.mutateAsync({ id: row.id, patch: { paid_amount: row.base_amount, status: 'paid' } })
      } else if (confirmingOverpay) {
        await update.mutateAsync({ id: row.id, patch: { paid_amount: paidAmount, status: 'paid' } })
      } else {
        await update.mutateAsync({ id: row.id, patch: { paid_amount: paidAmount } })
      }
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to update salary.'
      if (!confirmingOverpay && /exceed/i.test(msg)) {
        setConfirmingOverpay(true)
      } else {
        toast.error(msg)
      }
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent
        title={`Update salary — ${row.name ?? row.user_id}`}
        description={`Base ${formatINR(row.base_amount)} · currently ${formatINR(row.paid_amount)} paid.`}
      >
        <div className="flex flex-col gap-3">
          <PayToCard userId={row.user_id} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="salary-paid">Paid amount (₹)</Label>
            <Input
              id="salary-paid"
              type="number"
              min={0}
              value={paid}
              onChange={(e) => {
                setPaid(e.target.value)
                setConfirmingOverpay(false)
              }}
            />
          </div>
          {confirmingOverpay && (
            <p role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              Paid amount exceeds the base salary. Press Save again to confirm the overpayment.
            </p>
          )}
          {update.isError && (
            <p role="alert" className="text-sm text-destructive">
              {update.error instanceof Error ? update.error.message : 'Unable to update salary.'}
            </p>
          )}
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={() => void save(0, { markUnpaid: true })} disabled={update.isPending}>
            Mark unpaid
          </Button>
          <Button variant="outline" onClick={() => void save(row.base_amount, { markPaid: true })} disabled={update.isPending}>
            Mark paid
          </Button>
          <Button onClick={() => void save(Number(paid))} disabled={update.isPending}>
            {update.isPending ? 'Saving…' : confirmingOverpay ? 'Confirm overpayment' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
