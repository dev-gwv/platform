import { useMemo, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { Sequence, SequenceChannel, SequenceInput, StudioWhatsappTemplate } from '@ipc/contracts'
import { SEQUENCE_VARS, fillSequenceText } from '@ipc/domain'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input, Label, Select, Textarea } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { usePipelines } from '@/features/crm/api'
import { useSaveSequence } from './api'
import { CHANNEL } from './SequencesSection'
import { useWhatsapp, useWhatsappTemplates } from '@/features/studio-whatsapp/api'

interface StepDraft {
  key: number
  day: string
  channel: SequenceChannel
  hour: number
  subject: string
  body: string
  note: string
  /** "name|language" of an approved WhatsApp template, or '' to send by a tap. */
  template: string
  params: string[]
}

const SOURCES: { value: string; label: string }[] = [
  { value: '', label: 'any source' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'webform', label: 'Web form' },
  { value: 'enquiry', label: 'Enquiry form' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'google_form', label: 'Google Form' },
  { value: 'referral', label: 'Referral' },
  { value: 'manual', label: 'Added by hand' },
]
const HOURS = Array.from({ length: 16 }, (_, i) => i + 6)
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'am' : 'pm'}`

/** What the preview is filled with, so the studio reads a real message. */
const SAMPLE = { name: 'Riya Sharma', event_type: 'Wedding', event_date: '2026-12-12', city: 'Jaipur' }

let nextKey = 1
const blank = (day: number, channel: SequenceChannel = 'whatsapp'): StepDraft => ({
  key: nextKey++,
  day: String(day),
  channel,
  hour: 10,
  subject: '',
  body: '',
  note: '',
  template: '',
  params: [],
})

/**
 * One sequence, written as a timeline: each step is a day, a channel and the
 * words. The preview under each message is what Riya would get.
 */
export function SequenceEditor({ sequence, onClose }: { sequence: Sequence | null; onClose: () => void }) {
  const save = useSaveSequence()
  // With the studio's own number connected, a WhatsApp step can name an
  // approved template and go out by itself (0203).
  const wa = useWhatsapp()
  const connected = !!wa.data?.connection
  const templates = (useWhatsappTemplates(connected).data?.items ?? []).filter((t) => t.status === 'APPROVED')
  const pipelines = usePipelines()
  const [name, setName] = useState(sequence?.name ?? '')
  const [starts, setStarts] = useState<'hand' | 'new' | 'stage'>(
    !sequence?.auto_start ? (sequence ? 'hand' : 'new') : sequence.stage_filter ? 'stage' : 'new',
  )
  const [stage, setStage] = useState(sequence?.stage_filter ?? '')
  const [source, setSource] = useState(sequence?.source_filter ?? '')
  const [stopOnReply, setStopOnReply] = useState(sequence?.stop_on_reply ?? true)
  const [steps, setSteps] = useState<StepDraft[]>(() =>
    sequence
      ? sequence.steps.map((s) => ({
          key: nextKey++,
          day: String(s.day_offset),
          channel: s.channel,
          hour: s.send_hour,
          subject: s.subject ?? '',
          body: s.body ?? '',
          note: s.note ?? '',
          template: s.wa_template_name ? `${s.wa_template_name}|${s.wa_template_lang ?? 'en'}` : '',
          params: s.wa_params ?? [],
        }))
      : [blank(0), blank(2, 'reminder')],
  )
  const [error, setError] = useState<string | null>(null)

  const stages = useMemo(() => {
    const seen = new Set<string>()
    return (pipelines.data ?? [])
      .flatMap((p) => p.stages)
      .filter((s) => s.kind === 'open' && !seen.has(s.name) && seen.add(s.name))
      .map((s) => s.name)
  }, [pipelines.data])

  const update = (key: number, patch: Partial<StepDraft>) => setSteps((all) => all.map((s) => (s.key === key ? { ...s, ...patch } : s)))

  function submit() {
    setError(null)
    if (name.trim().length < 2) return setError('Give the sequence a name.')
    if (starts === 'stage' && !stage) return setError('Pick the stage that starts it.')
    const ordered = [...steps].sort((a, b) => Number(a.day) - Number(b.day))
    const input: SequenceInput = {
      name: name.trim(),
      description: sequence?.description ?? null,
      is_active: sequence?.is_active ?? true,
      auto_start: starts !== 'hand',
      stage_filter: starts === 'stage' ? stage : null,
      source_filter: starts === 'hand' ? null : source || null,
      stop_on_reply: stopOnReply,
      steps: ordered.map((s) => ({
        day_offset: Math.max(0, Math.min(365, Number(s.day) || 0)),
        channel: s.channel,
        send_hour: s.hour,
        subject: s.channel === 'email' ? s.subject.trim() || null : null,
        body: s.channel === 'reminder' ? null : s.body.trim() || null,
        note: s.channel === 'reminder' ? s.note.trim() || null : null,
        ...(s.channel === 'whatsapp' && s.template
          ? { wa_template_name: s.template.split('|')[0]!, wa_template_lang: s.template.split('|')[1] ?? 'en', wa_params: s.params }
          : { wa_template_name: null, wa_template_lang: null, wa_params: null }),
      })),
    }
    const missing = input.steps.findIndex((s) => (s.channel !== 'reminder' && !s.body) || (s.channel === 'email' && !s.subject))
    if (missing >= 0) return setError(`Step ${missing + 1} needs its ${input.steps[missing]!.body ? 'subject' : 'message'}.`)
    save.mutate({ id: sequence?.id, input }, { onSuccess: onClose })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={sequence ? 'Edit sequence' : 'New sequence'} className="max-w-2xl">
        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="seq-name">Name</Label>
            <Input id="seq-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="New enquiry" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="seq-starts">Starts</Label>
              <Select id="seq-starts" value={starts} onChange={(e) => setStarts(e.target.value as typeof starts)}>
                <option value="new">For every new lead</option>
                <option value="stage">When a lead reaches a stage</option>
                <option value="hand">Only when I add a lead to it</option>
              </Select>
            </div>
            {starts === 'stage' && (
              <div>
                <Label htmlFor="seq-stage">Stage</Label>
                <Select id="seq-stage" value={stage} onChange={(e) => setStage(e.target.value)}>
                  <option value="">Pick a stage…</option>
                  {stages.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {starts !== 'hand' && (
              <div>
                <Label htmlFor="seq-source">For leads from</Label>
                <Select id="seq-source" value={source} onChange={(e) => setSource(e.target.value)}>
                  {SOURCES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>

          <ol className="flex flex-col gap-3">
            {steps.map((s, i) => (
              <StepCard
                key={s.key}
                index={i}
                step={s}
                onChange={(p) => update(s.key, p)}
                onRemove={steps.length > 1 ? () => setSteps((all) => all.filter((x) => x.key !== s.key)) : undefined}
                templates={connected ? templates : null}
              />
            ))}
          </ol>
          <Button
            variant="outline"
            className="self-start"
            onClick={() => setSteps((all) => [...all, blank((Number(all[all.length - 1]?.day) || 0) + 2)])}
          >
            <Plus /> Add a step
          </Button>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={stopOnReply} onChange={(e) => setStopOnReply(e.target.checked)} className="size-4" />
            Stop when they reply or call
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function StepCard({
  index,
  step,
  onChange,
  onRemove,
  templates,
}: {
  index: number
  step: StepDraft
  onChange: (p: Partial<StepDraft>) => void
  onRemove: (() => void) | undefined
  templates: StudioWhatsappTemplate[] | null
}) {
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const isMessage = step.channel !== 'reminder'

  /** Put {{name}} where the cursor is, not at the end. */
  function insert(key: string) {
    const el = bodyRef.current
    const token = `{{${key}}}`
    if (!el) return onChange({ body: step.body + token })
    const start = el.selectionStart ?? step.body.length
    const end = el.selectionEnd ?? start
    onChange({ body: step.body.slice(0, start) + token + step.body.slice(end) })
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
  }

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground">Step {index + 1}</span>
        <span className="text-sm">Day</span>
        <Input
          aria-label={`Step ${index + 1} day`}
          type="number"
          min={0}
          max={365}
          value={step.day}
          onChange={(e) => onChange({ day: e.target.value })}
          className="h-8 w-16"
        />
        <div className="inline-flex rounded-full border border-border bg-muted p-0.5" role="radiogroup" aria-label={`Step ${index + 1} channel`}>
          {(['whatsapp', 'email', 'reminder'] as const).map((c) => {
            const Icon = CHANNEL[c].icon
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={step.channel === c}
                onClick={() => onChange({ channel: c })}
                className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs', step.channel === c ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground')}
              >
                <Icon className="size-3" /> {CHANNEL[c].label}
              </button>
            )
          })}
        </div>
        <Select aria-label={`Step ${index + 1} time`} value={String(step.hour)} onChange={(e) => onChange({ hour: Number(e.target.value) })} className="h-8 w-28">
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {hourLabel(h)}
            </option>
          ))}
        </Select>
        {onRemove && (
          <Button size="icon" variant="ghost" className="ml-auto" onClick={onRemove} aria-label={`Remove step ${index + 1}`}>
            <Trash2 />
          </Button>
        )}
      </div>

      {step.channel === 'email' && (
        <Input
          className="mt-2"
          aria-label={`Step ${index + 1} subject`}
          placeholder="Subject"
          value={step.subject}
          onChange={(e) => onChange({ subject: e.target.value })}
        />
      )}
      {isMessage ? (
        <>
          <Textarea
            ref={bodyRef}
            className="mt-2 min-h-24 text-sm"
            aria-label={`Step ${index + 1} message`}
            placeholder={step.channel === 'whatsapp' ? 'Hi {{first_name}}, thank you for reaching out…' : 'Hi {{first_name}},\n\n…'}
            value={step.body}
            onChange={(e) => onChange({ body: e.target.value })}
          />
          <div className="mt-1.5 flex flex-wrap gap-1">
            {SEQUENCE_VARS.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => insert(v.key)}
                className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                + {v.label}
              </button>
            ))}
          </div>
          {step.channel === 'whatsapp' && templates && <TemplatePick step={step} templates={templates} onChange={onChange} index={index} />}
          {step.body.trim() && (
            <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Riya would get: </span>
              {fillSequenceText(step.body, SAMPLE, { name: 'Your studio', website: 'yourstudio.in' })}
            </p>
          )}
        </>
      ) : (
        <Input
          className="mt-2"
          aria-label={`Step ${index + 1} reminder`}
          placeholder="What to do, e.g. Call about the quotation"
          value={step.note}
          onChange={(e) => onChange({ note: e.target.value })}
        />
      )}
    </li>
  )
}

/** The usual order of a photography template's blanks: Hi {{1}}, {{2}} here, about your {{3}} on {{4}}. */
const GUESS = ['first_name', 'studio', 'event_type', 'event_date', 'city']

/**
 * Which approved template sends this step by itself, and what fills its
 * {{1}}, {{2}}. Without one, the step still goes by itself while the client's
 * 24 hours are open, and waits in Send now otherwise.
 */
function TemplatePick({
  step,
  templates,
  onChange,
  index,
}: {
  step: StepDraft
  templates: StudioWhatsappTemplate[]
  onChange: (p: Partial<StepDraft>) => void
  index: number
}) {
  const chosen = templates.find((t) => `${t.name}|${t.language}` === step.template)
  return (
    <div className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs">
      <Label htmlFor={`tpl-${index}`} className="text-xs">
        Send by itself with an approved template
      </Label>
      <Select
        id={`tpl-${index}`}
        aria-label={`Step ${index + 1} template`}
        value={step.template}
        onChange={(e) => {
          const t = templates.find((x) => `${x.name}|${x.language}` === e.target.value)
          onChange({ template: e.target.value, params: Array.from({ length: t?.param_count ?? 0 }, (_, i) => step.params[i] ?? GUESS[i] ?? 'first_name') })
        }}
        className="mt-1 h-8"
      >
        <option value="">No template: send by a tap (or by itself if they wrote in the last 24 hours)</option>
        {templates.map((t) => (
          <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
            {t.name} ({t.language})
          </option>
        ))}
      </Select>
      {chosen?.body && <p className="mt-1.5 whitespace-pre-wrap text-muted-foreground">{chosen.body}</p>}
      {chosen &&
        step.params.map((p, i) => (
          <div key={i} className="mt-1.5 flex items-center gap-2">
            <span className="w-10 shrink-0 font-mono">{`{{${i + 1}}}`}</span>
            <Select
              aria-label={`Step ${index + 1} template value ${i + 1}`}
              value={p}
              onChange={(e) => onChange({ params: step.params.map((x, j) => (j === i ? e.target.value : x)) })}
              className="h-8"
            >
              {SEQUENCE_VARS.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>
        ))}
    </div>
  )
}
