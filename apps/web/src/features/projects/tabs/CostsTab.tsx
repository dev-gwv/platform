import { Printer } from 'lucide-react'
import type { ProjectCostSheet } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { useAccess } from '@/shared/auth/useAccess'
import { AddExpenseDialog } from '@/features/expenses/ExpenseDialog'
import { useProjectCosts } from '../api'

const day = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

/**
 * The project's cost sheet: what each person booked on it is paid (and how
 * much has gone out), every expense against it, and what is left of the
 * project value. The owner asked for "all the cost of the project, including
 * the payouts to the team", in one place.
 */
export function CostsTab({ projectId, onBookTeam }: { projectId: string; onBookTeam?: (() => void) | undefined }) {
  const costs = useProjectCosts(projectId)
  const canAddExpense = useAccess().hasModule('company_expenses')

  if (costs.isLoading) return <SkeletonList rows={5} columns={4} />
  if (costs.isError || !costs.data) return <ErrorState onRetry={() => void costs.refetch()} />
  const c = costs.data
  const due = Math.max(0, c.team_total - c.team_paid)

  return (
    <div className="mt-4 flex flex-col gap-4 print:mt-0">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-sm">
              <Sentence c={c} />
            </p>
            <Button variant="outline" size="sm" onClick={() => window.print()} className="no-print">
              <Printer /> Print
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Figure label="Project value" value={c.project_value} />
            <Figure label="Team payouts" value={c.team_total} sub={due > 0 ? `${formatINR(due)} still to pay` : c.team_total > 0 ? 'All paid' : undefined} />
            <Figure label="Expenses" value={c.expenses === null ? null : c.expenses_total} />
            <Figure label={c.profit >= 0 ? 'Left for the studio' : 'Over budget by'} value={Math.abs(c.profit)} tone={c.profit >= 0 ? 'good' : 'bad'} />
          </div>
        </CardContent>
      </Card>

      <Section title="Team payouts" total={c.team_total}>
        {c.team.length === 0 ? (
          <Empty>
            Nobody is booked yet.{' '}
            {onBookTeam && (
              <button type="button" onClick={onBookTeam} className="font-medium text-primary hover:underline">
                Book the team
              </button>
            )}
          </Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Person</th>
                <th className="px-3 py-2 font-medium">Shoot</th>
                <th className="px-3 py-2 text-right font-medium">Payout</th>
                <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Paid</th>
              </tr>
            </thead>
            <tbody>
              {c.team.map((t) => (
                <tr key={t.slot_id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <p className="font-medium">{t.user_name ?? '—'}</p>
                    <p className="text-xs text-muted-foreground">{t.role ?? 'Crew'}</p>
                  </td>
                  <td className="px-3 py-2">
                    <p>{t.shoot_name ?? '—'}</p>
                    <p className="text-xs text-muted-foreground">{day(t.shoot_date)}</p>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {t.cost > 0 ? (
                      <>
                        {formatINR(t.cost)}
                        {t.cost_status !== 'final' && <p className="text-[11px] text-muted-foreground">not final</p>}
                      </>
                    ) : (
                      <span className="text-xs font-medium text-warning">No payout set</span>
                    )}
                  </td>
                  <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">
                    {t.paid > 0 ? formatINR(t.paid) : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {c.expenses !== null && (
        <Section
          title="Expenses"
          total={c.expenses_total}
          action={canAddExpense ? <AddExpenseDialog presetProjectId={projectId} /> : null}
        >
          {c.expenses.length === 0 ? (
            <Empty>No expenses against this project yet.</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">What</th>
                  <th className="hidden px-3 py-2 font-medium sm:table-cell">Date</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {c.expenses.map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <p className="font-medium">{e.category ?? 'Expense'}</p>
                      <p className="text-xs text-muted-foreground">{[e.description, e.party_name && `paid to ${e.party_name}`].filter(Boolean).join(' · ') || '—'}</p>
                    </td>
                    <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">{day(e.expense_date)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatINR(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}
    </div>
  )
}

/** The numbers in one sentence, as the owner reads them. */
function Sentence({ c }: { c: ProjectCostSheet }) {
  if (c.total_cost === 0) return <span className="text-muted-foreground">No costs on this project yet. Payouts you set when booking the team and expenses you add show here.</span>
  return (
    <>
      This project has cost <b>{formatINR(c.total_cost)}</b> so far
      {c.expenses !== null && c.expenses_total > 0 && c.team_total > 0 && (
        <>
          {' '}({formatINR(c.team_total)} team, {formatINR(c.expenses_total)} expenses)
        </>
      )}
      {c.project_value > 0 && (
        <>
          {' '}— {c.profit >= 0 ? <b className="text-success">{formatINR(c.profit)} left</b> : <b className="text-destructive">{formatINR(-c.profit)} over</b>} of the {formatINR(c.project_value)} value.
        </>
      )}
    </>
  )
}

function Figure({ label, value, sub, tone }: { label: string; value: number | null; sub?: string | undefined; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className={cn('text-lg font-semibold tabular-nums', tone === 'good' && 'text-success', tone === 'bad' && 'text-destructive')}>
        {value === null ? '—' : formatINR(value)}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

function Section({ title, total, action, children }: { title: string; total: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">
            {title} <span className="font-normal text-muted-foreground">· {formatINR(total)}</span>
          </p>
          {action && <div className="no-print">{action}</div>}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-5 text-sm text-muted-foreground">{children}</p>
}
