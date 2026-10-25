import { useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { Archive, ArchiveRestore, ArrowLeft, Copy, Eye, Handshake, Link2Off, MessageCircle, Pencil, Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { EnquiryHub, EnquiryPartner } from '@ipc/contracts'
import { firstWord, formatIndianPhone, partnerPageText, partnerQrText, splitKinds, topPartnerId, whatsappUrl } from '@ipc/domain'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Switch } from '@/shared/ui/switch'
import { cn } from '@/shared/ui/cn'
import { useConfirm } from '@/shared/ui/confirm'
import { useAccess } from '@/shared/auth/useAccess'
import {
  useEnquiryHub,
  usePartner,
  usePartnerLeads,
  usePartnerSharing,
  usePartners,
  useUpdatePartner,
} from '@/features/enquiry-forms/api'
import { PartnerDialog } from '@/features/enquiry-forms/PartnerDialog'
import { PartnerAfterSendCard } from '@/features/enquiry-forms/AfterSendCard'
import { LeadLine, LeadsDownloadStrip, PartnerRow, QrDownloadButtons, QrImage, StatTiles, copyText } from '@/features/enquiry-forms/parts'

function NotYours() {
  return (
    <Card className="mt-2">
      <CardContent className="p-6">
        <EmptyState
          title="Partner QR codes aren't on your screens"
          description="Ask the owner if you need them."
        />
      </CardContent>
    </Card>
  )
}

/** Partner QR codes, every one (spec 3.5): busiest first, and the ones ended. */
export function PartnersPage() {
  const hub = useEnquiryHub()
  const [tab, setTab] = useState<'live' | 'archived'>('live')
  const canManage = hub.data?.can_manage ?? false
  const canExport = useAccess().hasModule('crm_export')
  const partners = usePartners(tab === 'archived', canManage)
  const [adding, setAdding] = useState(false)
  const rows = partners.data ?? []
  const studio = hub.data?.studio ?? ''
  const total = rows.reduce(
    (t, p) => ({ scans: t.scans + p.scans, enquiries: t.enquiries + p.enquiries, booked: t.booked + p.booked }),
    { scans: 0, enquiries: 0, booked: 0 },
  )
  const top = topPartnerId(rows)

  return (
    <>
      <Link to="/follow-ups/form" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Enquiry form & QR codes
      </Link>
      <PageHeader
        title="Partner QR codes"
        description="Give each partner you collaborate with their own QR code. Every enquiry through it is credited to them, and they see their enquiries on their own page."
        actions={
          canManage && (
            <Button onClick={() => setAdding(true)}>
              <Plus /> Add partner
            </Button>
          )
        }
      />
      {hub.isPending ? (
        <Skeleton className="h-40" />
      ) : !canManage ? (
        <NotYours />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex gap-2" role="tablist">
            {(
              [
                ['live', 'Partners'],
                ['archived', 'Archived'],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={cn(
                  'rounded-full border px-4 py-1.5 text-sm font-semibold',
                  tab === k ? 'border-foreground bg-foreground text-background' : 'border-border bg-card hover:border-brand',
                )}
              >
                {l}
              </button>
            ))}
          </div>
          {partners.isPending ? (
            <Skeleton className="h-40" />
          ) : partners.isError ? (
            <ErrorState message="We could not load your partners." onRetry={() => void partners.refetch()} />
          ) : rows.length === 0 ? (
            <Card>
              <CardContent className="p-6">
                {tab === 'archived' ? (
                  <EmptyState
                    title="No archived partners"
                    description="Partnerships you end show here. Their QR codes still open your form."
                  />
                ) : (
                  <EmptyState
                    title="No partner QR codes yet"
                    description="A boutique, jeweller, salon or venue keeps your QR at their counter. Their enquiries are marked as theirs, and they can see them too."
                    action={
                      <Button onClick={() => setAdding(true)}>
                        <Plus /> Add your first partner
                      </Button>
                    }
                  />
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              {tab === 'live' && canExport && <LeadsDownloadStrip title="Download every lead from all your partners" query={{ from: 'partner' }} />}
              {tab === 'live' && <StatTiles {...total} />}
              <Card>
                <ul className="divide-y divide-border">
                  {rows.map((p) => (
                    <PartnerRow key={p.id} partner={p} studio={studio} top={tab === 'live' && p.id === top} />
                  ))}
                </ul>
              </Card>
            </>
          )}
        </div>
      )}
      {adding && <PartnerDialog onClose={() => setAdding(false)} />}
    </>
  )
}

/** One partner (spec 3.6): who they are, their page, their QR, their enquiries. */
export function PartnerPage() {
  const { id } = useParams({ from: '/authed/follow-ups/partners/$id' })
  const hub = useEnquiryHub()
  const partner = usePartner(id)
  if (hub.isPending || partner.isPending) return <Skeleton className="h-96" />
  if (hub.data && !hub.data.can_manage) return <NotYours />
  if (partner.isError || !partner.data || !hub.data)
    return <ErrorState message="We could not load this partner." onRetry={() => void partner.refetch()} />
  return <PartnerDetail partner={partner.data} studio={hub.data.studio} formOn={hub.data.form.is_active} hub={hub.data} />
}

function PartnerDetail({ partner: p, studio, formOn, hub }: { partner: EnquiryPartner; studio: string; formOn: boolean; hub: EnquiryHub }) {
  const [editing, setEditing] = useState(false)
  const canExport = useAccess().hasModule('crm_export')
  const update = useUpdatePartner(p.id)
  const confirm = useConfirm()
  const ended = !!p.archived_at
  const kinds = splitKinds(p.label).join(', ')
  const vendor = p.vendor_name && p.vendor_name.toLowerCase() !== p.name.toLowerCase() ? `Vendor: ${p.vendor_name}` : null

  return (
    <>
      <Link to="/follow-ups/partners" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Partner QR codes
      </Link>
      <div className="flex flex-col gap-6">
        <Card>
          <CardContent className="flex flex-col gap-4 p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground">
                <Handshake className="size-6" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="flex flex-wrap items-center gap-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
                  <span className="truncate">{p.name}</span>
                  {ended && <StatusBadge>Partnership ended</StatusBadge>}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {[kinds, vendor, p.phone ? formatIndianPhone(p.phone) : null].filter(Boolean).join(' · ')}
                </p>
              </div>
              <Button size="sm" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
            </div>
            <StatTiles scans={p.scans} enquiries={p.enquiries} booked={p.booked} />
            {canExport && <LeadsDownloadStrip title={`Download all leads from ${p.name}`} query={{ partner_id: p.id }} />}
            {p.notes && <p className="whitespace-pre-line rounded-xl bg-muted/60 px-4 py-3 text-sm">{p.notes}</p>}
          </CardContent>
        </Card>

        {!ended && <TheirPageCard partner={p} studio={studio} />}
        {!ended && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-extrabold">Their QR code</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {!formOn && (
                <p className="rounded-xl bg-warning/15 px-4 py-3 text-sm text-warning">
                  Your enquiry form is switched off, so this QR shows a "not available" page.{' '}
                  <Link to="/follow-ups/form" className="font-bold underline">
                    Switch it on
                  </Link>
                </p>
              )}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <span className="mx-auto w-44 shrink-0 rounded-2xl border border-border bg-white p-2 sm:mx-0">
                  <QrImage url={p.form_url} label={`QR code for ${p.name}`} />
                </span>
                <div className="flex min-w-0 flex-col gap-3">
                  <p className="text-sm">
                    Print it for {firstWord(p.name)}'s counter, trial room or table. People scan it, fill in your enquiry form, and the
                    enquiry is marked as theirs.
                  </p>
                  <QrDownloadButtons url={p.form_url} studio={studio} partner={p.name} />
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 flex-1 basis-56 break-all rounded-xl bg-muted/60 px-3 py-2 text-xs font-bold">{p.form_url}</p>
                    <Button size="sm" variant="outline" asChild>
                      <a href={whatsappUrl(p.phone, partnerQrText(p.name, studio, p.form_url))} target="_blank" rel="noreferrer">
                        <MessageCircle /> Send on WhatsApp
                      </a>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void copyText(p.form_url)}>
                      <Copy /> Copy
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Its questions stay editable for good (owner, 25 Oct); answers already given stay on their leads. */}
        {!ended && <QrQuestionsCard partner={p} onEdit={() => setEditing(true)} />}

        {/* This QR's own after-send (0281): a link, chat or thank-you just for them. */}
        {!ended && (
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-extrabold">After they send, through {firstWord(p.name)}'s QR</h2>
            <PartnerAfterSendCard
              key={`a-${p.after_submit}-${p.whatsapp_phone}-${p.redirect_url}-${p.thank_you}-${p.whatsapp_text}`}
              partner={p}
              form={hub.form}
              studio={studio}
              defaultPhone={hub.default_whatsapp_phone}
            />
          </section>
        )}

        <EnquiriesCard partner={p} />

        <Button
          variant="ghost"
          className="self-start"
          disabled={update.isPending}
          onClick={async () => {
            if (!ended) {
              const ok = await confirm({
                title: `End the partnership with ${p.name}?`,
                description: 'Their QR still opens your form, but new enquiries are not marked as theirs, and their page stops working.',
                confirmLabel: 'End partnership',
                destructive: true,
              })
              if (!ok) return
            }
            update.mutate(
              { archived: !ended },
              {
                onSuccess: () =>
                  toast.success(ended ? `${p.name} is back` : 'Partnership ended. Their page is off and their QR is no longer credited.'),
                onError: (e) => toast.error(e.message || 'We could not save that.'),
              },
            )
          }}
        >
          {ended ? <ArchiveRestore /> : <Archive />} {ended ? 'Bring back' : 'End partnership'}
        </Button>
      </div>
      {editing && <PartnerDialog partner={p} onClose={() => setEditing(false)} />}
    </>
  )
}

