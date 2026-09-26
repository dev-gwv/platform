import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { ArrowLeft, Ban, Copy, FolderOpen, IndianRupee, Link2Off, Mail, MessageCircle, Paperclip, Pencil, Printer, Trash2 } from 'lucide-react'
import { companyProfile, type InvoiceDetail } from '@ipc/contracts'
import { callApi, downloadFile } from '@/shared/api/client'
import { toast } from 'sonner'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { useAccess } from '@/shared/auth/useAccess'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { DownloadDocumentButton } from '@/shared/ui/download-document'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState } from '@/shared/ui/states'
import { RowMenu, type RowMenuItem } from '@/shared/ui/row-menu'
import { useConfirm } from '@/shared/ui/confirm'
import { formatINR } from '@/shared/ui/format'
import {
  useCancelInvoice,
  useDeleteInvoice,
  useInvoice,
  useReceivedPayment,
  useRevokeInvoiceLink,
  useUpdateInvoice,
  useSendInvoice,
  useRecordPayment,
} from '@/features/billing/api'
import { emptyInvoiceForm } from '@/features/billing/InvoiceForm'
import { InvoiceEditor } from '@/features/billing/InvoiceEditor'
import { FullScreen } from '@/features/billing/NewInvoiceDialog'
import { InvoicePaper } from '@/features/billing/InvoicePaper'
import { PaymentReminderCard } from '@/features/billing/PaymentReminder'
import { RecordPaymentDialog } from '@/features/billing/RecordPaymentDialog'
import { DeleteReceivedPaymentDialog, ReceivedPaymentDialog } from '@/features/billing/ReceivedPaymentDialogs'
import { copyInvoiceLink, emailInvoice, whatsappInvoice } from '@/features/billing/share'
import { isOverdue, shortDate } from '@/features/billing/status'

export function InvoiceDetailPage({ edit }: { edit?: boolean } = {}) {
  return (
    <AuthedPage module="billing">
      <InvoiceDoc edit={edit} />
    </AuthedPage>
  )
}

/**
 * One invoice: the sheet as the client sees it, the things done with it
 * every day (record a payment, send it, remind) in reach, and the rarer ones
 * (edit, cancel, stop the link) under "more". It links back to its project.
 */
