import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { ENQUIRY_FIELD_KEYS, type EnquiryFieldKey, type EnquiryForm } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { Switch } from '@/shared/ui/switch'
import { cn } from '@/shared/ui/cn'
import { useSetEnquiryServices, useUpdateEnquiryForm } from './api'
import { LIST_LABEL } from './form-fields'

/**
 * Which questions the form asks (spec 3.3): name and mobile always, then each
 * question on or off and, when on, whether it must be answered. "What they
 * need" lists the studio's own services, with "+ Add" right there.
 */
export function QuestionsCard({ form, services }: { form: EnquiryForm; services: string[] }) {
  const update = useUpdateEnquiryForm(form.id)
  const [fields, setFields] = useState(form.fields)
  const changed = JSON.stringify(fields) !== JSON.stringify(form.fields)

  const toggle = (k: EnquiryFieldKey, on: boolean) => setFields((f) => ({ ...f, [k]: on ? 'optional' : 'off' }))
  const must = (k: EnquiryFieldKey, req: boolean) => setFields((f) => ({ ...f, [k]: req ? 'required' : 'optional' }))

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4 sm:p-6">
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {['Name', 'Mobile number'].map((l) => (
            <li key={l} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-sm font-medium">{l}</span>
              <span className="text-xs font-bold text-muted-foreground">Always asked</span>
            </li>
          ))}
          {ENQUIRY_FIELD_KEYS.map((k) => {
            const on = fields[k] !== 'off'
            return (
              <li key={k} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex items-center gap-3">
                  <Switch
                    checked={on}
                    onChange={(v) => toggle(k, v)}
                    label={LIST_LABEL[k]}
                    className={cn('flex-1', !on && '[&>span:last-child]:text-muted-foreground')}
                  />
                  {on && (
                    <label className="flex shrink-0 items-center gap-1.5 text-xs font-medium">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--primary)]"
                        checked={fields[k] === 'required'}
                        onChange={(e) => must(k, e.target.checked)}
                      />
                      Must answer
                    </label>
                  )}
                </div>
                {k === 'services' && <ServicesEditor services={services} />}
              </li>
            )
          })}
        </ul>
        {changed && (
          <div className="flex gap-2">
            <Button
              disabled={update.isPending}
              onClick={() => update.mutate({ fields }, { onSuccess: () => toast.success('Questions saved. The form asks these now.') })}
            >
              {update.isPending ? 'Saving…' : 'Save questions'}
            </Button>
            <Button variant="ghost" onClick={() => setFields(form.fields)}>
              Undo
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** The choices under "What do you need?": the studio's own words, added and removed here. */
function ServicesEditor({ services }: { services: string[] }) {
  const save = useSetEnquiryServices()
  const [word, setWord] = useState('')
  const add = () => {
    const w = word.trim()
    if (!w) return
    if (services.some((s) => s.toLowerCase() === w.toLowerCase())) return setWord('')
    save.mutate([...services, w], { onSuccess: () => setWord('') })
  }
  return (
    <div className="flex flex-col gap-2 pl-14">
      <div className="flex flex-wrap gap-1.5">
        {services.map((s) => (
          <span key={s} className="inline-flex items-center gap-1 rounded-full border border-border bg-card py-1 pl-3 pr-1 text-xs font-medium">
            {s}
            <button
              type="button"
              aria-label={`Remove ${s}`}
              disabled={save.isPending || services.length <= 1}
              className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
              onClick={() => save.mutate(services.filter((x) => x !== s))}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <Input value={word} maxLength={60} placeholder="Mehendi shoot" onChange={(e) => setWord(e.target.value)} className="h-8 max-w-56 text-sm" />
        <Button type="submit" size="sm" disabled={!word.trim() || save.isPending}>
          <Plus /> Add
        </Button>
      </form>
    </div>
  )
}
