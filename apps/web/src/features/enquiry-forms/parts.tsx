import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronRight, Download, Eye, FileSpreadsheet } from 'lucide-react'
import { toast } from 'sonner'
import type { EnquiryFormLead, EnquiryPartner } from '@ipc/contracts'
import { partnerCounts, partnerPageText, slugify, splitKinds, whatsappUrl } from '@ipc/domain'
import { Button } from '@/shared/ui/button'
import { StatusBadge } from '@/shared/ui/status-badge'
import { cn } from '@/shared/ui/cn'
import { downloadQrPng, downloadQrSvg, qrSvg } from '@/shared/ui/qr-download'
import { downloadLeads, type LeadsDownload } from './api'

/** Copy a link, or say how to copy it by hand (spec 3.1). */
export async function copyText(text: string, done = 'Link copied') {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(done)
  } catch {
    toast.error("Couldn't copy. Press and hold the link to copy it.")
  }
}

/** Scans · Enquiries · Booked, three equal tiles. */
export function StatTiles({ scans, enquiries, booked, className }: { scans: number; enquiries: number; booked: number; className?: string }) {
  return (
    <div className={cn('grid grid-cols-3 gap-3', className)}>
      {(
        [
          [scans, 'Scans'],
          [enquiries, 'Enquiries'],
          [booked, 'Booked'],
        ] as const
      ).map(([v, l]) => (
        <div key={l} className="rounded-xl border border-border bg-card p-3 sm:p-4">
          <p className="text-2xl font-extrabold tabular-nums leading-tight">{v}</p>
          <p className="text-sm text-muted-foreground">{l}</p>
        </div>
      ))}
    </div>
  )
}

const LEAD_STATUS: Record<string, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' }> = {
  new: { label: 'New', tone: 'warning' },
  contacted: { label: 'In talks', tone: 'info' },
  qualified: { label: 'In talks', tone: 'info' },
  proposal_sent: { label: 'In talks', tone: 'info' },
  converted: { label: 'Booked', tone: 'success' },
  lost: { label: 'Not booked', tone: 'neutral' },
}

const shortDay = (d: string, year = true) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) })

/** One enquiry: name, when, the event, where it stands. Opens the lead. */
export function LeadLine({ lead }: { lead: EnquiryFormLead }) {
  const s = LEAD_STATUS[lead.status] ?? { label: lead.status, tone: 'neutral' as const }
  const event = [lead.event_type, lead.event_date && shortDay(lead.event_date)].filter(Boolean).join(' · ')
  return (
    <li>
      <Link
        to="/follow-ups"
        search={{ lead: lead.id } as never}
        className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-accent/50"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{lead.name ?? 'No name'}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[lead.phone, lead.email].filter(Boolean).join(' · ')}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {[`Enquired ${shortDay(lead.created_at, false)}`, event].filter(Boolean).join(' · ')}
          </p>
        </div>
        <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
      </Link>
    </li>
  )
}

/** "Excel" and "CSV", the same pair everywhere leads can be downloaded (spec 3.12). */
export function DownloadButtons({ query, className }: { query: Omit<LeadsDownload, 'format'>; className?: string }) {
  const [busy, setBusy] = useState<'xlsx' | 'csv' | null>(null)
  const run = async (format: 'xlsx' | 'csv') => {
    setBusy(format)
    try {
      const n = await downloadLeads({ ...query, format })
      if (n === 0) toast.info('No leads to download yet')
      else toast.success(`${n} ${n === 1 ? 'lead' : 'leads'} downloaded`)
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'We could not make the file. Please try again.')
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className={cn('flex gap-2', className)}>
      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run('xlsx')}>
        <FileSpreadsheet /> {busy === 'xlsx' ? 'Making…' : 'Excel'}
      </Button>
      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run('csv')}>
        {busy === 'csv' ? 'Making…' : 'CSV'}
      </Button>
    </div>
  )
}

