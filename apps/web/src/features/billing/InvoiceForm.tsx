import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Plus, Search } from 'lucide-react'
import { computeInvoice, type GstSlab } from '@ipc/domain'
import { formatBankSnapshot, type Client, type CreateInvoiceRequest } from '@ipc/contracts'
import { cn } from '@/shared/ui/cn'
import { Button } from '@/shared/ui/button'
import { Input, Select } from '@/shared/ui/input'
import { ClientFormDialog } from '@/features/clients/ClientFormDialog'
import { toAmount, type InvoiceLineDraft } from './invoice-math'
import { useInvoiceBankAccounts, useInvoiceNoteTemplates, useCreateInvoiceNoteTemplate } from './api'

export { toAmount, type InvoiceLineDraft } from './invoice-math'

export const GST_SLABS: GstSlab[] = [0, 5, 12, 18, 28]

export const todayISO = () => new Date().toISOString().slice(0, 10)

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso || todayISO())
  if (Number.isNaN(d.getTime())) return ''
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}


export interface InvoiceFormValues {
  client_id: string
  project_id: string
  place_of_supply: string
  intra_state: boolean
  /** "No GST" mode — all lines forced to 0% and the GST UI hides. */
  no_gst: boolean
  /** Per-invoice GSTIN snapshot (Lovable parity) — validated when GST applies. */
  gst_number: string
  /** Draft stays editable; sent is client-facing. */
  status: 'draft' | 'sent'
  invoice_date: string
  due_date: string
  /** String for the same reason the line amounts are — see InvoiceLineDraft. */
  discount: string
  discount_type: 'flat' | 'percent' | 'none'
  notes: string
  /** Per-invoice snapshot; blank falls back to the print layout. */
  bank_details: string
  terms: string
  template_id: string
  /** Create only -- blank means auto-numbered. Never sent on an edit. */
  invoice_number: string
  /** A line telling the client what this invoice is for. */
  subject: string
  /** "Due on receipt", "Net 15"... the due date follows from it. */
  payment_terms: string
  /** Files sent with the invoice. */
  attachments: { id: string; name: string }[]
  /** Money already in hand, recorded as the invoice is created (create only). */
  payment: { on: boolean; amount: string; paid_on: string; mode: string; reference: string }
  lines: InvoiceLineDraft[]
}

/**
 * A blank invoice, with GST OFF.
 *
 * Most of what this studio bills is a family paying for a wedding: no GSTIN,
 * no place of supply, no tax. A corporate client wanting a tax invoice is the
 * exception. GST used to be the default — every new invoice started at 18% and
 * put four tax controls in front of the person typing — which had the rare
 * case blocking the common one on every single invoice.
 */
export function emptyInvoiceForm(): InvoiceFormValues {
  return {
    client_id: '',
    project_id: '',
    place_of_supply: '',
    intra_state: true,
    no_gst: true,
    gst_number: '',
    status: 'draft',
    invoice_date: todayISO(),
    due_date: '',
    discount: '',
    discount_type: 'none',
    notes: '',
    bank_details: '',
    terms: '',
    template_id: '',
    invoice_number: '',
    subject: '',
    payment_terms: 'Due on receipt',
    attachments: [],
    payment: { on: false, amount: '', paid_on: todayISO(), mode: '', reference: '' },
    lines: [{ description: '', quantity: '1', rate: '', gst_rate: 0 }],
  }
}

