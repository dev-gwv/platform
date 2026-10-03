import { useState, type FormEvent } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { enquiryEventTypes, type PublicEnquiryForm } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Input, Label, Select, Textarea } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { toneVar } from '@/shared/ui/tones'
import { FIELD_LABEL, firstMissing, type EnquiryValues } from './form-fields'

export type FormLook = Pick<
  PublicEnquiryForm,
  | 'studio'
  | 'form_name'
  | 'purpose'
  | 'title'
  | 'intro'
  | 'thank_you'
  | 'accent'
  | 'logo_url'
  | 'fields'
>

export interface EnquirySend {
  name: string
  phone: string
  email: string | null
  event_type: string | null
  event_date: string | null
  city: string | null
  budget: number | null
  message: string | null
  website: string
}

/**
 * The form itself, as the person filling it sees it: the studio's logo and
 * words, the fields the studio chose, its colour on the button. The public
 * page, the website embed and the studio's own preview all draw this one.
 * In preview nothing is sent.
 */
export function EnquiryFormView({
  look,
  preview = false,
  onSend,
}: {
  look: FormLook
  preview?: boolean
  onSend?: (body: EnquirySend) => Promise<void>
}) {
  const f = look.fields
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [values, setValues] = useState<EnquiryValues>({})
  // Hidden from people; a bot fills it and the server quietly drops the send.
  const [website, setWebsite] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const accent = look.accent && look.accent !== 'slate' ? toneVar(look.accent) : undefined
  const set = (k: keyof EnquiryValues) => (v: string) => setValues((x) => ({ ...x, [k]: v }))
  const mark = (k: keyof typeof f) =>
    f[k] === 'required' ? <span className="text-destructive"> *</span> : null

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (preview) return
    setError(null)
    if (name.trim().length < 2) return setError('Please tell us your name.')
    if (phone.replace(/\D/g, '').length < 10) return setError('Please enter a valid mobile number.')
    const missing = firstMissing(f, values)
    if (missing) return setError(`Please add ${missing.toLowerCase()}.`)
    const budget = values.budget ? Number(values.budget.replace(/[^\d.]/g, '')) : null
    setBusy(true)
    try {
      await onSend?.({
        name: name.trim(),
        phone: phone.trim(),
        email: values.email?.trim() || null,
        event_type: values.event_type || null,
        event_date: values.event_date || null,
        city: values.city?.trim() || null,
        budget: budget !== null && Number.isFinite(budget) ? budget : null,
        message: values.message?.trim() || null,
        website,
      })
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not send this. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        {look.logo_url && (
          <img
            src={look.logo_url}
            alt=""
            className="size-12 shrink-0 rounded-lg border border-border bg-white object-contain p-1"
          />
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{look.studio}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {look.title || 'Tell us about your event and we will call you back.'}
          </p>
          {look.intro && <p className="mt-1 text-sm text-muted-foreground">{look.intro}</p>}
          {look.purpose === 'vendor' && (
            <StatusBadge tone="info" className="mt-2">
              via {look.form_name}
            </StatusBadge>
          )}
        </div>
      </div>

      {done ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <CheckCircle2 className="size-10 text-success" aria-hidden />
          <p className="font-medium">{look.thank_you || 'Thank you, we have your enquiry.'}</p>
          {!look.thank_you && (
            <p className="text-sm text-muted-foreground">{look.studio} will call you soon.</p>
          )}
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="enq-name">
              Your name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="enq-name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
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
          {f.email !== 'off' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="enq-email">
                {FIELD_LABEL.email}
                {mark('email')}
              </Label>
              <Input
                id="enq-email"
                type="email"
                autoComplete="email"
                value={values.email ?? ''}
                onChange={(e) => set('email')(e.target.value)}
              />
            </div>
          )}
          {(f.event_type !== 'off' || f.event_date !== 'off') && (
            <div className="grid grid-cols-2 gap-3">
              {f.event_type !== 'off' && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="enq-event">
                    {FIELD_LABEL.event_type}
                    {mark('event_type')}
                  </Label>
                  <Select
                    id="enq-event"
                    value={values.event_type ?? ''}
                    onChange={(e) => set('event_type')(e.target.value)}
                  >
                    <option value="">Choose</option>
                    {enquiryEventTypes.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              {f.event_date !== 'off' && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="enq-date">
                    {FIELD_LABEL.event_date}
                    {mark('event_date')}
                  </Label>
                  <Input
                    id="enq-date"
                    type="date"
                    value={values.event_date ?? ''}
                    onChange={(e) => set('event_date')(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}
          {(f.city !== 'off' || f.budget !== 'off') && (
            <div className="grid grid-cols-2 gap-3">
              {f.city !== 'off' && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="enq-city">
                    {FIELD_LABEL.city}
                    {mark('city')}
                  </Label>
                  <Input
                    id="enq-city"
                    value={values.city ?? ''}
                    onChange={(e) => set('city')(e.target.value)}
                  />
                </div>
              )}
              {f.budget !== 'off' && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="enq-budget">
                    {FIELD_LABEL.budget} (₹){mark('budget')}
                  </Label>
                  <Input
                    id="enq-budget"
                    inputMode="numeric"
                    placeholder="e.g. 1,50,000"
                    value={values.budget ?? ''}
                    onChange={(e) => set('budget')(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}
          {f.message !== 'off' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="enq-msg">
                {FIELD_LABEL.message}
                {mark('message')}
              </Label>
              <Textarea
                id="enq-msg"
                rows={3}
                value={values.message ?? ''}
                onChange={(e) => set('message')(e.target.value)}
              />
            </div>
          )}
          <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label>
              Website
              <input
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </label>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            type="submit"
            size="lg"
            disabled={busy || preview}
            style={accent ? { backgroundColor: accent, borderColor: accent } : undefined}
          >
            {busy ? 'Sending…' : 'Send enquiry'}
          </Button>
        </form>
      )}
    </div>
  )
}