function QrQuestionsCard({ partner: p, onEdit }: { partner: EnquiryPartner; onEdit: () => void }) {
  const qs = p.questions ?? []
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 pb-2">
        <CardTitle className="text-lg font-extrabold">Questions on {firstWord(p.name)}'s QR</CardTitle>
        <Button size="sm" onClick={onEdit}>
          <Pencil /> {qs.length || p.occasion ? 'Edit questions' : 'Add questions'}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {p.occasion && (
          <p className="text-sm">
            <span className="text-muted-foreground">For </span>
            <span className="font-semibold">{p.occasion}</span>
          </p>
        )}
        {qs.length ? (
          <ol className="flex flex-col gap-1.5">
            {qs.map((q, i) => (
              <li key={q.id} className="text-sm">
                <span className="font-semibold">
                  {i + 1}. {q.label}
                </span>
                <span className="text-muted-foreground">
                  {' · '}
                  {q.kind === 'choice' ? q.options.join(' / ') : 'Typed answer'}
                  {q.required ? ' · Must answer' : ''}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">Only your form's own questions are asked.</p>
        )}
        {qs.length > 0 && (
          <p className="text-xs text-muted-foreground">Change them any time. Answers already given stay on their leads.</p>
        )}
      </CardContent>
    </Card>
  )
}

function TheirPageCard({ partner: p, studio }: { partner: EnquiryPartner; studio: string }) {
  const sharing = usePartnerSharing(p.id)
  const update = useUpdatePartner(p.id)
  const confirm = useConfirm()
  const first = firstWord(p.name)
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-extrabold">{first}'s page: every enquiry, open to them</CardTitle>
        <p className="text-sm text-muted-foreground">
          A private link where {p.name} sees every enquiry from their QR code and where it stands: new, in talks, booked or not booked.
          Never prices or payments.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {p.page_url ? (
          <>
            <p className="break-all rounded-xl bg-muted/60 px-3 py-2 text-sm font-bold">{p.page_url}</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <a href={whatsappUrl(p.phone, partnerPageText(p.name, studio, p.page_url))} target="_blank" rel="noreferrer">
                  <MessageCircle /> Send on WhatsApp
                </a>
              </Button>
              <Button variant="outline" onClick={() => void copyText(p.page_url!)}>
                <Copy /> Copy link
              </Button>
              <Button variant="outline" asChild>
                <a href={p.page_url} target="_blank" rel="noreferrer">
                  <Eye /> See their page
                </a>
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={sharing.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Make a new link?',
                    description: 'The old link stops working. Send them the new one.',
                    confirmLabel: 'Make new link',
                  })
                  if (ok) sharing.mutate(true, { onSuccess: () => toast.success('New link made. The old one no longer works.') })
                }}
              >
                <RefreshCw /> New link
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="hover:text-destructive"
                disabled={sharing.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: `Stop sharing with ${first}?`,
                    description: 'Their page link stops working at once. You can make a new one later.',
                    confirmLabel: 'Stop sharing',
                    destructive: true,
                  })
                  if (ok) sharing.mutate(false, { onSuccess: () => toast.success('Sharing stopped. Their link no longer works.') })
                }}
              >
                <Link2Off /> Stop sharing
              </Button>
            </div>
          </>
        ) : (
          <Button
            className="self-start"
            disabled={sharing.isPending}
            onClick={() => sharing.mutate(true, { onSuccess: () => toast.success('Their page is on') })}
          >
            Make their page link
          </Button>
        )}
        <div className="rounded-xl border border-border p-3">
          <Switch
            checked={p.show_phone}
            disabled={update.isPending}
            onChange={(v) =>
              update.mutate(
                { show_phone: v },
                { onError: (e) => toast.error(e.message || 'We could not save that. Please try again.') },
              )
            }
            label="Show full contact details"
            description={
              p.show_phone
                ? "They see each client's number and email in full."
                : 'Numbers show as 98xxxxx123 and no email, enough to recognise, not to call.'
            }
          />
        </div>
      </CardContent>
    </Card>
  )
}

function EnquiriesCard({ partner: p }: { partner: EnquiryPartner }) {
  const leads = usePartnerLeads(p.id)
  const rows = leads.data ?? []
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-lg font-extrabold">Enquiries from {p.name}</CardTitle>
      </CardHeader>
      <CardContent>
        {leads.isPending ? (
          <Skeleton className="h-16" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet. They show here the moment someone enquires through this QR code.</p>
        ) : (
          <ul className="-mx-3 flex flex-col">
            {rows.map((l) => (
              <LeadLine key={l.id} lead={l} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
