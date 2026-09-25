import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
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
}: {
  initial?: Partial<InvoiceFormValues> | undefined
  onClose: () => void
  /** Go to the new invoice once it is made. */
  openAfter?: boolean
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
          toast.success(
            req.status === 'draft'
              ? `${made.invoice_number} saved as a draft. Send it when you are ready.`
              : req.payment
                ? `${made.invoice_number} saved, and the payment is recorded.`
                : `${made.invoice_number} saved. Share it on WhatsApp or email.`,
          )
          onClose()
          if (openAfter) void navigate({ to: '/billing/invoices/$id', params: { id: made.id } })
        }}
      />
    </FullScreen>
  )
}
