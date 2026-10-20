import { useEffect, useState, type ReactNode } from 'react'
import { useParams } from '@tanstack/react-router'
import { Download, Handshake, Inbox, Mail, Phone } from 'lucide-react'
import { ENQUIRY_HEIGHT_MESSAGE, defuse } from '@ipc/domain'
import {
  publicEnquiryFormV2,
  publicPartnerView,
  submitEnquiryResponse,
  z,
  type PublicEnquiryFormV2,
} from '@ipc/contracts'
import { callApi, ApiError } from '@/shared/api/client'
import { PageBackdrop } from '@/shared/brand/PageBackdrop'
import { Skeleton } from '@/shared/ui/skeleton'
import { Wordmark } from '@/shared/ui/wordmark'
import { cn } from '@/shared/ui/cn'
import { EnquiryFormView, EnquirySendError, type EnquirySend } from '@/features/enquiry-forms/EnquiryFormView'
import type { FieldErrors } from '@/features/enquiry-forms/form-fields'

type PartnerView = z.infer<typeof publicPartnerView>

function Shell({ children, embed = false, wide = false }: { children: ReactNode; embed?: boolean; wide?: boolean }) {
  // On a studio's own website the form sits in their page: no backdrop, and
  // the frame is told how tall it is so it never scrolls inside itself.
  useEffect(() => {
    if (!embed || window.parent === window) return
    const send = () =>
      window.parent.postMessage({ type: ENQUIRY_HEIGHT_MESSAGE, height: Math.ceil(document.documentElement.scrollHeight) }, '*')
    send()
    const ro = new ResizeObserver(send)
    ro.observe(document.body)
    return () => ro.disconnect()
  }, [embed])
  if (embed) return <div className="bg-background p-1 font-sans">{children}</div>
  return (
    <div className="relative min-h-screen bg-background px-4 py-10 font-sans sm:px-6">
      <PageBackdrop />
      <div className={cn('relative z-10 mx-auto flex w-full flex-col gap-6', wide ? 'max-w-2xl' : 'max-w-md')}>
        {children}
        <a
          href="/"
          className="mx-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          Powered by <Wordmark className="text-xs" />
        </a>
      </div>
    </div>
  )
}

function Unavailable({ title, text, embed = false }: { title: string; text: string; embed?: boolean }) {
  return (
    <Shell embed={embed}>
      <div className="rounded-2xl border border-border bg-card px-6 py-14 text-center shadow-sm">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-muted">
          <Inbox className="size-6 text-muted-foreground" aria-hidden />
        </span>
        <p className="mt-5 text-xl font-extrabold tracking-tight">{title}</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{text}</p>
      </div>
    </Shell>
  )
}

const fieldErrors = z.object({ fields: z.record(z.string(), z.string()) })

/** A 404 is a form that is off or a wrong link; 429 is too many opens; anything else is our side. */
function formFailure(err: unknown): 'missing' | 'busy' | 'down' {
  if (err instanceof ApiError) {
    if (err.status === 404) return 'missing'
    if (err.status === 429) return 'busy'
  }
  return 'down'
}

