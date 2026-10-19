import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, ChevronRight, Code2, Copy, ExternalLink, Handshake, MessageCircle, Pencil, Plus, QrCode, Store } from 'lucide-react'
import { toast } from 'sonner'
import type { EnquiryForm, EnquiryHub } from '@ipc/contracts'
import { formShareText, whatsappUrl } from '@ipc/domain'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
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
 * QR, where a client goes after sending, which questions it asks, and a QR
 * for each partner or vendor. Reached from Leads ("Form & QR"), Settings and
 * each vendor. Staff see the link and the QR to share; owners and managers
 * also change the form and its partners.
 */
export function EnquiryHubPage() {
  const hub = useEnquiryHub()
  if (hub.isPending) return <Skeleton className="h-96" />
  if (hub.isError || !hub.data) return <ErrorState message="We could not load your enquiry form." onRetry={() => void hub.refetch()} />
  return <Hub hub={hub.data} />
}

function Hub({ hub }: { hub: EnquiryHub }) {
  const { form, studio, can_manage: canManage } = hub
  return (
    <>
      <Link to="/follow-ups" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Leads
      </Link>
      <PageHeader
        title="Enquiry form & QR codes"
        description="Share one link or QR code. Every enquiry comes into Leads, due today."
      />
      <div className="flex flex-col gap-6">
        <OnOffCard form={form} canManage={canManage} />
        <YourQrCard hub={hub} />
        {canManage && (
          <>
            <AfterSendCard key={`a-${form.after_submit}-${form.whatsapp_phone}-${form.redirect_url}`} form={form} studio={studio} defaultPhone={hub.default_whatsapp_phone} />
            <QuestionsCard key={`q-${JSON.stringify(form.fields)}`} form={form} services={hub.services} />
            <WebsiteCard form={form} />
            <PartnersSection hub={hub} />
            <VendorsSection />
          </>
        )}
      </div>
    </>
  )
}

/** Card A: is the form taking enquiries? */
function OnOffCard({ form, canManage }: { form: EnquiryForm; canManage: boolean }) {
  const update = useUpdateEnquiryForm(form.id)
  const on = form.is_active
  const line = on
    ? 'Anyone with the link or a QR code can send you an enquiry.'
    : "The link and every QR code show a 'not available' page."
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4 sm:p-5">
        {canManage ? (
          <Switch
            checked={on}
            disabled={update.isPending}
            label={on ? 'Accepting enquiries' : 'Switched off'}
            description={line}
            onChange={(v) =>
              update.mutate({ is_active: v }, { onSuccess: () => toast.success(v ? 'Form switched on' : 'Form switched off') })
            }
          />
        ) : (
          <div className="flex items-start gap-3">
            <span className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', on ? 'bg-success' : 'bg-muted-foreground/40')} />
            <div>
              <p className="font-bold">{on ? 'Accepting enquiries' : 'Switched off'}</p>
              <p className="text-sm text-muted-foreground">{line}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** Card B: the printed card as it will look, its downloads and the link to share. */
function YourQrCard({ hub }: { hub: EnquiryHub }) {
  const access = useAccess()
  const url = hub.share_url
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg font-extrabold">
          <QrCode className="size-5 text-primary" aria-hidden /> Your QR code
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-[240px_1fr]">
        <PrintCardPreview url={url} studio={hub.studio} line="Scan to send us your enquiry" />
        <div className="flex min-w-0 flex-col gap-4">
          <p className="text-sm">
            Print it for your studio, stall or wedding expo. People scan it, fill in their details, and the enquiry is in Leads at once.
          </p>
          <QrDownloadButtons url={url} studio={hub.studio} />
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-muted-foreground">Or share the link</p>
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
          {hub.can_manage && access.hasModule('crm_export') && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-muted-foreground">Leads from this QR code and link</p>
              <DownloadButtons query={{ from: 'form' }} />
            </div>
          )}
          <p className="text-xs text-muted-foreground">Put the link in your Instagram bio, WhatsApp Business profile and Google listing.</p>
        </div>
      </CardContent>
    </Card>
  )
}

/** The same form on the studio's own website, how it looks, and any other website forms. */
function WebsiteCard({ form }: { form: EnquiryForm }) {
  const [editing, setEditing] = useState(false)
  const forms = useEnquiryForms()
  const others = (forms.data ?? []).filter((f) => !f.is_main && !f.archived_at && f.purpose === 'website')
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-lg font-extrabold">
          <Code2 className="size-5 text-primary" aria-hidden /> On your website
        </CardTitle>
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          <Pencil /> Edit how it looks
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">Paste this where the form should appear. It sizes itself.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void copyText(form.embed_code, 'Website code copied')}>
            <Code2 /> Copy code
          </Button>
        </div>
        {others.length > 0 && (
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
        )}
      </CardContent>
      {editing && <FormBuilderDialog form={form} onClose={() => setEditing(false)} />}
    </Card>
  )
}

