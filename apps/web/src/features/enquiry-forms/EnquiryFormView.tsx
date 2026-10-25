import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { CalendarHeart, Check, CircleCheck, ExternalLink, Handshake, MessageCircle } from 'lucide-react'
import { enquiryEventTypes, type PublicEnquiryFormV2 } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Input, Label, Select, Textarea } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { toneVar } from '@/shared/ui/tones'
import { FIELD_LABEL, checkEnquiry, type EnquiryValues, type FieldErrors } from './form-fields'

type FormLook = Pick<
  PublicEnquiryFormV2,
  'studio' | 'form_name' | 'purpose' | 'title' | 'intro' | 'thank_you' | 'accent' | 'logo_url' | 'fields'
> &
  Partial<Pick<PublicEnquiryFormV2, 'city' | 'services' | 'event_types' | 'partner' | 'goes_to' | 'occasion' | 'questions'>>

export interface EnquirySend {
  name: string
  phone: string
  email: string | null
  event_type: string | null
  event_date: string | null
  city: string | null
  services: string[] | null
  guests: number | null
  budget: number | null
  message: string | null
  website: string
  /** A partner QR's own questions, answered (0281). */
  answers?: Record<string, string> | null
}

/** Field errors, plus "q:<id>" for a partner QR's own questions. */
type SendErrors = FieldErrors & Record<string, string | undefined>

/** What the server says about a send it refused: one message, and a word per field. */
export class EnquirySendError extends Error {
  constructor(
    message: string,
    readonly fields: SendErrors = {},
  ) {
    super(message)
  }
}

const num = (s: string | undefined) => {
  const n = s ? Number(s.replace(/[^\d.]/g, '')) : NaN
  return Number.isFinite(n) && s ? n : null
}

/**
 * The form itself, as the client sees it (spec 3.9, 3.10): the studio's name
 * and logo, "Sent via <partner>" through a partner's QR, the questions the
 * studio chose, then a thank-you that takes them straight into a WhatsApp
 * chat with the studio. The public page, the website embed and the studio's
 * own preview all draw this one; in preview nothing is sent.
 */
