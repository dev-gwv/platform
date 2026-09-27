import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { ArrowLeft, Copy, Download, MessageCircle, Plus, QrCode, RefreshCw, Link2Off } from 'lucide-react'
import { toast } from 'sonner'
import { buildWhatsAppUrl, type EnquiryForm, type EnquiryFormLead } from '@ipc/contracts'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'
import { Skeleton } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Switch } from '@/shared/ui/switch'
import { RowMenu } from '@/shared/ui/row-menu'
import { useConfirm } from '@/shared/ui/confirm'
import { cn } from '@/shared/ui/cn'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { downloadQrPng, downloadQrSvg, qrSvg } from '@/shared/ui/qr-download'
import {
  useCreateEnquiryForm,
  useEnquiryForm,
  useEnquiryFormLeads,
  useEnquiryFormPage,
  useEnquiryForms,
  useUpdateEnquiryForm,
} from '@/features/enquiry-forms/api'

/**
 * Enquiry forms: a QR for each vendor the studio works with. Someone scans
 * it at the boutique or the venue, sends an enquiry, and it lands in Leads
 * credited to that vendor. The vendor can be sent a page of their own that
 * shows what their QR brought in.
 */

const KINDS = ['Boutique', 'Jeweller', 'Venue', 'Salon', 'Decorator', 'Wedding planner', 'Caterer', 'Influencer', 'Store']

const numbers = (f: Pick<EnquiryForm, 'scans' | 'enquiries' | 'booked'>) =>
  `${f.scans} ${f.scans === 1 ? 'scan' : 'scans'} · ${f.enquiries} ${f.enquiries === 1 ? 'enquiry' : 'enquiries'} · ${f.booked} booked`