/** Section E: a QR for each partner or vendor. */
function PartnersSection({ hub }: { hub: EnquiryHub }) {
  const access = useAccess()
  const partners = usePartners()
  const [adding, setAdding] = useState(false)
  const rows = partners.data ?? []
  const total = rows.reduce(
    (t, p) => ({ scans: t.scans + p.scans, enquiries: t.enquiries + p.enquiries, booked: t.booked + p.booked }),
    { scans: 0, enquiries: 0, booked: 0 },
  )
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-xl">
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <Handshake className="size-5 text-primary" aria-hidden /> A QR code for each partner or vendor
          </h2>
          <p className="text-sm text-muted-foreground">
            Each has its own code. Enquiries through it are marked as theirs, so you see who sends you work.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {total.enquiries > 0 && access.hasModule('crm_export') && <DownloadButtons query={{ from: 'partner' }} />}
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus /> Add partner
          </Button>
        </div>
      </div>
      {!hub.form.is_active && rows.length > 0 && (
        <p className="rounded-xl bg-warning/15 px-4 py-3 text-sm text-warning">
          The form is switched off, so these QR codes show a "not available" page.
        </p>
      )}
      {partners.isPending ? (
        <Skeleton className="h-32" />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <EmptyState
              title="No partner QR codes yet"
              description="A boutique, jeweller, salon or venue keeps your QR at their counter. Their enquiries are marked as theirs, and they can see them too."
              action={
                <Button onClick={() => setAdding(true)}>
                  <Plus /> Add your first partner
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <StatTiles {...total} />
          <Card>
            <ul className="divide-y divide-border">
              {rows.slice(0, 8).map((p) => (
                <PartnerRow key={p.id} partner={p} studio={hub.studio} />
              ))}
              <li>
                <Link
                  to="/follow-ups/partners"
                  className="flex items-center justify-between px-4 py-3 text-sm font-semibold text-primary hover:bg-accent/50"
                >
                  All partners, and ones you've ended <ChevronRight className="size-4" aria-hidden />
                </Link>
              </li>
            </ul>
          </Card>
        </>
      )}
      {adding && <PartnerDialog onClose={() => setAdding(false)} />}
    </section>
  )
}

/** Section F: vendors with no QR yet, one tap each. */
function VendorsSection() {
  const vendors = usePartnerVendors()
  const make = useMakeVendorQr()
  const navigate = useNavigate()
  const [all, setAll] = useState(false)
  const rows = (vendors.data ?? []).filter((v) => !v.partner_id)
  if (!rows.length) return null
  const shown = all ? rows : rows.slice(0, 5)
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <Store className="size-5 text-primary" aria-hidden /> Your vendors
        </h2>
        <p className="text-sm text-muted-foreground">
          Give a vendor you work with their own QR code in one tap. Enquiries from it are marked as theirs.
        </p>
      </div>
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
      {rows.length > 5 && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setAll((x) => !x)}>
          {all ? 'Show fewer' : `Show all ${rows.length} vendors`}
        </Button>
      )}
    </section>
  )
}
