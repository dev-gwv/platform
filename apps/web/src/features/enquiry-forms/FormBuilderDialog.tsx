import { useState } from 'react'
import { toast } from 'sonner'
import {
  ENQUIRY_FIELD_KEYS,
  type EnquiryFieldSetting,
  type EnquiryFields,
  type EnquiryForm,
} from '@ipc/contracts'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'
import { Switch } from '@/shared/ui/switch'
import { cn } from '@/shared/ui/cn'
import { TONES, TONE_BG, type ToneName } from '@/shared/ui/tones'
import { useUpdateEnquiryForm } from './api'
import { EnquiryFormView } from './EnquiryFormView'
import { FIELD_LABEL, SETTING_LABEL } from './form-fields'

const SETTINGS: EnquiryFieldSetting[] = ['off', 'optional', 'required']

/**
 * Build the form: its words, what it asks, its colour -- with the form
 * itself beside it, changing as you go. Name and phone are always asked.
 */
export function FormBuilderDialog({ form, onClose }: { form: EnquiryForm; onClose: () => void }) {
  const { session } = useAuth()
  const update = useUpdateEnquiryForm(form.id)
  const studio =
    session?.studios.find((m) => m.company_id === session.company_id)?.company_name ?? 'Your studio'
  const [title, setTitle] = useState(form.title ?? '')
  const [intro, setIntro] = useState(form.intro ?? '')
  const [thanks, setThanks] = useState(form.thank_you ?? '')
  const [accent, setAccent] = useState<ToneName | null>(form.accent)
  const [showLogo, setShowLogo] = useState(form.show_logo)
  const [fields, setFields] = useState<EnquiryFields>(form.fields)

  const save = () =>
    update.mutate(
      {
        title: title.trim() || null,
        intro: intro.trim() || null,
        thank_you: thanks.trim() || null,
        accent,
        show_logo: showLogo,
        fields,
      },
      {
        onSuccess: () => {
          toast.success('Form saved. It changes everywhere it is used.')
          onClose()
        },
      },
    )

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title="Edit the form" className="max-w-4xl">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fb-title">Heading</Label>
              <Input
                id="fb-title"
                value={title}
                maxLength={120}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Tell us about your event and we will call you back."
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fb-intro">A line under it</Label>
              <Input
                id="fb-intro"
                value={intro}
                maxLength={300}
                onChange={(e) => setIntro(e.target.value)}
                placeholder="e.g. Weddings across Rajasthan since 2012"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>What it asks</Label>
              <p className="text-xs text-muted-foreground">Name and mobile number, always.</p>
              <ul className="flex flex-col gap-1.5">
                {ENQUIRY_FIELD_KEYS.map((k) => (
                  <li key={k} className="flex items-center justify-between gap-3">
                    <span className="text-sm">{FIELD_LABEL[k].replace('?', '')}</span>
                    <span
                      className="inline-flex rounded-md border border-border p-0.5"
                      role="radiogroup"
                      aria-label={FIELD_LABEL[k]}
                    >
                      {SETTINGS.map((s) => (
                        <button
                          key={s}
                          type="button"
                          role="radio"
                          aria-checked={fields[k] === s}
                          onClick={() => setFields((f) => ({ ...f, [k]: s }))}
                          className={cn(
                            'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                            fields[k] === s
                              ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:bg-accent',
                          )}
                        >
                          {SETTING_LABEL[s]}
                        </button>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Button colour</Label>
              <div className="flex flex-wrap gap-2">
                {TONES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-label={t}
                    aria-pressed={(accent ?? 'slate') === t}
                    onClick={() => setAccent(t === 'slate' ? null : t)}
                    className={cn(
                      'size-7 rounded-full border-2 transition-transform',
                      TONE_BG[t],
                      (accent ?? 'slate') === t
                        ? 'scale-110 border-foreground'
                        : 'border-transparent',
                    )}
                  />
                ))}
              </div>
            </div>

            <Switch
              checked={showLogo}
              onChange={setShowLogo}
              label="Show your logo"
              description="The one on your invoices."
            />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fb-thanks">After they send</Label>
              <Input
                id="fb-thanks"
                value={thanks}
                maxLength={300}
                onChange={(e) => setThanks(e.target.value)}
                placeholder="Thank you, we have your enquiry."
              />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              How it looks
            </p>
            <div className="rounded-lg border border-border bg-card p-4">
              <EnquiryFormView
                preview
                look={{
                  studio,
                  form_name: form.name,
                  purpose: form.purpose,
                  title: title.trim() || null,
                  intro: intro.trim() || null,
                  thank_you: thanks.trim() || null,
                  accent,
                  logo_url: null,
                  fields,
                }}
              />
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save form'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