export function EnquiryFormView({
  look,
  preview = false,
  embed = false,
  onSend,
}: {
  look: FormLook
  preview?: boolean
  embed?: boolean
  onSend?: (body: EnquirySend) => Promise<{ redirect_url: string | null }>
}) {
  const f = look.fields
  const services = look.services ?? []
  const events = look.event_types?.length ? look.event_types : [...enquiryEventTypes]
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [values, setValues] = useState<EnquiryValues>({})
  // Hidden from people; a bot fills it and the server quietly drops the send.
  const [website, setWebsite] = useState('')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<SendErrors>({})
  const questions = look.questions ?? []
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [done, setDone] = useState<{ redirect: string | null } | null>(null)
  const accent = look.accent && look.accent !== 'slate' ? toneVar(look.accent) : undefined
  const set = (k: Exclude<keyof EnquiryValues, 'services'>) => (v: string) => setValues((x) => ({ ...x, [k]: v }))
  const label = (k: keyof typeof f, text = FIELD_LABEL[k]) => (f[k] === 'required' ? text : `${text} (optional)`)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (preview) return
    setNotice(null)
    const found: SendErrors = checkEnquiry(f, name, phone, values)
    for (const q of questions) {
      if (q.required && !(answers[q.id] ?? '').trim()) found[`q:${q.id}`] = q.kind === 'choice' ? 'Pick one' : 'Please fill this in'
    }
    setErrors(found)
    if (Object.keys(found).length) {
      focusFirstError(found)
      return
    }
    setBusy(true)
    try {
      const res = await onSend?.({
        name: name.trim(),
        phone: phone.trim(),
        email: values.email?.trim() || null,
        event_type: values.event_type || null,
        event_date: values.event_date || null,
        city: values.city?.trim() || null,
        services: values.services?.length ? values.services : null,
        guests: num(values.guests),
        budget: num(values.budget),
        message: values.message?.trim() || null,
        website,
        answers: questions.length
          ? Object.fromEntries(questions.map((q) => [q.id, (answers[q.id] ?? '').trim()]).filter(([, a]) => a))
          : null,
      })
      setDone({ redirect: res?.redirect_url ?? null })
    } catch (err) {
      if (err instanceof EnquirySendError && Object.keys(err.fields).length) {
        setErrors(err.fields)
        focusFirstError(err.fields)
      }
      else setNotice(err instanceof Error ? err.message : 'We could not send this. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col items-center gap-2 text-center">
        {look.logo_url && (
          <img
            src={look.logo_url}
            alt=""
            className="size-16 rounded-2xl border border-border bg-white object-contain p-1.5 shadow-sm"
          />
        )}
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{look.studio}</h1>
        {look.city && <p className="text-sm text-muted-foreground">{look.city}</p>}
        {look.partner && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-card/80 px-3 py-1 text-sm font-semibold text-primary ring-1 ring-brand/50">
            <Handshake className="size-4" aria-hidden /> Sent via {look.partner}
          </span>
        )}
        {look.occasion && (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
            <CalendarHeart className="size-4 text-primary" aria-hidden /> {look.occasion}
          </span>
        )}
      </header>

      <section className={cn('rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7', embed && 'shadow-none')}>
        {done ? (
          <ThankYou look={look} redirect={done.redirect} embed={embed} />
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <div>
              <h2 className="text-xl font-extrabold tracking-tight">{look.title || 'Tell us about your event'}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{look.intro || 'We usually reply the same day.'}</p>
            </div>

            <Field id="enq-name" label="Your name" error={errors.name}>
              <Input
                id="enq-name"
                autoComplete="name"
                className="h-12"
                value={name}
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? 'enq-name-note' : undefined}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field id="enq-phone" label="Mobile number" hint="We'll reach you on WhatsApp or a call." error={errors.phone}>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-base text-muted-foreground">
                  +91
                </span>
                <Input
                  id="enq-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder="98765 43210"
                  className="h-12 pl-12 tabular-nums"
                  value={phone}
                  aria-invalid={!!errors.phone}
                  aria-describedby="enq-phone-note"
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </Field>

            {f.email !== 'off' && (
              <Field id="enq-email" label={label('email')} error={errors.email}>
                <Input
                  id="enq-email"
                  type="email"
                  autoComplete="email"
                  className="h-12"
                  value={values.email ?? ''}
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? 'enq-email-note' : undefined}
                  onChange={(e) => set('email')(e.target.value)}
                />
              </Field>
            )}

            {(f.event_type !== 'off' || f.event_date !== 'off') && (
              <div className={cn('grid gap-3', f.event_type !== 'off' && f.event_date !== 'off' && 'grid-cols-2')}>
                {f.event_type !== 'off' && (
                  <Field id="enq-event" label={label('event_type')} error={errors.event_type}>
                    <Select
                      id="enq-event"
                      className="[&_button]:h-12"
                      value={values.event_type ?? ''}
                      aria-invalid={!!errors.event_type}
                      aria-describedby={errors.event_type ? 'enq-event-note' : undefined}
                      onChange={(e) => set('event_type')(e.target.value)}
                    >
                      <option value="">Choose</option>
                      {events.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {f.event_date !== 'off' && (
                  <Field id="enq-date" label={label('event_date')} error={errors.event_date}>
                    <Input
                      id="enq-date"
                      type="date"
                      className="h-12"
                      value={values.event_date ?? ''}
                      aria-invalid={!!errors.event_date}
                      aria-describedby={errors.event_date ? 'enq-date-note' : undefined}
                      onChange={(e) => set('event_date')(e.target.value)}
                    />
                  </Field>
                )}
              </div>
            )}

            {f.city !== 'off' && (
              <Field id="enq-city" label={label('city')} error={errors.city}>
                <Input
                  id="enq-city"
                  maxLength={60}
                  autoComplete="address-level2"
                  className="h-12"
                  value={values.city ?? ''}
                  aria-invalid={!!errors.city}
                  aria-describedby={errors.city ? 'enq-city-note' : undefined}
                  onChange={(e) => set('city')(e.target.value)}
                />
              </Field>
            )}

            {f.services !== 'off' && services.length > 0 && (
              <fieldset
                id="enq-services"
                tabIndex={-1}
                aria-describedby="enq-services-note"
                aria-invalid={!!errors.services}
                className="flex flex-col gap-1.5 outline-none"
              >
                <legend className="mb-1.5 text-sm font-semibold">{label('services')}</legend>
                <div className="flex flex-wrap gap-2">
                  {services.map((s) => {
                    const on = (values.services ?? []).includes(s)
                    return (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setValues((x) => ({
                            ...x,
                            services: on ? (x.services ?? []).filter((v) => v !== s) : [...(x.services ?? []), s],
                          }))
                        }
                        className={cn(
                          'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors',
                          on
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-input bg-card hover:border-brand',
                        )}
                      >
                        {on && <Check className="size-4" aria-hidden />}
                        {s}
                      </button>
                    )
                  })}
                </div>
                <p id="enq-services-note" className={cn('text-xs', errors.services ? 'text-destructive' : 'text-muted-foreground')}>
                  {errors.services ?? 'Tick all that apply.'}
                </p>
              </fieldset>
            )}

            {(f.guests !== 'off' || f.budget !== 'off') && (
              <div className={cn('grid gap-3', f.guests !== 'off' && f.budget !== 'off' && 'grid-cols-2')}>
                {f.guests !== 'off' && (
                  <Field id="enq-guests" label={label('guests')} error={errors.guests}>
                    <Input
                      id="enq-guests"
                      inputMode="numeric"
                      placeholder="300"
                      className="h-12 tabular-nums"
                      value={values.guests ?? ''}
                      aria-invalid={!!errors.guests}
                      aria-describedby={errors.guests ? 'enq-guests-note' : undefined}
                      onChange={(e) => set('guests')(e.target.value.replace(/[^\d]/g, ''))}
                    />
                  </Field>
                )}
                {f.budget !== 'off' && (
                  <Field id="enq-budget" label={label('budget')} error={errors.budget}>
                    <Input
                      id="enq-budget"
                      inputMode="numeric"
                      placeholder="5,00,000"
                      className="h-12 tabular-nums"
                      value={values.budget ?? ''}
                      aria-invalid={!!errors.budget}
                      aria-describedby={errors.budget ? 'enq-budget-note' : undefined}
                      onChange={(e) => set('budget')(e.target.value)}
                    />
                  </Field>
                )}
              </div>
            )}

            {f.message !== 'off' && (
              <Field id="enq-msg" label={label('message')} error={errors.message}>
                <Textarea
                  id="enq-msg"
                  rows={3}
                  maxLength={1000}
                  placeholder="Venue, number of people, what you're looking for"
                  value={values.message ?? ''}
                  aria-invalid={!!errors.message}
                  aria-describedby={errors.message ? 'enq-msg-note' : undefined}
                  onChange={(e) => set('message')(e.target.value)}
                />
              </Field>
            )}

            {/* A partner QR's own questions (0281), after the form's. */}
            {questions.map((q) => {
              const id = `enq-q-${q.id}`
              const err = errors[`q:${q.id}`]
              const title = q.required ? q.label : `${q.label} (optional)`
              if (q.kind === 'text')
                return (
                  <Field key={q.id} id={id} label={title} error={err}>
                    <Input
                      id={id}
                      maxLength={500}
                      value={answers[q.id] ?? ''}
                      aria-invalid={!!err}
                      aria-describedby={err ? `${id}-note` : undefined}
                      onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                    />
                  </Field>
                )
              return (
                <fieldset key={q.id} id={id} tabIndex={-1} aria-invalid={!!err} className="flex flex-col gap-1.5 outline-none">
                  <legend className="mb-1.5 text-sm font-semibold">{title}</legend>
                  <div className="flex flex-wrap gap-2" role="radiogroup">
                    {q.options.map((o) => {
                      const on = answers[q.id] === o
                      return (
                        <button
                          key={o}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => setAnswers((a) => ({ ...a, [q.id]: on ? '' : o }))}
                          className={cn(
                            'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors',
                            on ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card hover:border-brand',
                          )}
                        >
                          {on && <Check className="size-4" aria-hidden />}
                          {o}
                        </button>
                      )
                    })}
                  </div>
                  {err && <p className="text-xs text-destructive">{err}</p>}
                </fieldset>
              )
            })}

            <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>
                Website
                <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </label>
            </div>
            {notice && (
              <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {notice}
              </p>
            )}
            <Button
              type="submit"
              size="lg"
              className="h-13 w-full text-base font-bold"
              disabled={busy || preview}
              aria-busy={busy}
              style={accent ? { backgroundColor: accent, borderColor: accent } : undefined}
            >
              {busy ? 'Sending…' : 'Send enquiry'}
            </Button>
          </form>
        )}
      </section>
    </div>
  )
}