/** The create form's field set as a hook, reused by the edit dialog so both stay in lockstep. */
export function useInvoiceForm(initial: InvoiceFormValues) {
  const [values, setValues] = useState(initial)

  function set<K extends keyof InvoiceFormValues>(key: K, value: InvoiceFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }))
  }

  function patchLine(i: number, p: Partial<InvoiceLineDraft>) {
    setValues((v) => ({ ...v, lines: v.lines.map((l, idx) => (idx === i ? { ...l, ...p } : l)) }))
  }

  /**
   * Turning GST on and off.
   *
   * Off forces every rate to 0. On restores 18% for lines that are at 0 —
   * without that, un-ticking the old "No GST" box left every line at 0% and
   * produced a GST invoice with no tax on it, silently.
   */
  function setGstEnabled(on: boolean) {
    setValues((v) => ({
      ...v,
      no_gst: !on,
      gst_number: on ? v.gst_number : '',
      lines: v.lines.map((l) => ({ ...l, gst_rate: on ? (l.gst_rate || 18) : 0 })),
    }))
  }

  /**
   * The drafts parsed into numbers, once.
   *
   * Left unannotated on purpose: `computeInvoice` wants @ipc/domain's line
   * shape (`gst_rate: GstSlab`) while the request wants @ipc/contracts' (a
   * plain refined number). Inferring from the cast satisfies both — naming
   * either type here breaks the other.
   */
  const lineInputs = useMemo(
    () =>
      values.lines.map((l) => ({
        description: l.description.trim(),
        ...(l.subtext?.trim() ? { subtext: l.subtext.trim() } : {}),
        quantity: toAmount(l.quantity),
        rate: toAmount(l.rate),
        gst_rate: l.gst_rate as GstSlab,
        ...(l.hsn_sac?.trim() ? { hsn_sac: l.hsn_sac.trim() } : {}),
      })),
    [values.lines],
  )

  /**
   * Every line counts, described or not.
   *
   * This used to skip lines with a blank description, so a rate typed before a
   * description showed a total of ₹0 — and the submit button, which was gated
   * on the total, stayed disabled with nothing on screen explaining why. The
   * total now reflects what has been typed; a missing description is caught by
   * `problems()` at submit, where it can actually be reported.
   */
  const totals = useMemo(
    () =>
      computeInvoice(lineInputs, {
        intraState: values.intra_state,
        discount: values.discount_type === 'none' ? 0 : toAmount(values.discount),
        discountType: values.discount_type === 'none' ? 'flat' : values.discount_type,
      }),
    [lineInputs, values.intra_state, values.discount, values.discount_type],
  )

  /**
   * What is stopping this invoice being saved, in the order worth fixing.
   *
   * Returned as messages rather than a boolean so the form can say why instead
   * of greying out the button and leaving the person to guess.
   */
  function problems(): string[] {
    const out: string[] = []
    if (!values.client_id) out.push('Choose a client for this invoice.')

    const typed = values.lines.filter((l) => l.description.trim() || toAmount(l.rate) > 0)
    if (typed.length === 0) out.push('Add at least one line with a description and an amount.')
    // A line carrying money but no description would previously have been
    // dropped on save without a word, taking the amount with it.
    if (typed.some((l) => !l.description.trim())) out.push('Every line needs a description.')
    if (typed.some((l) => l.description.trim() && toAmount(l.quantity) <= 0)) {
      out.push('Quantity must be more than 0 on every line.')
    }
    if (typed.length > 0 && totals.total <= 0) out.push('The invoice total must be more than ₹0.')
    if (typed.some((l) => l.hsn_sac && !/^\d{4,8}$/.test(l.hsn_sac.trim()))) out.push('An HSN/SAC code is 4 to 8 digits.')
    if (values.payment.on) {
      const amt = toAmount(values.payment.amount)
      if (amt <= 0) out.push('Enter the payment amount received, or untick “Payment received”.')
      else if (amt > totals.total) out.push('The payment received is more than the invoice total.')
    }
    return out
  }

  function toRequest(): CreateInvoiceRequest {
    const discountNone = values.discount_type === 'none'
    return {
      client_id: values.client_id || null,
      project_id: values.project_id || null,
      place_of_supply: values.place_of_supply,
      intra_state: values.intra_state,
      invoice_date: values.invoice_date || undefined,
      due_date: values.due_date || undefined,
      discount: discountNone ? 0 : toAmount(values.discount),
      discount_type: values.discount_type,
      status: values.status,
      gst_number: values.gst_number.trim() ? values.gst_number.trim().toUpperCase() : undefined,
      notes: values.notes.trim() || undefined,
      bank_details: values.bank_details.trim() || undefined,
      terms: values.terms.trim() || undefined,
      template_id: values.template_id || null,
      invoice_number: values.invoice_number.trim() || undefined,
      subject: values.subject.trim() || undefined,
      payment_terms: values.payment_terms.trim() || undefined,
      attachment_file_ids: values.attachments.map((a) => a.id),
      ...(values.payment.on && toAmount(values.payment.amount) > 0
        ? {
            payment: {
              amount: toAmount(values.payment.amount),
              paid_on: values.payment.paid_on || undefined,
              mode: values.payment.mode || undefined,
              reference: values.payment.reference.trim() || undefined,
            },
          }
        : {}),
      // Only lines someone actually filled in — a spare empty row at the
      // bottom is not an error, it is just an empty row.
      lines: lineInputs.filter((l) => l.description || l.rate > 0),
    }
  }

  function reset() {
    setValues(emptyInvoiceForm())
  }

  /** Put back a whole saved state at once (a restored draft). */
  function replace(next: InvoiceFormValues) {
    setValues(next)
  }

  return { values, set, patchLine, setGstEnabled, totals, problems, toRequest, reset, replace }
}

