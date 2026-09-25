import type { ReactNode } from 'react'
import { CheckCircle2, Clock } from 'lucide-react'
import { amountInWords } from '@ipc/domain'
import type { PublicReceipt } from '@ipc/contracts'
import { formatINR, humanize } from '@/shared/ui/format'
import { shortDate } from './status'

/**
 * The payment receipt a client keeps: letterhead, a big green "amount
 * received" with the amount in words, who paid and for which project, and a
 * PAID ribbon. The studio's receipt page and the client's link both draw this,
 * so what the studio previews is exactly what the client gets.
 *
 * It is paper, so it keeps light colours in dark mode too; `.paper` gives it
 * the whole sheet when printed.
 */
export function ReceiptPaper({
  receipt,
  createdAt,
  projectStatus,
}: {
  receipt: PublicReceipt
  createdAt?: string | null | undefined
  projectStatus?: string | null | undefined
}) {
  const isPaid = (receipt.status ?? 'paid') !== 'pending'
  const brandName = receipt.company_name ?? 'Studio'
  const contact = [receipt.company_phone, receipt.company_email, receipt.company_website].filter(Boolean).join('  ·  ')
  const balance = Math.max(0, receipt.total_cost - receipt.received_total)
  const forWhat = receipt.project_name ?? (receipt.invoice_number ? `Invoice ${receipt.invoice_number}` : receipt.description ?? 'Payment received')

  return (
    <article className="paper relative overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-sm">
      {isPaid && (
        <div className="absolute right-[-44px] top-5 rotate-45 bg-emerald-600 px-12 py-1 text-xs font-bold uppercase tracking-[0.2em] text-white shadow-md">
          Paid
        </div>
      )}

      {/* Letterhead */}
      <header className="flex items-start gap-4 border-b border-slate-200 px-5 pb-6 pt-7 sm:px-8">
        {receipt.logo_url && (
          <img src={receipt.logo_url} alt={brandName} className="size-14 shrink-0 rounded-lg border border-slate-200 bg-white object-contain" />
        )}
        <div className="min-w-0 pr-10">
          <h2 className="text-xl font-semibold leading-tight">{brandName}</h2>
          {receipt.company_legal_name && receipt.company_legal_name !== brandName && (
            <p className="mt-0.5 text-xs text-slate-500">{receipt.company_legal_name}</p>
          )}
          {receipt.company_address && <p className="mt-1 max-w-[44ch] whitespace-pre-line text-xs text-slate-600">{receipt.company_address}</p>}
          {contact && <p className="mt-1 text-xs text-slate-600">{contact}</p>}
          {receipt.gstin && (
            <p className="mt-0.5 text-xs text-slate-600">
              GSTIN: <span className="font-medium text-slate-800">{receipt.gstin}</span>
            </p>
          )}
        </div>
      </header>

      {/* Title and facts */}
      <section className="px-5 pt-6 sm:px-8">
        <h1 className="text-2xl font-bold uppercase tracking-tight">Payment Receipt</h1>
        <p className="mt-1 text-xs text-slate-500">A record of payment received against the project below.</p>
        <dl className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4">
          <Meta label="Receipt No." value={receipt.receipt_number ?? '—'} />
          <Meta label="Payment Date" value={shortDate(receipt.paid_on)} />
          {createdAt && <Meta label="Created" value={shortDate(createdAt)} />}
          <Meta
            label="Payment Status"
            value={
              <span className={isPaid ? 'inline-flex items-center gap-1 font-semibold text-emerald-700' : 'inline-flex items-center gap-1 font-semibold text-amber-700'}>
                {isPaid ? <CheckCircle2 className="size-3.5" /> : <Clock className="size-3.5" />}
                {isPaid ? 'Paid' : 'Promised'}
              </span>
            }
          />
          {receipt.mode && <Meta label="Mode" value={receipt.mode} />}
          {receipt.reference && <Meta label="Reference" value={receipt.reference} />}
          {receipt.invoice_number && <Meta label="Against invoice" value={receipt.invoice_number} />}
          {receipt.is_gst && <Meta label="GST Number" value={receipt.payment_gst_number ?? 'Applicable'} />}
        </dl>
      </section>

      {/* The amount */}
      <section className="mt-6 px-5 sm:px-8">
        <div className="paper-block rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-5 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Amount {isPaid ? 'Received' : 'Promised'}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-emerald-700 sm:text-4xl">{formatINR(receipt.amount)}</p>
          <p className="mt-2 text-xs text-slate-700">
            <span className="text-slate-500">Amount in words:</span>{' '}
            <span className="font-medium text-slate-800">{amountInWords(receipt.amount)} only</span>
          </p>
        </div>
      </section>

      {/* From whom, for what */}
      <section className="mt-6 grid gap-4 px-5 sm:grid-cols-2 sm:gap-6 sm:px-8">
        <div className="paper-block rounded-xl border border-slate-200 p-4">
          <Heading>Received From</Heading>
          {receipt.client_name ? (
            <div className="mt-2 space-y-0.5 text-sm">
              <p className="font-semibold">{receipt.client_name}</p>
              {receipt.client_phone && <p className="text-slate-600">{receipt.client_phone}</p>}
              {receipt.client_email && <p className="text-slate-600">{receipt.client_email}</p>}
              {receipt.client_address && <p className="whitespace-pre-line text-slate-600">{receipt.client_address}</p>}
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No client linked.</p>
          )}
        </div>
        <div className="paper-block rounded-xl border border-slate-200 p-4">
          <Heading>Project</Heading>
          {receipt.project_name ? (
            <div className="mt-2 space-y-0.5 text-sm">
              <p className="font-semibold">{receipt.project_name}</p>
              {projectStatus && <p className="text-slate-600">{humanize(projectStatus)}</p>}
              <p className="text-slate-600">
                Project Value: <span className="font-medium tabular-nums text-slate-800">{formatINR(receipt.total_cost)}</span>
              </p>
              <p className="text-slate-600">
                Paid so far: <span className="font-medium tabular-nums text-slate-800">{formatINR(receipt.received_total)}</span>
                {balance > 0 && (
                  <>
                    {' · '}Balance: <span className="font-medium tabular-nums text-slate-800">{formatINR(balance)}</span>
                  </>
                )}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500">{receipt.invoice_number ? `Invoice ${receipt.invoice_number}` : 'No project linked.'}</p>
          )}
        </div>
      </section>

      {/* Payment for */}
      <section className="mt-6 px-5 sm:px-8">
        <Heading className="mb-2">Payment For</Heading>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-4 py-2 font-semibold">Project / Invoice</th>
                <th className="px-4 py-2 font-semibold">Date</th>
                <th className="px-4 py-2 text-right font-semibold">Project Value</th>
                <th className="px-4 py-2 text-right font-semibold">Payment Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-200">
                <td className="px-4 py-3 align-top">
                  <p className="font-medium">{forWhat}</p>
                  {receipt.description && receipt.description !== forWhat && <p className="mt-0.5 text-xs text-slate-500">{receipt.description}</p>}
                </td>
                <td className="px-4 py-3 align-top text-slate-600">{shortDate(receipt.paid_on)}</td>
                <td className="px-4 py-3 text-right align-top tabular-nums text-slate-700">{receipt.total_cost > 0 ? formatINR(receipt.total_cost) : '—'}</td>
                <td className="px-4 py-3 text-right align-top font-semibold tabular-nums">{formatINR(receipt.amount)}</td>
              </tr>
              <tr className="border-t border-slate-200 bg-slate-50">
                <td colSpan={3} className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Total {isPaid ? 'Received' : 'Promised'}
                </td>
                <td className="px-4 py-2.5 text-right text-base font-bold tabular-nums text-emerald-700">{formatINR(receipt.amount)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <footer className="mt-8 px-5 pb-8 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-6 border-t border-slate-200 pt-6">
          <div className="max-w-md text-xs text-slate-500">
            {receipt.document_footer_note && <p className="mb-2 whitespace-pre-line">{receipt.document_footer_note}</p>}
            <p>This is a computer-generated receipt and does not require a signature.</p>
          </div>
          <div className="min-w-[180px] border-t border-slate-300 pt-2 text-right">
            <p className="text-xs text-slate-500">Authorised Signatory</p>
            <p className="mt-0.5 text-xs font-medium text-slate-700">{brandName}</p>
          </div>
        </div>
      </footer>
    </article>
  )
}

function Heading({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={`text-[11px] font-semibold uppercase tracking-wider text-slate-500 ${className ?? ''}`}>{children}</h3>
}

function Meta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium text-slate-900">{value}</dd>
    </div>
  )
}
