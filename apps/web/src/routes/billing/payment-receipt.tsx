import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { ArrowLeft, Copy, ExternalLink, Mail, MessageCircle, Pencil, Printer, Trash2 } from 'lucide-react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { Button } from '@/shared/ui/button'
import { Skeleton } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { formatINR } from '@/shared/ui/format'
import { useAccess } from '@/shared/auth/useAccess'
import { usePaymentReceipt, useReceivedPayment } from '@/features/billing/api'
import { ReceiptPaper } from '@/features/billing/ReceiptPaper'
import { ReceivedPaymentDialog, DeleteReceivedPaymentDialog } from '@/features/billing/ReceivedPaymentDialogs'
import { SendReceiptDialog } from '@/features/billing/SendReceiptDialog'
import { copyReceiptLink, issueReceiptLink, openReceiptWhatsApp, receiptShareText } from '@/features/billing/receiptShare'
import { shortDate } from '@/features/billing/status'

/**
 * The studio's view of one payment: the receipt exactly as the client will
 * see it, with everything the studio does with a receipt in one bar above
 * it. `?print=1` opens the print dialog as soon as the receipt has drawn, so
 * the Print icon on the payments list lands straight on "Save as PDF".
 */
export function PaymentReceiptPage() {
  return (
    <AuthedPage module="billing">
      <PaymentReceipt />
    </AuthedPage>
  )
}

function PaymentReceipt() {
  const { id = '' } = useParams({ strict: false }) as { id?: string }
  const navigate = useNavigate()
  const access = useAccess()
  const receipt = usePaymentReceipt(id || null)
  const payment = useReceivedPayment(id || null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const printed = useRef(false)

  const data = receipt.data
  useEffect(() => {
    if (!data || printed.current) return
    if (new URLSearchParams(window.location.search).get('print') !== '1') return
    printed.current = true
    // Let the logo and fonts land before the print dialog freezes the page.
    const t = setTimeout(() => window.print(), 400)
    return () => clearTimeout(t)
  }, [data])

  if (receipt.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-[600px] w-full rounded-2xl" />
      </div>
    )
  }
  if (receipt.isError || !data) {
    return <ErrorState message="We could not load this receipt." onRetry={() => void receipt.refetch()} />
  }

  const isPaid = (data.status ?? 'paid') !== 'pending'
  const summary = {
    clientName: data.client_name,
    projectName: data.project_name,
    amountFormatted: formatINR(data.amount),
    paymentDate: shortDate(data.paid_on),
  }

  async function onWhatsApp() {
    if (!data) return
    const link = (await issueReceiptLink(data.id)) ?? window.location.href
    openReceiptWhatsApp(data.client_phone, receiptShareText(summary, link))
  }

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <div className="paper-toolbar no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
        <Button asChild variant="outline" size="sm">
          <Link to="/billing/payments">
            <ArrowLeft /> Back to Payments
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-1.5">
          {data.project_id && (
            <Button asChild variant="outline" size="sm">
              <Link to="/projects/$id" params={{ id: data.project_id }} search={{ tab: 'billing' }}>
                <ExternalLink /> View Project
              </Link>
            </Button>
          )}
          {isPaid && (
            <>
              <Button variant="outline" size="sm" onClick={() => void copyReceiptLink(data.id)} title="Copy a link the client can open">
                <Copy /> Copy Link
              </Button>
              <Button variant="outline" size="sm" onClick={() => setEmailOpen(true)} title="Email the receipt to the client">
                <Mail /> Email
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950"
                onClick={() => void onWhatsApp()}
                title="Send the receipt link on WhatsApp"
              >
                <MessageCircle /> WhatsApp
              </Button>
            </>
          )}
          {access.hasAction('billing', 'edit') && (
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} disabled={!payment.data}>
              <Pencil /> Edit
            </Button>
          )}
          {access.hasAction('billing', 'delete') && (
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 /> Delete
            </Button>
          )}
          <Button size="sm" onClick={() => window.print()}>
            <Printer /> Print / Save PDF
          </Button>
        </div>
      </div>

      <ReceiptPaper receipt={data} createdAt={data.created_at} projectStatus={data.project_status} />

      <ReceivedPaymentDialog open={editOpen} onOpenChange={setEditOpen} initial={editOpen ? (payment.data ?? null) : null} />
      <DeleteReceivedPaymentDialog
        payment={deleteOpen ? { id: data.id } : null}
        onOpenChange={setDeleteOpen}
        onDeleted={() => void navigate({ to: '/billing/payments' })}
      />
      <SendReceiptDialog open={emailOpen} onOpenChange={setEmailOpen} payment={payment.data ?? null} />
    </section>
  )
}
