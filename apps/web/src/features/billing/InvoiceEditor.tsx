import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  BookmarkPlus,
  FileUp,
  IndianRupee,
  PackagePlus,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import type { GstSlab } from '@ipc/domain'
import {
  GSTIN_REGEX,
  companyProfile,
  friendlyInvoiceError,
  placeOfSupplyLabel,
  stateCodeFromGstin,
  type CreateInvoiceRequest,
  type InvoiceItemPreset,
} from '@ipc/contracts'
import { toast } from 'sonner'
import { callApi, uploadFile } from '@/shared/api/client'
import { Button } from '@/shared/ui/button'
import { Input, Label, Select } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { useConfirm } from '@/shared/ui/confirm'
import { useAccess } from '@/shared/auth/useAccess'
import { useClients } from '@/features/clients/api'
import { useProject, useProjects } from '@/features/projects/api'
import { PaymentModePicker } from '@/features/settings/PaymentModePicker'
import {
  BankAccountPicker,
  ClientCombobox,
  GST_SLABS,
  NoteTemplatePicker,
  TermsTemplatePicker,
  addDaysISO,
  useInvoiceForm,
  type InvoiceFormValues,
} from './InvoiceForm'
import { matchStudioState, deriveIntraState, toAmount, type InvoiceLineDraft } from './invoice-math'
import { useInvoiceItems, useInvoiceTemplates, useSaveInvoiceItem, useStates } from './api'
import { HsnSearchDialog } from './HsnSearchDialog'
import { DESIGN_INFO } from './InvoicePaper'
import { DraftRestoredBanner, agoText, useFormDraft } from '@/shared/hooks/use-form-draft'

/** Payment terms as a studio says them, and how many days each allows. */
export const PAYMENT_TERMS: { label: string; days: number | null }[] = [
  { label: 'Due on receipt', days: 0 },
  { label: 'Net 7', days: 7 },
  { label: 'Net 15', days: 15 },
  { label: 'Net 30', days: 30 },
  { label: 'Net 45', days: 45 },
  { label: 'Net 60', days: 60 },
  { label: 'Due end of the month', days: null },
  { label: 'Custom', days: null },
]

function endOfMonth(iso: string): string {
  const d = new Date(`${iso || new Date().toISOString().slice(0, 10)}T00:00:00Z`)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
}

function dueFor(terms: string, invoiceDate: string): string | null {
  const t = PAYMENT_TERMS.find((x) => x.label === terms)
  if (!t) return null
  if (t.label === 'Due end of the month') return endOfMonth(invoiceDate)
  if (t.days == null) return null
  return addDaysISO(invoiceDate, t.days)
}

const MAX_FILES = 3
const MAX_BYTES = 10 * 1024 * 1024

/**
 * The whole invoice on one page, laid out the way a billing tool is: who it
 * is for, dates and terms, a proper item table (saved items, HSN/SAC, tax per
 * line), totals, notes and terms, the files that go with it, and -- when the
 * money is already in -- the payment, recorded in the same save.
 *
 * Choosing a client who has a GSTIN turns it into a tax invoice by itself:
 * GSTIN filled, place of supply from the GSTIN's state, HSN/SAC and tax
 * columns shown.
 */
