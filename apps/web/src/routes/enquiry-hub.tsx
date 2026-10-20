import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, ChevronRight, Code2, Copy, ExternalLink, Handshake, ListChecks, MessageCircle, Pencil, Plus, QrCode, Send, Store } from 'lucide-react'
import { toast } from 'sonner'
import type { EnquiryForm, EnquiryHub } from '@ipc/contracts'
import { formShareText, whatsappUrl } from '@ipc/domain'
import { PageHeader } from '@/shared/layout/page-header'
import { SectionTabs } from '@/shared/layout/section-tabs'
import { useUrlParam } from '@/shared/hooks/use-url-param'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { Switch } from '@/shared/ui/switch'
import { cn } from '@/shared/ui/cn'
import { useAccess } from '@/shared/auth/useAccess'
import {
  useEnquiryForms,
  useEnquiryHub,
  useMakeVendorQr,
  usePartnerVendors,
  usePartners,
  useUpdateEnquiryForm,
} from '@/features/enquiry-forms/api'
import { AfterSendCard } from '@/features/enquiry-forms/AfterSendCard'
import { QuestionsCard } from '@/features/enquiry-forms/QuestionsCard'
import { FormBuilderDialog } from '@/features/enquiry-forms/FormBuilderDialog'
import { PartnerDialog } from '@/features/enquiry-forms/PartnerDialog'
import {
  DownloadButtons,
  PartnerRow,
  PrintCardPreview,
  QrDownloadButtons,
  StatTiles,
  copyText,
} from '@/features/enquiry-forms/parts'

/**
 * Enquiry form & QR codes (spec 3.1): the studio's one form, its link and
 * QR, a QR for each partner or vendor, where a client goes after sending and
 * which questions it asks. Reached from Leads ("Form & QR"), Settings and
 * each vendor. One tab at a time, so the page is short (owner, 20 Oct: the
 * long page was "overwhelming"); Add partner sits in the header. Staff see
 * the link and the QR only.
 */
export function EnquiryHubPage() {
  const hub = useEnquiryHub()
  if (hub.isPending) return <Skeleton className="h-96" />
  if (hub.isError || !hub.data) return <ErrorState message="We could not load your enquiry form." onRetry={() => void hub.refetch()} />
  return <Hub hub={hub.data} />
}

type Tab = 'qr' | 'partners' | 'after' | 'questions'
const TABS: Tab[] = ['qr', 'partners', 'after', 'questions']

function Hub({ hub }: { hub: EnquiryHub }) {
  const { form, studio, can_manage: canManage } = hub
  const partners = usePartners()
  const [raw, setTab] = useUrlParam('tab', 'qr')
  const tab: Tab = canManage && TABS.includes(raw as Tab) ? (raw as Tab) : 'qr'
  const [adding, setAdding] = useState(false)
  const live = (partners.data ?? []).filter((p) => !p.archived_at).length
  return (
    <>
      <Link to="/follow-ups" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Leads
      </Link>
      <PageHeader
        title="Enquiry form & QR codes"
        actions={
          <>
            <OnOff form={form} canManage={canManage} />
            {canManage && (
              <Button onClick={() => setAdding(true)}>
                <Plus /> Add partner
              </Button>
            )}
          </>
        }
      />
      {!form.is_active && (
        <p className="mb-4 rounded-xl bg-warning/15 px-4 py-3 text-sm text-warning">
          Switched off: the link and every QR code show a "not available" page.
        </p>
      )}
      {canManage && (
        <SectionTabs<Tab>
          variant="chips"
          label="Enquiry form"
          className="mb-4"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'qr', label: 'Your QR code', icon: QrCode },
            { value: 'partners', label: live ? `Partners · ${live}` : 'Partners', icon: Handshake },
            { value: 'after', label: 'After they send', icon: Send },
            { value: 'questions', label: 'Questions', icon: ListChecks },
          ]}
        />
      )}
      {tab === 'qr' && <YourQrCard hub={hub} />}
      {tab === 'partners' && (
        <div className="flex flex-col gap-6">
          <PartnersSection hub={hub} onAdd={() => setAdding(true)} />
          <VendorsSection />
        </div>
      )}
      {tab === 'after' && (
        <AfterSendCard key={`a-${form.after_submit}-${form.whatsapp_phone}-${form.redirect_url}`} form={form} studio={studio} defaultPhone={hub.default_whatsapp_phone} />
      )}
      {tab === 'questions' && <QuestionsCard key={`q-${JSON.stringify(form.fields)}`} form={form} services={hub.services} />}
      {adding && <PartnerDialog onClose={() => setAdding(false)} />}
    </>
  )
}

/** Is the form taking enquiries? A switch in the header for those who run it, a dot for staff. */
function OnOff({ form, canManage }: { form: EnquiryForm; canManage: boolean }) {
  const update = useUpdateEnquiryForm(form.id)
  const on = form.is_active
  if (!canManage)
    return (
      <span className="inline-flex items-center gap-2 text-sm font-medium">
        <span className={cn('size-2.5 rounded-full', on ? 'bg-success' : 'bg-muted-foreground/40')} aria-hidden />
        {on ? 'Taking enquiries' : 'Switched off'}
      </span>
    )
  return (
    <Switch
      checked={on}
      disabled={update.isPending}
      label={on ? 'Taking enquiries' : 'Switched off'}
      className="h-10 w-auto rounded-md border border-input bg-card px-3"
      onChange={(v) => update.mutate({ is_active: v }, { onSuccess: () => toast.success(v ? 'Form switched on' : 'Form switched off') })}
    />
  )
}

