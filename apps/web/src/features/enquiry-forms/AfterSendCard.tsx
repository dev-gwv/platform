import { useState, type ReactNode } from 'react'
import { CircleCheck, Copy, ExternalLink, Link2, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { EnquiryAfterSubmit, EnquiryForm, EnquiryPartner } from '@ipc/contracts'
import { formatIndianPhone, waDigits, whatsappPreview } from '@ipc/domain'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label, Textarea } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { fieldOf, useUpdateEnquiryForm, useUpdatePartner } from './api'

const CHOICES: { key: EnquiryAfterSubmit; title: string; line: string; icon: ReactNode; best?: boolean }[] = [
  {
    key: 'whatsapp',
    title: 'Chat with you on WhatsApp',
    line: 'WhatsApp opens with their enquiry typed in. One tap sends it to you.',
    icon: <MessageCircle className="size-4" aria-hidden />,
    best: true,
  },
  {
    key: 'thanks',
    title: 'Just say thank you',
    line: 'A thank-you message, and you call them back.',
    icon: <CircleCheck className="size-4" aria-hidden />,
  },
  {
    key: 'link',
    title: 'Open a link',
    line: 'Your WhatsApp Business short link, a WhatsApp group, Instagram or your website.',
    icon: <Link2 className="size-4" aria-hidden />,
  },
]

const tenOf = (p: string | null | undefined) => (p ?? '').replace(/\D/g, '').slice(-10)

type Choice = EnquiryAfterSubmit | 'same'
type Values = { after: Choice; phone: string; text: string; link: string; thanks: string }

/** "WhatsApp chat", "a thank-you", "opens a link": the main form's choice in a few words. */
export function afterSendWords(after: EnquiryAfterSubmit): string {
  return after === 'whatsapp' ? 'a WhatsApp chat with you' : after === 'link' ? 'the link you set' : 'a thank-you'
}

/**
 * Where a client lands after sending (spec 3.2): a WhatsApp chat with the
 * studio (the default), a plain thank-you, or a link the studio chooses.
 * This is the main form's, which every partner QR follows unless it has its own.
 */
export function AfterSendCard({ form, studio, defaultPhone }: { form: EnquiryForm; studio: string; defaultPhone: string | null }) {
  const update = useUpdateEnquiryForm(form.id)
  return (
    <AfterSendEditor
      studio={studio}
      fallbackPhone={defaultPhone}
      pending={update.isPending}
      start={{
        after: form.after_submit,
        phone: tenOf(form.whatsapp_phone),
        text: form.whatsapp_text ?? '',
        link: form.redirect_url ?? '',
        thanks: form.thank_you ?? '',
      }}
      save={(v, done, failed) =>
        update.mutate(
          {
            after_submit: v.after as EnquiryAfterSubmit,
            whatsapp_phone: v.phone.trim() ? v.phone : null,
            whatsapp_text: v.text.trim() || null,
            redirect_url: v.link.trim() || null,
            thank_you: v.thanks.trim() || null,
          },
          { onSuccess: done, onError: failed },
        )
      }
    />
  )
}

/**
 * One partner's QR, after they send (owner, 25 Oct: "sometimes we need to send
 * some unique links to different QR codes"). "Same as your main form" until the
 * studio picks something else; an empty number or message falls back to the
 * main form's, then the studio's own number (0281).
 */
export function PartnerAfterSendCard({
  partner,
  form,
  studio,
  defaultPhone,
}: {
  partner: EnquiryPartner
  form: EnquiryForm
  studio: string
  defaultPhone: string | null
}) {
  const update = useUpdatePartner(partner.id)
  return (
    <AfterSendEditor
      studio={studio}
      fallbackPhone={form.whatsapp_phone ?? defaultPhone}
      fallbackText={form.whatsapp_text}
      sameLine={`Like your main form: ${afterSendWords(form.after_submit)}.`}
      pending={update.isPending}
      start={{
        after: partner.after_submit ?? 'same',
        phone: tenOf(partner.whatsapp_phone),
        text: partner.whatsapp_text ?? '',
        link: partner.redirect_url ?? '',
        thanks: partner.thank_you ?? '',
      }}
      save={(v, done, failed) =>
        update.mutate(
          v.after === 'same'
            ? { after_submit: null }
            : {
                after_submit: v.after,
                whatsapp_phone: v.phone.trim() ? v.phone : null,
                whatsapp_text: v.text.trim() || null,
                redirect_url: v.link.trim() || null,
                thank_you: v.thanks.trim() || null,
              },
          { onSuccess: done, onError: failed },
        )
      }
    />
  )
}