/** A searchable dropdown over the client list -- matches by name, phone or email. */
export function ClientCombobox({
  clients,
  value,
  onChange,
}: {
  clients: Client[]
  value: string
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  // The client just added, shown by name until the refreshed list includes it.
  const [added, setAdded] = useState<Client | null>(null)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)

  const selected = clients.find((c) => c.id === value) ?? (added?.id === value ? added : undefined)

  useEffect(() => {
    if (open) search.current?.focus()
    else setQuery('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const q = query.trim().toLowerCase()
  const matches = q
    ? clients.filter((c) => c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(q) || (c.email ?? '').toLowerCase().includes(q))
    : clients

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          'flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-left text-sm shadow-sm',
          !value && 'text-muted-foreground',
        )}
      >
        <span className="truncate">{selected ? selected.name : 'Select a client…'}</span>
        <Search className="size-4 shrink-0 opacity-50" aria-hidden />
      </button>

      {open && (
        <div
          role="listbox"
          className="ipc-menu absolute left-0 top-full z-40 mt-1 w-full min-w-64 overflow-hidden rounded-lg border border-border bg-card shadow-lg"
        >
          <div className="border-b border-border p-2">
            <Input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, phone or email…" />
          </div>
          <div className="max-h-64 overflow-y-auto p-1.5">
            {matches.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">No client matches "{query}".</p>
            ) : (
              matches.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={c.id === value}
                  onClick={() => {
                    onChange(c.id)
                    setOpen(false)
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.name}</p>
                    {(c.phone || c.email) && (
                      <p className="truncate text-xs text-muted-foreground">{[c.phone, c.email].filter(Boolean).join(' · ')}</p>
                    )}
                  </div>
                  {c.id === value && <Check className="size-4 shrink-0" aria-hidden />}
                </button>
              ))
            )}
          </div>
          <div className="border-t border-border p-1.5">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setCreating(true)
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium text-primary transition-colors hover:bg-muted"
            >
              <Plus className="size-4" aria-hidden /> New client
            </button>
          </div>
        </div>
      )}
      {/* A client who isn't on the list yet is added here and picked, without leaving the invoice. */}
      <ClientFormDialog open={creating} onOpenChange={setCreating} hideTrigger onCreated={(c) => {
          setAdded(c)
          onChange(c.id)
        }} />
    </div>
  )
}

/** A "Templates ▾" picker that fills Notes from a saved snippet, plus a "+ Save" to add the current text as one. */
export function NoteTemplatePicker({ notes, onFill }: { notes: string; onFill: (content: string) => void }) {
  const { data } = useInvoiceNoteTemplates()
  const createTemplate = useCreateInvoiceNoteTemplate()
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const templates = (data?.items ?? []).filter((t) => (t.template_type ?? 'note') === 'note')

  async function onSave() {
    if (!title.trim() || !notes.trim()) return
    await createTemplate.mutateAsync({ title: title.trim(), content: notes.trim(), template_type: 'note', is_default: false })
    setSaving(false)
    setTitle('')
  }

  if (saving) {
    return (
      <div className="flex items-center gap-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Template name" autoFocus className="h-7 w-40 text-xs" />
        <Button type="button" size="sm" className="h-7" onClick={() => void onSave()} disabled={!title.trim() || createTemplate.isPending}>
          Save
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => setSaving(false)}>
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {templates.length > 0 && (
        <Select
          value=""
          onChange={(e) => {
            const t = templates.find((x) => x.id === e.target.value)
            if (t) onFill(t.content)
          }}
          className="h-7 w-40 text-xs"
        >
          <option value="">Templates…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </Select>
      )}
      <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSaving(true)} disabled={!notes.trim()}>
        + Save as template
      </Button>
    </div>
  )
}

/** Same picker for the Terms field (template_type = 'terms'). */
export function TermsTemplatePicker({ terms, onFill }: { terms: string; onFill: (content: string) => void }) {
  const { data } = useInvoiceNoteTemplates()
  const createTemplate = useCreateInvoiceNoteTemplate()
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const templates = (data?.items ?? []).filter((t) => (t.template_type ?? 'note') === 'terms')

  async function onSave() {
    if (!title.trim() || !terms.trim()) return
    await createTemplate.mutateAsync({ title: title.trim(), content: terms.trim(), template_type: 'terms', is_default: false })
    setSaving(false)
    setTitle('')
  }

  if (saving) {
    return (
      <div className="flex items-center gap-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Template name" autoFocus className="h-7 w-40 text-xs" />
        <Button type="button" size="sm" className="h-7" onClick={() => void onSave()} disabled={!title.trim() || createTemplate.isPending}>
          Save
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => setSaving(false)}>
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {templates.length > 0 && (
        <Select
          value=""
          onChange={(e) => {
            const t = templates.find((x) => x.id === e.target.value)
            if (t) onFill(t.content)
          }}
          className="h-7 w-40 text-xs"
        >
          <option value="">Templates…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </Select>
      )}
      <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSaving(true)} disabled={!terms.trim()}>
        + Save as template
      </Button>
    </div>
  )
}

/** Bank account picker — fills the per-invoice bank_details snapshot. */
export function BankAccountPicker({ onFill }: { onFill: (snapshot: string) => void }) {
  const { data } = useInvoiceBankAccounts()
  const items = data?.items ?? []
  if (items.length === 0) return null
  return (
    <Select
      value=""
      onChange={(e) => {
        const b = items.find((x) => x.id === e.target.value)
        if (b) onFill(formatBankSnapshot(b))
      }}
      className="h-7 w-44 text-xs"
    >
      <option value="">Bank / UPI…</option>
      {items.map((b) => (
        <option key={b.id} value={b.id}>
          {b.label}
          {b.is_default ? ' ★' : ''}
        </option>
      ))}
    </Select>
  )
}
