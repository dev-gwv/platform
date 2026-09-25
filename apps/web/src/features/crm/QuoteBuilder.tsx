import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { createQuoteRequest, updateQuoteRequest, type CreateQuoteRequest, type CrmLead, type CrmQuote } from '@ipc/contracts'
import { computeInvoice, type GstSlab } from '@ipc/domain'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { formatINR } from '@/shared/ui/format'
import { DraftRestoredBanner, useFormDraft } from '@/shared/hooks/use-form-draft'
import { useCreateQuote, useUpdateQuote } from './api'

interface Line {
  description: string
  quantity: string
  rate: string
  gst_rate: GstSlab
}

const SLABS: GstSlab[] = [0, 5, 12, 18, 28]
const blank = (): Line => ({ description: '', quantity: '1', rate: '', gst_rate: 18 })

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * A priced offer on a deal: lines, discount, GST split, validity. Totals are
 * computed here with the same arithmetic the invoices use, so what the
 * client accepts is what they will later be billed.
 */
export function QuoteBuilder({
  lead,
  quote,
  open,
  onClose,
}: {
  lead: CrmLead
  quote?: CrmQuote
  open: boolean
  onClose: (createdId?: string) => void
}) {
  const isEdit = !!quote
  const create = useCreateQuote()
  const update = useUpdateQuote()
  const [title, setTitle] = useState(quote?.title ?? lead.title ?? `${lead.name ?? 'Wedding'} package`)
  const [lines, setLines] = useState<Line[]>(
    quote
      ? quote.items.map((i) => ({ description: i.description, quantity: String(i.quantity), rate: String(i.rate), gst_rate: i.gst_rate as GstSlab }))
      : [{ description: 'Photography coverage', quantity: '1', rate: lead.deal_value ? String(lead.deal_value) : '', gst_rate: 18 }],
  )
  const [discount, setDiscount] = useState(quote ? String(quote.discount) : '0')
  const [intra, setIntra] = useState(quote?.intra_state ?? true)
  const [place, setPlace] = useState(quote?.place_of_supply ?? '')
  const [validUntil, setValidUntil] = useState(() => {
    if (quote?.valid_until) return quote.valid_until
    const d = new Date()
    d.setDate(d.getDate() + 14)
    return iso(d)
  })
  const [notes, setNotes] = useState(quote?.notes ?? '')
  const [terms, setTerms] = useState(quote?.terms ?? '50% advance to confirm the date; balance before delivery.')
  const [error, setError] = useState<string | null>(null)
  // The fields as the builder opened, for "Start fresh".
  const [start] = useState(() => ({ title, lines, discount, intra, place, validUntil, notes, terms }))
  const fill = (v: typeof start) => {
    setTitle(v.title)
    setLines(v.lines)
    setDiscount(v.discount)
    setIntra(v.intra)
    setPlace(v.place)
    setValidUntil(v.validUntil)
    setNotes(v.notes)
    setTerms(v.terms)
  }
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(open ? `quote:${quote?.id ?? `new:${lead.id}`}` : null, { title, lines, discount, intra, place, validUntil, notes, terms }, fill)

  const parsedLines = useMemo(
    () =>
      lines
        .filter((l) => l.description.trim() && Number(l.rate) >= 0 && Number(l.quantity) > 0)
        .map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity), rate: Number(l.rate) || 0, gst_rate: l.gst_rate })),
    [lines],
  )
  const totals = useMemo(() => computeInvoice(parsedLines, { intraState: intra, discount: Number(discount) || 0 }), [parsedLines, intra, discount])

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  // The order is kept on the quote and shown to the client, so it is worth
  // being able to put the headline item first.
  const moveLine = (i: number, dir: -1 | 1) =>
    setLines((ls) => {
      const next = [...ls]
      const to = i + dir
      if (to < 0 || to >= next.length) return ls
      ;[next[i], next[to]] = [next[to]!, next[i]!]
      return next
    })

  function save() {
    setError(null)
    const shared = {
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(validUntil ? { valid_until: validUntil } : {}),
      place_of_supply: place.trim(),
      intra_state: intra,
      discount: Number(discount) || 0,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(terms.trim() ? { terms: terms.trim() } : {}),
      lines: parsedLines,
    }
    if (isEdit) {
      const parsed = updateQuoteRequest.safeParse(shared)
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? 'Please check the quote.')
        return
      }
      update.mutate(
        { id: quote.id, patch: parsed.data },
        {
          onSuccess: () => {
            draft.clear()
            onClose()
          },
        },
      )
      return
    }
    const body: CreateQuoteRequest = { lead_id: lead.id, ...shared }
    const parsed = createQuoteRequest.safeParse(body)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check the quote.')
      return
    }
    create.mutate(parsed.data, {
      onSuccess: (q) => {
        draft.clear()
        onClose(q.id)
      },
    })
  }

  const busy = create.isPending || update.isPending

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={isEdit ? `Edit quote ${quote.quote_number}` : `Quote for ${lead.name ?? lead.phone ?? 'this deal'}`}
        description="Lines, discount and GST. The client gets a link to accept or decline."
        className="max-w-2xl"
      >
        <div className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto pr-1">
          <DraftRestoredBanner
            at={draft.restoredAt}
            onDismiss={draft.dismissRestored}
            onDiscard={() => {
              draft.clear()
              fill(start)
            }}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1 sm:col-span-2">
              <Label htmlFor="q-title">Title</Label>
              <Input id="q-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="q-valid">Valid until</Label>
              <Input id="q-valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Lines</Label>
            {lines.map((l, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-12">
                <Input className="sm:col-span-6" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Description" aria-label="Description" />
                <Input className="sm:col-span-1" type="number" min={0.01} step="0.01" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} aria-label="Quantity" />
                <Input className="sm:col-span-2" type="number" min={0} value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} placeholder="Rate" aria-label="Rate" />
                <Select className="sm:col-span-2" value={l.gst_rate} onChange={(e) => setLine(i, { gst_rate: Number(e.target.value) as GstSlab })} aria-label="GST">
                  {SLABS.map((s) => (
                    <option key={s} value={s}>
                      GST {s}%
                    </option>
                  ))}
                </Select>
                <span className="flex sm:col-span-1">
                  <Button size="icon" variant="ghost" className="size-7" disabled={i === 0} onClick={() => moveLine(i, -1)} aria-label={`Move line ${i + 1} up`}>
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-7" disabled={i === lines.length - 1} onClick={() => moveLine(i, 1)} aria-label={`Move line ${i + 1} down`}>
                    <ArrowDown className="size-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-7" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove line ${i + 1}`}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </span>
              </div>
            ))}
            <div>
              <Button size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, blank()])}>
                <Plus /> Add line
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="q-discount">Discount (₹)</Label>
              <Input id="q-discount" type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="q-place">Place of supply</Label>
              <Input id="q-place" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="e.g. Maharashtra" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="q-intra">Tax split</Label>
              <Select id="q-intra" value={intra ? 'intra' : 'inter'} onChange={(e) => setIntra(e.target.value === 'intra')}>
                <option value="intra">Same state (CGST + SGST)</option>
                <option value="inter">Other state (IGST)</option>
              </Select>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg bg-muted/30 p-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Subtotal</dt>
              <dd className="tabular-nums">{formatINR(totals.subtotal)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Discount</dt>
              <dd className="tabular-nums">{formatINR(totals.discount)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">GST</dt>
              <dd className="tabular-nums">{formatINR(totals.tax)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Total</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatINR(totals.total)}</dd>
            </div>
          </dl>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="q-notes">Note to the client</Label>
              <textarea id="q-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="q-terms">Terms</Label>
              <textarea id="q-terms" value={terms} onChange={(e) => setTerms(e.target.value)} rows={2} className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm" />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onClose()}>
              Cancel
            </Button>
            <Button disabled={busy || parsedLines.length === 0} onClick={save}>
              {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create quote'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