/** Each answer's box, in the order the form shows them. */
const FIELD_IDS: [keyof FieldErrors, string][] = [
  ['name', 'enq-name'],
  ['phone', 'enq-phone'],
  ['email', 'enq-email'],
  ['event_type', 'enq-event'],
  ['event_date', 'enq-date'],
  ['city', 'enq-city'],
  ['services', 'enq-services'],
  ['guests', 'enq-guests'],
  ['budget', 'enq-budget'],
  ['message', 'enq-msg'],
]

/** Send refused: the cursor goes to the first answer to fix, so a phone scrolls to it. */
function focusFirstError(errors: SendErrors) {
  const first = FIELD_IDS.find(([k]) => errors[k])?.[1] ?? Object.keys(errors).find((k) => k.startsWith('q:') && errors[k])?.replace('q:', 'enq-q-')
  if (!first) return
  // After the error text has been drawn, so the box is where it will stay.
  window.requestAnimationFrame(() => document.getElementById(first)?.focus())
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string | undefined; error?: string | undefined; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="font-semibold">
        {label}
      </Label>
      {children}
      {(error || hint) && (
        <p id={`${id}-note`} className={cn('text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>
          {error ?? hint}
        </p>
      )}
    </div>
  )
}

/**
 * "Thank you!", then straight into the chat: a same-tab jump after 1.5 s,
 * with the button as the fallback when a phone blocks it (spec 3.10). In a
 * website's frame the jump takes the whole page, not just the frame.
 */
function ThankYou({ look, redirect, embed }: { look: FormLook; redirect: string | null; embed: boolean }) {
  const toWhatsApp = !!redirect && /^https:\/\/wa\.me\//.test(redirect)
  useEffect(() => {
    if (!redirect) return
    const t = window.setTimeout(() => {
      try {
        if (embed && window.top) window.top.location.assign(redirect)
        else window.location.assign(redirect)
      } catch {
        // A frame may not be allowed to move the page; the button still works.
      }
    }, 1500)
    return () => window.clearTimeout(t)
  }, [redirect, embed])

  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-success/15">
        <CircleCheck className="size-7 text-success" aria-hidden />
      </span>
      <p className="text-xl font-extrabold tracking-tight">Thank you!</p>
      {redirect ? (
        <>
          <p className="max-w-sm text-sm text-muted-foreground">
            {toWhatsApp
              ? `Opening WhatsApp, so you can chat with ${look.studio} right away…`
              : `Taking you to ${look.studio}…`}
          </p>
          <Button size="lg" className="mt-2 w-full text-base font-bold" asChild>
            <a href={redirect} target={embed ? '_top' : undefined} rel="noreferrer">
              {toWhatsApp ? <MessageCircle /> : <ExternalLink />}
              {toWhatsApp ? 'Chat on WhatsApp' : 'Continue'}
            </a>
          </Button>
        </>
      ) : (
        <p className="max-w-sm text-sm text-muted-foreground">
          {look.thank_you || `${look.studio} has your details and will get in touch with you soon.`}
        </p>
      )}
    </div>
  )
}
