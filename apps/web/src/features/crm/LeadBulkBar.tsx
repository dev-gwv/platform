import { useMemo, useState } from 'react'
import { Archive, ArchiveRestore, Download, Flame, Tag as TagIcon, X } from 'lucide-react'
import type { BulkLeadPatch, CrmLead, LeadStatus } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Select } from '@/shared/ui/input'
import { useAccess } from '@/shared/auth/useAccess'
import { useMembers } from '@/features/allocation/api'
import { useBulkLabel, useBulkPatch, useEnrollWorkflow, usePipelines, useWorkflows } from './api'
import { ArchiveDialog } from './ArchiveDialog'
import { LabelMenu } from './LabelMenu'
import { LostReasonDialog, type LostDetails } from './LostReasonDialog'
import { LookupChip, StagePicker } from './fields'
import { STAGES } from './leads'
import { exportLeadsCsv } from './tabs/shared'

/**
 * What to do to every lead that is ticked -- on the pipeline and in the list.
 *
 * The owner: "there is no option to select multiple cards and then put a
 * label on them." It used to live inside the list view only. This is the one
 * bar both use: move them, label them, rate them, give them to someone, set
 * when to call, mark hot, archive. Every list in it has "+ Add", and every
 * change can be undone from the toast.
 */
export function LeadBulkBar({
  leads,
  onClear,
  showArchived = false,
}: {
  /** The ticked leads, as they are now. */
  leads: readonly CrmLead[]
  onClear: () => void
  showArchived?: boolean | undefined
}) {
  const ids = useMemo(() => leads.map((l) => l.id), [leads])
  const bulk = useBulkPatch()
  const label = useBulkLabel()
  const workflows = useWorkflows()
  const enroll = useEnrollWorkflow()
  const pipelines = usePipelines()
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const { data: members } = useMembers()
  const [lostStage, setLostStage] = useState<string | null | 'status'>(null)
  const [askArchive, setAskArchive] = useState(false)

  // The studio's own stages when every ticked lead sits in one pipeline;
  // otherwise the standard steps, which every pipeline shares.
  const pipelineIds = new Set(leads.map((l) => l.pipeline_id ?? 'default'))
  const pipelineId = pipelineIds.size === 1 ? (leads[0]?.pipeline_id ?? null) : undefined
  const pipeline =
    pipelineId === undefined
      ? undefined
      : (pipelines.data?.find((p) => p.id === pipelineId) ?? pipelines.data?.find((p) => p.is_default))

  // A label every ticked lead carries is ticked; one only some carry shows a dash.
  const { all, some } = useMemo(() => {
    const counts = new Map<string, number>()
    for (const l of leads) for (const t of l.tags) counts.set(t.id, (counts.get(t.id) ?? 0) + 1)
    const allSet = new Set<string>()
    const someSet = new Set<string>()
    for (const [id, n] of counts) (n === leads.length ? allSet : someSet).add(id)
    return { all: allSet, some: someSet }
  }, [leads])

  const run = (patch: BulkLeadPatch['patch']) => bulk.mutate({ ids, patch }, { onSuccess: onClear })

  function moveTo(stageId: string) {
    const stage = pipeline?.stages.find((s) => s.id === stageId)
    if (stage?.kind === 'lost') setLostStage(stageId)
    else run({ stage_id: stageId })
  }

  function lost(d: LostDetails) {
    if (lostStage === 'status') run({ status: 'lost', ...d })
    else if (lostStage) run({ stage_id: lostStage, status: 'lost', ...d })
    setLostStage(null)
  }

  const n = leads.length
  const hasWorkflows = (workflows.data ?? []).some((w) => w.is_active)

  return (
    <>
      <div
        role="toolbar"
        aria-label="Change the ticked leads"
        className="no-print sticky bottom-3 z-30 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/30 bg-card p-3 shadow-lg"
      >
        <span className="rounded-full bg-primary px-2.5 py-1 text-sm font-semibold text-primary-foreground tabular-nums">
          {n} selected
        </span>

        {pipeline ? (
          <StagePicker
            pipelineId={pipeline.id}
            value={null}
            onChange={moveTo}
            canAdd={canEdit}
            placeholder="Move to stage…"
            disabled={bulk.isPending}
          />
        ) : (
          <Select
            value=""
            aria-label="Move to stage"
            className="h-8 w-40 text-sm"
            onChange={(e) => {
              const v = e.target.value as LeadStatus | ''
              if (v === 'lost') setLostStage('status')
              else if (v) run({ status: v })
            }}
          >
            <option value="">Move to stage…</option>
            {STAGES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </Select>
        )}

        <LabelMenu
          selected={all}
          partial={some}
          canCreate={canEdit}
          onToggle={(t, on) => label.mutate({ ids, tagId: t.id, tagName: t.name, attach: on })}
          trigger={
            <Button size="sm" variant="outline" disabled={label.isPending}>
              <TagIcon /> Labels
            </Button>
          }
        />

        <LookupChip
          category="lead_quality"
          value={null}
          onChange={(v) => run({ quality: v })}
          noun="quality"
          defaults={['hot', 'warm', 'cold']}
          placeholder="Quality…"
          disabled={bulk.isPending}
        />

        <Select
          value=""
          aria-label="Give to"
          className="h-8 w-40 text-sm"
          onChange={(e) => {
            const v = e.target.value
            if (v === 'none') run({ assigned_to: null })
            else if (v) run({ assigned_to: v })
          }}
        >
          <option value="">Give to…</option>
          <option value="none">Nobody</option>
          {(members ?? []).map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.name}
            </option>
          ))}
        </Select>

        <Select
          value=""
          aria-label="When to call next"
          className="h-8 w-40 text-sm"
          onChange={(e) => {
            const days = e.target.value
            if (!days) return
            if (days === 'clear') return run({ follow_up_at: null })
            const at = new Date()
            at.setDate(at.getDate() + Number(days))
            at.setHours(10, 0, 0, 0)
            run({ follow_up_at: at.toISOString() })
          }}
        >
          <option value="">Call next…</option>
          <option value="0">Today</option>
          <option value="1">Tomorrow</option>
          <option value="3">In 3 days</option>
          <option value="7">Next week</option>
          <option value="clear">No follow-up</option>
        </Select>

        <Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => run({ is_hot: true })}>
          <Flame /> Mark hot
        </Button>

        {hasWorkflows && (
          <Select
            value=""
            aria-label="Start a workflow"
            className="h-8 w-44 text-sm"
            onChange={(e) => {
              if (e.target.value) enroll.mutate({ workflowId: e.target.value, lead_ids: ids }, { onSuccess: onClear })
            }}
          >
            <option value="">Start a workflow…</option>
            {(workflows.data ?? [])
              .filter((w) => w.is_active)
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
          </Select>
        )}

        <Button
          size="sm"
          variant="outline"
          disabled={bulk.isPending}
          onClick={() => (showArchived ? run({ is_archived: false }) : setAskArchive(true))}
        >
          {showArchived ? <ArchiveRestore /> : <Archive />}
          {showArchived ? 'Restore' : 'Archive'}
        </Button>

        {access.hasModule('crm_export') && (
          <Button size="sm" variant="outline" onClick={() => exportLeadsCsv(leads)}>
            <Download /> CSV
          </Button>
        )}

        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear}>
          <X /> Clear
        </Button>
      </div>

      <ArchiveDialog
        open={askArchive}
        count={n}
        pending={bulk.isPending}
        onCancel={() => setAskArchive(false)}
        onConfirm={(reason) => {
          run(reason === null ? { is_archived: true } : { is_archived: true, archive_reason: reason })
          setAskArchive(false)
        }}
      />
      <LostReasonDialog open={lostStage !== null} count={n} pending={bulk.isPending} onCancel={() => setLostStage(null)} onConfirm={lost} />
    </>
  )
}
