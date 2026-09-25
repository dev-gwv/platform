import { useState } from 'react'
import { Pencil, Plus, Repeat, Trash2, X } from 'lucide-react'
import { createCadenceRequest, type CadenceStepInput } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { useAccess } from '@/shared/auth/useAccess'
import { DraftRestoredBanner, useFormDraft } from '@/shared/hooks/use-form-draft'
import { useCadences, useCreateCadence, useDeleteCadence, usePipelines, useTemplates, useUpdateCadence } from '../api'

type Draft = { day: string; template_id: string; note: string }

/**
 * Which leads a cadence is written for. Both columns have existed since 0099
 * and neither was ever settable, so every cadence applied to every lead — a
 * workflow told to start "Instagram nurture" would start it on a referral.
 * 0134 makes the automatic path honour them.
 */
const CADENCE_SOURCES: { value: string; label: string }[] = [
  { value: 'webform', label: 'Web form' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'google_form', label: 'Google Form' },
  { value: 'referral', label: 'Referral' },
  { value: 'enquiry', label: 'Enquiry' },
  { value: 'manual', label: 'Added by hand' },
  { value: 'other', label: 'Other' },
]
const EMPTY_STEP: Draft = { day: '0', template_id: '', note: '' }
const firstSteps = (): Draft[] => [{ ...EMPTY_STEP }, { ...EMPTY_STEP, day: '3' }]

/**
 * Cadences: the follow-up sequence a lead is put on — day 0 call, day 3 send
 * the quote, day 7 check in. Each step becomes the lead's next follow-up and
 * an alert to whoever owns it, on the hourly sweep. A lead that is won or
 * lost comes off its cadence by itself.
 */
