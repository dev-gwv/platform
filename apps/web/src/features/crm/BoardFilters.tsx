import { useMemo } from 'react'
import { CalendarHeart, Flame, Layers, Megaphone, Tag, User, X } from 'lucide-react'
import type { CrmLead } from '@ipc/contracts'
import { MultiSelectFilter, type FilterOption } from '@/shared/ui/multi-select-filter'
import { toneVar } from '@/shared/ui/tones'
import { useMembers } from '@/features/allocation/api'
import { usePipelines, useTags } from './api'
import { UNSET, activeFacetCount, facetCounts, type LeadFacets } from './board-filters'
import { prettyWord, useLookupOptions } from './fields'

const LABEL: Record<keyof LeadFacets, string> = {
  stage: 'stages',
  owner: 'owners',
  event: 'events',
  quality: 'qualities',
  tag: 'tags',
  source: 'sources',
}

/**
 * Six filters in a row, each several-at-once, each option with its colour
 * and how many leads it would leave -- the Control Center's toolbar, which
 * the owner holds up as the one to match. The active ones repeat underneath
 * as chips you can take off one at a time.
 */
export function BoardFilters({
  leads,
  value,
  onChange,
}: {
  leads: readonly CrmLead[]
  value: LeadFacets
  onChange: (next: LeadFacets) => void
}) {
  const pipelines = usePipelines()
  const members = useMembers()
  const tags = useTags()
  const qualities = useLookupOptions('lead_quality', ['hot', 'warm', 'cold'])
  const sources = useLookupOptions('lead_source')

  const options = useMemo(() => {
    const counts = (f: keyof LeadFacets) => facetCounts(leads, f)
    const withNone = (f: keyof LeadFacets, list: FilterOption[], none: string): FilterOption[] => {
      const c = counts(f)
      const out = list.map((o) => ({ ...o, count: c.get(o.value) ?? 0 }))
      // Values seen on leads but missing from the list still show.
      for (const [v, n] of c) {
        if (v !== UNSET && !out.some((o) => o.value === v)) out.push({ value: v, label: prettyWord(v), count: n })
      }
      const unset = c.get(UNSET)
      if (unset) out.push({ value: UNSET, label: none, count: unset })
      return out
    }
    const stages = (pipelines.data ?? []).flatMap((p) =>
      p.stages.map((s) => ({ value: s.id, label: (pipelines.data?.length ?? 0) > 1 ? `${s.name} · ${p.name}` : s.name, color: toneVar(s.color) })),
    )
    return {
      stage: withNone('stage', stages, 'No stage'),
      owner: withNone('owner', (members.data ?? []).map((m) => ({ value: m.user_id, label: m.name })), 'Unassigned'),
      event: withNone('event', [], 'No event type'),
      quality: withNone('quality', qualities.map((q) => ({ value: q.value, label: q.label, color: toneVar(q.color) })), 'Not rated'),
      tag: withNone('tag', (tags.data ?? []).map((t) => ({ value: t.id, label: t.name, color: toneVar(t.color) })), 'No tags'),
      source: withNone('source', sources.map((q) => ({ value: q.value, label: q.label, color: q.color ? toneVar(q.color) : undefined })), 'No source'),
    } satisfies Record<keyof LeadFacets, FilterOption[]>
  }, [leads, pipelines.data, members.data, tags.data, qualities, sources])

  const set = (k: keyof LeadFacets) => (next: string[]) => onChange({ ...value, [k]: next })
  const chips = (Object.keys(value) as (keyof LeadFacets)[]).flatMap((k) =>
    value[k].map((v) => ({ k, v, label: options[k].find((o) => o.value === v)?.label ?? prettyWord(v) })),
  )

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <MultiSelectFilter label={LABEL.stage} icon={Layers} options={options.stage} selected={value.stage} onChange={set('stage')} />
        <MultiSelectFilter label={LABEL.event} icon={CalendarHeart} options={options.event} selected={value.event} onChange={set('event')} />
        <MultiSelectFilter label={LABEL.quality} icon={Flame} options={options.quality} selected={value.quality} onChange={set('quality')} />
        <MultiSelectFilter label={LABEL.owner} icon={User} options={options.owner} selected={value.owner} onChange={set('owner')} />
        <MultiSelectFilter label={LABEL.tag} icon={Tag} options={options.tag} selected={value.tag} onChange={set('tag')} />
        <MultiSelectFilter label={LABEL.source} icon={Megaphone} options={options.source} selected={value.source} onChange={set('source')} />
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.slice(0, 8).map((c) => (
            <button
              key={`${c.k}:${c.v}`}
              type="button"
              onClick={() => onChange({ ...value, [c.k]: value[c.k].filter((x) => x !== c.v) })}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-xs hover:border-destructive/40"
            >
              {c.label}
              <X className="size-3" aria-label="Remove" />
            </button>
          ))}
          {chips.length > 8 && <span className="text-xs text-muted-foreground">+{chips.length - 8} more</span>}
          {activeFacetCount(value) > 0 && (
            <button
              type="button"
              onClick={() => onChange({ stage: [], owner: [], event: [], quality: [], tag: [], source: [] })}
              className="text-xs font-medium text-primary hover:underline"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  )
}