function AfterSendEditor({
  start,
  save,
  pending,
  studio,
  fallbackPhone,
  fallbackText = null,
  sameLine,
}: {
  start: Values
  save: (v: Values, done: () => void, failed: (e: unknown) => void) => void
  pending: boolean
  studio: string
  fallbackPhone: string | null
  fallbackText?: string | null
  /** Offers "Same as your main form" first, with what that is. */
  sameLine?: string
}) {
  const [v, setV] = useState(start)
  const [error, setError] = useState<{ field: string; text: string } | null>(null)
  const changed = JSON.stringify(v) !== JSON.stringify(start)
  const defaultPhone = fallbackPhone
  const chatNumber = waDigits(v.phone) ?? waDigits(defaultPhone)
  const choices: { key: Choice; title: string; line: string; icon: ReactNode; best?: boolean }[] = sameLine
    ? [{ key: 'same', title: 'Same as your main form', line: sameLine, icon: <Copy className="size-4" aria-hidden /> }, ...CHOICES.map((c) => ({ ...c, best: false }))]
    : CHOICES

  const onSave = () => {
    setError(null)
    save(
      v,
      () => toast.success(v.after === 'whatsapp' ? 'Saved. After sending the form, people land in a WhatsApp chat with you.' : 'Saved'),
      (e) => {
        const field = fieldOf(e)
        if (field) setError({ field, text: e instanceof Error ? e.message : 'Please check this.' })
      },
    )
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4 sm:p-6">
        <div role="radiogroup" aria-label="After they send the form" className={cn('grid gap-2', sameLine ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>
          {choices.map((c) => {
            const on = v.after === c.key
            return (
              <button
                key={c.key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setV((x) => ({ ...x, after: c.key }))}
                className={cn(
                  'flex flex-col gap-1.5 rounded-2xl border p-4 text-left transition-colors',
                  on ? 'border-primary bg-primary/5 shadow-sm' : 'border-border bg-card hover:border-brand',
                )}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      'grid size-5 shrink-0 place-items-center rounded-full border-2',
                      on ? 'border-primary' : 'border-muted-foreground/40',
                    )}
                  >
                    {on && <span className="size-2.5 rounded-full bg-primary" />}
                  </span>
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    {c.icon} {c.title}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">{c.line}</span>
                {c.best && (
                  <span className="w-fit rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-bold text-success">Best</span>
                )}
              </button>
            )
          })}
        </div>

        {v.after === 'whatsapp' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wa-phone" className="font-semibold">
                Your WhatsApp number
              </Label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">+91</span>
                <Input
                  id="wa-phone"
                  type="tel"
                  inputMode="tel"
                  className={cn('h-11 pl-12 tabular-nums', !v.phone && !defaultPhone && 'border-warning/60')}
                  placeholder={defaultPhone ? tenOf(defaultPhone) : '98765 43210'}
                  value={v.phone}
                  aria-invalid={error?.field === 'whatsapp_phone'}
                  onChange={(e) => setV((x) => ({ ...x, phone: e.target.value }))}
                />
              </div>
              <p className={cn('text-xs', error?.field === 'whatsapp_phone' ? 'text-destructive' : 'text-muted-foreground')}>
                {error?.field === 'whatsapp_phone'
                  ? error.text
                  : v.phone
                    ? 'Chats open with this number.'
                    : defaultPhone
                      ? `Leave it empty to use ${formatIndianPhone(defaultPhone)}.`
                      : 'The number you chat with clients on.'}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wa-text" className="font-semibold">
                Their first message (optional)
              </Label>
              <Textarea
                id="wa-text"
                rows={2}
                maxLength={300}
                placeholder={fallbackText || `Hi ${studio}! I just sent you an enquiry.`}
                value={v.text}
                onChange={(e) => setV((x) => ({ ...x, text: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-semibold text-muted-foreground">What they'll send you</p>
              <p className="whitespace-pre-line rounded-2xl bg-[#E7F8E1] p-4 text-sm text-[#112B1A]">{whatsappPreview(studio, v.text || fallbackText || '')}</p>
              {chatNumber && (
                <a
                  href={`https://wa.me/${chatNumber}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-fit items-center gap-1 text-sm font-bold text-primary hover:underline"
                >
                  <ExternalLink className="size-4" aria-hidden /> Try it: wa.me/{chatNumber}
                </a>
              )}
            </div>
          </div>
        )}

        {v.after === 'link' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="after-link" className="font-semibold">
                The link to open
              </Label>
              <Input
                id="after-link"
                type="url"
                className={cn('h-11', !v.link && 'border-warning/60')}
                placeholder="https://wa.me/message/…"
                value={v.link}
                aria-invalid={error?.field === 'redirect_url'}
                onChange={(e) => setV((x) => ({ ...x, link: e.target.value }))}
              />
              <p className={cn('text-xs', error?.field === 'redirect_url' ? 'text-destructive' : 'text-muted-foreground')}>
                {error?.field === 'redirect_url' ? error.text : 'Starts with https://'}
              </p>
            </div>
            <ShortLinkGuide />
          </div>
        )}

        {v.after === 'thanks' && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="thanks-text" className="font-semibold">
              What they see
            </Label>
            {/* The same words the form shows after Send (EnquiryFormView), editable here. */}
            <Textarea
              id="thanks-text"
              rows={2}
              maxLength={300}
              placeholder={`${studio} has your details and will get in touch with you soon.`}
              value={v.thanks}
              onChange={(e) => setV((x) => ({ ...x, thanks: e.target.value }))}
            />
          </div>
        )}

        {changed && (
          <div className="flex gap-2">
            <Button onClick={onSave} disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="ghost" onClick={() => (setV(start), setError(null))}>
              Undo
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Where to find a WhatsApp Business short link, drawn rather than shown: a
 * real screenshot would carry somebody's private chats and counts.
 */
function ShortLinkGuide() {
  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-muted/50 p-4 sm:flex-row sm:items-center">
      <div aria-hidden className="mx-auto w-44 shrink-0 rounded-[22px] border-4 border-[#111827] bg-[#F4F4F4] p-2 text-[10px] text-[#111827]">
        <p className="px-1 pt-1 text-sm font-bold">Tools</p>
        <p className="px-1 pb-1 text-[9px] text-[#6b7280]">Manage your account</p>
        <div className="flex flex-col gap-1">
          <span className="rounded-md bg-white px-2 py-1.5">Profile</span>
          <span className="rounded-md bg-white px-2 py-1.5">Facebook and Instagram</span>
          <span className="relative rounded-md bg-white px-2 py-1.5 ring-2 ring-brand">
            <b>Short link</b>
            <span className="block text-[8px] text-[#6b7280]">Invite to chat via link or QR code</span>
            <span className="absolute -right-1 -top-2 rounded-full bg-brand px-1.5 text-[8px] font-bold text-brand-foreground">Tap</span>
          </span>
        </div>
        <p className="mt-3 flex justify-around border-t border-[#e5e7eb] pt-1.5 text-[9px] text-[#6b7280]">
          <span>Chats</span>
          <b className="text-[#111827]">Tools</b>
          <span>Settings</span>
        </p>
      </div>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
        <li>Open the WhatsApp Business app.</li>
        <li>
          Tap <b>Tools</b> at the bottom.
        </li>
        <li>
          Tap <b>Short link</b>, then copy the link.
        </li>
        <li>Paste it in the box above and tap Save.</li>
      </ol>
    </div>
  )
}