export function CadencesSection() {
  const { data, isLoading, isError, error, refetch } = useCadences()
  const update = useUpdateCadence()
  const del = useDeleteCadence()
  const confirm = useConfirm()
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const canDelete = access.hasAction('crm', 'delete')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  async function onDelete(id: string, name: string, active: number) {
    const yes = await confirm({
      title: `Delete “${name}”?`,
      ...(active > 0 ? { description: `${active} lead${active === 1 ? ' is' : 's are'} on it now; they come off it.` } : {}),
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (yes) del.mutate(id)
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="font-semibold tracking-tight">Cadences</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          A follow-up sequence a lead is put on. Each step sets the next follow-up and alerts the owner on the day; winning or losing the lead ends it.
        </p>
      </div>

      {canEdit && <CadenceForm />}

      {isLoading ? (
        <SkeletonCards count={2} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <Card>
          <CardContent className="py-4">
            <EmptyState title="No cadences yet" description="Try: day 0 call, day 2 send the quote, day 7 check in." />
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.map((c) => (
            <li key={c.id} className={`rounded-lg border border-border bg-card p-3 ${c.is_active ? '' : 'opacity-60'}`}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Repeat className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.steps.map((s) => `day ${s.day_offset}${s.template_name ? ` · ${s.template_name}` : s.note ? ` · ${s.note}` : ''}`).join('  →  ')}
                  </p>
                </div>
                {/* Who it is written for. Without this the list is a row of
                    names that all look equally applicable to every lead. */}
                {c.stage_filter && <StatusBadge tone="neutral">at {c.stage_filter}</StatusBadge>}
                {c.source_filter && <StatusBadge tone="neutral">from {c.source_filter.replace(/_/g, ' ')}</StatusBadge>}
                <StatusBadge tone={c.active_leads > 0 ? 'info' : 'neutral'}>{c.active_leads} on it</StatusBadge>
                <StatusBadge tone={c.is_active ? 'success' : 'neutral'}>{c.is_active ? 'On' : 'Off'}</StatusBadge>
                {canEdit && renaming === c.id && (
                  <span className="flex items-center gap-1">
                    <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="h-8 w-44" autoFocus aria-label="Cadence name" />
                    <Button
                      size="sm"
                      disabled={renameValue.trim().length < 2 || update.isPending}
                      onClick={() => update.mutate({ id: c.id, patch: { name: renameValue.trim() } }, { onSuccess: () => setRenaming(null) })}
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                      <X />
                      <span className="sr-only">Cancel rename</span>
                    </Button>
                  </span>
                )}
                {canEdit && renaming !== c.id && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => { setRenameValue(c.name); setRenaming(c.id) }} title="Rename">
                      <Pencil />
                      <span className="sr-only">Rename {c.name}</span>
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: c.id, patch: { is_active: !c.is_active } })}>
                      {c.is_active ? 'Turn off' : 'Turn on'}
                    </Button>
                  </>
                )}
                {canDelete && (
                  <Button size="sm" variant="ghost" onClick={() => void onDelete(c.id, c.name, c.active_leads)}>
                    <Trash2 />
                    <span className="sr-only">Delete {c.name}</span>
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CadenceForm() {
  const create = useCreateCadence()
  const { data: templates } = useTemplates()
  const { data: pipelines } = usePipelines()
  const [name, setName] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [steps, setSteps] = useState<Draft[]>(firstSteps)
  const [error, setError] = useState<string | null>(null)
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft('cadence:new', { name, stageFilter, sourceFilter, steps }, (v) => {
    setName(v.name)
    setStageFilter(v.stageFilter)
    setSourceFilter(v.sourceFilter)
    setSteps(v.steps)
  })

  // Stage names across every pipeline, deduped — the filter is stored as text,
  // so two pipelines with a "Proposal sent" stage are one choice here.
  const stageNames = [
    ...new Set((pipelines ?? []).flatMap((p) => (p.stages ?? []).map((st) => st.name))),
  ]

  const patch = (i: number, p: Partial<Draft>) => setSteps((all) => all.map((s, idx) => (idx === i ? { ...s, ...p } : s)))

  function onSave() {
    setError(null)
    const input: CadenceStepInput[] = steps.map((s) => ({
      day_offset: Number(s.day) || 0,
      template_id: s.template_id || null,
      note: s.note.trim() || null,
    }))
    const parsed = createCadenceRequest.safeParse({
      name: name.trim(),
      steps: input,
      ...(stageFilter ? { stage_filter: stageFilter } : {}),
      ...(sourceFilter ? { source_filter: sourceFilter } : {}),
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check the steps.')
      return
    }
    create.mutate(parsed.data, {
      onSuccess: () => {
        draft.clear()
        reset()
      },
    })
  }

  function reset() {
    setName('')
    setStageFilter('')
    setSourceFilter('')
    setSteps(firstSteps())
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:p-4">
        <p className="font-medium">New cadence</p>
        <DraftRestoredBanner
          at={draft.restoredAt}
          onDismiss={draft.dismissRestored}
          onDiscard={() => {
            draft.clear()
            reset()
          }}
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="cad-name">Name</Label>
          <Input id="cad-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Wedding enquiry follow-up" aria-invalid={!!error && name.trim().length < 2} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="cad-stage">Only for leads at stage</Label>
            <Select id="cad-stage" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
              <option value="">Any stage</option>
              {stageNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="cad-source">Only for leads from</Label>
            <Select id="cad-source" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
              <option value="">Any source</option>
              {CADENCE_SOURCES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          A workflow will not start this cadence on a lead that does not match. Starting it by hand
          from a lead always works — you can see what you are doing.
        </p>

        <div className="flex flex-col gap-2">
          {steps.map((s, i) => (
            <div key={i} className="grid items-end gap-2 rounded-md border border-border p-2 sm:grid-cols-[6rem_1fr_1fr_auto]">
              <div className="flex flex-col gap-1">
                <Label htmlFor={`cad-day-${i}`}>Day</Label>
                <Input id={`cad-day-${i}`} type="number" min={0} max={365} value={s.day} onChange={(e) => patch(i, { day: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`cad-tpl-${i}`}>Template</Label>
                <Select id={`cad-tpl-${i}`} value={s.template_id} onChange={(e) => patch(i, { template_id: e.target.value })}>
                  <option value="">None</option>
                  {(templates ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`cad-note-${i}`}>What to do</Label>
                <Input id={`cad-note-${i}`} value={s.note} onChange={(e) => patch(i, { note: e.target.value })} placeholder="Call and confirm the date" />
              </div>
              <Button type="button" variant="ghost" size="icon" disabled={steps.length === 1} onClick={() => setSteps((all) => all.filter((_, idx) => idx !== i))}>
                <Trash2 />
                <span className="sr-only">Remove step {i + 1}</span>
              </Button>
            </div>
          ))}
          <div>
            <Button type="button" variant="outline" size="sm" disabled={steps.length >= 30} onClick={() => setSteps((all) => [...all, { ...EMPTY_STEP, day: String((Number(all[all.length - 1]?.day) || 0) + 3) }])}>
              <Plus /> Add step
            </Button>
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div>
          <Button onClick={onSave} disabled={create.isPending || name.trim().length < 2}>
            {create.isPending ? 'Saving…' : 'Save cadence'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
