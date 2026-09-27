import { useEffect, useState, type FormEvent } from 'react'
import { useParams } from '@tanstack/react-router'
import { CheckCircle2 } from 'lucide-react'
import { enquiryEventTypes, publicEnquiryForm, publicEnquiryView, z, type PublicEnquiryForm, type PublicEnquiryView } from '@ipc/contracts'
import { callApi, ApiError } from '@/shared/api/client'
import { PageBackdrop } from '@/shared/brand/PageBackdrop'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label, Select } from '@/shared/ui/input'
import { Skeleton } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'

const ok = z.object({ ok: z.boolean() })

function Shell({ children }: { children: React.ReactNode }) {
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
 * PUBLIC: what a QR on a vendor's counter opens. The studio's name, a short
 * form, and a thank-you. The enquiry lands in the studio's Leads credited to
 * the vendor whose QR it was.
 */
export function EnquirePage() {
  const { code } = useParams({ from: '/enquire/$code' })
  const [form, setForm] = useState<PublicEnquiryForm | null>(null)
  const [missing, setMissing] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [eventType, setEventType] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [city, setCity] = useState('')
  const [message, setMessage] = useState('')
  // Hidden from people; a bot fills it and the server quietly drops the send.
  const [website, setWebsite] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    callApi(`/public/enquiry/${encodeURIComponent(code)}`, { responseSchema: publicEnquiryForm })
      .then(setForm)
      .catch(() => setMissing(true))
  }, [code])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (name.trim().length < 2) return setError('Please tell us your name.')
    if (phone.replace(/\D/g, '').length < 10) return setError('Please enter a valid mobile number.')
    setBusy(true)
    try {
      await callApi(`/public/enquiry/${encodeURIComponent(code)}`, {
        method: 'POST',
        body: {
          name: name.trim(),
          phone: phone.trim(),
          event_type: eventType || null,
          event_date: eventDate || null,
          city: city.trim() || null,
          message: message.trim() || null,
          website,
        },
        responseSchema: ok,
      })
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not send this. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (missing || (form && !form.is_open)) {
    return (
      <Shell>
        <div className="py-6 text-center">
          <p className="font-medium">This form isn't available</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {form ? `${form.studio} is not taking enquiries on this QR right now.` : 'The link may be wrong or no longer in use.'}
          </p>
        </div>
      </Shell>
    )
  }
  if (!form) {
    return (
      <Shell>
        <Skeleton className="h-72" />
      </Shell>
    )
  }

  return (
    <Shell>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{form.studio}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Tell us about your event and we will call you back.</p>
        <StatusBadge tone="info" className="mt-2">
          via {form.form_name}
        </StatusBadge>
      </div>

      {done ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <CheckCircle2 className="size-10 text-success" aria-hidden />
          <p className="font-medium">Thank you, we have your enquiry.</p>
          <p className="text-sm text-muted-foreground">{form.studio} will call you soon.</p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="enq-name">
              Your name <span className="text-destructive">*</span>
            </Label>
            <Input id="enq-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="enq-phone">
              Mobile number <span className="text-destructive">*</span>
            </Label>
            <Input
              id="enq-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="98765 43210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="enq-event">Event</Label>
              <Select id="enq-event" value={eventType} onChange={(e) => setEventType(e.target.value)}>
                <option value="">Choose</option>
                {enquiryEventTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="enq-date">Date</Label>
              <Input id="enq-date" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="enq-city">City</Label>
            <Input id="enq-city" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="enq-msg">Anything else?</Label>
            <textarea
              id="enq-msg"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label>
              Website
              <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </label>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? 'Sending…' : 'Send enquiry'}
          </Button>
        </form>
      )}
    </Shell>
  )
}

const TONE: Record<PublicEnquiryView['leads'][number]['status'], 'neutral' | 'info' | 'success' | 'danger'> = {
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
    callApi(`/public/enquiry-view/${encodeURIComponent(token)}`, { responseSchema: publicEnquiryView })
      .then(setView)
      .catch(() => setMissing(true))
  }, [token])

  if (missing) {
    return (
      <Shell>
        <div className="py-6 text-center">
          <p className="font-medium">This page isn't available</p>
          <p className="mt-1 text-sm text-muted-foreground">Please ask the studio for a new link.</p>
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

  const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

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
        <p className="py-4 text-center text-sm text-muted-foreground">No enquiries yet. They will show here as they come in.</p>
      ) : (
        <ul className="-mx-1 flex flex-col divide-y divide-border">
          {view.leads.map((l, i) => (
            <li key={i} className="flex items-center gap-3 px-1 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{l.name ?? 'No name'}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[l.phone, l.event_type, l.event_date ? fmt(l.event_date) : null].filter(Boolean).join(' · ') ||
                    `Enquired ${fmt(l.enquired_on)}`}
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