/** The printed card as it will look, its downloads, the link to share and the website code. */
function YourQrCard({ hub }: { hub: EnquiryHub }) {
  const access = useAccess()
  const [editing, setEditing] = useState(false)
  const url = hub.share_url
  return (
    <Card>
      <CardContent className="grid gap-6 p-4 sm:p-6 md:grid-cols-[240px_1fr]">
        <PrintCardPreview url={url} studio={hub.studio} line="Scan to send us your enquiry" />
        <div className="flex min-w-0 flex-col gap-5">
          <QrDownloadButtons url={url} studio={hub.studio} />
          <div className="flex flex-col gap-2">
            <p className="break-all rounded-xl bg-muted/60 px-3 py-2 text-sm font-bold">{url}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" asChild>
                <a href={whatsappUrl(null, formShareText(url))} target="_blank" rel="noreferrer">
                  <MessageCircle /> WhatsApp
                </a>
              </Button>
              <Button size="sm" variant="outline" onClick={() => void copyText(url)}>
                <Copy /> Copy link
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href={url} target="_blank" rel="noreferrer">
                  <ExternalLink /> Open form
                </a>
              </Button>
            </div>
          </div>
          {hub.can_manage && (
            <div className="flex flex-col gap-2 border-t border-border pt-4 text-sm">
              <Row label="On your website">
                <Button size="sm" variant="outline" onClick={() => void copyText(hub.form.embed_code, 'Website code copied')}>
                  <Code2 /> Copy code
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  <Pencil /> Edit how it looks
                </Button>
              </Row>
              {access.hasModule('crm_export') && (
                <Row label="Leads from this link">
                  <DownloadButtons query={{ from: 'form' }} />
                </Row>
              )}
              <OtherWebsiteForms />
            </div>
          )}
        </div>
      </CardContent>
      {editing && <FormBuilderDialog form={hub.form} onClose={() => setEditing(false)} />}
    </Card>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-semibold text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

/** Website forms made before the main form, still taking enquiries; hidden when there are none. */
function OtherWebsiteForms() {
  const forms = useEnquiryForms()
  const others = (forms.data ?? []).filter((f) => !f.is_main && !f.archived_at && f.purpose === 'website')
  if (!others.length) return null
  return (
    <ul className="divide-y divide-border rounded-xl border border-border">
      {others.map((f) => (
        <li key={f.id}>
          <Link to="/enquiry-forms/$id" params={{ id: f.id }} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent/50">
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            <span className="text-xs text-muted-foreground">{f.enquiries} enquiries</span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** A QR for each partner or vendor; Add partner is in the page header. */
function PartnersSection({ hub, onAdd }: { hub: EnquiryHub; onAdd: () => void }) {
  const access = useAccess()
  const partners = usePartners()
  const rows = (partners.data ?? []).filter((p) => !p.archived_at)
  const total = rows.reduce(
    (t, p) => ({ scans: t.scans + p.scans, enquiries: t.enquiries + p.enquiries, booked: t.booked + p.booked }),
    { scans: 0, enquiries: 0, booked: 0 },
  )
  if (partners.isPending) return <Skeleton className="h-32" />
  if (!rows.length)
    return (
      <Card>
        <CardContent className="p-6">
          <EmptyState
            title="No partner QR codes yet"
            description="A boutique, jeweller or venue keeps your QR at their counter. Their enquiries are marked as theirs."
            action={
              <Button onClick={onAdd}>
                <Plus /> Add your first partner
              </Button>
            }
          />
        </CardContent>
      </Card>
    )
  return (
    <section className="flex flex-col gap-3">
      {total.scans + total.enquiries > 0 && <StatTiles {...total} />}
      <Card>
        <ul className="divide-y divide-border">
          {rows.slice(0, 8).map((p) => (
            <PartnerRow key={p.id} partner={p} studio={hub.studio} />
          ))}
          <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <Link to="/follow-ups/partners" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
              All partners <ChevronRight className="size-4" aria-hidden />
            </Link>
            {total.enquiries > 0 && access.hasModule('crm_export') && <DownloadButtons query={{ from: 'partner' }} />}
          </li>
        </ul>
      </Card>
    </section>
  )
}

/** Vendors with no QR yet, one tap each. */
function VendorsSection() {
  const vendors = usePartnerVendors()
  const make = useMakeVendorQr()
  const navigate = useNavigate()
  const [all, setAll] = useState(false)
  const rows = (vendors.data ?? []).filter((v) => !v.partner_id)
  if (!rows.length) return null
  const shown = all ? rows : rows.slice(0, 3)
  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 font-bold">
        <Store className="size-4 text-primary" aria-hidden /> Your vendors without a QR
      </h2>
      <Card>
        <ul className="divide-y divide-border">
          {shown.map((v) => (
            <li key={v.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{v.name}</p>
                {(v.categories.length > 0 || v.state) && (
                  <p className="truncate text-sm text-muted-foreground">{[v.categories.join(', '), v.state].filter(Boolean).join(' · ')}</p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={make.isPending}
                onClick={() =>
                  make.mutate(v.id, {
                    onSuccess: (p) => {
                      toast.success(`QR code made for ${v.name}`)
                      void navigate({ to: '/follow-ups/partners/$id', params: { id: p.id } })
                    },
                  })
                }
              >
                <QrCode /> Make QR
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      {rows.length > 3 && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setAll((x) => !x)}>
          {all ? 'Show fewer' : `Show all ${rows.length} vendors`}
        </Button>
      )}
    </section>
  )
}
