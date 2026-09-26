import { Fragment, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { CheckCircle2, Download, FileText, RefreshCcw, Wallet } from 'lucide-react'
import type { PayrollLine, PayrollRun } from '@ipc/contracts'
import { MONTH_NAMES, monthLabel, netPay, payrollBankRows, payrollTotals, PAYROLL_BANK_HEADERS } from '@ipc/domain'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { MetricCard } from '@/shared/ui/metric-card'
import { SkeletonList } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { downloadCsv, toCsv } from '@/shared/ui/csv'
import { formatINR } from '@/shared/ui/format'
import { PayToCard } from '@/features/team/PayToCard'
import {
  fetchPayrollExport,
  useApprovePayroll,
  useGeneratePayroll,
  useMarkPayrollPaid,
  usePayrollMonth,
  useUpdatePayrollLine,
} from '@/features/payroll/api'

/**
 * Pay everyone this month, on one screen.
 *
 *   1. Work out pay: one line per in-house member on a monthly salary, with
 *      deductions for unpaid leave and absences counted from attendance.
 *   2. Add a bonus or take back an advance, with a note.
 *   3. Approve: the month is locked.
 *   4. Pay each person (their UPI / bank details are right there) or all at
 *      once, and download the bank sheet.
 *
 * Shoot payouts owed to freelancers for the month are listed underneath, so
 * everything owed is in one place; they are paid from Team Payouts.
 */
export function PayrollPage() {
  return (
    <AuthedPage module="team_salaries">
      <Payroll />
    </AuthedPage>
  )
}

const STATUS: Record<PayrollRun['status'], { label: string; tone: 'neutral' | 'info' | 'success' }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  approved: { label: 'Approved', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
}

const MODES = ['UPI', 'Bank transfer', 'Cash', 'Cheque'] as const

const days = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

function Payroll() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const q = usePayrollMonth(year, month)
  const generate = useGeneratePayroll()
  const approve = useApprovePayroll()
  const [paying, setPaying] = useState<PayrollLine | 'all' | null>(null)
  const [adjusting, setAdjusting] = useState<string | null>(null)
  const [confirmApprove, setConfirmApprove] = useState(false)

  const run = q.data?.run ?? null
  const lines = useMemo(() => q.data?.lines ?? [], [q.data])
  const canEdit = !!q.data?.can_edit
  const totals = payrollTotals(lines)
  const unpaid = lines.filter((l) => !l.paid_at)
  const years = Array.from({ length: 4 }, (_, i) => now.getFullYear() - 2 + i)
  const label = monthLabel(year, month)

  async function exportSheet() {
    if (!run) return
    try {
      const rows = await fetchPayrollExport(run.id)
      downloadCsv(`payroll-${year}-${String(month).padStart(2, '0')}.csv`, toCsv(PAYROLL_BANK_HEADERS, payrollBankRows(rows)))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not download the sheet.')
    }
  }

  return (
    <>
      <PageHeader title="Payroll" description="Work out, approve and pay the whole team’s salary for a month." />

      <div className="flex flex-col gap-4">
        {/* Month and what to do next */}
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-end">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label>Month</Label>
              <Select value={String(month)} onChange={(e) => setMonth(Number(e.target.value))}>
                {MONTH_NAMES.map((m, i) => (
                  <option key={m} value={String(i + 1)}>{m}</option>
                ))}
              </Select>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label>Year</Label>
              <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))}>
                {years.map((y) => (
                  <option key={y} value={String(y)}>{y}</option>
                ))}
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {run && <StatusBadge tone={STATUS[run.status].tone}>{STATUS[run.status].label}</StatusBadge>}
            {canEdit && (!run || run.status === 'draft') && (
              <Button
                variant={run ? 'outline' : 'default'}
                onClick={() => generate.mutate({ year, month })}
                disabled={generate.isPending}
              >
                <RefreshCcw /> {generate.isPending ? 'Working out…' : run ? 'Work out again' : 'Work out pay'}
              </Button>
            )}
            {canEdit && run?.status === 'draft' && lines.length > 0 && (
              <Button onClick={() => setConfirmApprove(true)}>
                <CheckCircle2 /> Approve
              </Button>
            )}
            {canEdit && run?.status === 'approved' && unpaid.length > 0 && (
              <Button onClick={() => setPaying('all')}>
                <Wallet /> Mark all paid
              </Button>
            )}
            {canEdit && run && run.status !== 'draft' && (
              <Button variant="outline" onClick={() => void exportSheet()}>
                <Download /> Bank sheet
              </Button>
            )}
          </div>
        </div>

        {q.isLoading ? (
          <SkeletonList rows={4} columns={5} />
        ) : q.isError ? (
          <ErrorState onRetry={() => void q.refetch()} />
        ) : !run ? (
          <Card>
            <CardContent className="py-2">
              <EmptyState
                title={`No payroll for ${label} yet`}
                description={
                  canEdit
                    ? 'Work out pay to make one line for each team member on a monthly salary, using their attendance and leave.'
                    : 'Ask the owner to work out this month’s pay.'
                }
              />
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard label="Net pay" value={formatINR(totals.net)} tone="muted" hint={label} />
              <MetricCard label="Paid" value={formatINR(totals.paid)} tone="success" />
              <MetricCard label="Still to pay" value={formatINR(totals.pending)} tone={totals.pending > 0 ? 'warning' : 'muted'} />
              <MetricCard label="People" value={String(totals.people)} tone="muted" />
            </div>

            {run.status === 'draft' && (
              <p className="text-sm text-muted-foreground">
                Pay is cut for unpaid leave and absent days: salary ÷ working days × those days. Late marks are shown but not cut.
              </p>
            )}

            {lines.length === 0 ? (
              <Card>
                <CardContent className="py-2">
                  <EmptyState
                    title="Nobody to pay this month"
                    description="Only in-house team members with a monthly salary or stipend are included. Set pay on their team profile."
                  />
                </CardContent>
              </Card>
            ) : (
              <div className="table-wrap rounded-lg border border-border">
                <table className="w-full min-w-[46rem] text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Member</th>
                      <th className="px-3 py-2 text-right font-medium">Salary</th>
                      <th className="px-3 py-2 text-right font-medium">Cut for days</th>
                      <th className="px-3 py-2 text-right font-medium">Added</th>
                      <th className="px-3 py-2 text-right font-medium">Other cuts</th>
                      <th className="px-3 py-2 text-right font-medium">Net pay</th>
                      <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <Fragment key={l.id}>
                        <tr className="border-t border-border align-top">
                          <td className="px-3 py-2">
                            <p className="font-medium">{l.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {l.days_present} of {l.working_days} days in
                              {l.unpaid_leave_days > 0 && ` · ${days(l.unpaid_leave_days)} unpaid leave`}
                              {l.absent_days > 0 && ` · ${l.absent_days} absent`}
                              {l.late_marks > 0 && ` · ${l.late_marks} late`}
                            </p>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatINR(l.base_amount)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{l.deduction > 0 ? `−${formatINR(l.deduction)}` : '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {l.additions > 0 ? `+${formatINR(l.additions)}` : '—'}
                            {l.additions_note && <p className="text-xs text-muted-foreground">{l.additions_note}</p>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {l.other_deductions > 0 ? `−${formatINR(l.other_deductions)}` : '—'}
                            {l.other_deductions_note && <p className="text-xs text-muted-foreground">{l.other_deductions_note}</p>}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatINR(l.net_pay)}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-1.5">
                              {l.paid_at && <StatusBadge tone="success">Paid</StatusBadge>}
                              {canEdit && run.status === 'draft' && (
                                <Button size="sm" variant="outline" onClick={() => setAdjusting(adjusting === l.id ? null : l.id)}>
                                  {adjusting === l.id ? 'Close' : 'Adjust'}
                                </Button>
                              )}
                              {canEdit && run.status !== 'draft' && !l.paid_at && (
                                <Button size="sm" onClick={() => setPaying(l)}>
                                  Mark paid
                                </Button>
                              )}
                              {run.status !== 'draft' && (
                                <Button size="sm" variant="ghost" asChild>
                                  <Link to="/payroll/payslip/$lineId" params={{ lineId: l.id }} aria-label={`Payslip for ${l.name}`}>
                                    <FileText /> Payslip
                                  </Link>
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {adjusting === l.id && (
                          <tr className="bg-muted/30">
                            <td colSpan={7} className="px-3 py-3">
                              <AdjustRow line={l} onDone={() => setAdjusting(null)} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {q.data?.freelancers && q.data.freelancers.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">Shoot payouts still owed</h2>
                <Button size="sm" variant="outline" asChild>
                  <Link to="/team-payouts">Pay in Team Payouts</Link>
                </Button>
              </div>
              <ul className="mt-2 divide-y divide-border">
                {q.data.freelancers.map((f) => (
                  <li key={f.user_id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 text-sm">
                    <span className="min-w-0 flex-1 font-medium">{f.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {f.shoots} {f.shoots === 1 ? 'shoot' : 'shoots'}
                      {f.paid > 0 && ` · ${formatINR(f.paid)} paid`}
                    </span>
                    <span className="font-semibold tabular-nums">{formatINR(f.due)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      {confirmApprove && run && (
        <Dialog open onOpenChange={(o) => !o && setConfirmApprove(false)}>
          <DialogContent
            title={`Approve ${label}?`}
            description={`${lines.length} ${lines.length === 1 ? 'person' : 'people'}, ${formatINR(totals.net)} in all. After this the numbers are locked and each person can see their payslip.`}
          >
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmApprove(false)}>
                Not yet
              </Button>
              <Button
                disabled={approve.isPending}
                onClick={() => approve.mutate(run.id, { onSuccess: () => setConfirmApprove(false) })}
              >
                {approve.isPending ? 'Approving…' : 'Approve'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {paying && run && (
        <PayDialog
          runId={run.id}
          line={paying === 'all' ? null : paying}
          count={paying === 'all' ? unpaid.length : 1}
          amount={paying === 'all' ? unpaid.reduce((n, l) => n + l.net_pay, 0) : paying.net_pay}
          onClose={() => setPaying(null)}
        />
      )}
    </>
  )
}

/** A bonus or allowance, and an advance taken back, each with a note; net pay updates as you type. */
function AdjustRow({ line, onDone }: { line: PayrollLine; onDone: () => void }) {
  const update = useUpdatePayrollLine()
  const [add, setAdd] = useState(line.additions ? String(line.additions) : '')
  const [addNote, setAddNote] = useState(line.additions_note ?? '')
  const [cut, setCut] = useState(line.other_deductions ? String(line.other_deductions) : '')
  const [cutNote, setCutNote] = useState(line.other_deductions_note ?? '')
  const additions = Math.max(0, Number(add) || 0)
  const other = Math.max(0, Number(cut) || 0)
  const net = netPay({ base: line.base_amount, deduction: line.deduction, additions, otherDeductions: other })
  const missingNote = (additions > 0 && !addNote.trim()) || (other > 0 && !cutNote.trim())

  return (
    <form
      // Pinned to the left of the scrolling table, and no wider than the
      // screen, so on a phone the fields are in view without scrolling sideways.
      className="sticky left-3 flex max-w-[calc(100vw-4.5rem)] flex-col gap-3 sm:max-w-none"
      onSubmit={(e) => {
        e.preventDefault()
        update.mutate(
          {
            id: line.id,
            body: { additions, additions_note: addNote.trim() || null, other_deductions: other, other_deductions_note: cutNote.trim() || null },
          },
          { onSuccess: onDone },
        )
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid grid-cols-[7rem_1fr] gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`add-${line.id}`}>Add (₹)</Label>
            <Input id={`add-${line.id}`} type="number" min={0} inputMode="decimal" value={add} onChange={(e) => setAdd(e.target.value)} />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`add-note-${line.id}`}>For</Label>
            <Input id={`add-note-${line.id}`} maxLength={200} placeholder="Bonus, travel allowance…" value={addNote} onChange={(e) => setAddNote(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-[7rem_1fr] gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`cut-${line.id}`}>Take off (₹)</Label>
            <Input id={`cut-${line.id}`} type="number" min={0} inputMode="decimal" value={cut} onChange={(e) => setCut(e.target.value)} />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`cut-note-${line.id}`}>For</Label>
            <Input id={`cut-note-${line.id}`} maxLength={200} placeholder="Advance, loan…" value={cutNote} onChange={(e) => setCutNote(e.target.value)} />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          Net pay <span className="font-semibold tabular-nums">{formatINR(net)}</span>
          {missingNote && <span className="ml-2 text-xs text-destructive">Add a note for each amount.</span>}
        </p>
        <Button type="submit" size="sm" disabled={update.isPending || missingNote}>
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  )
}

function PayDialog({
  runId,
  line,
  count,
  amount,
  onClose,
}: {
  runId: string
  line: PayrollLine | null
  count: number
  amount: number
  onClose: () => void
}) {
  const pay = useMarkPayrollPaid()
  const [mode, setMode] = useState<string>(MODES[0])
  const [reference, setReference] = useState('')

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={line ? `Pay ${line.name}` : `Mark ${count} ${count === 1 ? 'person' : 'people'} paid`}
        description={`${formatINR(amount)}${line ? '' : ' in all'}. Each person is told their payslip is ready.`}
      >
        <div className="flex flex-col gap-3">
          {line && <PayToCard userId={line.user_id} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Paid by</Label>
              <Select value={mode} onChange={(e) => setMode(e.target.value)}>
                {MODES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-ref">Reference (optional)</Label>
              <Input id="pay-ref" maxLength={120} placeholder="UTR or cheque no." value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pay.isPending}
            onClick={() =>
              pay.mutate(
                { runId, body: { ...(line ? { line_id: line.id } : {}), payment_mode: mode, reference: reference.trim() || null } },
                {
                  onSuccess: (r) => {
                    toast.success(`${r.paid_count} marked paid · ${formatINR(r.paid_total)}`)
                    onClose()
                  },
                },
              )
            }
          >
            {pay.isPending ? 'Saving…' : 'Mark paid'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
