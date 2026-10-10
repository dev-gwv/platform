import { useMemo } from 'react'
import type { Pipeline, PipelineStage } from '@ipc/contracts'
import { QuickSelect, type QuickOption } from '@/shared/ui/quick-select'
import { EventTile } from '@/shared/ui/icon-tile'
import { toneOf, type ToneName } from '@/shared/ui/tones'
import { useActiveLookups, useCreateCustomLookup } from '@/features/settings/api'
import { useCanAddLookup } from '@/features/settings/useCanAddLookup'
import { useCreateStage, usePipelines } from './api'
import { EVENT_TYPE_DEFAULTS } from './event-types'

/**
 * The CRM's fields, each one open: pick from the studio's list, or type a new
 * word and it joins the list for everyone (the owner's rule, CLAUDE.md).
 */

/** "google_form" reads as "Google form"; a studio's own words stay as typed. */
export function prettyWord(v: string): string {
  if (!/^[a-z0-9_]+$/.test(v)) return v
  const s = v.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** The colours a studio starts with, for a list that has not loaded yet. */
const QUALITY_FALLBACK: Record<string, ToneName> = { hot: 'rose', warm: 'amber', cold: 'blue' }

/** A studio list as picker options, with each value's colour. */
export function useLookupOptions(category: string, defaults: readonly string[] = []): QuickOption[] {
  const lookups = useActiveLookups(category)
  return useMemo(() => {
    const out: QuickOption[] = []
    const seen = new Set<string>()
    for (const l of lookups.data ?? []) {
      if (seen.has(l.value.toLowerCase())) continue
      seen.add(l.value.toLowerCase())
      out.push({ value: l.value, label: prettyWord(l.value), color: l.color ? toneOf(l.color) : null })
    }
    for (const d of defaults) {
      if (seen.has(d.toLowerCase())) continue
      seen.add(d.toLowerCase())
      out.push({ value: d, label: prettyWord(d), color: QUALITY_FALLBACK[d] ?? null })
    }
    return out
  }, [lookups.data, defaults])
}

/** The colour a value wears in its list (a quality's rose, a source's blue). */
export function useLookupColor(category: string): (value: string | null | undefined) => ToneName | null {
  const opts = useLookupOptions(category)
  return (v) => {
    if (!v) return null
    const o = opts.find((x) => x.value.toLowerCase() === v.toLowerCase())
    return o?.color ?? QUALITY_FALLBACK[v.toLowerCase()] ?? null
  }
}

/**
 * One of the studio's lists as a chip that opens a picker with "+ Add".
 * Anyone allowed to grow the list saves the new word to it; anyone else still
 * gets it on this record.
 */
export function LookupChip({
  category,
  value,
  onChange,
  noun,
  defaults = [],
  placeholder,
  colors = true,
  variant = 'chip',
  disabled,
  clearable = true,
  'aria-label': ariaLabel,
}: {
  category: string
  value: string | null
  onChange: (value: string | null) => void
  noun: string
  defaults?: readonly string[]
  placeholder?: string | undefined
  colors?: boolean | undefined
  variant?: 'chip' | 'field' | undefined
  disabled?: boolean | undefined
  clearable?: boolean | undefined
  'aria-label'?: string | undefined
}) {
  const options = useLookupOptions(category, defaults)
  const canAdd = useCanAddLookup(category)
  const create = useCreateCustomLookup()
  return (
    <QuickSelect
      aria-label={ariaLabel ?? noun}
      value={value}
      onChange={onChange}
      options={options}
      noun={noun}
      colors={colors}
      clearable={clearable}
      disabled={disabled}
      variant={variant}
      placeholder={placeholder ?? `Add ${noun}`}
      onCreate={async (label, color) => {
        if (canAdd) await create.mutateAsync({ category, value: label, color })
        return label
      }}
    />
  )
}

/** Event type with its icon: the haldi sun, the wedding heart. */
export function EventTypeChip({
  value,
  onChange,
  disabled,
  variant = 'chip',
}: {
  value: string | null
  onChange: (value: string | null) => void
  disabled?: boolean | undefined
  variant?: 'chip' | 'field' | undefined
}) {
  const base = useLookupOptions('project_type', EVENT_TYPE_DEFAULTS.map((d) => d.value))
  const canAdd = useCanAddLookup('project_type')
  const create = useCreateCustomLookup()
  const options = useMemo(
    () => base.map((o) => ({ ...o, icon: <EventTile name={o.value} size="sm" className="size-5 rounded-md [&_svg]:size-3" /> })),
    [base],
  )
  return (
    <QuickSelect
      aria-label="Event type"
      value={value}
      onChange={onChange}
      options={options}
      noun="event type"
      clearable
      disabled={disabled}
      variant={variant}
      placeholder="What's the event?"
      onCreate={async (label) => {
        if (canAdd) await create.mutateAsync({ category: 'project_type', value: label })
        return label
      }}
    />
  )
}

/** The stages of a pipeline as picker options, inactive ones left out. */
function stageOptions(stages: readonly PipelineStage[], keep?: string | null): QuickOption[] {
  return stages
    .filter((s) => s.is_active || s.id === keep)
    .map((s) => ({
      value: s.id,
      label: s.name,
      color: s.color,
      hint: s.kind === 'won' ? 'won' : s.kind === 'lost' ? 'lost' : undefined,
    }))
}

/**
 * The stage, as a coloured chip, with "+ Add stage" right there -- a studio
 * that works in "Site visit booked" should not have to find a settings page
 * to say so. The new stage lands before Won and Lost and the deal moves in.
 */
export function StagePicker({
  pipelineId,
  value,
  onChange,
  canAdd,
  disabled,
  variant = 'chip',
  placeholder = 'Stage',
}: {
  pipelineId: string | null
  value: string | null
  onChange: (stageId: string) => void
  canAdd: boolean
  disabled?: boolean | undefined
  variant?: 'chip' | 'field' | undefined
  placeholder?: string | undefined
}) {
  const pipelines = usePipelines()
  const create = useCreateStage()
  const pipeline: Pipeline | undefined =
    pipelines.data?.find((p) => p.id === pipelineId) ?? pipelines.data?.find((p) => p.is_default)
  const options = useMemo(() => stageOptions(pipeline?.stages ?? [], value), [pipeline, value])
  return (
    <QuickSelect
      aria-label="Stage"
      value={value}
      onChange={(v) => v && onChange(v)}
      options={options}
      noun="stage"
      colors
      disabled={disabled || !pipeline}
      variant={variant}
      placeholder={placeholder}
      onCreate={
        canAdd && pipeline
          ? async (name, color) => {
              const next = await create.mutateAsync({
                pipelineId: pipeline.id,
                name,
                kind: 'open',
                required_fields: [],
                ...(color ? { color } : {}),
              })
              const made = next.stages.find((s) => s.name.toLowerCase() === name.toLowerCase())
              return made?.id ?? value ?? ''
            }
          : undefined
      }
    />
  )
}
