import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Pencil, Plus, Receipt, Trash2 } from 'lucide-react'
import type { Expense } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { RowMenu } from '@/shared/ui/row-menu'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { formatINR } from '@/shared/ui/format'
import { useAccess } from '@/shared/auth/useAccess'
import { useDeleteExpense, useProjectExpenses } from '@/features/financials/api'
import { AddExpenseDialog } from '@/routes/company-expenses'

const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

/**
 * What this project cost to run, outside the crew: travel, rentals, prints.
 * One total at the top, one line per cost, and the add button right there --
 * the second expense stays on this project like the first.
 */
export function ExpensesTab({ projectId }: { projectId: string }) {
  const access = useAccess()
  const canSee = access.hasModule('company_expenses')
  const canAdd = access.hasAction('company_expenses', 'create')
  const canEdit = access.hasAction('company_expenses', 'edit')
  const canDelete = access.hasAction('company_expenses', 'delete')
  const { data, isLoading, isError, refetch } = useProjectExpenses(projectId)
  const del = useDeleteExpense()
  const confirm = useConfirm()
  const [editing, setEditing] = useState<Expense | null>(null)

  if (!canSee) {
    return (
      <Card className="mt-4">
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          Expenses are visible to the studio owner and people given access to them.
        </CardContent>
      </Card>
    )
  }

  const list = data ?? []
  const total = list.reduce((s, e) => s + e.amount, 0)
  const addButton = canAdd ? (
    <AddExpenseDialog
      presetProjectId={projectId}
      trigger={
        <Button size="sm">
          <Plus /> Add expense
        </Button>
      }
    />
  ) : null

  return (
    <div className="mt-4 flex flex-col gap-3">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-xs text-muted-foreground">Spent on this project</p>
            <p className="text-lg font-semibold tabular-nums">{formatINR(total)}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/company-expenses">All studio expenses</Link>
            </Button>
            {addButton}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <SkeletonList rows={3} columns={3} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : list.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
            <Receipt className="size-6 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">No expenses yet. Add travel, rentals, prints — anything you paid for this project.</p>
            {addButton}
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {list.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-card px-3 py-2">
              <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{e.category ?? 'Other'}</span>
              <span className="min-w-[10rem] flex-1 text-sm">
                {e.description ?? <span className="text-muted-foreground">No note</span>}
                {e.party_name && <span className="text-xs text-muted-foreground"> · paid to {e.party_name}</span>}
              </span>
              <span className="text-xs text-muted-foreground">{day(e.expense_date)}</span>
              <span className="w-24 text-right text-sm font-semibold tabular-nums">{formatINR(e.amount)}</span>
              {(canEdit || canDelete) && (
                <RowMenu
                  label={`More for ${e.description ?? e.category ?? 'expense'}`}
                  items={[
                    ...(canEdit ? [{ label: 'Edit…', icon: <Pencil className="size-4" />, onSelect: () => setEditing(e) }] : []),
                    ...(canDelete
                      ? [
                          {
                            label: 'Delete',
                            icon: <Trash2 className="size-4" />,
                            onSelect: async () => {
                              if (await confirm({ title: `Delete this ${formatINR(e.amount)} expense?`, destructive: true, confirmLabel: 'Delete' })) {
                                del.mutate(e.id)
                              }
                            },
                          },
                        ]
                      : []),
                  ]}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && <EditExpense expense={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

/** The shared expense dialog, opened straight away for one expense. */
function EditExpense({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  return (
    <AddExpenseDialog
      key={expense.id}
      expense={expense}
      defaultOpen
      onClosed={onClose}
      trigger={<span hidden />}
    />
  )
}
