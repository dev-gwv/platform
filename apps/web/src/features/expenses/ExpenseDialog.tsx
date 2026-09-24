import { useState, type FormEvent, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import type { CreateExpenseRequest, Expense } from '@ipc/contracts'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { useCreateExpense, useUpdateExpense } from '@/features/financials/api'
import { useProjects } from '@/features/projects/api'
import { useDirectory } from '@/features/team/api'
import { PartyPicker } from '@/features/parties/PartyPicker'
import { ExpenseCategoryPicker } from './CategoryManager'
import { ReceiptsPanel } from './ReceiptsPanel'

const todayISO = () => new Date().toISOString().slice(0, 10)
const GST_RATES = [0, 5, 12, 18, 28]

/**
 * One form for every cost: the studio's and the ones someone paid from their
 * own pocket. Date, amount, category and a line of description are all a
 * quick entry needs; who paid, the vendor, the project and the GST paperwork
 * sit below, and the bill goes on as a photo.
 *
 * From a project's tab the project is already known, so its picker is
 * hidden and the next expense stays on that project too.
 */
export function AddExpenseDialog({
  expense,
  trigger,
  presetProjectId,
  defaultOpen = false,
  onClosed,
}: {
  expense?: Expense | undefined
  trigger?: ReactNode
  presetProjectId?: string | undefined
  defaultOpen?: boolean
  onClosed?: () => void
} = {}) {
  const isEdit = !!expense
  const create = useCreateExpense()
  const update = useUpdateExpense()
  const { session } = useAuth()
  const { data: projects } = useProjects()
  const { data: people } = useDirectory()
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
  const [paidBy, setPaidBy] = useState(expense?.paid_by_user_id ?? '')
  const [gstTreatment, setGstTreatment] = useState<CreateExpenseRequest['gst_treatment']>(expense?.gst_treatment ?? 'non_gst')
  const [gstRate, setGstRate] = useState(expense?.gst_rate ?? 18)
  const [amountIs, setAmountIs] = useState<'including_tax' | 'excluding_tax'>(expense?.amount_is ?? 'excluding_tax')
  const [invoiceNumber, setInvoiceNumber] = useState(expense?.invoice_number ?? '')
  const [taxAmount, setTaxAmount] = useState(expense?.tax_amount ? String(expense.tax_amount) : '')
  const [reverse, setReverse] = useState(expense?.reverse_charge ?? false)
  const [error, setError] = useState<string | null>(null)
  const projectMode = !!presetProjectId && !isEdit
  const [showTax, setShowTax] = useState(!!(expense && (expense.gst_treatment !== 'non_gst' || expense.invoice_number || expense.tax_amount)))
  // A person whose name the studio can pick: the team, or whoever is signed in.
  const payers = (people ?? []).map((m) => ({ id: m.user_id, name: m.name }))
  if (session && !payers.some((p) => p.id === session.user_id)) payers.unshift({ id: session.user_id, name: session.display_name || 'Me' })

  const value = Number(amount) || 0
  const taxGuess = gstTreatment === 'gst_applicable' && value > 0 ? (amountIs === 'excluding_tax' ? (value * gstRate) / 100 : value - value / (1 + gstRate / 100)) : 0

  function reset() {
    setCategory('')
    setDescription('')
    setAmount('')
    setExpenseDate(todayISO())
    setProjectId(presetProjectId ?? '')
    setPartyId('')
    setPaidBy('')
    setGstTreatment('non_gst')
    setGstRate(18)
    setAmountIs('excluding_tax')
    setInvoiceNumber('')
    setTaxAmount('')
    setReverse(false)
    setShowTax(false)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (value <= 0) {
      setError('Enter the amount.')
      return
    }
    try {
      const shared = {
        project_id: projectId || null,
        party_id: partyId || null,
        amount: value,
        expense_date: expenseDate,
        gst_treatment: gstTreatment,
        gst_rate: gstTreatment === 'gst_applicable' ? gstRate : null,
        amount_is: amountIs,
        invoice_number: invoiceNumber.trim() || null,
        tax_amount: taxAmount.trim() ? Number(taxAmount) : gstTreatment === 'gst_applicable' ? Math.round(taxGuess * 100) / 100 : 0,
        reverse_charge: reverse,
        paid_by_user_id: paidBy || null,
        is_fixed_overhead: false,
      }
      if (isEdit) {
        await update.mutateAsync({ id: expense.id, patch: { ...shared, category: category.trim() || null, description: description.trim() || null } })
      } else {
        await create.mutateAsync({
          ...shared,
          gst_rate: shared.gst_rate ?? undefined,
          ...(category.trim() ? { category: category.trim() } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
        })
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
      <DialogContent
        title={isEdit ? 'Edit expense' : 'Add expense'}
        description={projectMode ? 'A cost of this project. It counts against its profit.' : 'A cost of the studio, or of one project.'}
        className="max-w-lg"
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exp-amount">Amount ₹</Label>
              <Input id="exp-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exp-date">Date</Label>
              <Input id="exp-date" type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <ExpenseCategoryPicker value={category} onChange={setCategory} />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exp-desc">What for</Label>
              <Input id="exp-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Cab to venue, album printing…" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exp-paid-by">Paid by</Label>
              <Select id="exp-paid-by" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
                <option value="">The studio</option>
                {payers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              {paidBy && (
                <p className="text-[11px] text-muted-foreground">
                  {expense?.reimbursement_status === 'reimbursed' ? 'Paid back already.' : 'From their own pocket: shows under "To reimburse" until paid back.'}
                </p>
              )}
            </div>
            {!projectMode && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="exp-project">Project</Label>
                <Select id="exp-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">Studio cost, no project</option>
                  {(projects ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>

          <PartyPicker value={partyId} onChange={setPartyId} />

          {!showTax ? (
            <button type="button" onClick={() => setShowTax(true)} className="self-start text-xs font-medium text-primary hover:underline">
              + GST or the vendor's invoice number
            </button>
          ) : (
            <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>GST</Label>
                  <Select value={gstTreatment} onChange={(e) => setGstTreatment(e.target.value as CreateExpenseRequest['gst_treatment'])}>
                    <option value="non_gst">No GST</option>
                    <option value="gst_applicable">GST charged</option>
                    <option value="exempt">Exempt</option>
                    <option value="reverse_charge">Reverse charge</option>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Vendor's invoice no.</Label>
                  <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="INV-001" />
                </div>
              </div>
              {gstTreatment === 'gst_applicable' && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>Rate</Label>
                    <Select value={gstRate} onChange={(e) => setGstRate(Number(e.target.value))}>
                      {GST_RATES.map((r) => (
                        <option key={r} value={r}>
                          {r}%
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Amount is</Label>
                    <Select value={amountIs} onChange={(e) => setAmountIs(e.target.value as 'including_tax' | 'excluding_tax')}>
                      <option value="excluding_tax">Before tax</option>
                      <option value="including_tax">With tax</option>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Tax ₹</Label>
                    <Input inputMode="decimal" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} placeholder={taxGuess ? String(Math.round(taxGuess)) : '0'} />
                  </div>
                </div>
              )}
              <label className={cn('flex items-center gap-2 text-sm', gstTreatment === 'reverse_charge' && 'text-muted-foreground')}>
                <input type="checkbox" checked={reverse || gstTreatment === 'reverse_charge'} disabled={gstTreatment === 'reverse_charge'} onChange={(e) => setReverse(e.target.checked)} />
                Reverse charge (the studio pays the GST, not the vendor)
              </label>
            </div>
          )}

          {isEdit ? (
            <ReceiptsPanel expenseId={expense.id} />
          ) : (
            <p className="text-xs text-muted-foreground">Save it, then add a photo of the bill from the row.</p>
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
              {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add expense'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
