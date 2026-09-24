import { amountInWords } from '@ipc/domain'
import type { InvoiceDetail } from '@ipc/contracts'
import { StatusBadge } from '@/shared/ui/status-badge'
import { formatINR, humanize } from '@/shared/ui/format'
import { invoiceBadge, shortDate } from './status'
import { UpiQr, upiLink } from './UpiQr'

/** Who the invoice is from, as printed at the top. */
export interface InvoiceFrom {
  name: string | null
  logo_url?: string | null | undefined
  city?: string | null | undefined
  state?: string | null | undefined
  country?: string | null | undefined
  invoice_gst_number?: string | null | undefined
  invoice_address?: string | null | undefined
  invoice_phone?: string | null | undefined
  invoice_email?: string | null | undefined
  invoice_upi_id?: string | null | undefined
  invoice_sac_code?: string | null | undefined
}

const NO_LAYOUT = {
  show_header: true,
  show_footer: true,
  show_gst: true,
  show_bank_details: false,
  header_text: null,
  footer_text: null,
  bank_details: null,
  terms_and_conditions: null,
}

/**
 * The invoice as it prints -- the same sheet the studio sees and the client
 * opens from their link. Only money that has come in is listed as paid.
 */
export function InvoicePaper({ invoice, company }: { invoice: InvoiceDetail; company: InvoiceFrom }) {
  const intraState = invoice.intra_state
  // No template resolved prints as it always did: every part shown.
  const base = invoice.template_layout ?? NO_LAYOUT
  // An invoice with no tax on it is not a tax invoice, and empty GST columns
  // only make a family's wedding bill look like a form.
  const taxed = invoice.tax > 0 || invoice.items.some((i) => i.gst_rate > 0)
  const layout = { ...base, show_gst: base.show_gst && taxed }
  const received = invoice.payments.filter((p) => (p.status ?? 'paid') === 'paid')
  const badge = invoiceBadge(invoice)
  return (
      <div className="paper mx-auto w-full max-w-3xl rounded-lg border border-border bg-card p-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
          {layout.show_header ? (
            <div>
              {company.logo_url && <img src={company.logo_url} alt="" className="mb-2 h-10 w-auto object-contain" />}
              <h1 className="text-xl font-bold">{company.name ?? 'Your Studio'}</h1>
              {company.city && (
                <p className="text-sm text-muted-foreground">
                  {[company.city, company.state, company.country].filter(Boolean).join(', ')}
                </p>
              )}
              {company.invoice_gst_number && (
                <p className="text-sm text-muted-foreground">GSTIN: {company.invoice_gst_number}</p>
              )}
              {(company.invoice_address || company.invoice_phone || company.invoice_email) && (
                <p className="text-sm text-muted-foreground">
                  {[company.invoice_address, company.invoice_phone, company.invoice_email].filter(Boolean).join(' · ')}
                </p>
              )}
              {layout.header_text && <p className="mt-1 text-sm text-muted-foreground">{layout.header_text}</p>}
            </div>
          ) : (
            <div />
          )}
          <div className="text-right">
            <p className="text-lg font-semibold">{taxed ? 'TAX INVOICE' : 'INVOICE'}</p>
            <p className="text-sm">{invoice.invoice_number}</p>
            <p className="text-sm text-muted-foreground">{shortDate(invoice.invoice_date)}</p>
            {invoice.due_date && <p className="text-xs text-muted-foreground">Due {shortDate(invoice.due_date)}</p>}
            <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
          </div>
        </div>

        {/* Bill to */}
        <div className="py-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Bill to</p>
          <p className="font-medium">{invoice.client_name ?? '—'}</p>
          {invoice.client_address && <p className="text-sm text-muted-foreground">{invoice.client_address}</p>}
          {(invoice.client_phone || invoice.client_email) && (
            <p className="text-sm text-muted-foreground">
              {[invoice.client_phone, invoice.client_email].filter(Boolean).join(' · ')}
            </p>
          )}
          {invoice.client_gstin && <p className="text-sm text-muted-foreground">GSTIN {invoice.client_gstin}</p>}
          {invoice.gst_number && <p className="text-sm text-muted-foreground">Invoice GSTIN: {invoice.gst_number}</p>}
          {invoice.project_name && (
            <p className="mt-1 text-sm text-muted-foreground">Project: {invoice.project_name}</p>
          )}
        </div>

        {/* Items */}
        <table className="w-full text-sm">
          <thead className="border-y border-border text-left text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 text-right font-medium">Qty</th>
              <th className="py-2 text-right font-medium">Rate</th>
              {layout.show_gst && <th className="py-2 text-right font-medium">GST%</th>}
              {layout.show_gst &&
                (intraState ? (
                  <>
                    <th className="py-2 text-right font-medium">CGST</th>
                    <th className="py-2 text-right font-medium">SGST</th>
                  </>
                ) : (
                  <th className="py-2 text-right font-medium">IGST</th>
                ))}
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((it) => (
              <tr key={it.id} className="border-b border-border">
                <td className="py-2">
                  {it.description}
                  {it.subtext && <p className="text-xs text-muted-foreground">{it.subtext}</p>}
                </td>
                <td className="py-2 text-right">{it.quantity}</td>
                <td className="py-2 text-right">{formatINR(it.rate)}</td>
                {layout.show_gst && <td className="py-2 text-right">{it.gst_rate}%</td>}
                {layout.show_gst &&
                  (intraState ? (
                    <>
                      <td className="py-2 text-right">{formatINR(it.cgst)}</td>
                      <td className="py-2 text-right">{formatINR(it.sgst)}</td>
                    </>
                  ) : (
                    <td className="py-2 text-right">{formatINR(it.igst)}</td>
                  ))}
                <td className="py-2 text-right">{formatINR(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {layout.show_gst && company.invoice_sac_code && (
          <p className="mt-1 text-xs text-muted-foreground">SAC {company.invoice_sac_code} · Photography and videography services</p>
        )}

        {/* Totals */}
        <div className="mt-4 flex justify-end">
          <div className="w-64 space-y-1 text-sm">
            <Row label="Subtotal" value={formatINR(invoice.subtotal)} />
            {invoice.discount > 0 && <Row label="Discount" value={`− ${formatINR(invoice.discount)}`} />}
            {layout.show_gst && <Row label="Taxable" value={formatINR(invoice.taxable)} />}
            {layout.show_gst && <Row label="Tax" value={formatINR(invoice.tax)} />}
            <div className="my-1 border-t border-border" />
            <Row label="Total" value={formatINR(invoice.total)} strong />
            <Row label="Paid" value={formatINR(invoice.amount_paid)} />
            <Row label="Balance due" value={formatINR(invoice.balance_due)} strong />
          </div>
        </div>

        <p className="mt-4 border-t border-border pt-3 text-sm">
          <span className="text-muted-foreground">Amount in words: </span>
          {amountInWords(invoice.total)} only
        </p>

        {invoice.notes && (
          <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">{invoice.notes}</p>
        )}

        {received.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Payments received</p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {received.map((p) => (
                <li key={p.id} className="flex flex-col gap-0.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-muted-foreground">
                      {shortDate(p.paid_on)}
                      {p.mode ? ` · ${humanize(p.mode)}` : ''}
                      {p.reference ? ` · ${p.reference}` : ''}
                    </span>
                    <span className="font-medium">{formatINR(p.amount)}</span>
                  </div>
                  {p.notes && <p className="text-xs text-muted-foreground">{p.notes}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {layout.show_footer && (
          <div className="mt-4 flex flex-col gap-3 border-t border-border pt-3 text-sm">
            {(() => {
              const bank = invoice.bank_details ?? (layout.show_bank_details ? layout.bank_details : null)
              const terms = invoice.terms ?? layout.terms_and_conditions
              return (
                <>
                  {layout.show_bank_details && bank && (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Bank details</p>
                      <p className="whitespace-pre-line">{bank}</p>
                    </div>
                  )}
                  {terms && (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Terms &amp; conditions</p>
                      <p className="whitespace-pre-line text-muted-foreground">{terms}</p>
                    </div>
                  )}
                </>
              )
            })()}
            {company.invoice_upi_id && invoice.balance_due > 0 && invoice.status !== 'cancelled' && (
              <div className="flex items-center gap-4">
                <UpiQr
                  value={upiLink({ upi: company.invoice_upi_id, name: company.name ?? 'Studio', amount: invoice.balance_due, note: invoice.invoice_number })}
                  className="shrink-0 rounded border border-border bg-white p-1"
                />
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Scan to pay by UPI</p>
                  <p className="font-medium">{company.invoice_upi_id}</p>
                  <p className="text-xs text-muted-foreground">{formatINR(invoice.balance_due)} due · opens in any UPI app with the amount filled in</p>
                </div>
              </div>
            )}
            {layout.footer_text && <p className="text-center text-xs text-muted-foreground">{layout.footer_text}</p>}
          </div>
        )}
      </div>

  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? 'text-base font-semibold' : 'font-medium'}>{value}</span>
    </div>
  )
}
