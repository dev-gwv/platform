import type { CSSProperties, ReactNode } from 'react'
import { Paperclip } from 'lucide-react'
import { amountInWords } from '@ipc/domain'
import { placeOfSupplyLabel, type InvoiceDesign, type InvoiceDetail, type InvoiceTemplateLayout } from '@ipc/contracts'
import { formatINR, humanize } from '@/shared/ui/format'
import { cn } from '@/shared/ui/cn'
import { invoiceBadge, shortDate } from './status'
import { UpiQr, upiLink } from './UpiQr'

/** Who the invoice is from, as printed at the top. */
export interface InvoiceFrom {
  name: string | null
  legal_name?: string | null | undefined
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

const NO_LAYOUT: InvoiceTemplateLayout = {
  show_header: true,
  show_footer: true,
  show_gst: true,
  show_bank_details: false,
  header_text: null,
  footer_text: null,
  bank_details: null,
  terms_and_conditions: null,
  design: 'classic',
  accent: '#4f46e5',
  show_logo: true,
}

/** The five looks a studio picks from, with the words shown in the picker. */
export const DESIGN_INFO: Record<InvoiceDesign, { label: string; hint: string }> = {
  classic: { label: 'Classic', hint: 'A traditional tax invoice: serif title, dark table header' },
  modern: { label: 'Modern', hint: 'A coloured band across the top, soft tinted table' },
  minimal: { label: 'Minimal', hint: 'Mostly white, one thin line of colour' },
  bold: { label: 'Bold', hint: 'Big coloured title and a solid total box' },
  elegant: { label: 'Elegant', hint: 'Centred letterhead, serif type, fine rules' },
}

export const ACCENTS = ['#4f46e5', '#0f766e', '#b45309', '#be123c', '#1e293b', '#7c3aed', '#0369a1', '#a16207']

/** A layout being previewed: any subset, where a blank field may be undefined. */
export type LayoutOverride = { [K in keyof InvoiceTemplateLayout]?: InvoiceTemplateLayout[K] | undefined }

const SERIF: CSSProperties = { fontFamily: "Georgia, 'Times New Roman', serif" }

/**
 * The invoice as it prints -- the same sheet the studio sees and the client
 * opens from their link, in the design the studio chose. Always paper-white,
 * whatever the app's theme, because it is a document, not a screen.
 */
export function InvoicePaper({
  invoice,
  company,
  layoutOverride,
  attachmentHref,
}: {
  invoice: InvoiceDetail
  company: InvoiceFrom
  /** A design being previewed in settings, before it is saved. */
  layoutOverride?: LayoutOverride | undefined
  /** Where a listed attachment downloads from; without it the names are listed plainly. */
  attachmentHref?: ((fileId: string) => string) | undefined
}) {
  const override = Object.fromEntries(Object.entries(layoutOverride ?? {}).filter(([, v]) => v !== undefined)) as Partial<InvoiceTemplateLayout>
  const base: InvoiceTemplateLayout = { ...NO_LAYOUT, ...(invoice.template_layout ?? {}), ...override }
  const design = base.design
  const accent = base.accent
  // An invoice with no tax on it is not a tax invoice, and empty GST columns
  // only make a family's wedding bill look like a form.
  const taxed = invoice.tax > 0 || invoice.items.some((i) => i.gst_rate > 0)
  const layout = { ...base, show_gst: base.show_gst && taxed }
  const intraState = invoice.intra_state
  const showHsn = invoice.items.some((i) => i.hsn_sac)
  const received = invoice.payments.filter((p) => (p.status ?? 'paid') === 'paid')
  const paid = invoiceBadge(invoice).label === 'Paid'
  const title = taxed ? 'TAX INVOICE' : 'INVOICE'
  const pos = placeOfSupplyLabel(invoice.place_of_supply)
  const serif = design === 'classic' || design === 'elegant'
  const bank = invoice.bank_details ?? (layout.show_bank_details ? layout.bank_details : null)
  const terms = invoice.terms ?? layout.terms_and_conditions

  const headStyle: CSSProperties =
    design === 'classic'
      ? { background: '#1f2937', color: '#fff' }
      : design === 'bold'
        ? { background: accent, color: '#fff' }
        : design === 'modern'
          ? { background: `${accent}1a`, color: '#111827' }
          : { borderBottom: `2px solid ${accent}`, color: '#374151' }

  const studio = layout.show_header && (
    <div className={cn('min-w-0', design === 'elegant' && 'text-center')}>
      {base.show_logo && company.logo_url && (
        <img
          src={company.logo_url}
          alt=""
          className={cn('mb-2 h-14 w-auto max-w-[180px] object-contain', design === 'elegant' && 'mx-auto')}
        />
      )}
      <p className={cn('text-lg font-bold leading-tight', design === 'modern' ? 'text-white' : 'text-slate-900')} style={serif ? SERIF : undefined}>
        {company.legal_name || company.name || 'Your Studio'}
      </p>
      <div className={cn('mt-1 space-y-0.5 text-xs', design === 'modern' ? 'text-white/85' : 'text-slate-600')}>
        {company.invoice_address && <p className="whitespace-pre-line">{company.invoice_address}</p>}
        {!company.invoice_address && company.city && <p>{[company.city, company.state, company.country].filter(Boolean).join(', ')}</p>}
        {(company.invoice_phone || company.invoice_email) && <p>{[company.invoice_phone, company.invoice_email].filter(Boolean).join(' · ')}</p>}
        {company.invoice_gst_number && <p className="font-medium">GSTIN {company.invoice_gst_number}</p>}
        {layout.header_text && <p>{layout.header_text}</p>}
      </div>
    </div>
  )

  const titleBlock = (
    <div className={cn('shrink-0', design === 'elegant' ? 'text-center' : 'text-right')}>
      <p
        className={cn(
          'font-bold tracking-tight',
          design === 'bold' ? 'text-4xl' : design === 'minimal' ? 'text-xl tracking-[0.2em]' : 'text-3xl',
          design === 'modern' && 'text-white',
        )}
        style={{ ...(serif ? SERIF : {}), ...(design === 'bold' || design === 'minimal' ? { color: accent } : design === 'modern' ? {} : { color: '#111827' }) }}
      >
        {title}
      </p>
      <p className={cn('mt-1 text-sm font-semibold', design === 'modern' ? 'text-white' : 'text-slate-800')}># {invoice.invoice_number}</p>
      <div className={cn('mt-3', design === 'elegant' && 'hidden')}>
        <p className={cn('text-[11px] uppercase tracking-wider', design === 'modern' ? 'text-white/80' : 'text-slate-500')}>Balance due</p>
        <p className={cn('text-xl font-bold tabular-nums', design === 'modern' ? 'text-white' : 'text-slate-900')}>{formatINR(invoice.balance_due)}</p>
      </div>
    </div>
  )

  return (
    <div
      className="paper relative mx-auto w-full max-w-4xl overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-900 shadow-sm"
      style={design === 'elegant' ? SERIF : undefined}
    >
      {paid && (
        <div className="absolute left-[-46px] top-6 z-10 -rotate-45 bg-emerald-600 px-14 py-1 text-xs font-bold uppercase tracking-[0.2em] text-white shadow-md">
          Paid
        </div>
      )}

      {/* Letterhead */}
      {design === 'modern' ? (
        <div className="flex flex-wrap items-start justify-between gap-6 px-8 py-7 sm:px-10" style={{ background: accent }}>
          {studio || <div />}
          {titleBlock}
        </div>
      ) : design === 'elegant' ? (
        <div className="flex flex-col items-center gap-4 px-8 pt-10 sm:px-10">
          {studio}
          <div className="w-full border-y py-3 text-center" style={{ borderColor: accent }}>
            <p className="text-2xl tracking-[0.35em]" style={{ color: accent }}>
              {title}
            </p>
            <p className="mt-1 text-sm text-slate-700"># {invoice.invoice_number}</p>
          </div>
        </div>
      ) : (
        <div className={cn('flex flex-wrap items-start justify-between gap-6 px-8 pt-10 sm:px-10', design === 'bold' && 'border-l-8')} style={design === 'bold' ? { borderColor: accent } : undefined}>
          {studio || <div />}
          {titleBlock}
        </div>
      )}

      <div className="px-8 pb-10 sm:px-10">
        {/* Bill to + facts */}
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="min-w-0">
            <Caption accent={design === 'minimal' || design === 'elegant' ? accent : undefined}>Bill to</Caption>
            <p className="mt-1 font-semibold" style={{ color: design === 'classic' ? accent : undefined }}>
              {invoice.client_name ?? '—'}
            </p>
            <div className="mt-0.5 space-y-0.5 text-sm text-slate-600">
              {invoice.client_address && <p className="whitespace-pre-line">{invoice.client_address}</p>}
              {(invoice.client_phone || invoice.client_email) && <p>{[invoice.client_phone, invoice.client_email].filter(Boolean).join(' · ')}</p>}
              {(invoice.gst_number || invoice.client_gstin) && <p className="font-medium text-slate-700">GSTIN {invoice.gst_number || invoice.client_gstin}</p>}
            </div>
            {pos && layout.show_gst && <p className="mt-2 text-sm text-slate-600">Place of supply: {pos}</p>}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 self-start text-sm sm:justify-self-end">
            <Fact label="Invoice date" value={shortDate(invoice.invoice_date)} />
            {invoice.payment_terms && <Fact label="Terms" value={invoice.payment_terms} />}
            {invoice.due_date && <Fact label="Due date" value={shortDate(invoice.due_date)} />}
            {invoice.project_name && <Fact label="Project" value={invoice.project_name} />}
            {design === 'elegant' && <Fact label="Balance due" value={formatINR(invoice.balance_due)} />}
          </dl>
        </div>

        {invoice.subject && (
          <div className="mt-6">
            <Caption accent={design === 'minimal' || design === 'elegant' ? accent : undefined}>Subject</Caption>
            <p className="mt-1 text-sm text-slate-800">{invoice.subject}</p>
          </div>
        )}

        {/* Items */}
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr style={headStyle}>
                <Th className="w-8 text-left">#</Th>
                <Th className="text-left">Item &amp; description</Th>
                {showHsn && <Th className="text-left">HSN/SAC</Th>}
                <Th className="text-right">Qty</Th>
                <Th className="text-right">Rate</Th>
                {layout.show_gst &&
                  (intraState ? (
                    <>
                      <Th className="text-right">CGST</Th>
                      <Th className="text-right">SGST</Th>
                    </>
                  ) : (
                    <Th className="text-right">IGST</Th>
                  ))}
                <Th className="text-right">Amount</Th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((it, i) => (
                <tr key={it.id} className={cn('border-b border-slate-200 align-top', design === 'modern' && i % 2 === 1 && 'bg-slate-50')}>
                  <td className="px-3 py-3 text-slate-500">{i + 1}</td>
                  <td className="px-3 py-3">
                    <p className="font-medium text-slate-900">{it.description}</p>
                    {it.subtext && <p className="mt-0.5 text-xs text-slate-500">{it.subtext}</p>}
                  </td>
                  {showHsn && <td className="px-3 py-3 tabular-nums text-slate-700">{it.hsn_sac ?? '—'}</td>}
                  <td className="px-3 py-3 text-right tabular-nums">{it.quantity}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatINR(it.rate)}</td>
                  {layout.show_gst &&
                    (intraState ? (
                      <>
                        <TaxCell amount={it.cgst} rate={it.gst_rate / 2} />
                        <TaxCell amount={it.sgst} rate={it.gst_rate / 2} />
                      </>
                    ) : (
                      <TaxCell amount={it.igst} rate={it.gst_rate} />
                    ))}
                  <td className="px-3 py-3 text-right font-medium tabular-nums">{formatINR(it.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {layout.show_gst && !showHsn && company.invoice_sac_code && (
          <p className="mt-2 text-xs text-slate-500">SAC {company.invoice_sac_code} · Photography and videography services</p>
        )}

        {/* Words + totals */}
        <div className="mt-6 flex flex-col-reverse gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm text-sm">
            <Caption>Total in words</Caption>
            <p className="mt-1 font-medium italic text-slate-800">Indian Rupee {amountInWords(invoice.total)} only</p>
            {invoice.notes && (
              <div className="mt-4">
                <Caption>Notes</Caption>
                <p className="mt-1 whitespace-pre-line text-slate-600">{invoice.notes}</p>
              </div>
            )}
          </div>
          <div className="w-full space-y-1.5 text-sm sm:w-72">
            <Row label="Sub total" value={formatINR(invoice.subtotal)} />
            {invoice.discount > 0 && <Row label="Discount" value={`(−) ${formatINR(invoice.discount)}`} />}
            {layout.show_gst &&
              (intraState ? (
                <>
                  <Row label="CGST" value={formatINR(invoice.items.reduce((s, x) => s + x.cgst, 0))} />
                  <Row label="SGST" value={formatINR(invoice.items.reduce((s, x) => s + x.sgst, 0))} />
                </>
              ) : (
                <Row label="IGST" value={formatINR(invoice.items.reduce((s, x) => s + x.igst, 0))} />
              ))}
            <div
              className={cn('flex items-center justify-between rounded-md px-3 py-2 text-base font-bold', design !== 'bold' && 'border-t border-slate-300 px-0')}
              style={design === 'bold' ? { background: accent, color: '#fff' } : undefined}
            >
              <span>Total</span>
              <span className="tabular-nums">{formatINR(invoice.total)}</span>
            </div>
            {invoice.amount_paid > 0 && <Row label="Payment made" value={`(−) ${formatINR(invoice.amount_paid)}`} tone="text-emerald-700" />}
            <div className="flex items-center justify-between rounded-md px-3 py-2 font-bold" style={{ background: design === 'minimal' ? '#f8fafc' : `${accent}14` }}>
              <span>Balance due</span>
              <span className="tabular-nums">{formatINR(invoice.balance_due)}</span>
            </div>
          </div>
        </div>

        {received.length > 0 && (
          <div className="paper-block mt-6 border-t border-slate-200 pt-4">
            <Caption>Payments received</Caption>
            <ul className="mt-2 space-y-1 text-sm">
              {received.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-600">
                    {shortDate(p.paid_on)}
                    {p.mode ? ` · ${humanize(p.mode)}` : ''}
                    {p.reference ? ` · ${p.reference}` : ''}
                  </span>
                  <span className="font-medium tabular-nums">{formatINR(p.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {layout.show_footer && (bank || terms || (company.invoice_upi_id && invoice.balance_due > 0 && invoice.status !== 'cancelled')) && (
          <div className="paper-block mt-6 grid gap-6 border-t border-slate-200 pt-4 text-sm sm:grid-cols-2">
            <div className="space-y-4">
              {layout.show_bank_details && bank && (
                <div>
                  <Caption>Bank details</Caption>
                  <p className="mt-1 whitespace-pre-line text-slate-700">{bank}</p>
                </div>
              )}
              {terms && (
                <div>
                  <Caption>Terms &amp; conditions</Caption>
                  <p className="mt-1 whitespace-pre-line text-slate-600">{terms}</p>
                </div>
              )}
            </div>
            {company.invoice_upi_id && invoice.balance_due > 0 && invoice.status !== 'cancelled' && (
              <div className="flex items-center gap-4 sm:justify-self-end">
                <UpiQr
                  value={upiLink({ upi: company.invoice_upi_id, name: company.name ?? 'Studio', amount: invoice.balance_due, note: invoice.invoice_number })}
                  className="shrink-0 rounded border border-slate-200 bg-white p-1"
                />
                <div>
                  <Caption>Scan to pay by UPI</Caption>
                  <p className="font-medium">{company.invoice_upi_id}</p>
                  <p className="text-xs text-slate-500">{formatINR(invoice.balance_due)} · any UPI app</p>
                </div>
              </div>
            )}
          </div>
        )}

        {invoice.attachments.length > 0 && (
          <div className="paper-block mt-6 border-t border-slate-200 pt-4">
            <Caption>Attached with this invoice</Caption>
            <ul className="mt-2 flex flex-wrap gap-2">
              {invoice.attachments.map((f) => (
                <li key={f.id}>
                  {attachmentHref ? (
                    <a
                      href={attachmentHref(f.id)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-sm hover:bg-slate-50"
                      style={{ color: accent }}
                    >
                      <Paperclip className="size-3.5" /> {f.name}
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-sm text-slate-700">
                      <Paperclip className="size-3.5" /> {f.name}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-10 flex items-end justify-between gap-6">
          <p className="text-xs text-slate-400">{layout.footer_text ?? 'This is a computer-generated invoice.'}</p>
          <div className="min-w-[180px] border-t border-slate-300 pt-2 text-right">
            <p className="text-xs text-slate-500">Authorised signatory</p>
            <p className="text-xs font-medium text-slate-700">{company.legal_name || company.name}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function Caption({ children, accent }: { children: ReactNode; accent?: string | undefined }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500" style={accent ? { color: accent } : undefined}>
      {children}
    </p>
  )
}

function Th({ children, className }: { children: ReactNode; className?: string }) {
  return <th className={cn('px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider', className)}>{children}</th>
}

function TaxCell({ amount, rate }: { amount: number; rate: number }) {
  return (
    <td className="px-3 py-3 text-right tabular-nums">
      {formatINR(amount)}
      <p className="text-[11px] text-slate-500">{Number(rate.toFixed(2))}%</p>
    </td>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-slate-500">{label} :</dt>
      <dd className="text-right font-medium text-slate-800">{value}</dd>
    </>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={cn('flex items-center justify-between', tone)}>
      <span className="text-slate-600">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
}
