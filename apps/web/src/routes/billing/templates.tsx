import { useEffect, useState } from 'react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { useUrlParam } from '@/shared/hooks/use-url-param'
import { SettingsTabs } from '@/features/settings/SettingsTabs'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { Button } from '@/shared/ui/button'
import { Input, Label } from '@/shared/ui/input'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState } from '@/shared/ui/states'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { callApi } from '@/shared/api/client'
import {
  invoiceTemplateList,
  createInvoiceTemplateRequest,
  companyProfile,
  formatBankSnapshot,
  z,
  type CreateInvoiceBankAccountRequest,
  type CreateInvoiceNoteTemplateRequest,
  type CreateInvoiceTemplateRequest,
  type InvoiceBankAccount,
  type InvoiceNoteTemplate,
  type InvoiceTemplate,
  type UpdateCompanyRequest,
} from '@ipc/contracts'
import {
  useInvoiceTemplates,
  useInvoiceBankAccounts,
  useCreateInvoiceBankAccount,
  useUpdateInvoiceBankAccount,
  useDefaultInvoiceBankAccount,
  useDeleteInvoiceBankAccount,
  useInvoiceNoteTemplates,
  useCreateInvoiceNoteTemplate,
  useUpdateInvoiceNoteTemplate,
  useDeleteInvoiceNoteTemplate,
  useDefaultInvoiceNoteTemplate,
  useSeedInvoiceNoteTemplates,
} from '@/features/billing/api'
import { useConfirm } from '@/shared/ui/confirm'
import { useAuth } from '@/shared/auth/AuthProvider'
import { toast } from 'sonner'
import { Plus, Trash2, Pencil, FileText, Star, Wallet, StickyNote, Sparkles } from 'lucide-react'

const emptyForm = (): CreateInvoiceTemplateRequest => ({
  name: '',
  layout_json: {
    show_header: true,
    show_footer: true,
    show_gst: true,
    show_bank_details: false,
    header_text: null,
    footer_text: null,
    bank_details: null,
    terms_and_conditions: null,
  },
  is_default: false,
})

export function InvoiceTemplatesPage() {
  return (
    <AuthedPage module="billing">
      <InvoiceSettings />
    </AuthedPage>
  )
}

/**
 * Everything printed on an invoice, in three places instead of one long
 * page: who the invoice is from and where to pay, how it is laid out, and
 * the terms and notes that go at the bottom.
 */
function InvoiceSettings() {
  const [tab, setTab] = useUrlParam('tab', 'details')
  return (
    <>
      <PageHeader title="Invoicing" description="What every invoice says about you, how it looks, and the words at the bottom." />
      <SettingsTabs />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="details">Your details & bank</TabsTrigger>
          <TabsTrigger value="layouts">Print layouts</TabsTrigger>
          <TabsTrigger value="text">Terms & notes</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="space-y-8">
          <CompanyInvoiceDefaults />
          <BankAccountsSection />
        </TabsContent>
        <TabsContent value="layouts">
          <TemplatesContent />
        </TabsContent>
        <TabsContent value="text" className="space-y-8">
          <TextLibrarySection type="terms" />
          <TextLibrarySection type="note" />
        </TabsContent>
      </Tabs>
    </>
  )
}

