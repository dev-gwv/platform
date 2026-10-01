import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { computeInvoice, type GstSlab } from '@ipc/domain'
import { formatINR } from '@/shared/ui/format'
import { useCreateInvoice } from './api'
import { emptyInvoiceForm, type InvoiceFormValues } from './InvoiceForm'
import { InvoiceEditor } from './InvoiceEditor'

/**
 * The editor over the whole screen: an invoice is a document, and it needs
 * the room of one, not a small box in the middle of the list.
 */
export function FullScreen({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  return createPortal(
    <div role="region" aria-label="Invoice editor" className="fixed inset-0 z-40 overflow-y-auto bg-background">
      {children}
    </div>,
    document.body,
  )
}

/**
 * Raise an invoice. Opened from Billing with a blank form, or from a
 * project with the project, its client and (for a plan instalment) the line
 * already filled in. Mounted only while open, so every opening starts fresh.
 */
export function NewInvoiceDialog({
  initial,
  onClose,
  openAfter = true,
  next,
}: {
  initial?: Partial<InvoiceFormValues> | undefined
  onClose: () => void
  /** Go to the new invoice once it is made. */
  openAfter?: boolean
  /**
   * The step after the invoice (e.g. "Book the team"): offered on the "saved"
   * message, or -- with `auto`, when the project's journey opened this --
   * taken at once, so saving the invoice lands on the shoots.
   */
  next?: { label: string; onClick: () => void; auto?: boolean } | undefined
}) {
  const create = useCreateInvoice()
  const navigate = useNavigate()
  return (
    <FullScreen onClose={onClose}>
      <InvoiceEditor
        initial={{ ...emptyInvoiceForm(), ...initial }}
        draftKey={`invoice:new${initial?.project_id ? `:project:${initial.project_id}` : ''}`}
        busy={create.isPending}
        onCancel={onClose}
        onSubmit={async (req) => {
          const made = await create.mutateAsync(req)
          if (next?.auto) {
            // "₹50,000 received, ₹50,000 to collect": the advance applied plus
            // anything recorded now, against the invoice's own total.
            const applied = (initial?.applied ?? []).filter((a) => req.attach_payment_ids?.includes(a.id)).reduce((n, a) => n + a.amount, 0)
            const received = applied + (req.payment?.amount ?? 0)
            const total = computeInvoice(
              req.lines.map((l) => ({ ...l, gst_rate: l.gst_rate as GstSlab })),
              { intraState: req.intra_state, discount: req.discount, discountType: req.discount_type === 'none' ? 'flat' : req.discount_type },
            ).total
            toast.success(
              received > 0
                ? `${made.invoice_number} saved. ${formatINR(received)} received, ${formatINR(Math.max(0, total - received))} to collect. Now book the team.`
                : `${made.invoice_number} saved. Now book the team for the shoots.`,
            )
            onClose()
            next.onClick()
            return
          }
          toast.success(
            req.status === 'draft'
              ? `${made.invoice_number} saved as a draft. Send it when you are ready.`
              : req.payment
                ? `${made.invoice_number} saved, and the payment is recorded.`
                : `${made.invoice_number} saved. Share it on WhatsApp or email.`,
            next ? { action: { label: next.label, onClick: next.onClick }, duration: 10_000 } : undefined,
          )
          onClose()
          if (openAfter) void navigate({ to: '/billing/invoices/$id', params: { id: made.id } })
        }}
      />
    </FullScreen>
  )
}
