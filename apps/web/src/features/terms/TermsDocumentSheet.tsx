import { FileText } from 'lucide-react'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import type { TermsPayload } from './document'

/**
 * The terms document itself, rendered the same way wherever it is read.
 *
 * Used by the public acknowledge page (where the client signs) and by the
 * in-app viewer (where the studio checks what was sent). Only the surroundings
 * differ — the agree form, the share buttons, the dialog chrome — so only the
 * surroundings live outside this file. If the studio and the client saw two
 * different renderings of the same legal text, the whole point of being able
 * to read it in the app would be lost.
 *
 * `bodyClassName` is the one concession: the public page scrolls the body
 * inside a short card on a phone, the dialog gives it the whole panel.
 */
export function TermsDocumentSheet({
  doc,
  bodyClassName = 'max-h-[45vh] overflow-auto',
}: {
  doc: TermsPayload
  bodyClassName?: string
}) {
  const estimatedFor = (mode: string | null | undefined, value: number | null | undefined) =>
    mode === 'percentage' && doc.total_cost ? ((Number(value) || 0) / 100) * doc.total_cost : Number(value) || 0

  return (
    <div className="flex flex-col gap-4">
      {doc.total_cost != null && doc.total_cost > 0 && (
        <Card>
          <CardContent className="p-4 text-sm">
            <div className="flex items-center justify-between">
              <p className="font-semibold">Project value</p>
              <p className="font-semibold tabular-nums">₹{doc.total_cost.toLocaleString('en-IN')}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {doc.payment_terms && doc.payment_terms.length > 0 ? (
        <Card>
          <CardContent className="p-4 text-sm">
            <p className="font-semibold">Payment terms</p>
            <div className="mt-2 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Label</th>
                    <th className="px-2 py-1.5 text-right font-medium">Value</th>
                    <th className="px-2 py-1.5 text-right font-medium">Estimated</th>
                    <th className="px-2 py-1.5 font-medium">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.payment_terms.map((p, i) => (
                    <tr key={p.id ?? i} className="border-t border-border">
                      <td className="px-2 py-1.5">
                        {p.label}
                        {p.notes ? <div className="text-[10px] text-muted-foreground">{p.notes}</div> : null}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {p.mode === 'percentage'
                          ? `${p.value}%`
                          : `₹${Number(p.value ?? 0).toLocaleString('en-IN')}`}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        ₹{Math.round(estimatedFor(p.mode, p.value)).toLocaleString('en-IN')}
                      </td>
                      <td className="px-2 py-1.5">
                        {p.due_trigger ?? '—'}
                        {p.due_date ? ` · ${p.due_date}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : doc.payment_summary ? (
        <Card>
          <CardContent className="p-4 text-sm">
            <p className="font-semibold">Payment</p>
            <p className="mt-1 text-muted-foreground">{doc.payment_summary}</p>
          </CardContent>
        </Card>
      ) : null}

      {doc.sections.length > 0 && (
        <Card>
          <CardContent className="p-4 text-sm">
            {doc.sections.map((s, i) => (
              <div key={i} className="mb-3 last:mb-0">
                {(s['heading'] as string | undefined) && <p className="font-semibold">{String(s['heading'])}</p>}
                <p className="whitespace-pre-wrap text-muted-foreground">{String(s['body'] ?? '')}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className={`whitespace-pre-wrap p-4 text-sm leading-relaxed ${bodyClassName}`}>
          {doc.body}
        </CardContent>
      </Card>

      {doc.legal_note && (
        <p className="border-t border-border pt-3 text-[11px] italic text-muted-foreground">{doc.legal_note}</p>
      )}
      {doc.document_footer_note && (
        <p className="whitespace-pre-line text-[11px] text-muted-foreground">{doc.document_footer_note}</p>
      )}
    </div>
  )
}

/**
 * The letterhead: who issued this, to whom, under what number, and when.
 *
 * Separated from the body because the public page puts it outside the document
 * card (it is the page header there) while the dialog puts it inside.
 */
export function TermsDocumentLetterhead({ doc, trailing }: { doc: TermsPayload; trailing?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      {doc.logo_url ? (
        <img
          src={doc.logo_url}
          alt={doc.company_name ?? 'Studio logo'}
          className="size-9 rounded-lg object-contain"
        />
      ) : (
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <FileText className="size-5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="text-lg font-semibold">{doc.title ?? 'Terms & agreement'}</h1>
        {(doc.project_name || doc.client_name || doc.company_name) && (
          <p className="text-xs text-muted-foreground">
            {[doc.project_name, doc.client_name, doc.company_name].filter(Boolean).join(' · ')}
          </p>
        )}
        {doc.company_legal_name && doc.company_legal_name !== doc.company_name && (
          <p className="text-xs text-muted-foreground">{doc.company_legal_name}</p>
        )}
        <p className="text-[11px] text-muted-foreground">
          {[doc.company_phone, doc.company_email, doc.company_website, doc.gstin ? `GSTIN: ${doc.gstin}` : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {doc.company_address && (
          <p className="whitespace-pre-line text-[11px] text-muted-foreground">{doc.company_address}</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 text-right">
        {doc.document_number && <p className="font-mono text-xs text-muted-foreground">{doc.document_number}</p>}
        {doc.issued_at && (
          <p className="text-[11px] text-muted-foreground">
            Issued {new Date(doc.issued_at).toLocaleDateString('en-IN')}
          </p>
        )}
        {doc.acknowledged_at && <StatusBadge tone="success">Agreed</StatusBadge>}
        {trailing}
      </div>
    </div>
  )
}