function TemplatesContent() {
  const qc = useQueryClient()
  const { data, isLoading, isError, refetch } = useInvoiceTemplates()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CreateInvoiceTemplateRequest>(emptyForm())

  const create = useMutation({
    mutationFn: (body: CreateInvoiceTemplateRequest) =>
      callApi('/billing/templates', { method: 'POST', body, responseSchema: invoiceTemplateList.shape.items.element }),
    onSuccess: () => {
      toast.success('Template created')
      void qc.invalidateQueries({ queryKey: ['billing', 'templates'] })
      setDialogOpen(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: CreateInvoiceTemplateRequest }) =>
      callApi(`/billing/templates/${id}`, { method: 'PATCH', body, responseSchema: z.object({ ok: z.boolean() }) }),
    onSuccess: () => {
      toast.success('Template updated')
      void qc.invalidateQueries({ queryKey: ['billing', 'templates'] })
      setDialogOpen(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const del = useMutation({
    mutationFn: (id: string) => callApi(`/billing/templates/${id}`, { method: 'DELETE', responseSchema: z.unknown() }),
    onSuccess: () => {
      toast.success('Template deleted')
      void qc.invalidateQueries({ queryKey: ['billing', 'templates'] })
    },
  })

  const items = data?.items ?? []

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm())
    setDialogOpen(true)
  }

  function openEdit(t: InvoiceTemplate) {
    setEditingId(t.id)
    setForm({ name: t.name, layout_json: t.layout_json, is_default: t.is_default })
    setDialogOpen(true)
  }

  function handleSubmit() {
    const parsed = createInvoiceTemplateRequest.safeParse(form)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Please check the form.')
      return
    }
    if (editingId) update.mutate({ id: editingId, body: parsed.data })
    else create.mutate(parsed.data)
  }

  const busy = create.isPending || update.isPending

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Saved print layouts. Pick one per invoice, or set a default.</p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" /> New layout
        </Button>
      </div>
      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">Loading…</div>
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((t) => (
            <Card key={t.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  {t.name}
                </CardTitle>
                <div className="flex items-center gap-1">
                  {t.is_default && (
                    <StatusBadge tone="success" className="gap-1">
                      <Star className="h-3 w-3" />
                      Default
                    </StatusBadge>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(t)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => {
                      if (confirm(`Delete "${t.name}"? Invoices already printed with it are unaffected.`)) del.mutate(t.id)
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Header: {t.layout_json.show_header ? 'Yes' : 'No'} · GST: {t.layout_json.show_gst ? 'Yes' : 'No'} · Bank details:{' '}
                  {t.layout_json.show_bank_details ? 'Yes' : 'No'}
                </p>
              </CardContent>
            </Card>
          ))}
          {items.length === 0 && <div className="col-span-full py-12 text-center text-muted-foreground">No templates yet.</div>}
        </div>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent title={editingId ? 'Edit Template' : 'New Template'} className="max-h-[85vh] max-w-lg overflow-y-auto">
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Standard GST Invoice" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
              Set as company default
            </label>

            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <p className="text-sm font-medium">What shows on the printed invoice</p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.layout_json.show_header}
                  onChange={(e) => setForm({ ...form, layout_json: { ...form.layout_json, show_header: e.target.checked } })}
                />
                Studio name, address and GSTIN in the header
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.layout_json.show_gst}
                  onChange={(e) => setForm({ ...form, layout_json: { ...form.layout_json, show_gst: e.target.checked } })}
                />
                GST breakdown (rate, CGST/SGST/IGST columns)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.layout_json.show_footer}
                  onChange={(e) => setForm({ ...form, layout_json: { ...form.layout_json, show_footer: e.target.checked } })}
                />
                Footer block (bank details, terms, footer note)
              </label>
            </div>

            <div>
              <label className="text-sm font-medium">Header note (optional)</label>
              <Input
                value={form.layout_json.header_text ?? ''}
                onChange={(e) => setForm({ ...form, layout_json: { ...form.layout_json, header_text: e.target.value || null } })}
                placeholder="Shown under the studio name"
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.layout_json.show_bank_details}
                onChange={(e) => setForm({ ...form, layout_json: { ...form.layout_json, show_bank_details: e.target.checked } })}
              />
              Show bank details
            </label>
            {form.layout_json.show_bank_details && (
              <div>
                <label className="text-sm font-medium">Bank details</label>
                <textarea
                  value={form.layout_json.bank_details ?? ''}
                  onChange={(e) => setForm({ ...form, layout_json: { ...form.layout_json, bank_details: e.target.value || null } })}
                  rows={2}
                  placeholder={'Account name, number, IFSC…'}
                  className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm"
                />
              </div>
            )}

            <div>
              <label className="text-sm font-medium">Terms &amp; conditions (optional)</label>
              <textarea
                value={form.layout_json.terms_and_conditions ?? ''}
                onChange={(e) => setForm({ ...form, layout_json: { ...form.layout_json, terms_and_conditions: e.target.value || null } })}
                rows={2}
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Footer note (optional)</label>
              <Input
                value={form.layout_json.footer_text ?? ''}
                onChange={(e) => setForm({ ...form, layout_json: { ...form.layout_json, footer_text: e.target.value || null } })}
                placeholder="Shown centered at the very bottom"
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!form.name.trim() || busy}>
              {busy ? 'Saving…' : editingId ? 'Save changes' : 'Create'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Company invoice defaults ───────────────────────────────
function CompanyInvoiceDefaults() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const isOwner = !!session?.is_owner
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'company'],
    queryFn: () => callApi('/settings/company', { responseSchema: companyProfile }),
  })
  const { data: templates } = useInvoiceTemplates()
  const defaultLayout = templates?.items.find((t) => t.is_default)

  const [form, setForm] = useState({
    avatar_url: '',
    invoice_address: '',
    invoice_phone: '',
    invoice_email: '',
    invoice_gst_number: '',
    invoice_upi_id: '',
    invoice_sac_code: '',
    invoice_bank_details: '',
    invoice_number_prefix: '',
    invoice_next_number: '',
    invoice_default_notes: '',
    invoice_default_terms: '',
  })

  useEffect(() => {
    if (!data) return
    setForm({
      avatar_url: data.avatar_url ?? '',
      invoice_address: data.invoice_address ?? '',
      invoice_phone: data.invoice_phone ?? '',
      invoice_email: data.invoice_email ?? '',
      invoice_gst_number: data.invoice_gst_number ?? '',
      invoice_upi_id: data.invoice_upi_id ?? '',
      invoice_sac_code: data.invoice_sac_code ?? '998387',
      invoice_bank_details: data.invoice_bank_details ?? '',
      invoice_number_prefix: data.invoice_number_prefix ?? '',
      invoice_next_number: String(data.invoice_next_number ?? 1),
      invoice_default_notes: data.invoice_default_notes ?? '',
      invoice_default_terms: data.invoice_default_terms ?? '',
    })
  }, [data])

  const save = useMutation({
    mutationFn: (body: UpdateCompanyRequest) =>
      callApi('/settings/company', { method: 'PATCH', body, responseSchema: companyProfile }),
    onSuccess: () => {
      toast.success('Invoice defaults saved')
      void qc.invalidateQueries({ queryKey: ['settings', 'company'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (isLoading) return null

  const set = (k: keyof typeof form, v: string) => setForm((s) => ({ ...s, [k]: v }))

  async function onSave() {
    const body: UpdateCompanyRequest = {
      avatar_url: form.avatar_url.trim() || undefined,
      invoice_address: form.invoice_address.trim() || null,
      invoice_phone: form.invoice_phone.trim() || null,
      invoice_email: form.invoice_email.trim() || null,
      invoice_gst_number: form.invoice_gst_number.trim() ? form.invoice_gst_number.trim().toUpperCase() : undefined,
      invoice_upi_id: form.invoice_upi_id.trim() || null,
      invoice_sac_code: form.invoice_sac_code.trim() || null,
      invoice_bank_details: form.invoice_bank_details.trim() || null,
      invoice_number_prefix: form.invoice_number_prefix.trim() || undefined,
      invoice_next_number: Number(form.invoice_next_number) || undefined,
      invoice_default_notes: form.invoice_default_notes.trim() || null,
      invoice_default_terms: form.invoice_default_terms.trim() || null,
    }
    // Drop null-prefixed no-ops so an untouched field never fails validation.
    if (!form.invoice_number_prefix.trim()) delete body.invoice_number_prefix
    await save.mutateAsync(body)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Company invoice defaults</CardTitle>
        {defaultLayout && <StatusBadge tone="info">Layout default: {defaultLayout.name}</StatusBadge>}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Branding and fallbacks applied to every new invoice. A per-invoice value overrides these for that invoice only.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label>Logo URL</Label>
            <Input value={form.avatar_url} onChange={(e) => set('avatar_url', e.target.value)} placeholder="https://…" disabled={!isOwner} />
            {form.avatar_url && <img src={form.avatar_url} alt="logo preview" className="mt-2 h-14 object-contain" />}
          </div>
          <div className="md:col-span-2">
            <Label>Business address</Label>
            <textarea
              value={form.invoice_address}
              onChange={(e) => set('invoice_address', e.target.value)}
              rows={2}
              disabled={!isOwner}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
            />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={form.invoice_phone} onChange={(e) => set('invoice_phone', e.target.value)} disabled={!isOwner} />
          </div>
          <div>
            <Label>Email</Label>
            <Input value={form.invoice_email} onChange={(e) => set('invoice_email', e.target.value)} disabled={!isOwner} />
          </div>
          <div>
            <Label>GSTIN</Label>
            <Input value={form.invoice_gst_number} onChange={(e) => set('invoice_gst_number', e.target.value.toUpperCase())} placeholder="27ABCDE1234F1Z5" disabled={!isOwner} />
            <p className="mt-1 text-xs text-muted-foreground">15-char format: 2-digit state + 10-char PAN + entity + Z + checksum.</p>
          </div>
          <div>
            <Label>UPI ID</Label>
            <Input value={form.invoice_upi_id} onChange={(e) => set('invoice_upi_id', e.target.value)} placeholder="studio@upi" disabled={!isOwner} />
            <p className="mt-1 text-xs text-muted-foreground">Printed on invoices as a scan-to-pay QR while money is due.</p>
          </div>
          <div>
            <Label>SAC code</Label>
            <Input value={form.invoice_sac_code} onChange={(e) => set('invoice_sac_code', e.target.value)} placeholder="998387" disabled={!isOwner} />
            <p className="mt-1 text-xs text-muted-foreground">The services code GST invoices carry. 998387 is photography and videography.</p>
          </div>
          <div className="md:col-span-2">
            <Label>Bank fallback</Label>
            <textarea
              value={form.invoice_bank_details}
              onChange={(e) => set('invoice_bank_details', e.target.value)}
              rows={3}
              placeholder="Used only when no saved bank account is picked on the invoice."
              disabled={!isOwner}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
            />
          </div>
          <div>
            <Label>Number prefix</Label>
            <Input value={form.invoice_number_prefix} onChange={(e) => set('invoice_number_prefix', e.target.value)} disabled={!isOwner} />
          </div>
          <div>
            <Label>Next number</Label>
            <Input inputMode="numeric" value={form.invoice_next_number} onChange={(e) => set('invoice_next_number', e.target.value)} disabled={!isOwner} />
          </div>
          <div className="md:col-span-2">
            <Label>Default notes (fallback)</Label>
            <textarea
              value={form.invoice_default_notes}
              onChange={(e) => set('invoice_default_notes', e.target.value)}
              rows={2}
              disabled={!isOwner}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
            />
          </div>
          <div className="md:col-span-2">
            <Label>Default terms (fallback)</Label>
            <textarea
              value={form.invoice_default_terms}
              onChange={(e) => set('invoice_default_terms', e.target.value)}
              rows={3}
              placeholder="Used only when no default Terms template is set."
              disabled={!isOwner}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
            />
          </div>
        </div>
        {isOwner ? (
          <div className="flex justify-end">
            <Button onClick={() => void onSave()} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save defaults'}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Only the studio owner can edit company defaults.</p>
        )}
      </CardContent>
    </Card>
  )
}

// ── Bank accounts ──────────────────────────────────────────
const emptyBank = (): CreateInvoiceBankAccountRequest => ({
  label: '',
  holder: null,
  bank: null,
  number: null,
  ifsc: null,
  upi: null,
  branch: null,
  notes: null,
  is_default: false,
})

function BankAccountsSection() {
  const { data, isLoading } = useInvoiceBankAccounts()
  const create = useCreateInvoiceBankAccount()
  const update = useUpdateInvoiceBankAccount()
  const setDefault = useDefaultInvoiceBankAccount()
  const del = useDeleteInvoiceBankAccount()
  const confirm = useConfirm()
  const [dialog, setDialog] = useState<{ open: boolean; editing: InvoiceBankAccount | null }>({ open: false, editing: null })
  const [form, setForm] = useState<CreateInvoiceBankAccountRequest>(emptyBank())

  useEffect(() => {
    if (!dialog.open) return
    const e = dialog.editing
    setForm(
      e
        ? { label: e.label, holder: e.holder, bank: e.bank, number: e.number, ifsc: e.ifsc, upi: e.upi, branch: e.branch, notes: e.notes, is_default: e.is_default }
        : emptyBank(),
    )
  }, [dialog])

  async function onSubmit() {
    if (!form.label.trim()) {
      toast.error('Label is required.')
      return
    }
    if (dialog.editing) await update.mutateAsync({ id: dialog.editing.id, body: form })
    else await create.mutateAsync(form)
    setDialog({ open: false, editing: null })
  }

  async function onDelete(b: InvoiceBankAccount) {
    const yes = await confirm({
      title: `Delete "${b.label}"?`,
      description: 'Invoices already stamped with these details keep their copy.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!yes) return
    del.mutate(b.id)
  }

  const items = data?.items ?? []
  const busy = create.isPending || update.isPending

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="h-4 w-4" /> Bank / UPI accounts
        </CardTitle>
        <Button size="sm" onClick={() => setDialog({ open: true, editing: null })}>
          <Plus className="mr-1 h-4 w-4" /> Add account
        </Button>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-muted-foreground">
          Pick one on the invoice form to fill bank details — the invoice keeps a snapshot, so later edits here don&apos;t rewrite history.
        </p>
        {isLoading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No bank accounts saved yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((b) => (
              <div key={b.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-sm">{b.label}</p>
                  {b.is_default && <StatusBadge tone="success">Default</StatusBadge>}
                </div>
                <pre className="whitespace-pre-wrap font-sans text-xs text-muted-foreground">{formatBankSnapshot(b)}</pre>
                <div className="flex flex-wrap gap-1 border-t border-border pt-2">
                  {!b.is_default && (
                    <Button size="sm" variant="ghost" onClick={() => setDefault.mutate(b.id)}>
                      <Star className="mr-1 h-3.5 w-3.5" /> Set default
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setDialog({ open: true, editing: b })}>
                    <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void onDelete(b)}>
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <Dialog open={dialog.open} onOpenChange={(o) => !o && setDialog({ open: false, editing: null })}>
          <DialogContent title={dialog.editing ? 'Edit bank account' : 'New bank account'} className="max-w-lg">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Label *</Label>
                <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="HDFC Current / Studio UPI" />
              </div>
              <div>
                <Label>Account holder</Label>
                <Input value={form.holder ?? ''} onChange={(e) => setForm({ ...form, holder: e.target.value || null })} />
              </div>
              <div>
                <Label>Bank</Label>
                <Input value={form.bank ?? ''} onChange={(e) => setForm({ ...form, bank: e.target.value || null })} />
              </div>
              <div>
                <Label>Account number</Label>
                <Input value={form.number ?? ''} onChange={(e) => setForm({ ...form, number: e.target.value || null })} />
              </div>
              <div>
                <Label>IFSC</Label>
                <Input value={form.ifsc ?? ''} onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() || null })} placeholder="HDFC0001234" />
              </div>
              <div>
                <Label>UPI ID</Label>
                <Input value={form.upi ?? ''} onChange={(e) => setForm({ ...form, upi: e.target.value || null })} placeholder="studio@upi" />
              </div>
              <div>
                <Label>Branch</Label>
                <Input value={form.branch ?? ''} onChange={(e) => setForm({ ...form, branch: e.target.value || null })} />
              </div>
              <div className="sm:col-span-2">
                <Label>Notes</Label>
                <Input value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value || null })} />
              </div>
              {!dialog.editing && (
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
                  Set as default
                </label>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialog({ open: false, editing: null })}>
                Cancel
              </Button>
              <Button onClick={() => void onSubmit()} disabled={busy || !form.label.trim()}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

// ── Terms / Notes library ──────────────────────────────────
function TextLibrarySection({ type }: { type: 'terms' | 'note' }) {
  const { data, isLoading } = useInvoiceNoteTemplates()
  const create = useCreateInvoiceNoteTemplate()
  const update = useUpdateInvoiceNoteTemplate()
  const del = useDeleteInvoiceNoteTemplate()
  const setDefault = useDefaultInvoiceNoteTemplate()
  const seed = useSeedInvoiceNoteTemplates()
  const confirm = useConfirm()
  const [dialog, setDialog] = useState<{ open: boolean; editing: InvoiceNoteTemplate | null }>({ open: false, editing: null })
  const [form, setForm] = useState<CreateInvoiceNoteTemplateRequest>({ title: '', content: '', template_type: type, is_default: false })

  const items = (data?.items ?? []).filter((t) => (t.template_type ?? 'note') === type)
  const isTerms = type === 'terms'

  useEffect(() => {
    if (!dialog.open) return
    const e = dialog.editing
    setForm(
      e
        ? { title: e.title, content: e.content, template_type: type, is_default: e.is_default }
        : { title: '', content: '', template_type: type, is_default: false },
    )
  }, [dialog, type])

  async function onSubmit() {
    if (!form.title.trim() || !form.content.trim()) {
      toast.error('Title and content are required.')
      return
    }
    if (dialog.editing) await update.mutateAsync({ id: dialog.editing.id, body: { ...form, template_type: type } })
    else await create.mutateAsync({ ...form, template_type: type })
    setDialog({ open: false, editing: null })
  }

  async function onDelete(t: InvoiceNoteTemplate) {
    const yes = await confirm({
      title: `Delete "${t.title}"?`,
      description: 'Invoices already filled with this text keep their copy.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!yes) return
    del.mutate(t.id)
  }

  const busy = create.isPending || update.isPending

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          {isTerms ? <FileText className="h-4 w-4" /> : <StickyNote className="h-4 w-4" />}
          {isTerms ? 'Terms library' : 'Notes library'}
        </CardTitle>
        <div className="flex gap-2">
          {items.length === 0 && (
            <Button size="sm" variant="outline" onClick={() => seed.mutate()} disabled={seed.isPending}>
              <Sparkles className="mr-1 h-4 w-4" /> {seed.isPending ? 'Seeding…' : 'Seed defaults'}
            </Button>
          )}
          <Button size="sm" onClick={() => setDialog({ open: true, editing: null })}>
            <Plus className="mr-1 h-4 w-4" /> Add
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-muted-foreground">
          {isTerms
            ? 'Reusable payment terms. The default fills new invoices; blank falls back to company defaults, then the print layout.'
            : 'Reusable notes snippets. The default fills new invoices; pick any of them from the invoice form.'}
        </p>
        {isLoading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No templates yet — add one or seed defaults.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((t) => (
              <div key={t.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-sm">{t.title}</p>
                  {t.is_default && <StatusBadge tone="success">Default</StatusBadge>}
                </div>
                <pre className="line-clamp-5 whitespace-pre-wrap font-sans text-xs text-muted-foreground">{t.content}</pre>
                <div className="flex flex-wrap gap-1 border-t border-border pt-2">
                  {!t.is_default && (
                    <Button size="sm" variant="ghost" onClick={() => setDefault.mutate(t.id)}>
                      <Star className="mr-1 h-3.5 w-3.5" /> Set default
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setDialog({ open: true, editing: t })}>
                    <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void onDelete(t)}>
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <Dialog open={dialog.open} onOpenChange={(o) => !o && setDialog({ open: false, editing: null })}>
          <DialogContent title={dialog.editing ? `Edit ${type} template` : `New ${type} template`} className="max-w-lg">
            <div className="space-y-3">
              <div>
                <Label>Title *</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={isTerms ? 'Standard Payment Terms' : 'Thank You Note'} />
              </div>
              <div>
                <Label>Content *</Label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  rows={6}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
                />
              </div>
              {!dialog.editing && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
                  Set as default
                </label>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialog({ open: false, editing: null })}>
                Cancel
              </Button>
              <Button onClick={() => void onSubmit()} disabled={busy || !form.title.trim() || !form.content.trim()}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
