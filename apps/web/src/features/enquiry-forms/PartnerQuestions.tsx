import { useState } from 'react'
import { List, Plus, Trash2, Type, X } from 'lucide-react'
import type { EnquiryQuestion } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'

export const MAX_QUESTIONS = 10

/** A new question's id: what its answer is kept under (0281). */
const newId = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0')

/** A question the database would refuse, in the studio's words; null when all are fine. */
export function questionsProblem(qs: EnquiryQuestion[]): string | null {
  const blank = qs.findIndex((q) => !q.label.trim())
  if (blank >= 0) return `Write question ${blank + 1}, or remove it.`
  const thin = qs.find((q) => q.kind === 'choice' && q.options.length < 2)
  if (thin) return `Give "${thin.label}" at least two choices.`
  return null
}

/**
 * A partner QR's own questions (owner, 25 Oct): each a typed answer or one pick
 * from a list, optional or must-answer. Asked after the form's own questions,
 * and every answer shows on the lead.
 */
export function PartnerQuestions({ value, onChange }: { value: EnquiryQuestion[]; onChange: (qs: EnquiryQuestion[]) => void }) {
  const put = (i: number, q: Partial<EnquiryQuestion>) => onChange(value.map((x, j) => (j === i ? { ...x, ...q } : x)))
  return (
    <div className="flex flex-col gap-3">
      {value.map((q, i) => (
        <QuestionRow key={q.id} n={i + 1} q={q} onChange={(x) => put(i, x)} onRemove={() => onChange(value.filter((_, j) => j !== i))} />
      ))}
      {value.length < MAX_QUESTIONS && (
        <Button
          type="button"
          className="self-start"
          onClick={() => onChange([...value, { id: newId(), label: '', kind: 'text', options: [], required: false }])}
        >
          <Plus /> Add a question
        </Button>
      )}
    </div>
  )
}

function QuestionRow({
  n,
  q,
  onChange,
  onRemove,
}: {
  n: number
  q: EnquiryQuestion
  onChange: (q: Partial<EnquiryQuestion>) => void
  onRemove: () => void
}) {
  const [choice, setChoice] = useState('')
  const addChoice = () => {
    const w = choice.trim().slice(0, 60)
    if (!w || q.options.includes(w) || q.options.length >= 20) return setChoice('')
    onChange({ options: [...q.options, w] })
    setChoice('')
  }
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/30 p-3">
      <div className="flex items-start gap-2">
        <span className="mt-2.5 text-xs font-bold text-muted-foreground">{n}.</span>
        <Input
          aria-label={`Question ${n}`}
          maxLength={120}
          placeholder="e.g. Bride side or groom side?"
          value={q.label}
          className={cn('h-10 flex-1', !q.label.trim() && 'border-warning/60 bg-tone-amber-soft/40')}
          onChange={(e) => onChange({ label: e.target.value })}
        />
        <Button type="button" size="icon" variant="ghost" className="hover:text-destructive" aria-label={`Remove question ${n}`} onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-5">
        {(
          [
            ['text', 'Typed answer', Type],
            ['choice', 'Pick from a list', List],
          ] as const
        ).map(([k, l, Icon]) => (
          <button
            key={k}
            type="button"
            aria-pressed={q.kind === k}
            onClick={() => onChange({ kind: k })}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold',
              q.kind === k ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card hover:border-brand',
            )}
          >
            <Icon className="size-3.5" aria-hidden /> {l}
          </button>
        ))}
        <label className="ml-auto inline-flex items-center gap-2 text-xs font-semibold">
          <input type="checkbox" className="size-4 accent-primary" checked={q.required} onChange={(e) => onChange({ required: e.target.checked })} />
          Must answer
        </label>
      </div>
      {q.kind === 'choice' && (
        <div className="flex flex-col gap-2 pl-5">
          <div className="flex flex-wrap gap-1.5">
            {q.options.map((o) => (
              <span key={o} className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2.5 py-1 text-xs font-semibold">
                {o}
                <button type="button" aria-label={`Remove ${o}`} onClick={() => onChange({ options: q.options.filter((x) => x !== o) })}>
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
            {q.options.length < 2 && (
              <span className="rounded-full border border-dashed border-warning/60 px-2.5 py-1 text-xs text-muted-foreground">
                {q.options.length ? 'Add one more choice' : 'Add at least two choices'}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              aria-label={`A choice for question ${n}`}
              maxLength={60}
              placeholder="e.g. Bride side"
              value={choice}
              className="h-9"
              onChange={(e) => setChoice(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addChoice()
                }
              }}
            />
            <Button type="button" size="sm" onClick={addChoice} disabled={!choice.trim()}>
              <Plus /> Add
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