function InvoiceDoc({ edit }: { edit?: boolean | undefined }) {
  // Not strict: the same screen serves /billing/invoices/$id and its /edit address.
  const { id = '' } = useParams({ strict: false }) as { id?: string }
  const { data, isLoading, isError, refetch } = useInvoice(id)
  const access = useAccess()
  const [recording, setRecording] = useState(false)
  const [editing, setEditing] = useState(!!edit)
  const send = useSendInvoice()
  const navigate = useNavigate()
  const { data: company } = useQuery({
    queryKey: ['settings', 'company'],
    queryFn: () => callApi('/settings/company', { responseSchema: companyProfile }),
  })
  // `?print=1` (the Print icon on the invoice list) opens the print dialog once the sheet has drawn.
  const printed = useRef(false)
  useEffect(() => {
    if (!data || printed.current) return
    if (new URLSearchParams(window.location.search).get('print') !== '1') return
    printed.current = true
    const t = setTimeout(() => window.print(), 400)
    return () => clearTimeout(t)
  }, [data])

  if (isLoading) return <SkeletonCards count={3} />
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />

  const cancelled = data.status === 'cancelled'
  const editable = data.amount_paid === 0 && !cancelled && data.payments.length === 0
  const isDraft = data.status === 'draft'
  const sendable = !cancelled && !isDraft
  const late = isOverdue(data)
  const canEdit = access.hasAction('billing', 'edit')

  /** A draft is sent first, then shared or paid: a client cannot open or pay a draft. */
  async function asSent(then: () => void | Promise<void>) {
    if (isDraft) {
      await send.mutateAsync(data!.id)
      toast.success(`${data!.invoice_number} is now sent.`)
    }
    await then()
  }

  return (
    <>
      <div className="paper-toolbar mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/billing/invoices">
                <ArrowLeft /> Invoices
              </Link>
            </Button>
            {data.project_id && (
              <Button asChild variant="ghost" size="sm">
                <Link to="/projects/$id" params={{ id: data.project_id }} search={{ tab: 'billing' }}>
                  <FolderOpen /> {data.project_name ?? 'Project'}
                </Link>
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {data.balance_due > 0 && !cancelled && canEdit && (
              <Button size="sm" onClick={() => void asSent(() => setRecording(true))} disabled={send.isPending}>
                <IndianRupee /> Record payment
              </Button>
            )}
            {editable && canEdit && (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
            )}
            {sendable && (
              <>
                <Button size="sm" variant="outline" onClick={() => void whatsappInvoice(data, late)}>
                  <MessageCircle /> {late ? 'WhatsApp reminder' : 'WhatsApp'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void emailInvoice(data, late)}>
                  <Mail /> Email
                </Button>
                <Button size="sm" variant="outline" onClick={() => void copyInvoiceLink(data.id)}>
                  <Copy /> Client link
                </Button>
              </>
            )}
            <DownloadDocumentButton name={`Invoice ${data.invoice_number}${data.client_name ? ` ${data.client_name}` : ''}`} label="PDF" />
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Printer /> Print
            </Button>
            <MoreActions invoice={data} editable={editable} />
          </div>
        </div>
        {isDraft && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-tone-amber/40 bg-tone-amber-soft px-4 py-3">
            <div>
              <p className="font-semibold text-foreground">Draft · not sent yet</p>
              <p className="text-sm text-muted-foreground">Check it below, then send it. The client can open and pay it once it is sent.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canEdit && (
                <>
                  <Button size="sm" onClick={() => void asSent(() => whatsappInvoice(data, false))} disabled={send.isPending}>
                    <MessageCircle /> Send on WhatsApp
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void asSent(() => emailInvoice(data, false))} disabled={send.isPending}>
                    <Mail /> Send by email
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void asSent(() => copyInvoiceLink(data.id))} disabled={send.isPending}>
                    <Copy /> Mark sent &amp; copy link
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
        {cancelled && (
          <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            This invoice is cancelled. Its link no longer opens for the client.
          </p>
        )}
      </div>

      <PaymentReminderCard invoice={data} canSend={canEdit} />

      <InvoicePaper
        invoice={data}
        company={{
          name: company?.display_name ?? company?.name ?? null,
          legal_name: company?.legal_name,
          logo_url: company?.invoice_logo_url ?? company?.avatar_url,
          city: company?.city,
          state: company?.state,
          country: company?.country,
          invoice_gst_number: company?.invoice_gst_number,
          invoice_address: company?.invoice_address,
          invoice_phone: company?.invoice_phone,
          invoice_email: company?.invoice_email,
          invoice_upi_id: company?.invoice_upi_id,
          invoice_sac_code: company?.invoice_sac_code,
        }}
      />

      {data.attachments.length > 0 && (
        <Card className="paper-toolbar mx-auto mt-4 w-full max-w-4xl">
          <CardContent className="p-4">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <Paperclip className="size-4" /> Sent with this invoice
            </p>
            <ul className="flex flex-wrap gap-2">
              {data.attachments.map((f) => (
                <li key={f.id}>
                  <Button size="sm" variant="outline" onClick={() => void downloadFile(`/files/${f.id}`, f.name).catch((e: Error) => toast.error(e.message))}>
                    <Paperclip /> {f.name}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <InvoicePayments invoice={data} />

      {editing && editable && (
        <EditInvoiceDialog
          invoice={data}
          onClose={() => {
            setEditing(false)
            if (edit) void navigate({ to: '/billing/invoices/$id', params: { id: data.id }, replace: true })
          }}
        />
      )}

      {recording && (
        <RecordPaymentDialog
          target={{ kind: 'invoice', invoiceId: data.id, invoiceNumber: data.invoice_number }}
          suggested={data.balance_due}
          onClose={() => setRecording(false)}
        />
      )}
    </>
  )
}

/** Edit, delete (only while nothing is paid), stop the link and cancel -- out of the way of the everyday buttons. */
function MoreActions({ invoice, editable }: { invoice: InvoiceDetail; editable: boolean }) {
  const access = useAccess()
  const del = useDeleteInvoice()
  const cancel = useCancelInvoice()
  const revoke = useRevokeInvoiceLink()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const cancelled = invoice.status === 'cancelled'
  const items: RowMenuItem[] = []
  if (!cancelled && invoice.status !== 'draft') {
    items.push({
      label: 'Stop the client link',
      icon: <Link2Off className="size-4" />,
      onSelect: () =>
        void confirm({
          title: 'Stop the client link?',
          description: 'The link you sent stops opening. Sending the invoice again makes a new one.',
          confirmLabel: 'Stop link',
        }).then((yes) => yes && revoke.mutate(invoice.id)),
    })
  }
  if (!cancelled && access.hasAction('billing', 'edit')) {
    const paid = invoice.payments.length > 0
    items.push({
      label: 'Cancel invoice',
      icon: <Ban className="size-4" />,
      onSelect: () =>
        void confirm({
          title: `Cancel ${invoice.invoice_number}?`,
          description: paid
            ? 'The payments against it stay on the project, just not against this invoice. The client link stops working.'
            : 'It stays in the list as cancelled and is no longer counted as owed.',
          destructive: true,
          confirmLabel: 'Cancel invoice',
        }).then((yes) => yes && cancel.mutate(invoice.id)),
    })
  }
  if (editable && access.hasAction('billing', 'delete')) {
    items.push({
      label: 'Delete',
      icon: <Trash2 className="size-4" />,
      onSelect: () =>
        void confirm({
          title: 'Delete this invoice?',
          description: 'No payment has been recorded against it. This cannot be undone.',
          destructive: true,
          confirmLabel: 'Delete',
        }).then(async (yes) => {
          if (!yes) return
          await del.mutateAsync(invoice.id)
          void navigate({ to: '/billing/invoices' })
        }),
    })
  }
  return (
    <>
      {items.length > 0 && <RowMenu label="More for this invoice" items={items} />}
    </>
  )
}

/**
 * The money against this invoice, each payment changeable here. Promised
 * payments are shown for what they are: they do not reduce the balance.
 */
function InvoicePayments({ invoice }: { invoice: InvoiceDetail }) {
  const canEdit = useAccess().hasAction('billing', 'edit')
  const [editId, setEditId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const editing = useReceivedPayment(editId)
  const deleting = useReceivedPayment(deleteId)
  if (invoice.payments.length === 0) return null
  return (
    <Card className="paper-toolbar mx-auto mt-4 max-w-3xl">
      <CardContent className="p-4">
        <p className="mb-2 text-sm font-semibold">Payments on this invoice</p>
        <ul className="flex flex-col gap-1.5">
          {invoice.payments.map((p) => {
            const promised = (p.status ?? 'paid') === 'pending'
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2 text-sm">
                <span className="font-semibold tabular-nums">{formatINR(p.amount)}</span>
                <span className="text-xs text-muted-foreground">{[shortDate(p.paid_on), p.mode, p.reference].filter(Boolean).join(' · ')}</span>
                <StatusBadge tone={promised ? 'warning' : 'success'} className="ml-auto">
                  {promised ? 'Promised' : 'Received'}
                </StatusBadge>
                {canEdit && (
                  <RowMenu
                    label={`More for the ${formatINR(p.amount)} payment`}
                    items={[
                      { label: 'Change…', icon: <Pencil className="size-4" />, onSelect: () => setEditId(p.id) },
                      { label: 'Delete', icon: <Trash2 className="size-4" />, onSelect: () => setDeleteId(p.id) },
                    ]}
                  />
                )}
              </li>
            )
          })}
        </ul>
      </CardContent>
      <ReceivedPaymentDialog open={!!editId && !!editing.data} onOpenChange={(v) => !v && setEditId(null)} initial={editing.data ?? null} />
      <DeleteReceivedPaymentDialog payment={deleteId ? (deleting.data ?? null) : null} onOpenChange={(v) => !v && setDeleteId(null)} />
    </Card>
  )
}

function EditInvoiceDialog({ invoice, onClose }: { invoice: InvoiceDetail; onClose: () => void }) {
  const update = useUpdateInvoice(invoice.id)
  const pay = useRecordPayment(invoice.id)
  const allZeroGst = invoice.items.every((i) => Number(i.gst_rate) === 0)
  return (
    <FullScreen onClose={onClose}>
      <InvoiceEditor
        isEdit
        editNumber={invoice.invoice_number}
        editStatus={invoice.status}
        draftKey={`invoice:edit:${invoice.id}`}
        busy={update.isPending || pay.isPending}
        onCancel={onClose}
        onSubmit={async (req) => {
          const { invoice_number: _n, payment, ...rest } = req
          // Money in hand means the invoice is sent: a draft cannot be paid.
          await update.mutateAsync(payment ? { ...rest, status: 'sent' } : rest)
          if (payment) await pay.mutateAsync(payment)
          toast.success(
            rest.status === 'draft' && !payment
              ? `${invoice.invoice_number} saved as a draft.`
              : payment
                ? `${invoice.invoice_number} saved, and the payment is recorded.`
                : `${invoice.invoice_number} saved.`,
          )
          onClose()
        }}
        initial={{
          ...emptyInvoiceForm(),
          client_id: invoice.client_id ?? '',
          project_id: invoice.project_id ?? '',
          place_of_supply: invoice.place_of_supply ?? '',
          intra_state: invoice.intra_state,
          no_gst: allZeroGst,
          gst_number: invoice.gst_number ?? '',
          status: invoice.status === 'draft' ? 'draft' : 'sent',
          invoice_date: invoice.invoice_date,
          due_date: invoice.due_date ?? '',
          discount: invoice.discount ? String(invoice.discount) : '',
          // Preserve the original discount type on edit, including 'none'.
          discount_type: (invoice.discount_type ?? 'flat') as 'flat' | 'percent' | 'none',
          notes: invoice.notes ?? '',
          bank_details: invoice.bank_details ?? '',
          terms: invoice.terms ?? '',
          template_id: invoice.template_id ?? '',
          subject: invoice.subject ?? '',
          payment_terms: invoice.payment_terms ?? 'Custom',
          attachments: invoice.attachments.map((a) => ({ id: a.id, name: a.name })),
          lines: invoice.items.map((i) => ({
            description: i.description,
            subtext: i.subtext ?? undefined,
            quantity: String(i.quantity),
            rate: String(i.rate),
            gst_rate: Number(i.gst_rate),
            hsn_sac: i.hsn_sac ?? undefined,
          })),
        }}
      />
    </FullScreen>
  )
}