const LEAD_STATUS: Record<string, { label: string; tone: 'neutral' | 'info' | 'success' | 'danger' }> = {
  new: { label: 'New', tone: 'neutral' },
  contacted: { label: 'In talks', tone: 'info' },
  qualified: { label: 'In talks', tone: 'info' },
  proposal_sent: { label: 'In talks', tone: 'info' },
  converted: { label: 'Booked', tone: 'success' },
  lost: { label: 'Not booked', tone: 'danger' },
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copied`)
  } catch {
    toast.error('Could not copy. Press and hold the link to copy it.')
  }
}

// ── the list ─────────────────────────────────────────────────────
export function EnquiryFormsPage() {
  const access = useAccess()
  const forms = useEnquiryForms()
  const [adding, setAdding] = useState(false)
  const [showEnded, setShowEnded] = useState(false)
  const canCreate = access.hasAction('crm', 'create')

  const all = forms.data ?? []
  const live = all.filter((f) => !f.archived_at)
  const ended = all.filter((f) => f.archived_at)
  const total = live.reduce((t, f) => ({ scans: t.scans + f.scans, enquiries: t.enquiries + f.enquiries, booked: t.booked + f.booked }), {
    scans: 0,
    enquiries: 0,
    booked: 0,
  })

  return (
    <>
      <PageHeader
        title="Enquiry forms"
        description="A QR for each vendor you work with. Every enquiry is credited to them."
        actions={
          canCreate && (
            <Button onClick={() => setAdding(true)}>
              <Plus /> Add form
            </Button>
          )
        }
      />

      {forms.isPending ? (
        <Skeleton className="mt-2 h-40" />
      ) : forms.isError ? (
        <ErrorState message="We could not load your enquiry forms." onRetry={() => void forms.refetch()} />
      ) : all.length === 0 ? (
        <Card className="mt-2">
          <CardContent className="p-6">
            <EmptyState
              title="No enquiry forms yet"
              description="Make one for a boutique, a venue or a decorator you work with. Print their QR, and every enquiry from it is marked as theirs."
              action={
                canCreate && (
                  <Button onClick={() => setAdding(true)}>
                    <Plus /> Add your first form
                  </Button>
                )
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:gap-3">
            <Figure value={total.scans} label="Scans" />
            <Figure value={total.enquiries} label="Enquiries" />
            <Figure value={total.booked} label="Booked" />
          </div>

          <Card className="mt-4">
            <ul className="divide-y divide-border">
              {live.map((f) => (
                <FormRow key={f.id} form={f} />
              ))}
            </ul>
          </Card>

          {ended.length > 0 && (
            <div className="mt-4">
              <Button variant="ghost" size="sm" onClick={() => setShowEnded((v) => !v)}>
                {showEnded ? 'Hide ended' : `Show ended (${ended.length})`}
              </Button>
              {showEnded && (
                <Card className="mt-2 opacity-80">
                  <ul className="divide-y divide-border">
                    {ended.map((f) => (
                      <FormRow key={f.id} form={f} />
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          )}
        </>
      )}

      {adding && <AddFormDialog onClose={() => setAdding(false)} />}
    </>
  )
}

function Figure({ value, label }: { value: number; label: string }) {
  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <p className="text-base font-semibold tabular-nums leading-tight sm:text-xl">{value}</p>
        <p className="text-xs text-muted-foreground sm:text-sm">{label}</p>
      </CardContent>
    </Card>
  )
}

function FormRow({ form }: { form: EnquiryForm }) {
  return (
    <li>
      <Link
        to="/enquiry-forms/$id"
        params={{ id: form.id }}
        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <QrCode className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {form.name}
            {form.kind && <span className="font-normal text-muted-foreground"> · {form.kind}</span>}
          </p>
          <p className="truncate text-sm text-muted-foreground">{numbers(form)}</p>
        </div>
        {form.archived_at ? (
          <StatusBadge>Ended</StatusBadge>
        ) : (
          !form.is_active && <StatusBadge tone="warning">Off</StatusBadge>
        )}
      </Link>
    </li>
  )
}

function AddFormDialog({ onClose }: { onClose: () => void }) {
  const create = useCreateEnquiryForm()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [kind, setKind] = useState('')
  const [phone, setPhone] = useState('')

  const submit = () =>
    create.mutate(
      { name: name.trim(), kind: kind.trim() || null, phone: phone.trim() || null },
      {
        onSuccess: (f) => {
          onClose()
          void navigate({ to: '/enquiry-forms/$id', params: { id: f.id } })
        },
      },
    )

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title="Add an enquiry form" description="One QR for one vendor. You can print it right after.">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) submit()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ef-name">
              Who is it for <span className="text-destructive">*</span>
            </Label>
            <Input id="ef-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Riya Boutique" autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ef-kind">What they are</Label>
            <div className="flex flex-wrap gap-1.5">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(kind === k ? '' : k)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition-colors',
                    kind === k ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-accent',
                  )}
                >
                  {k}
                </button>
              ))}
            </div>
            <Input id="ef-kind" value={kind} onChange={(e) => setKind(e.target.value)} placeholder="Or type your own" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ef-phone">Their mobile</Label>
            <Input
              id="ef-phone"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="To send them their QR and page on WhatsApp"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? 'Making…' : 'Add and make QR'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── one form ─────────────────────────────────────────────────────
export function EnquiryFormDetailPage() {
  const { id } = useParams({ from: '/authed/enquiry-forms/$id' })
  const form = useEnquiryForm(id)

  if (form.isPending) return <Skeleton className="h-64" />
  if (form.isError || !form.data)
    return <ErrorState message="We could not load this form." onRetry={() => void form.refetch()} />
  return <FormDetail form={form.data} />
}

function FormDetail({ form }: { form: EnquiryForm }) {
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const update = useUpdateEnquiryForm(form.id)
  const confirm = useConfirm()

  return (
    <>
      <Link to="/enquiry-forms" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Enquiry forms
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {form.name}
            {form.archived_at ? <StatusBadge>Ended</StatusBadge> : !form.is_active && <StatusBadge tone="warning">Off</StatusBadge>}
          </span>
        }
        description={[form.kind, numbers(form)].filter(Boolean).join(' · ')}
      />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <QrCard form={form} />
        <div className="flex flex-col gap-4">
          <VendorPageCard form={form} canEdit={canEdit} />
          <LeadsCard form={form} />
        </div>
      </div>

      {canEdit && (
        <div className="mt-6 flex flex-wrap gap-2">
          {!form.archived_at && (
            <Button
              variant="outline"
              size="sm"
              disabled={update.isPending}
              onClick={() =>
                update.mutate(
                  { is_active: !form.is_active },
                  { onSuccess: (f) => toast.success(f.is_active ? 'Taking enquiries again.' : 'Switched off. The QR now says the form is closed.') },
                )
              }
            >
              {form.is_active ? 'Switch off' : 'Switch on'}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={update.isPending}
            onClick={async () => {
              if (form.archived_at) {
                update.mutate({ archived: false })
                return
              }
              const ok = await confirm({
                title: `End the partnership with ${form.name}?`,
                description: 'The QR stops taking enquiries and their page stops working. Their past enquiries stay in Leads.',
                confirmLabel: 'End it',
                destructive: true,
              })
              if (ok) update.mutate({ archived: true }, { onSuccess: () => toast.success('Ended. You can bring it back from the list.') })
            }}
          >
            {form.archived_at ? 'Bring it back' : 'End partnership'}
          </Button>
        </div>
      )}
    </>
  )
}

function QrCard({ form }: { form: EnquiryForm }) {
  const { session } = useAuth()
  const svg = useMemo(() => qrSvg(form.form_url), [form.form_url])
  const [busy, setBusy] = useState(false)
  const studio = session?.studios.find((m) => m.company_id === session.company_id)?.company_name ?? ''

  const message = `Hi! Here is your QR for ${studio || 'our studio'}. Anyone who scans it can send us an enquiry, and it is marked as coming from you.\n${form.form_url}`

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Their QR code</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <span
          role="img"
          aria-label={`QR code for ${form.name}`}
          className="block size-44 shrink-0 rounded-lg border border-border bg-white p-2"
          // The generator's own SVG of our link, not user input.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <div className="flex w-full min-w-0 flex-col gap-2">
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await downloadQrPng(form.form_url, `qr-${form.name}`, studio || form.name, `Scan to enquire · via ${form.name}`)
                toast.success('QR downloaded, ready to print')
              } catch {
                toast.error('Could not download the QR. Please try again.')
              } finally {
                setBusy(false)
              }
            }}
          >
            <Download /> Download for print
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" asChild>
              <a href={buildWhatsAppUrl(form.phone, message)} target="_blank" rel="noreferrer">
                <MessageCircle /> WhatsApp
              </a>
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => void copy(form.form_url, 'Link')}>
              <Copy /> Copy link
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <a href={form.form_url} target="_blank" rel="noreferrer" className="truncate text-xs text-muted-foreground hover:underline">
              {form.form_url.replace(/^https?:\/\//, '')}
            </a>
            <button
              type="button"
              className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => downloadQrSvg(form.form_url, `qr-${form.name}`)}
            >
              SVG
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function VendorPageCard({ form, canEdit }: { form: EnquiryForm; canEdit: boolean }) {
  const page = useEnquiryFormPage(form.id)
  const update = useUpdateEnquiryForm(form.id)
  const confirm = useConfirm()
  const message = form.page_url
    ? `Hi! This page shows every enquiry that came through your QR and where each one stands.\n${form.page_url}`
    : ''

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base">Their page</CardTitle>
        {form.page_url && canEdit && (
          <RowMenu
            label="Page link options"
            items={[
              {
                label: 'Make a new link',
                icon: <RefreshCw className="size-4" />,
                onSelect: async () => {
                  const ok = await confirm({
                    title: 'Make a new link?',
                    description: 'The old link stops working. Send them the new one.',
                    confirmLabel: 'Make new link',
                  })
                  if (ok) page.mutate(true, { onSuccess: () => toast.success('New link ready.') })
                },
              },
              {
                label: 'Stop sharing',
                icon: <Link2Off className="size-4" />,
                onSelect: () => page.mutate(false, { onSuccess: () => toast.success('Their page is off.') }),
              },
            ]}
          />
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!form.page_url ? (
          <>
            <p className="text-sm text-muted-foreground">
              Let {form.name} see the enquiries their QR brought in, and which ones booked.
            </p>
            {canEdit && (
              <Button className="self-start" disabled={page.isPending || !!form.archived_at} onClick={() => page.mutate(true)}>
                Make their page link
              </Button>
            )}
          </>
        ) : (
          <>
            <div className="flex gap-2">
              <Button className="flex-1" asChild>
                <a href={buildWhatsAppUrl(form.phone, message)} target="_blank" rel="noreferrer">
                  <MessageCircle /> Send on WhatsApp
                </a>
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => void copy(form.page_url!, 'Page link')}>
                <Copy /> Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {form.page_views > 0
                ? `Opened ${form.page_views} ${form.page_views === 1 ? 'time' : 'times'}`
                : 'Not opened yet'}
              {' · '}
              <a href={form.page_url} target="_blank" rel="noreferrer" className="hover:underline">
                See what they see
              </a>
            </p>
            {canEdit && (
              <Switch
                checked={form.show_phone}
                disabled={update.isPending}
                onChange={(v) => update.mutate({ show_phone: v })}
                label="Show full phone numbers"
                description="Off: they see 98xxxxx210."
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function LeadsCard({ form }: { form: EnquiryForm }) {
  const leads = useEnquiryFormLeads(form.id)
  const rows = leads.data ?? []
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Enquiries from {form.name}</CardTitle>
      </CardHeader>
      <CardContent>
        {leads.isPending ? (
          <Skeleton className="h-16" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet. They will show up here the moment someone scans and sends.</p>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {rows.slice(0, 20).map((l) => (
              <LeadLine key={l.id} lead={l} />
            ))}
            {rows.length > 20 && (
              <li className="px-2 pt-1 text-xs text-muted-foreground">+ {rows.length - 20} more in Leads</li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function LeadLine({ lead }: { lead: EnquiryFormLead }) {
  const s = LEAD_STATUS[lead.status] ?? { label: lead.status, tone: 'neutral' as const }
  const when = [lead.event_type, lead.event_date && new Date(lead.event_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })]
    .filter(Boolean)
    .join(' · ')
  return (
    <li>
      <Link
        to="/follow-ups"
        search={{ lead: lead.id } as never}
        className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent/50"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{lead.name ?? 'No name'}</p>
          <p className="truncate text-xs text-muted-foreground">
            {when || `Enquired ${new Date(lead.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
          </p>
        </div>
        <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
      </Link>
    </li>
  )
}
