import { useEffect, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { ENQUIRY_HEIGHT_MESSAGE } from '@ipc/domain'
import {
  publicEnquiryForm,
  publicEnquiryView,
  z,
  type PublicEnquiryForm,
  type PublicEnquiryView,
} from '@ipc/contracts'
import { callApi, ApiError } from '@/shared/api/client'
import { PageBackdrop } from '@/shared/brand/PageBackdrop'
import { Card, CardContent } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'
import { EnquiryFormView, type EnquirySend } from '@/features/enquiry-forms/EnquiryFormView'
import { StatusBadge } from '@/shared/ui/status-badge'

const ok = z.object({ ok: z.boolean() })

function Shell({ children, embed = false }: { children: React.ReactNode; embed?: boolean }) {
  // On a studio's own website the form sits in their page: no backdrop, and
  // the frame is told how tall it is so it never scrolls inside itself.
  useEffect(() => {
    if (!embed || window.parent === window) return
    const send = () =>
      window.parent.postMessage(
        { type: ENQUIRY_HEIGHT_MESSAGE, height: Math.ceil(document.documentElement.scrollHeight) },
        '*',
      )
    send()
    const ro = new ResizeObserver(send)
    ro.observe(document.body)
    return () => ro.disconnect()
  }, [embed])
  if (embed) return <div className="bg-background p-1 font-sans">{children}</div>
  return (
    <div className="relative flex min-h-screen items-start justify-center bg-background p-4 font-sans sm:items-center">
      <PageBackdrop />
      <Card className="relative z-10 w-full max-w-md">
        <CardContent className="flex flex-col gap-5 p-5">{children}</CardContent>
      </Card>
    </div>
  )
}

/**
 * PUBLIC: an enquiry form (0195, built by the studio since 0240). A vendor's
 * QR or the studio's own website opens it; what is sent lands in Leads,
 * credited to the form. `?embed=1` is the version framed on a website.
 */
export function EnquirePage() {
  const { code } = useParams({ from: '/enquire/$code' })
  const embed = new URLSearchParams(window.location.search).get('embed') === '1'
  const [form, setForm] = useState<PublicEnquiryForm | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    callApi(`/public/enquiry/${encodeURIComponent(code)}`, { responseSchema: publicEnquiryForm })
      .then(setForm)
      .catch(() => setMissing(true))
  }, [code])

  async function send(body: EnquirySend) {
    try {
      await callApi(`/public/enquiry/${encodeURIComponent(code)}`, {
        method: 'POST',
        body,
        responseSchema: ok,
      })
    } catch (err) {
      throw new Error(
        err instanceof ApiError ? err.message : 'We could not send this. Please try again.',
      )
    }
  }

  if (missing || (form && !form.is_open)) {
    return (
      <Shell embed={embed}>
        <div className="py-6 text-center">
          <p className="font-medium">This form isn't available</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {form
              ? `${form.studio} is not taking enquiries on this form right now.`
              : 'The link may be wrong or no longer in use.'}
          </p>
        </div>
      </Shell>
    )
  }
  if (!form) {
    return (
      <Shell embed={embed}>
        <Skeleton className="h-72" />
      </Shell>
    )
  }

  return (
    <Shell embed={embed}>
      <EnquiryFormView look={form} onSend={send} />
    </Shell>
  )
}

const TONE: Record<
  PublicEnquiryView['leads'][number]['status'],
  'neutral' | 'info' | 'success' | 'danger'
> = {
  New: 'neutral',
  'In talks': 'info',
  Booked: 'success',
  'Not booked': 'danger',
}

/**
 * PUBLIC: the vendor's own page. What their QR brought in and where each
 * enquiry stands, so neither side has to take the other's word for it.
 */
export function EnquiryViewPage() {
  const { token } = useParams({ from: '/enquiry-view/$token' })
  const [view, setView] = useState<PublicEnquiryView | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    callApi(`/public/enquiry-view/${encodeURIComponent(token)}`, {
      responseSchema: publicEnquiryView,
    })
      .then(setView)
      .catch(() => setMissing(true))
  }, [token])

  if (missing) {
    return (
      <Shell>
        <div className="py-6 text-center">
          <p className="font-medium">This page isn't available</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Please ask the studio for a new link.
          </p>
        </div>
      </Shell>
    )
  }
  if (!view) {
    return (
      <Shell>
        <Skeleton className="h-72" />
      </Shell>
    )
  }

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <Shell>
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{view.studio}</p>
        <h1 className="text-xl font-semibold tracking-tight">Enquiries via {view.form_name}</h1>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          [view.scans, 'Scans'],
          [view.enquiries, 'Enquiries'],
          [view.booked, 'Booked'],
        ].map(([v, l]) => (
          <div key={l} className="rounded-lg bg-muted/40 p-3">
            <p className="text-xl font-semibold tabular-nums">{v}</p>
            <p className="text-xs text-muted-foreground">{l}</p>
          </div>
        ))}
      </div>
      {view.leads.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          No enquiries yet. They will show here as they come in.
        </p>
      ) : (
        <ul className="-mx-1 flex flex-col divide-y divide-border">
          {view.leads.map((l, i) => (
            <li key={i} className="flex items-center gap-3 px-1 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{l.name ?? 'No name'}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[l.phone, l.event_type, l.event_date ? fmt(l.event_date) : null]
                    .filter(Boolean)
                    .join(' · ') || `Enquired ${fmt(l.enquired_on)}`}
                </p>
              </div>
              <StatusBadge tone={TONE[l.status]}>{l.status}</StatusBadge>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  )
}
