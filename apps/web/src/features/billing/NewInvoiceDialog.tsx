import { useState, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { friendlyInvoiceError } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent } from '@/shared/ui/dialog'
import { useCreateInvoice, useStates } from './api'
import { emptyInvoiceForm, useInvoiceForm, InvoiceFormFields, type InvoiceFormValues } from './InvoiceForm'

/**
 * Raise an invoice. Opened from Billing with a blank form, or from a
 * project with the project, its client and (for a plan instalment) the line
 * already filled in. Mounted only while open, so every opening starts fresh.
 */
export function NewInvoiceDialog({
  initial,
  onClose,
  openAfter = true,
}: {
  initial?: Partial<InvoiceFormValues> | undefined
  onClose: () => void
  /** Go to the new invoice once it is made. */
  openAfter?: boolean
}) {
  const create = useCreateInvoice()
  const navigate = useNavigate()
  const { data: states } = useStates()
  const form = useInvoiceForm({ ...emptyInvoiceForm(), ...initial })
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    // Everything the invoice is missing, said out loud, instead of a disabled button.
    const problems = form.problems()
    if (problems.length > 0) {
      setError(problems[0] ?? 'This invoice is not ready yet.')
      return
    }
    const discount = Number(form.values.discount) || 0
    if (form.values.discount_type === 'percent' && discount > 100) {
      setError('Discount percentage cannot exceed 100%.')
      return
    }
    if (form.values.discount_type === 'flat' && discount > form.totals.subtotal && form.totals.subtotal > 0) {
      setError('Discount cannot exceed the invoice subtotal.')
      return
    }
    // The same checks the server makes: GSTIN format, place of supply when
    // tax applies, and at least one taxed line on a GST invoice.
    if (!form.values.no_gst) {
      const gst = form.values.gst_number.trim().toUpperCase()
      if (gst && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gst)) {
        setError('GSTIN format looks invalid. Expected 15-char GSTIN like 27ABCDE1234F1Z5.')
        return
      }
      if (!form.values.place_of_supply.trim()) {
        setError('Place of Supply is required for GST invoices.')
        return
      }
      if (gst && !form.values.lines.some((l) => Number(l.gst_rate) > 0)) {
        setError('At least one item must have a tax rate for GST invoices.')
        return
      }
    }
    try {
      const made = await create.mutateAsync(form.toRequest())
      onClose()
      if (openAfter) void navigate({ to: '/billing/invoices/$id', params: { id: made.id } })
    } catch (err) {
      setError(friendlyInvoiceError(err))
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title="New invoice" description="GST is worked out for you." className="max-w-2xl">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <InvoiceFormFields form={form} states={states} />
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
            {/* Enabled, so submitting can explain what is missing. */}
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create invoice'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