/** "Download for print (HD)" and "SVG" for one QR (spec 3.13). */
export function QrDownloadButtons({
  url,
  studio,
  partner,
  small = false,
}: {
  url: string
  studio: string
  partner?: string
  small?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const file = partner ? `${slugify(studio)}-x-${slugify(partner)}-qr` : `${slugify(studio)}-enquiry-qr`
  const line = partner ? `Scan to enquire · via ${partner}` : 'Scan to send us your enquiry'
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size={small ? 'sm' : 'default'}
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await downloadQrPng(url, file, studio, line)
            toast.success(partner ? `${partner}'s QR code downloaded, ready to print` : 'QR code downloaded, ready to print')
          } catch {
            toast.error('Could not download the QR. Please try again.')
          } finally {
            setBusy(false)
          }
        }}
      >
        <Download /> {small ? 'Download (HD)' : 'Download for print (HD)'}
      </Button>
      <Button
        size={small ? 'sm' : 'default'}
        variant="outline"
        onClick={() => {
          downloadQrSvg(url, file)
          toast.success('QR code downloaded as SVG')
        }}
      >
        SVG
      </Button>
    </div>
  )
}

/** The code itself, drawn from our own link. */
export function QrImage({ url, label, className }: { url: string; label: string; className?: string }) {
  const svg = useMemo(() => qrSvg(url, 1), [url])
  return (
    <span
      role="img"
      aria-label={label}
      className={cn('block aspect-square bg-white [&_svg]:size-full', className)}
      // The generator's own SVG of our link, not user input.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

/** What gets printed, as it will look: the code, the studio's name and the line under it. */
export function PrintCardPreview({ url, studio, line }: { url: string; studio: string; line: string }) {
  return (
    <div className="mx-auto w-full max-w-60 rounded-2xl border border-border bg-white p-5 text-center text-[#111827] shadow-sm">
      <QrImage url={url} label={`QR code for ${studio}`} />
      <p className="mt-3 text-lg font-extrabold leading-tight">{studio}</p>
      <p className="mt-1 text-sm text-[#4b5563]">{line}</p>
    </div>
  )
}

/** One partner in a list (spec 3.4): thumbnail, name and counts, then send-their-page and download. */
export function PartnerRow({ partner, studio }: { partner: EnquiryPartner; studio: string }) {
  const kinds = splitKinds(partner.label).join(', ')
  const counts = partnerCounts(partner.scans, partner.enquiries, partner.booked)
  return (
    <li className="flex items-center gap-3 px-3 py-3 sm:px-4">
      <Link
        to="/follow-ups/partners/$id"
        params={{ id: partner.id }}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg hover:opacity-90"
      >
        <span className="size-14 shrink-0 rounded-xl border border-border bg-white p-1">
          <QrImage url={partner.form_url} label="" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{partner.name}</span>
          <span className="block truncate text-sm text-muted-foreground">{[kinds, counts].filter(Boolean).join(' · ')}</span>
        </span>
        <ChevronRight className="hidden size-4 shrink-0 text-muted-foreground sm:block" aria-hidden />
      </Link>
      {partner.page_url && !partner.archived_at && (
        <Button size="icon" variant="outline" asChild>
          <a
            href={whatsappUrl(partner.phone, partnerPageText(partner.name, studio, partner.page_url))}
            target="_blank"
            rel="noreferrer"
            aria-label={`Send ${partner.name} their page on WhatsApp`}
            title={`Send ${partner.name} their page on WhatsApp`}
          >
            <Eye />
          </a>
        </Button>
      )}
      <Button
        size="icon"
        variant="outline"
        aria-label={`Download ${partner.name}'s QR code`}
        title={`Download ${partner.name}'s QR code`}
        onClick={async () => {
          try {
            await downloadQrPng(
              partner.form_url,
              `${slugify(studio)}-x-${slugify(partner.name)}-qr`,
              studio,
              `Scan to enquire · via ${partner.name}`,
            )
            toast.success(`${partner.name}'s QR code downloaded, ready to print`)
          } catch {
            toast.error('Could not download the QR. Please try again.')
          }
        }}
      >
        <Download />
      </Button>
    </li>
  )
}
