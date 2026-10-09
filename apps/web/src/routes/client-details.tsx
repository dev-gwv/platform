import { useEffect, useState, type FormEvent } from 'react'
import { useParams } from '@tanstack/react-router'
import { CheckCircle2, Plus, X } from 'lucide-react'
import {
  clientDetailsResult,
  publicClientDetails,
  type ClientDetailsRequest,
  type DetailsDate,
  type PublicClientDetails,
} from '@ipc/contracts'
import { callApi, ApiError } from '@/shared/api/client'
import { PageBackdrop } from '@/shared/brand/PageBackdrop'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label, Select } from '@/shared/ui/input'
import { Skeleton } from '@/shared/ui/skeleton'
import { cn } from '@/shared/ui/cn'
import { foregroundForHex } from '@/shared/theme/presets'
import { MONTHS } from '@/features/wishes/OccasionForm'
import { guestsValue } from '@/features/shoots/guests'

const EVENT_PICKS = ['Haldi', 'Mehendi', 'Sangeet', 'Wedding', 'Reception', 'Engagement', 'Pre-wedding'] as const
const OCCASIONS = ['Wedding', 'Engagement', 'Pre-wedding', 'Birthday'] as const

interface DateDraft {
  day: string
  month: string
  year: string
}
interface EventDraft {
  name: string
  date: string
  start_time: string
  hours: string
  venue: string
  guests: string
}
const noDate: DateDraft = { day: '', month: '', year: '' }
const noEvent: EventDraft = { name: '', date: '', start_time: '', hours: '', venue: '', guests: '' }

const toDraft = (o?: { day: number; month: number; year: number | null }): DateDraft =>
  o ? { day: String(o.day), month: String(o.month), year: o.year ? String(o.year) : '' } : noDate

/** A day and month the client filled; null while either is missing. */
export function readDate(d: DateDraft): DetailsDate | null {
  const day = Number(d.day)
  const month = Number(d.month)
  if (!day || !month || day > 31) return null
  const year = d.year.length === 4 ? Number(d.year) : null
  return { day, month, year }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-start justify-center bg-background p-4 font-sans sm:py-10">
      <PageBackdrop />
      <Card className="relative z-10 w-full max-w-lg">
        <CardContent className="flex flex-col gap-6 p-5">{children}</CardContent>
      </Card>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}

/** Day · Month · Year (if known), on one line. */
function DateRow({ id, label, value, onChange }: { id: string; label: string; value: DateDraft; onChange: (d: DateDraft) => void }) {
  const filled = readDate(value) != null
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`${id}-day`}>{label}</Label>
      <div className="grid grid-cols-[4.5rem_1fr_5.5rem] gap-2">
        <Input
          id={`${id}-day`}
          inputMode="numeric"
          placeholder="Day"
          value={value.day}
          onChange={(e) => onChange({ ...value, day: e.target.value.replace(/\D/g, '').slice(0, 2) })}
          className={cn(filled && 'border-success/60')}
        />
        <Select aria-label={`${label} month`} value={value.month} onChange={(e) => onChange({ ...value, month: e.target.value })} className={cn(filled && 'border-success/60')}>
          <option value="">Month</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={String(i + 1)}>
              {m}
            </option>
          ))}
        </Select>
        <Input
          aria-label={`${label} year`}
          inputMode="numeric"
          placeholder="Year"
          value={value.year}
          onChange={(e) => onChange({ ...value, year: e.target.value.replace(/\D/g, '').slice(0, 4) })}
        />
      </div>
    </div>
  )
}

/**
 * PUBLIC: the details form a client fills (0244). A project's link shows what
 * the studio already knows so the client corrects instead of retyping; the
 * studio's own form (its QR) starts empty and makes the project. The studio's
 * records fill themselves in; nothing here overwrites what the studio typed.
 */
