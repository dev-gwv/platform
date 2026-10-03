import type { CSSProperties } from 'react'
import type { QuoteItem } from '@ipc/contracts'
import { formatINR } from '@/shared/ui/format'
import { QuotationLetterhead, TotalsRow, type QuotationDocumentData } from '@/features/projects/QuotationDocument'

/** What a lead's quote paper needs: the quote, and the studio it comes from. */
export interface QuotePaperData {
  studio: QuotationDocumentData['studio']
  brandColor?: string | null | undefined
  number: string
  title: string | null
  preparedFor: string | null
  issuedAt: string | null | undefined
  validUntil: string | null | undefined
  items: Pick<QuoteItem, 'description' | 'quantity' | 'rate' | 'amount'>[]
  subtotal: number
  discount: number
  tax: number
  total: number
  intraState: boolean
  notes: string | null
  terms: string | null
}

/**
 * A lead's quote on the studio's letterhead -- the same stripe, logo and
 * contacts as the project quotation, so a client who gets both sees one
 * studio. A document: rupees are never masked here.
 */
export function QuotePaper({ data }: { data: QuotePaperData }) {
  const { studio } = data
  const style = data.brandColor ? ({ '--quotation-brand': data.brandColor } as CSSProperties) : undefined
  return (
    <article
      className="paper quotation-paper relative overflow-hidden rounded-xl border border-border bg-card p-5 pt-7 shadow-sm sm:p-10 sm:pt-12"
      style={style}
    >
      <div className="quotation-brand-stripe" aria-hidden />
      <QuotationLetterhead
        studio={studio}
        label="Quotation"
        preparedFor={data.preparedFor}
        number={`#${data.number}`}
        issuedAt={data.issuedAt}
        validUntil={data.validUntil}
      />

      {data.title && <h2 className="paper-block mt-6 text-lg font-semibold">{data.title}</h2>}

      <section className="q-section paper-block mt-6">
        <div className="quotation-table overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Rate</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">
                    Details will be shared separately.
                  </td>
                </tr>
              ) : (
                data.items.map((i, n) => (
                  <tr key={n} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-medium">{i.description}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{i.quantity}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatINR(i.rate)}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{formatINR(i.amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="q-section paper-block mt-8 flex justify-end">
        <div className="q-summary w-full max-w-sm rounded-xl border border-border bg-muted/30 p-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Summary</h3>
          <TotalsRow label="Subtotal" value={formatINR(data.subtotal)} />
          {data.discount > 0 && <TotalsRow label="Discount" value={`− ${formatINR(data.discount)}`} muted />}
          {data.tax > 0 && (
            <TotalsRow label={data.intraState ? 'GST (CGST + SGST)' : 'GST (IGST)'} value={formatINR(data.tax)} />
          )}
          <div className="my-3 border-t border-border" />
          <TotalsRow label="Total" value={formatINR(data.total)} emphasis />
        </div>
      </section>

      {data.notes && (
        <p className="paper-block mt-6 whitespace-pre-line rounded-lg border border-border bg-muted/30 p-3 text-sm">{data.notes}</p>
      )}
      {data.terms && (
        <section className="q-section q-terms paper-block mt-8 border-t border-border pt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Terms</h3>
          <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{data.terms}</p>
        </section>
      )}

      <footer className="q-section q-foot paper-block mt-8 space-y-2 border-t border-border pt-4 text-[11px] text-muted-foreground">
        {studio.footerNote && <p className="whitespace-pre-line text-foreground/80">{studio.footerNote}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>{studio.name} · Quotation</span>
          <span>#{data.number}</span>
        </div>
      </footer>
    </article>
  )
}