export function InvoiceEditor({
  initial,
  isEdit = false,
  editNumber,
  editStatus,
  draftKey,
  busy,
  onSubmit,
  onCancel,
}: {
  initial: InvoiceFormValues
  isEdit?: boolean | undefined
  /** Status of the invoice being edited: a sent one is saved as sent, a draft can be saved or sent. */
  editStatus?: string | undefined
  /** Where the unsaved form is kept on this device, so a refresh or stray click loses nothing. */
  draftKey: string
  /** The number of the invoice being edited, for the heading. */
  editNumber?: string | undefined
  busy: boolean
  onSubmit: (req: CreateInvoiceRequest) => Promise<void>
  onCancel: () => void
}) {
  const form = useInvoiceForm(initial)
  const { values, set, patchLine, setGstEnabled, totals } = form
  const initialJson = useMemo(() => JSON.stringify(initial), [])
  const draft = useFormDraft(draftKey, values, form.replace, { isBlank: (v) => JSON.stringify(v) === initialJson })
  const sentAlready = isEdit && !!editStatus && editStatus !== 'draft'
  const access = useAccess()
  const confirm = useConfirm()
  const { data: states } = useStates()
  const { data: clientsData } = useClients()
  const clients = Array.isArray(clientsData) ? clientsData : (clientsData?.items ?? [])
  const { data: projects } = useProjects()
  const { data: templateData } = useInvoiceTemplates()
  const { data: savedItems } = useInvoiceItems()
  const saveItem = useSaveInvoiceItem()
  const { data: company } = useQuery({
    queryKey: ['settings', 'company'],
    queryFn: () => callApi('/settings/company', { responseSchema: companyProfile }),
    staleTime: 60_000,
  })
  const linkedProject = useProject(values.project_id)
  const [error, setError] = useState<string | null>(null)
  const [hsnFor, setHsnFor] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [importNote, setImportNote] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const gst = !values.no_gst
  const studioState = matchStudioState(states, company?.state)
  const selectedClient = clients.find((c) => c.id === values.client_id)
  const clientProjects = (projects ?? []).filter((p) => !values.client_id || p.client_id === values.client_id)
  const templates = templateData?.items ?? []
  const defaultSac = company?.invoice_sac_code?.trim() || ''

  // Place of supply starts at the studio's own state.
  useEffect(() => {
    if (!values.place_of_supply && studioState) set('place_of_supply', studioState.code)
  }, [studioState?.code, values.place_of_supply])

  // CGST+SGST or IGST follows from the two states.
  useEffect(() => {
    const intra = deriveIntraState(values.place_of_supply, studioState?.code)
    if (intra !== null && intra !== values.intra_state) set('intra_state', intra)
  }, [values.place_of_supply, studioState?.code, values.intra_state])

  // Due date follows the terms, unless the terms are "Custom".
  useEffect(() => {
    const due = dueFor(values.payment_terms, values.invoice_date)
    if (due && due !== values.due_date) set('due_date', due)
  }, [values.payment_terms, values.invoice_date])

  function pickClient(id: string) {
    set('client_id', id)
    set('project_id', '')
    const c = clients.find((x) => x.id === id)
    const gstin = (c?.gstin ?? '').trim().toUpperCase()
    // A client with a GSTIN is a business that needs a tax invoice.
    if (gstin && GSTIN_REGEX.test(gstin)) {
      if (values.no_gst) turnGst(true)
      set('gst_number', gstin)
      const code = stateCodeFromGstin(gstin)
      if (code) set('place_of_supply', code)
    }
  }

  function turnGst(on: boolean) {
    setGstEnabled(on)
    // A service line on a tax invoice needs its SAC; start it at the studio's usual one.
    if (on && defaultSac) {
      set(
        'lines',
        values.lines.map((l) => ({ ...l, gst_rate: l.gst_rate || 18, hsn_sac: l.hsn_sac || defaultSac })),
      )
    }
  }

  const blankLine = (): InvoiceLineDraft => ({ description: '', quantity: '1', rate: '', gst_rate: gst ? 18 : 0, ...(gst && defaultSac ? { hsn_sac: defaultSac } : {}) })

  function applyPreset(i: number, p: InvoiceItemPreset) {
    patchLine(i, {
      description: p.name,
      subtext: p.description ?? undefined,
      rate: p.rate ? String(p.rate) : values.lines[i]?.rate ?? '',
      gst_rate: gst ? p.gst_rate || 18 : 0,
      hsn_sac: p.hsn_sac ?? (gst ? defaultSac || undefined : undefined),
      preset_id: p.id,
    })
  }

  function addPreset(p: InvoiceItemPreset) {
    const blank = values.lines.findIndex((l) => !l.description.trim() && !toAmount(l.rate))
    if (blank !== -1) return applyPreset(blank, p)
    set('lines', [
      ...values.lines,
      {
        description: p.name,
        subtext: p.description ?? undefined,
        quantity: '1',
        rate: String(p.rate || ''),
        gst_rate: gst ? p.gst_rate || 18 : 0,
        hsn_sac: p.hsn_sac ?? (gst ? defaultSac || undefined : undefined),
        preset_id: p.id,
      },
    ])
  }

  async function saveLineAsItem(l: InvoiceLineDraft) {
    if (!l.description.trim()) return
    await saveItem.mutateAsync({
      body: {
        name: l.description.trim(),
        description: l.subtext?.trim() || null,
        rate: toAmount(l.rate),
        hsn_sac: l.hsn_sac?.trim() || null,
        gst_rate: (l.gst_rate || 0) as GstSlab,
        kind: l.hsn_sac && !l.hsn_sac.startsWith('99') ? 'goods' : 'service',
      },
    })
  }

  async function importFromProject(kind: 'package' | 'deliverables' | 'balance') {
    const p = linkedProject.data
    if (!p) return
    if (values.lines.some((l) => l.description.trim())) {
      const yes = await confirm({ title: 'Add to the existing lines?', description: 'This adds new lines alongside what is already here.', confirmLabel: 'Add' })
      if (!yes) return
    }
    const base = blankLine()
    const keep = values.lines.filter((l) => l.description.trim() || toAmount(l.rate))
    if (kind === 'package') {
      if (p.package_cost <= 0) return setImportNote('This project has no package cost set yet.')
      set('lines', [...keep, { ...base, description: `${p.name} — Package`, rate: String(p.package_cost) }])
    } else if (kind === 'deliverables') {
      const extra = p.deliverables.filter(
        (d) => d.visibility_scope === 'client' && d.show_on_quotation && d.status !== 'cancelled' && d.is_additional_charge && d.additional_charge_amount > 0,
      )
      if (extra.length === 0) return setImportNote('This project has no billable deliverables.')
      set('lines', [...keep, ...extra.map((d) => ({ ...base, description: d.title, rate: String(d.additional_charge_amount) }))])
    } else {
      const received = p.payments.filter((pay) => pay.status !== 'pending').reduce((s, pay) => s + pay.amount, 0)
      const balance = Math.max(0, p.total_cost - received)
      if (balance <= 0) return setImportNote('Nothing is outstanding on this project.')
      set('lines', [...keep, { ...base, description: `${p.name} — Balance due`, rate: String(balance) }])
    }
    setImportNote(null)
  }

  async function onFiles(list: FileList | null) {
    if (!list?.length) return
    const room = MAX_FILES - values.attachments.length
    const files = [...list].slice(0, room)
    if (list.length > room) toast.error(`Up to ${MAX_FILES} files per invoice.`)
    setUploading(true)
    const added: { id: string; name: string }[] = []
    for (const f of files) {
      if (f.size > MAX_BYTES) {
        toast.error(`${f.name} is larger than 10 MB.`)
        continue
      }
      try {
        const stored = await uploadFile(f)
        added.push({ id: stored.id, name: stored.name })
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Could not upload ${f.name}.`)
      }
    }
    set('attachments', [...values.attachments, ...added])
    setUploading(false)
    if (fileInput.current) fileInput.current.value = ''
  }

  const gstNumber = values.gst_number.trim().toUpperCase()
  const gstNumberError = gst && gstNumber && !GSTIN_REGEX.test(gstNumber) ? 'GSTIN is 15 characters, like 27ABCDE1234F1Z5.' : null
  const taxBy = useMemo(() => {
    const out = new Map<number, number>()
    for (const l of totals.lines) if (l.gst_rate > 0) out.set(l.gst_rate, (out.get(l.gst_rate) ?? 0) + l.cgst + l.sgst + l.igst)
    return [...out.entries()].sort((a, b) => a[0] - b[0])
  }, [totals.lines])

  async function submit(status: 'draft' | 'sent', e?: FormEvent) {
    e?.preventDefault()
    setError(null)
    set('status', status)
    const problems = form.problems()
    if (gstNumberError) problems.unshift(gstNumberError)
    if (gst && !values.place_of_supply) problems.unshift('Choose the place of supply for this tax invoice.')
    if (status === 'draft' && values.payment.on) problems.unshift('A draft cannot take a payment. Use “Save and send” to record it.')
    if (problems.length) {
      setError(problems[0] ?? 'This invoice is not ready yet.')
      return
    }
    try {
      await onSubmit({ ...form.toRequest(), status })
      draft.clear()
    } catch (err) {
      setError(friendlyInvoiceError(err))
    }
  }

  const colTemplate = gst
    ? 'md:grid-cols-[minmax(0,1fr)_9.5rem_5rem_7.5rem_6.5rem_7rem_2.5rem]'
    : 'md:grid-cols-[minmax(0,1fr)_5.5rem_8rem_7.5rem_2.5rem]'

  return (
    <form onSubmit={(e) => void submit('sent', e)} className="flex min-h-full flex-col bg-background">
      {/* Title bar */}
      <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3 sm:px-8">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileUp className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">{isEdit ? `Edit ${editNumber ?? 'invoice'}` : 'New invoice'}</h1>
            <p className="text-xs text-muted-foreground">
              {gst ? 'Tax invoice · GST worked out line by line' : 'Plain invoice · no GST'}
              {draft.savedAt ? ` · Kept on this device ${agoText(draft.savedAt)}` : ''}
            </p>
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onCancel} aria-label="Close">
          <X />
        </Button>
      </div>

      <div className="mx-auto w-full max-w-6xl flex-1 px-4 pb-32 pt-6 sm:px-8">
        {draft.restoredAt && (
          <div className="mb-4">
            <DraftRestoredBanner
              at={draft.restoredAt}
              onDismiss={draft.dismissRestored}
              onDiscard={() => {
                form.replace(initial)
                draft.clear()
              }}
            />
          </div>
        )}
        {/* Customer */}
        <section className="rounded-xl border border-border bg-muted/30 p-4 sm:p-5">
          <div className="grid gap-4 md:grid-cols-[10rem_minmax(0,28rem)_1fr] md:items-start">
            <Label className="pt-2 text-sm font-medium text-destructive">Customer name *</Label>
            <div className="flex flex-col gap-2">
              <ClientCombobox clients={clients} value={values.client_id} onChange={pickClient} />
              {selectedClient && (
                <div className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
                  <p className="text-sm font-medium text-foreground">{selectedClient.name}</p>
                  {selectedClient.address && <p className="mt-0.5 whitespace-pre-line">{selectedClient.address}</p>}
                  {(selectedClient.phone || selectedClient.email) && <p>{[selectedClient.phone, selectedClient.email].filter(Boolean).join(' · ')}</p>}
                  <p className="mt-1">{selectedClient.gstin ? `GSTIN ${selectedClient.gstin}` : 'No GSTIN on file: a plain invoice unless you turn GST on.'}</p>
                </div>
              )}
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 md:max-w-sm md:justify-self-end">
              <input type="checkbox" className="mt-0.5 size-4" checked={gst} onChange={(e) => turnGst(e.target.checked)} />
              <span>
                <span className="block text-sm font-medium">Tax invoice (GST)</span>
                <span className="block text-xs text-muted-foreground">Adds GSTIN, place of supply, HSN/SAC and tax to every line.</span>
              </span>
            </label>
          </div>
          {gst && (
            <div className="mt-4 grid gap-4 border-t border-border pt-4 md:grid-cols-[10rem_minmax(0,28rem)] md:items-start">
              <Label className="pt-2">Client GSTIN</Label>
              <div>
                <Input
                  value={values.gst_number}
                  onChange={(e) => {
                    const v = e.target.value.toUpperCase()
                    set('gst_number', v)
                    const code = stateCodeFromGstin(v)
                    if (code && GSTIN_REGEX.test(v)) set('place_of_supply', code)
                  }}
                  placeholder="27ABCDE1234F1Z5 (leave blank for an unregistered client)"
                  aria-invalid={!!gstNumberError}
                />
                {gstNumberError && <p className="mt-1 text-xs text-destructive">{gstNumberError}</p>}
              </div>
              <Label className="pt-2 text-destructive">Place of supply *</Label>
              <div>
                <Select value={values.place_of_supply} onChange={(e) => set('place_of_supply', e.target.value)} aria-label="Place of supply">
                  <option value="">Choose a state…</option>
                  {(states ?? []).map((st) => (
                    <option key={st.code} value={st.code}>
                      [{st.code}] {st.name}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  {values.intra_state ? 'Same state as the studio: CGST + SGST.' : 'Another state: IGST.'}
                  {studioState ? ` Studio is in ${placeOfSupplyLabel(studioState.code)}.` : ''}
                </p>
              </div>
            </div>
          )}
        </section>

        {/* Invoice facts */}
        <section className="mt-6 grid gap-x-8 gap-y-4 md:grid-cols-2">
          <Field label="Invoice #">
            <Input
              value={isEdit ? (editNumber ?? '') : values.invoice_number}
              onChange={(e) => set('invoice_number', e.target.value)}
              placeholder="Next number, automatically"
              disabled={isEdit}
            />
          </Field>
          <Field label="Project">
            <Select value={values.project_id} onChange={(e) => set('project_id', e.target.value)} disabled={!values.client_id} aria-label="Project">
              <option value="">{values.client_id ? 'Not linked to a project' : 'Choose the customer first'}</option>
              {clientProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Invoice date" required>
            <Input type="date" value={values.invoice_date} onChange={(e) => set('invoice_date', e.target.value)} aria-label="Invoice date" />
          </Field>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-[10rem_1fr_1fr] md:items-center">
            <Label className="col-span-2 md:col-span-1">Terms · Due date</Label>
            <Select value={values.payment_terms} onChange={(e) => set('payment_terms', e.target.value)} aria-label="Payment terms">
              {PAYMENT_TERMS.map((t) => (
                <option key={t.label} value={t.label}>
                  {t.label}
                </option>
              ))}
            </Select>
            <Input
              type="date"
              value={values.due_date}
              min={values.invoice_date || undefined}
              onChange={(e) => {
                set('due_date', e.target.value)
                set('payment_terms', 'Custom')
              }}
              aria-label="Due date"
            />
          </div>
          <div className="md:col-span-2">
            <Field label="Subject" wide>
              <textarea
                value={values.subject}
                onChange={(e) => set('subject', e.target.value)}
                rows={1}
                maxLength={250}
                placeholder="Let your customer know what this invoice is for, e.g. Wedding coverage, 12–14 Dec"
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
              />
            </Field>
          </div>
        </section>

        {/* Items */}
        <section className="mt-8 overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="font-semibold">Item table</h2>
            {values.project_id && linkedProject.data && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">From the project:</span>
                <Button type="button" size="sm" variant="outline" onClick={() => void importFromProject('package')}>
                  Package
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => void importFromProject('deliverables')}>
                  Deliverables
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => void importFromProject('balance')}>
                  Balance due
                </Button>
                {importNote && <span className="text-muted-foreground">{importNote}</span>}
              </div>
            )}
          </div>
          <div className={cn('hidden gap-3 border-b border-border bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:grid', colTemplate)}>
            <span>Item details</span>
            {gst && <span>HSN / SAC</span>}
            <span className="text-right">Quantity</span>
            <span className="text-right">Rate</span>
            {gst && <span>Tax</span>}
            <span className="text-right">Amount</span>
            <span />
          </div>
          <ul>
            {values.lines.map((l, i) => {
              const amount = toAmount(l.quantity) * toAmount(l.rate)
              const saved = (savedItems ?? []).some((p) => p.name.toLowerCase() === l.description.trim().toLowerCase())
              return (
                <li key={i} className={cn('grid gap-3 border-b border-border px-4 py-3 last:border-0', colTemplate)}>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <ItemCombo value={l.description} items={savedItems ?? []} onType={(v) => patchLine(i, { description: v, preset_id: undefined })} onPick={(p) => applyPreset(i, p)} />
                    <textarea
                      value={l.subtext ?? ''}
                      onChange={(e) => patchLine(i, { subtext: e.target.value || undefined })}
                      rows={1}
                      placeholder="Add a description to your item"
                      className="w-full resize-y rounded-md border border-dashed border-input bg-transparent px-3 py-1.5 text-xs shadow-sm"
                    />
                    {l.description.trim() && !saved && (
                      <button
                        type="button"
                        onClick={() => void saveLineAsItem(l)}
                        className="inline-flex items-center gap-1 self-start text-xs font-medium text-primary hover:underline"
                      >
                        <BookmarkPlus className="size-3.5" /> Save as a reusable item
                      </button>
                    )}
                  </div>
                  {gst && (
                    <div className="flex items-start gap-1">
                      <Input
                        value={l.hsn_sac ?? ''}
                        inputMode="numeric"
                        onChange={(e) => patchLine(i, { hsn_sac: e.target.value.replace(/\D/g, '').slice(0, 8) || undefined })}
                        placeholder="HSN/SAC"
                        aria-label={`HSN or SAC for line ${i + 1}`}
                      />
                      <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={() => setHsnFor(i)} title="Search HSN / SAC codes" aria-label="Search HSN or SAC codes">
                        <Search className="size-4" />
                      </Button>
                    </div>
                  )}
                  <Input inputMode="decimal" value={l.quantity} onChange={(e) => patchLine(i, { quantity: e.target.value })} className="text-right" aria-label={`Quantity for line ${i + 1}`} />
                  <Input inputMode="decimal" value={l.rate} onChange={(e) => patchLine(i, { rate: e.target.value })} className="text-right" placeholder="0.00" aria-label={`Rate for line ${i + 1}`} />
                  {gst && (
                    <Select value={l.gst_rate} onChange={(e) => patchLine(i, { gst_rate: Number(e.target.value) as GstSlab })} aria-label={`Tax for line ${i + 1}`}>
                      {GST_SLABS.map((g) => (
                        <option key={g} value={g}>
                          {g === 0 ? 'Nil' : `${g}%`}
                        </option>
                      ))}
                    </Select>
                  )}
                  <p className="self-center text-right font-semibold tabular-nums">{formatINR(amount)}</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => set('lines', values.lines.length > 1 ? values.lines.filter((_, idx) => idx !== i) : [blankLine()])}
                    aria-label={`Remove line ${i + 1}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              )
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/20 px-4 py-3">
            <Button type="button" variant="outline" size="sm" onClick={() => set('lines', [...values.lines, blankLine()])}>
              <Plus /> Add new row
            </Button>
            <SavedItemsMenu items={savedItems ?? []} onPick={addPreset} />
          </div>
        </section>

        {/* Notes + totals */}
        <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="flex flex-col gap-5">
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <Label>Customer notes</Label>
                <NoteTemplatePicker notes={values.notes} onFill={(c) => set('notes', c)} />
              </div>
              <textarea
                value={values.notes}
                onChange={(e) => set('notes', e.target.value)}
                rows={3}
                placeholder="Thanks for your business. Shown on the invoice."
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <Label>Terms &amp; conditions</Label>
                <TermsTemplatePicker terms={values.terms} onFill={(c) => set('terms', c)} />
              </div>
              <textarea
                value={values.terms}
                onChange={(e) => set('terms', e.target.value)}
                rows={3}
                placeholder="Payment terms, cancellation, delivery timelines…"
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <Label>Bank details</Label>
                <BankAccountPicker onFill={(s) => set('bank_details', s)} />
              </div>
              <textarea
                value={values.bank_details}
                onChange={(e) => set('bank_details', e.target.value)}
                rows={3}
                placeholder="Account name, number, IFSC, UPI"
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
              />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm">
              <TotalRow label="Sub total" value={formatINR(totals.subtotal)} strong />
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Discount</span>
                <div className="flex items-center gap-1.5">
                  <Input
                    inputMode="decimal"
                    value={values.discount_type === 'none' ? '' : values.discount}
                    onChange={(e) => {
                      set('discount', e.target.value)
                      if (values.discount_type === 'none') set('discount_type', 'percent')
                    }}
                    className="h-8 w-20 text-right"
                    placeholder="0"
                    aria-label="Discount"
                  />
                  <Select
                    value={values.discount_type === 'none' ? 'percent' : values.discount_type}
                    onChange={(e) => set('discount_type', e.target.value as 'flat' | 'percent')}
                    className="h-8 w-16"
                    aria-label="Discount type"
                  >
                    <option value="percent">%</option>
                    <option value="flat">₹</option>
                  </Select>
                  <span className="w-24 text-right tabular-nums text-muted-foreground">− {formatINR(totals.discount)}</span>
                </div>
              </div>
              {gst &&
                taxBy.map(([rate, tax]) =>
                  values.intra_state ? (
                    <div key={rate} className="mt-2 space-y-1">
                      <TotalRow label={`CGST ${rate / 2}%`} value={formatINR(tax / 2)} />
                      <TotalRow label={`SGST ${rate / 2}%`} value={formatINR(tax / 2)} />
                    </div>
                  ) : (
                    <div key={rate} className="mt-2">
                      <TotalRow label={`IGST ${rate}%`} value={formatINR(tax)} />
                    </div>
                  ),
                )}
              <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-base font-bold">
                <span>Total (₹)</span>
                <span className="tabular-nums">{formatINR(totals.total)}</span>
              </div>
            </div>

            {/* Files */}
            <div className="rounded-xl border border-border p-4">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Paperclip className="size-4" /> Attach files to invoice
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">A quotation or shot list the client should see with it. Up to 3 files, 10 MB each: PDF or images.</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {values.attachments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1 text-sm">
                    <span className="truncate">{a.name}</span>
                    <button type="button" onClick={() => set('attachments', values.attachments.filter((x) => x.id !== a.id))} className="text-muted-foreground hover:text-destructive" aria-label={`Remove ${a.name}`}>
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
              {values.attachments.length < MAX_FILES && (
                <>
                  <input ref={fileInput} type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={(e) => void onFiles(e.target.files)} aria-label="Attach files" />
                  <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => fileInput.current?.click()} disabled={uploading}>
                    <FileUp /> {uploading ? 'Uploading…' : 'Upload file'}
                  </Button>
                </>
              )}
            </div>

            {/* Design */}
            <div className="rounded-xl border border-border p-4">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Sparkles className="size-4" /> Invoice design
              </p>
              <Select value={values.template_id} onChange={(e) => set('template_id', e.target.value)} className="mt-2" aria-label="Invoice design">
                <option value="">{templates.some((t) => t.is_default) ? 'Studio default' : 'Classic (default)'}</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {DESIGN_INFO[t.layout_json.design].label}
                    {t.is_default ? ' (default)' : ''}
                  </option>
                ))}
              </Select>
              <Link to="/settings/invoicing" search={{ tab: 'layouts' }} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                <Pencil className="size-3" /> Designs, colours and logo
              </Link>
            </div>
          </div>
        </section>

        {/* Payment now */}
        {access.hasAction('billing', 'edit') && (
          <section className={cn('mt-6 rounded-xl border p-4 sm:p-5', values.payment.on ? 'border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30' : 'border-border')}>
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                className="size-4"
                checked={values.payment.on}
                onChange={(e) =>
                  set('payment', { ...values.payment, on: e.target.checked, amount: e.target.checked && !values.payment.amount ? String(totals.total || '') : values.payment.amount })
                }
              />
              <span>
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <IndianRupee className="size-4 text-emerald-600" /> {isEdit ? 'Record an advance or token amount received' : 'I have received payment (full, advance or token amount)'}
                </span>
                <span className="block text-xs text-muted-foreground">
                  Recorded with the invoice, with its receipt number. No second step later.{isEdit ? ' Once money is recorded, the lines are locked.' : ''}
                </span>
              </span>
            </label>
            {values.payment.on && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pay-amount">Amount received ₹</Label>
                  <Input id="pay-amount" inputMode="decimal" value={values.payment.amount} onChange={(e) => set('payment', { ...values.payment, amount: e.target.value })} />
                  <div className="flex gap-2 text-xs">
                    <button type="button" className="text-primary hover:underline" onClick={() => set('payment', { ...values.payment, amount: String(totals.total) })}>
                      Full {formatINR(totals.total)}
                    </button>
                    <button type="button" className="text-primary hover:underline" onClick={() => set('payment', { ...values.payment, amount: String(Math.round(totals.total / 2)) })}>
                      Half
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pay-date">Payment date</Label>
                  <Input id="pay-date" type="date" value={values.payment.paid_on} onChange={(e) => set('payment', { ...values.payment, paid_on: e.target.value })} />
                </div>
                <PaymentModePicker value={values.payment.mode} onChange={(v) => set('payment', { ...values.payment, mode: v })} label="Payment mode" id="pay-mode" />
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pay-ref">Reference (UTR, cheque no.)</Label>
                  <Input id="pay-ref" value={values.payment.reference} onChange={(e) => set('payment', { ...values.payment, reference: e.target.value })} />
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Action bar */}
      <div className="sticky bottom-0 z-20 border-t border-border bg-card px-4 py-3 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {!sentAlready && (
              <Button type="button" variant="outline" onClick={() => void submit('draft')} disabled={busy}>
                Save as draft
              </Button>
            )}
            <Button type="submit" disabled={busy}>
              {busy
                ? 'Saving…'
                : values.payment.on
                  ? 'Save and record payment'
                  : sentAlready
                    ? 'Save changes'
                    : 'Save and send'}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
          <div className="text-right">
            {error ? (
              <p role="alert" className="max-w-md text-sm text-destructive">
                {error}
              </p>
            ) : (
              <>
                <p className="text-sm font-semibold">Total amount: {formatINR(totals.total)}</p>
                <p className="text-xs text-muted-foreground">
                  {values.lines.filter((l) => l.description.trim()).length} item(s)
                  {values.payment.on && toAmount(values.payment.amount) > 0 ? ` · ${formatINR(toAmount(values.payment.amount))} received now` : ''}
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      <HsnSearchDialog
        open={hsnFor !== null}
        onOpenChange={(v) => !v && setHsnFor(null)}
        initialQuery={hsnFor !== null ? (values.lines[hsnFor]?.hsn_sac ?? '') : ''}
        onPick={(pick) => {
          if (hsnFor === null) return
          const rate = pick.gstRate
          patchLine(hsnFor, {
            hsn_sac: pick.code,
            ...(rate != null && (GST_SLABS as number[]).includes(rate) && rate > 0 ? { gst_rate: rate } : {}),
          })
        }}
      />
    </form>
  )
}