// Private windows and blocked storage throw: then every open counts, as before.
function readSession(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
function writeSession(key: string) {
  try {
    sessionStorage.setItem(key, '1')
  } catch {
    // nothing to remember
  }
}

/**
 * PUBLIC: the studio's enquiry form (0195, 0240, 0274). /f/<link> is the
 * studio's readable link, /enquire/<code> the older one (and every QR printed
 * before 0274); ?p=<code> is a partner's QR. What is sent lands in Leads, due
 * now, and the person goes on into a WhatsApp chat with the studio.
 * `?embed=1` is the version framed on a website.
 */
export function EnquirePage() {
  const params = useParams({ strict: false }) as { code?: string; slug?: string }
  const key = params.slug ?? params.code ?? ''
  const search = new URLSearchParams(window.location.search)
  const embed = search.get('embed') === '1'
  const partner = search.get('p')
  const [form, setForm] = useState<PublicEnquiryFormV2 | null>(null)
  const [failed, setFailed] = useState<'missing' | 'busy' | 'down' | null>(null)

  // Each visit counts one scan; a refresh in the same tab says it was seen (0278).
  useEffect(() => {
    const seenKey = `enquiry-seen:${key}:${partner ?? ''}`
    const seen = readSession(seenKey)
    const q = new URLSearchParams()
    if (partner) q.set('p', partner)
    if (seen) q.set('seen', '1')
    const qs = q.toString()
    callApi(`/public/forms/${encodeURIComponent(key)}${qs ? `?${qs}` : ''}`, { responseSchema: publicEnquiryFormV2 })
      .then((f) => {
        writeSession(seenKey)
        setForm(f)
      })
      .catch((err) => setFailed(formFailure(err)))
  }, [key, partner])

  async function send(body: EnquirySend) {
    try {
      return await callApi(`/public/forms/${encodeURIComponent(key)}`, {
        method: 'POST',
        body: { ...body, p: partner },
        responseSchema: submitEnquiryResponse,
      })
    } catch (err) {
      if (err instanceof ApiError) {
        const parsed = fieldErrors.safeParse(err.body)
        throw new EnquirySendError(err.message, parsed.success ? (parsed.data.fields as FieldErrors) : {})
      }
      throw new EnquirySendError('We could not send this. Please try again.')
    }
  }

  if (failed === 'missing') {
    return (
      <Unavailable
        embed={embed}
        title="This form isn't available"
        text="The link may be old or switched off. Please contact the business directly."
      />
    )
  }
  if (failed) {
    return (
      <Unavailable
        embed={embed}
        title={failed === 'busy' ? 'Too many tries' : 'Something went wrong'}
        text={failed === 'busy' ? 'Please wait a minute, then open the link again.' : 'Please try again in a moment.'}
      />
    )
  }
  if (!form) {
    return (
      <Shell embed={embed}>
        <Skeleton className="h-96 rounded-2xl" />
      </Shell>
    )
  }
  return (
    <Shell embed={embed}>
      <EnquiryFormView look={form} embed={embed} onSend={send} />
    </Shell>
  )
}

const STATUS: Record<PartnerView['leads'][number]['status'], string> = {
  New: 'bg-brand/15 text-foreground',
  'In talks': 'bg-muted text-foreground',
  Booked: 'bg-success/15 text-success',
  'Not booked': 'bg-border text-muted-foreground',
}

const day = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * The partner's own copy of their leads (owner, 20 Oct): a CSV that opens in
 * Excel, made in the browser from what the page already shows. No cell is
 * allowed to run as a formula.
 */
function downloadPartnerLeads(view: PartnerView) {
  const cell = (v: string | null | undefined) => `"${defuse(v ?? '').replace(/"/g, '""')}"`
  const head = ['Name', 'Mobile', 'Email', 'City', 'Event', 'Event date', 'Enquired on', 'Where it stands']
  const rows = view.leads.map((l) =>
    // The mobile as ten digits, like the studio's own download; a hidden one as shown.
    [l.name, l.phone ? (view.full_details ? l.phone.replace(/\D/g, '').slice(-10) : l.phone) : null, l.email, l.city, l.event_type, l.event_date ? day(l.event_date) : null, day(l.enquired_on), l.status]
      .map(cell)
      .join(','),
  )
  const csv = '\uFEFF' + [head.map(cell).join(','), ...rows].join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${view.form_name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-leads.csv`
  // In the page while it is clicked, and the file let go a moment after, or some phones save nothing.
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * PUBLIC: a partner's own page (spec 3.11). Every enquiry their QR brought in
 * and where it stands -- never prices, budgets, notes or who handles it.
 */
export function EnquiryViewPage() {
  const { token } = useParams({ from: '/enquiry-view/$token' })
  const [view, setView] = useState<PartnerView | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    callApi(`/public/enquiry-view/${encodeURIComponent(token)}`, { responseSchema: publicPartnerView })
      .then(setView)
      .catch(() => setMissing(true))
  }, [token])

  if (missing) {
    return (
      <Unavailable
        title="This page isn't available"
        text="The link may be old or sharing was stopped. Please ask the business for a new link."
      />
    )
  }
  if (!view) {
    return (
      <Shell wide>
        <Skeleton className="h-96 rounded-2xl" />
      </Shell>
    )
  }

  return (
    <Shell wide>
      <header className="flex flex-col items-center gap-2 text-center">
        {view.logo_url && (
          <img src={view.logo_url} alt="" className="size-16 rounded-2xl border border-border bg-white object-contain p-1.5 shadow-sm" />
        )}
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{view.studio}</h1>
        {view.city && <p className="text-sm text-muted-foreground">{view.city}</p>}
        <span className="inline-flex items-center gap-1.5 rounded-full bg-card/80 px-3 py-1 text-sm font-semibold text-primary ring-1 ring-brand/50">
          <Handshake className="size-4" aria-hidden /> Enquiries via {view.form_name}
        </span>
      </header>

      <div className="grid grid-cols-3 gap-3 text-center">
        {(
          [
            [view.scans, 'Scans'],
            [view.enquiries, 'Enquiries'],
            [view.booked, 'Booked'],
          ] as const
        ).map(([v, l]) => (
          <div key={l} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-3xl font-extrabold tabular-nums">{v}</p>
            <p className="text-sm text-muted-foreground">{l}</p>
          </div>
        ))}
      </div>

      {view.leads.length > 0 && (
        <button
          type="button"
          onClick={() => downloadPartnerLeads(view)}
          className="inline-flex items-center justify-center gap-2 self-center rounded-xl border border-input bg-card px-4 py-2.5 text-sm font-semibold shadow-sm hover:bg-muted"
        >
          <Download className="size-4" aria-hidden /> Download all {view.leads.length} leads (Excel / CSV)
        </button>
      )}

      <section className="rounded-2xl border border-border bg-card shadow-sm">
        {view.leads.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-xl font-extrabold tracking-tight">No enquiries yet</p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
              Every enquiry from your QR code shows here as soon as it comes in.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {view.leads.map((l) => (
              <li key={`${l.enquired_on}-${l.name ?? ''}-${l.phone ?? ''}`} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{l.name ?? 'No name'}</p>
                  {/* Their real details, tap to call or write (0276). */}
                  {(l.phone || l.email) && (
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                      {l.phone && (
                        view.full_details ? (
                          <a href={`tel:${l.phone}`} className="inline-flex items-center gap-1 font-medium tabular-nums text-primary hover:underline">
                            <Phone className="size-3.5" aria-hidden /> {l.phone}
                          </a>
                        ) : (
                          <span className="tabular-nums text-muted-foreground">{l.phone}</span>
                        )
                      )}
                      {l.email && (
                        <a href={`mailto:${l.email}`} className="inline-flex min-w-0 items-center gap-1 truncate font-medium text-primary hover:underline">
                          <Mail className="size-3.5 shrink-0" aria-hidden /> {l.email}
                        </a>
                      )}
                    </p>
                  )}
                  <p className="truncate text-sm text-muted-foreground">
                    {[l.city, `Enquired ${day(l.enquired_on)}`].filter(Boolean).join(' · ')}
                  </p>
                  {(l.event_type || l.event_date) && (
                    <p className="truncate text-sm text-muted-foreground">
                      {[l.event_type, l.event_date ? day(l.event_date) : null].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-bold', STATUS[l.status])}>{l.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Shell>
  )
}