export function ClientDetailsPage() {
  const { token } = useParams({ from: '/details/$token' })
  const [form, setForm] = useState<PublicClientDetails | null>(null)
  const [missing, setMissing] = useState(false)

  const [name, setName] = useState('')
  const [partner, setPartner] = useState('')
  const [phone, setPhone] = useState('')
  const [partnerPhone, setPartnerPhone] = useState('')
  const [email, setEmail] = useState('')
  const [city, setCity] = useState('')
  const [address, setAddress] = useState('')
  const [occasion, setOccasion] = useState('Wedding')
  const [birthday, setBirthday] = useState<DateDraft>(noDate)
  const [partnerBirthday, setPartnerBirthday] = useState<DateDraft>(noDate)
  const [wedding, setWedding] = useState<DateDraft>(noDate)
  const [events, setEvents] = useState<EventDraft[]>([{ ...noEvent }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    callApi(`/public/details/${encodeURIComponent(token)}`, { responseSchema: publicClientDetails })
      .then((f) => {
        setForm(f)
        const p = f.prefill
        if (!p) return
        setName(p.name ?? '')
        setPhone(p.phone ?? '')
        setPartnerPhone(p.partner_phone ?? '')
        setEmail(p.email ?? '')
        setCity(p.city ?? '')
        setAddress(p.address ?? '')
        const first = (p.name ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
        const births = p.occasions.filter((o) => o.kind === 'birthday')
        const mine = births.find((o) => o.person_name.toLowerCase() === first)
        const theirs = births.find((o) => o !== mine)
        if (mine) setBirthday(toDraft(mine))
        if (theirs) {
          setPartner(theirs.person_name)
          setPartnerBirthday(toDraft(theirs))
        }
        const ann = p.occasions.find((o) => o.kind === 'anniversary')
        if (ann) setWedding(toDraft(ann))
        if (p.events.length > 0) {
          setEvents(
            p.events.map((e) => ({
              name: e.name,
              date: e.date ?? '',
              start_time: e.start_time ?? '',
              hours: e.hours ? String(e.hours) : '',
              venue: e.venue ?? '',
              guests: e.guests ? String(e.guests) : '',
            })),
          )
        }
      })
      .catch(() => setMissing(true))
  }, [token])

  const setEvent = (i: number, patch: Partial<EventDraft>) => setEvents((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (name.trim().length < 2) return setError('Please add your name.')
    if (form?.kind === 'studio' && phone.replace(/\D/g, '').length < 10) return setError('Please add your phone number.')
    const body: ClientDetailsRequest = {
      name: name.trim(),
      partner_name: partner.trim() || undefined,
      phone: phone.trim() || undefined,
      partner_phone: partnerPhone.trim() || undefined,
      email: email.trim() || undefined,
      city: city.trim() || undefined,
      address: address.trim() || undefined,
      occasion: form?.kind === 'studio' ? occasion.trim() || 'Wedding' : undefined,
      birthday: readDate(birthday),
      partner_birthday: partner.trim() ? readDate(partnerBirthday) : null,
      wedding: readDate(wedding),
      events: events
        .filter((x) => x.name.trim())
        .map((x) => ({
          name: x.name.trim(),
          date: x.date || null,
          start_time: x.start_time || null,
          hours: x.hours ? Number(x.hours) : null,
          venue: x.venue.trim() || null,
          guests: guestsValue(x.guests),
        })),
    }
    setBusy(true)
    try {
      await callApi(`/public/details/${encodeURIComponent(token)}`, { method: 'POST', body, responseSchema: clientDetailsResult })
      setDone(true)
      window.scrollTo({ top: 0 })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not send this. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (missing) {
    return (
      <Shell>
        <div className="py-6 text-center">
          <p className="font-medium">This link isn't working</p>
          <p className="mt-1 text-sm text-muted-foreground">Please ask the studio for a new one.</p>
        </div>
      </Shell>
    )
  }
  if (!form) {
    return (
      <Shell>
        <Skeleton className="h-96" />
      </Shell>
    )
  }

  const studio = form.studio
  const brand = studio.brand_color && /^#[0-9a-f]{6}$/i.test(studio.brand_color) ? studio.brand_color : null
  const header = (
    <div className="flex items-center gap-3">
      {studio.logo_url && <img src={studio.logo_url} alt="" className="size-12 rounded-lg object-contain" />}
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{studio.name}</p>
        <h1 className="text-xl font-semibold tracking-tight">{form.project_name ?? 'Your details'}</h1>
      </div>
    </div>
  )

  if (done) {
    return (
      <Shell>
        {header}
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <CheckCircle2 className="size-10 text-success" aria-hidden />
          <p className="text-lg font-semibold">Thank you, {name.trim().split(/\s+/)[0]}!</p>
          <p className="text-sm text-muted-foreground">{studio.name} has your details.</p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      {header}
      <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
        {form.kind === 'studio' && (
          <Section title="What is it for?">
            <div className="flex flex-wrap gap-2">
              {OCCASIONS.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOccasion(o)}
                  aria-pressed={occasion === o}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm',
                    occasion === o ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border bg-card',
                  )}
                >
                  {o}
                </button>
              ))}
            </div>
          </Section>
        )}

        <Section title="About you">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="cd-name" label="Your name *">
              <Input id="cd-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={cn(!name.trim() && 'border-warning/70')} />
            </Field>
            <Field id="cd-phone" label={form.kind === 'studio' ? 'Your phone *' : 'Your phone'}>
              <Input id="cd-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
            </Field>
            <Field id="cd-partner" label="Partner's name">
              <Input id="cd-partner" value={partner} onChange={(e) => setPartner(e.target.value)} />
            </Field>
            <Field id="cd-pphone" label="Partner's phone">
              <Input id="cd-pphone" type="tel" inputMode="tel" value={partnerPhone} onChange={(e) => setPartnerPhone(e.target.value)} />
            </Field>
            <Field id="cd-email" label="Email">
              <Input id="cd-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </Field>
            <Field id="cd-city" label="City">
              <Input id="cd-city" value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" />
            </Field>
            <div className="sm:col-span-2">
              <Field id="cd-address" label="Address">
                <Input id="cd-address" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" />
              </Field>
            </div>
          </div>
        </Section>

        <Section title="Special days">
          <DateRow id="cd-bday" label="Your birthday" value={birthday} onChange={setBirthday} />
          {partner.trim() && (
            <DateRow id="cd-pbday" label={`${partner.trim().split(/\s+/)[0]}'s birthday`} value={partnerBirthday} onChange={setPartnerBirthday} />
          )}
          <DateRow id="cd-wedding" label="Wedding date" value={wedding} onChange={setWedding} />
        </Section>

        <Section title="Your events">
          <div className="flex flex-col gap-3">
            {events.map((ev, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center gap-2">
                  <Input
                    aria-label="Event"
                    placeholder="e.g. Haldi"
                    value={ev.name}
                    onChange={(e) => setEvent(i, { name: e.target.value })}
                    list="cd-event-picks"
                    className="flex-1"
                  />
                  {events.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" aria-label="Remove this event" onClick={() => setEvents((xs) => xs.filter((_, j) => j !== i))}>
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
                {!ev.name && (
                  <div className="flex flex-wrap gap-1.5">
                    {EVENT_PICKS.filter((p) => !events.some((x) => x.name === p)).map((p) => (
                      <button key={p} type="button" onClick={() => setEvent(i, { name: p })} className="rounded-full border border-border bg-card px-2.5 py-1 text-xs">
                        {p}
                      </button>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-[1fr_6.5rem_5rem] gap-2">
                  <Input aria-label="Date" type="date" value={ev.date} onChange={(e) => setEvent(i, { date: e.target.value })} />
                  <Input aria-label="Start time" type="time" value={ev.start_time} onChange={(e) => setEvent(i, { start_time: e.target.value })} />
                  <Select aria-label="Hours" value={ev.hours} onChange={(e) => setEvent(i, { hours: e.target.value })}>
                    <option value="">Hours</option>
                    {Array.from({ length: 12 }, (_, h) => h + 1).map((h) => (
                      <option key={h} value={String(h)}>
                        {h} h
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="grid grid-cols-[1fr_6.5rem] gap-2">
                  <Input aria-label="Venue" placeholder="Venue" value={ev.venue} onChange={(e) => setEvent(i, { venue: e.target.value })} />
                  <Input
                    aria-label="Guests"
                    placeholder="Guests"
                    inputMode="numeric"
                    value={ev.guests}
                    onChange={(e) => setEvent(i, { guests: e.target.value.replace(/[^\d]/g, '').slice(0, 6) })}
                  />
                </div>
              </div>
            ))}
            {events.length < 12 && (
              <Button type="button" variant="outline" className="self-start" onClick={() => setEvents((xs) => [...xs, { ...noEvent }])}>
                <Plus className="size-4" /> Add another event
              </Button>
            )}
          </div>
          <datalist id="cd-event-picks">
            {EVENT_PICKS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </Section>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-col gap-2">
          <Button
            type="submit"
            size="lg"
            disabled={busy}
            style={brand ? { background: brand, color: foregroundForHex(brand) } : undefined}
          >
            {busy ? 'Sending…' : form.submitted ? 'Send again' : 'Send'}
          </Button>
          <p className="text-center text-xs text-muted-foreground">{studio.name} will use these dates to send you wishes.</p>
        </div>
      </form>
    </Shell>
  )
}