function Field({ label, required, wide, children }: { label: string; required?: boolean; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('grid gap-1.5 md:items-center', wide ? 'md:grid-cols-[10rem_1fr]' : 'md:grid-cols-[10rem_1fr]')}>
      <Label className={cn(required && 'text-destructive')}>
        {label}
        {required ? ' *' : ''}
      </Label>
      {children}
    </div>
  )
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={strong ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
      <span className={cn('tabular-nums', strong && 'font-semibold')}>{value}</span>
    </div>
  )
}

/**
 * The item name box: type freely, or pick one of the studio's saved items,
 * which fills the description, rate, HSN/SAC and tax in one go.
 */
function ItemCombo({
  value,
  items,
  onType,
  onPick,
}: {
  value: string
  items: InvoiceItemPreset[]
  onType: (v: string) => void
  onPick: (p: InvoiceItemPreset) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])
  const q = value.trim().toLowerCase()
  const matches = items.filter((p) => !q || p.name.toLowerCase().includes(q)).slice(0, 8)
  return (
    <div ref={root} className="relative">
      <Input
        value={value}
        onChange={(e) => {
          onType(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
        placeholder={items.length ? 'Type or click to select an item' : 'Item name, e.g. Candid photography'}
        className="font-medium"
        aria-label="Item"
      />
      {open && matches.length > 0 && (
        <div className="ipc-menu absolute left-0 top-full z-30 mt-1 w-full min-w-72 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          <p className="border-b border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Saved items</p>
          <ul className="max-h-64 overflow-y-auto p-1">
            {matches.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(p)
                    setOpen(false)
                  }}
                  className="flex w-full items-start justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[p.hsn_sac ? `${p.hsn_sac.startsWith('99') ? 'SAC' : 'HSN'} ${p.hsn_sac}` : null, p.gst_rate ? `GST ${p.gst_rate}%` : null, p.description]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{p.rate ? formatINR(p.rate) : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** "Add from saved items": the catalogue as a list, one tap adds a filled line. */
function SavedItemsMenu({ items, onPick }: { items: InvoiceItemPreset[]; onPick: (p: InvoiceItemPreset) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])
  return (
    <div ref={root} className="relative">
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <PackagePlus /> Add saved item
      </Button>
      {open && (
        <div className="ipc-menu absolute bottom-full left-0 z-30 mb-1 w-80 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          {items.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              No saved items yet. Type a line, then “Save as a reusable item”, or add them in{' '}
              <Link to="/settings/invoicing" search={{ tab: 'items' }} className="text-primary underline">
                Settings → Invoicing
              </Link>
              .
            </p>
          ) : (
            <ul className="max-h-72 overflow-y-auto p-1">
              {items.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(p)
                      setOpen(false)
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    <span className="truncate font-medium">{p.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{p.rate ? formatINR(p.rate) : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
