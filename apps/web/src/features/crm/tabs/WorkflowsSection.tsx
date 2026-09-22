import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, GitBranch, Plus, Send, Sparkles, Square, Timer, Trash2, Workflow as WorkflowIcon, X, Zap } from 'lucide-react'
import {
  createWorkflowRequest,
  type ConditionOp,
  type CreateWorkflowRequest,
  type FieldCondition,
  type LeadSource,
  type LeadStatus,
  type Workflow,
  type WorkflowAction,
  type WorkflowStepInput,
  type WorkflowTrigger,
} from '@ipc/contracts'
import { ACTION_LABEL, CONDITION_FIELDS, OP_LABEL, TRIGGER_LABEL, describeStep, describeWorkflow, sortStages, type Names } from '@ipc/domain'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { useAccess } from '@/shared/auth/useAccess'
import { useMembers } from '@/features/allocation/api'
import {
  useCadences,
  useCreateWorkflow,
  useCrmOutbox,
  useDeleteWorkflow,
  useExitEnrollment,
  usePipelines,
  useTemplates,
  useUpdateWorkflow,
  useWorkflowEnrollments,
  useSeedWorkflows,
  useWorkflows,
} from '../api'
import { STAGES } from '../leads'

const SOURCES: LeadSource[] = ['facebook', 'webform', 'referral', 'manual', 'enquiry']
const TRIGGERS = Object.keys(TRIGGER_LABEL) as WorkflowTrigger[]
const ACTIONS = Object.keys(ACTION_LABEL) as WorkflowAction[]
const OPS = Object.keys(OP_LABEL) as ConditionOp[]

type Draft = {
  name: string
  trigger: WorkflowTrigger
  source: string
  toStatus: string
  fromStatus: string
  isHot: '' | 'true' | 'false'
  conditions: FieldCondition[]
  steps: WorkflowStepInput[]
  allow_reenroll: boolean
  exit_on_reply: boolean
  /**
   * How loud it is, how often it may repeat, and who hears it. All four were
   * on crm_workflows and seeded with real values per rule — 'critical' for a
   * hot lead with no follow-up, a 2-hour cooldown, routing to admin and
   * manager — and no screen ever showed them.
   */
  severity: 'info' | 'warning' | 'critical'
  cooldown_hours: number
  notify_assignee: boolean
  notify_roles: string[]
}

/** The roles a rule can escalate to. 'admin' includes the studio owner. */
const NOTIFY_ROLES: { value: string; label: string }[] = [
  { value: 'admin', label: 'Admins & owner' },
  { value: 'manager', label: 'Managers' },
]

const EMPTY: Draft = {
  name: '',
  trigger: 'lead_created',
  source: '',
  toStatus: '',
  fromStatus: '',
  isHot: '',
  conditions: [],
  steps: [{ kind: 'action', config: { action: 'mark_hot' } }],
  allow_reenroll: false,
  exit_on_reply: true,
  severity: 'info',
  cooldown_hours: 24,
  notify_assignee: true,
  notify_roles: [],
}

function fromWorkflow(w: Workflow): Draft {
  return {
    name: w.name,
    trigger: w.trigger,
    source: w.condition.source ?? '',
    toStatus: w.condition.to_status ?? '',
    fromStatus: w.condition.from_status ?? '',
    isHot: w.condition.is_hot === undefined ? '' : w.condition.is_hot ? 'true' : 'false',
    conditions: w.condition.conditions ?? [],
    steps: w.steps.map((s) => ({ kind: s.kind, config: s.config }) as WorkflowStepInput),
    allow_reenroll: w.allow_reenroll,
    exit_on_reply: w.exit_on_reply,
    severity: w.severity ?? 'info',
    cooldown_hours: w.cooldown_hours ?? 24,
    notify_assignee: w.notify_assignee ?? true,
    notify_roles: [...(w.notify_roles ?? [])],
  }
}

function toRequest(d: Draft): CreateWorkflowRequest {
  return createWorkflowRequest.parse({
    name: d.name.trim(),
    trigger: d.trigger,
    condition: {
      ...(d.source ? { source: d.source as LeadSource } : {}),
      ...(d.trigger === 'stage_changed' && d.toStatus ? { to_status: d.toStatus as LeadStatus } : {}),
      ...(d.trigger === 'stage_changed' && d.fromStatus ? { from_status: d.fromStatus as LeadStatus } : {}),
      ...(d.isHot ? { is_hot: d.isHot === 'true' } : {}),
      ...(d.conditions.length ? { conditions: d.conditions } : {}),
    },
    steps: d.steps,
    is_active: true,
    allow_reenroll: d.allow_reenroll,
    exit_on_reply: d.exit_on_reply,
    severity: d.severity,
    cooldown_hours: d.cooldown_hours,
    notify_assignee: d.notify_assignee,
    notify_roles: d.notify_roles,
  })
}

/**
 * Workflows: when X happens to a lead that matches Y, run these steps —
 * actions, waits, branches. Evaluated in the database on arrival, stage
 * change, activity, score change and by the hourly sweep, so they run
 * whether or not anyone has the page open.
 */
export function WorkflowsSection() {
  const { data, isLoading, isError, error, refetch } = useWorkflows()
  const update = useUpdateWorkflow()
  const del = useDeleteWorkflow()
  const seed = useSeedWorkflows()
  const confirm = useConfirm()
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const canDelete = access.hasAction('crm', 'delete')
  const [editing, setEditing] = useState<Workflow | 'new' | null>(null)
  const [showRuns, setShowRuns] = useState<string | null>(null)
  const names = useNames()

  async function onDelete(w: Workflow) {
    if (await confirm({ title: `Delete the workflow "${w.name}"?`, description: 'Leads currently in it stop where they are.', confirmLabel: 'Delete', destructive: true })) del.mutate(w.id)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold tracking-tight">Workflows</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Multi-step automations: act, wait, branch on the lead, stop. A reply from the lead ends the sequence.
          </p>
        </div>
        {canEdit && editing === null && (
          <>
            <Button size="sm" variant="outline" onClick={() => seed.mutate()} disabled={seed.isPending}>
              <Sparkles /> {seed.isPending ? 'Adding…' : 'Add the 7 defaults'}
            </Button>
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus /> New workflow
            </Button>
          </>
        )}
      </div>

      {editing !== null && (
        <WorkflowForm
          initial={editing === 'new' ? EMPTY : fromWorkflow(editing)}
          existing={editing === 'new' ? null : editing}
          names={names}
          onClose={() => setEditing(null)}
        />
      )}

      {isLoading ? (
        <SkeletonCards count={2} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <Card>
          <CardContent className="py-4">
            <EmptyState title="No workflows yet" description="Try: when a lead arrives from Facebook, mark it hot, wait a day, then notify the owner." />
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.map((w) => (
            <li key={w.id} className={`rounded-lg border border-border bg-card p-3 ${w.is_active ? '' : 'opacity-60'}`}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <WorkflowIcon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{w.name}</p>
                  <p className="text-sm text-muted-foreground">{describeWorkflow(w, names)}</p>
                </div>
                <StatusBadge tone={w.is_active ? 'success' : 'neutral'}>{w.is_active ? 'On' : 'Off'}</StatusBadge>
                <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setShowRuns(showRuns === w.id ? null : w.id)}>
                  {w.active_count} active · {w.completed_count} done{w.errored_count ? ` · ${w.errored_count} errored` : ''}
                </button>
                {canEdit && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: w.id, patch: { is_active: !w.is_active } })}>
                      {w.is_active ? 'Turn off' : 'Turn on'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(w)}>
                      Edit
                    </Button>
                  </>
                )}
                {canDelete && (
                  <Button size="sm" variant="ghost" onClick={() => void onDelete(w)}>
                    <Trash2 />
                    <span className="sr-only">Delete {w.name}</span>
                  </Button>
                )}
              </div>
              {showRuns === w.id && <Enrollments workflowId={w.id} canEdit={canEdit} />}
            </li>
          ))}
        </ul>
      )}

      <Outbox />
    </div>
  )
}

function useNames(): Names {
  const members = useMembers()
  const cadences = useCadences()
  const pipelines = usePipelines()
  const templates = useTemplates()
  return useMemo(() => {
    const users = new Map((members.data ?? []).map((m) => [m.user_id, m.name]))
    const cads = new Map((cadences.data ?? []).map((c) => [c.id, c.name]))
    const stages = new Map((pipelines.data ?? []).flatMap((p) => p.stages.map((s) => [s.id, `${s.name}${(pipelines.data ?? []).length > 1 ? ` (${p.name})` : ''}`])))
    const tpls = new Map((templates.data ?? []).map((t) => [t.id, t.name]))
    return {
      user: (id: string) => users.get(id),
      cadence: (id: string) => cads.get(id),
      stage: (id: string) => stages.get(id),
      template: (id: string) => tpls.get(id),
    }
  }, [members.data, cadences.data, pipelines.data, templates.data])
}

const when = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function Enrollments({ workflowId, canEdit }: { workflowId: string; canEdit: boolean }) {
  const { data, isLoading } = useWorkflowEnrollments(workflowId)
  const exit = useExitEnrollment()
  const [showLog, setShowLog] = useState<string | null>(null)
  const active = (data ?? []).filter((e) => e.status === 'active')

  if (isLoading) return <p className="mt-2 text-xs text-muted-foreground">Loading…</p>
  if (!data || data.length === 0) return <p className="mt-2 text-xs text-muted-foreground">Nobody has been through this workflow yet.</p>
  return (
    <div className="mt-3 border-t border-border">
      {canEdit && active.length > 1 && (
        <div className="flex justify-end py-1.5">
          <Button
            size="sm"
            variant="ghost"
            disabled={exit.isPending}
            onClick={() => active.forEach((e) => exit.mutate(e.id))}
          >
            Stop all {active.length}
          </Button>
        </div>
      )}
      <ul className="divide-y divide-border text-xs">
        {data.slice(0, 30).map((e) => (
          <li key={e.id} className="py-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{e.lead_name ?? e.lead_id}</span>
              <StatusBadge tone={e.status === 'active' ? 'info' : e.status === 'completed' ? 'success' : e.status === 'errored' ? 'danger' : 'neutral'}>{e.status}</StatusBadge>
              <span className="text-muted-foreground">
                step {e.current_step} · {e.steps_run} run
                {e.next_at && e.status === 'active' ? ` · next ${when.format(new Date(e.next_at))}` : ''}
                {e.exit_reason ? ` · ${e.exit_reason}` : ''}
              </span>
              {e.log.length > 0 && (
                <button type="button" className="text-muted-foreground hover:underline" onClick={() => setShowLog(showLog === e.id ? null : e.id)}>
                  {showLog === e.id ? 'hide steps' : 'steps'}
                </button>
              )}
              {canEdit && e.status === 'active' && (
                <Button size="sm" variant="ghost" disabled={exit.isPending} onClick={() => exit.mutate(e.id)}>
                  <Square className="size-3" /> Stop
                </Button>
              )}
            </div>
            {/* The executor writes a line per step; when one errors this is
                the only place that says which. */}
            {showLog === e.id && (
              <ol className="mt-1 flex flex-col gap-0.5 pl-4 text-muted-foreground">
                {e.log.map((l, i) => (
                  <li key={i}>
                    <span className="tabular-nums">{when.format(new Date(l.at))}</span> · step {l.step} · {l.kind}
                    {l.result ? ` → ${l.result}` : ''}
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** What the workflows queued to send, and what became of it. */
function Outbox() {
  const { data, isLoading } = useCrmOutbox()
  const rows = data ?? []
  const failed = rows.filter((r) => r.status === 'failed')
  if (isLoading || rows.length === 0) return null
  return (
    <Card>
      <CardContent className="p-4">
        <p className="flex items-center gap-2 font-medium">
          <Send className="size-4 text-muted-foreground" /> Messages workflows queued
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          A send step queues here and the hourly job delivers it — or leaves it as a task for the deal's owner when WhatsApp is not connected.
          {failed.length > 0 ? ` ${failed.length} could not be sent.` : ''}
        </p>
        <ul className="mt-3 divide-y divide-border text-xs">
          {rows.slice(0, 12).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="min-w-0 flex-1 truncate">
                {r.template_name ?? 'Template'} → {r.lead_name ?? 'a deal'} · {r.channel}
              </span>
              <StatusBadge tone={r.status === 'sent' ? 'success' : r.status === 'failed' ? 'danger' : r.status === 'manual' ? 'warning' : 'neutral'}>
                {r.status === 'manual' ? 'left as a task' : r.status}
              </StatusBadge>
              <span className="tabular-nums text-muted-foreground">{when.format(new Date(r.sent_at ?? r.created_at))}</span>
              {r.error && <span className="w-full truncate text-destructive" title={r.error}>{r.error}</span>}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function WorkflowForm({ initial, existing, names, onClose }: { initial: Draft; existing: Workflow | null; names: Names; onClose: () => void }) {
  const create = useCreateWorkflow()
  const update = useUpdateWorkflow()
  const [d, setD] = useState<Draft>(initial)
  const [error, setError] = useState<string | null>(null)
  const pending = create.isPending || update.isPending

  const preview = useMemo(() => {
    try {
      const r = toRequest(d)
      return describeWorkflow(r, names)
    } catch {
      return null
    }
  }, [d, names])

  function save() {
    setError(null)
    let body: CreateWorkflowRequest
    try {
      body = toRequest(d)
    } catch (e) {
      const issue = (e as { issues?: Array<{ message?: string; path?: unknown[] }> }).issues?.[0]
      setError(issue?.message ? `${issue.message}${issue.path?.length ? ` (${issue.path.join('.')})` : ''}` : 'Please check the workflow.')
      return
    }
    if (existing) update.mutate({ id: existing.id, patch: body }, { onSuccess: onClose })
    else create.mutate(body, { onSuccess: onClose })
  }

  const setStep = (i: number, step: WorkflowStepInput) => setD((x) => ({ ...x, steps: x.steps.map((s, j) => (j === i ? step : s)) }))
  const moveStep = (i: number, dir: -1 | 1) =>
    setD((x) => {
      const next = [...x.steps]
      const t = i + dir
      if (t < 0 || t >= next.length) return x
      ;[next[i], next[t]] = [next[t]!, next[i]!]
      return { ...x, steps: next }
    })
  const addStep = (kind: WorkflowStepInput['kind']) =>
    setD((x) => ({
      ...x,
      steps: [
        ...x.steps,
        kind === 'action'
          ? { kind, config: { action: 'notify_assignee' } }
          : kind === 'delay'
            ? { kind, config: { amount: 1, unit: 'days' } }
            : kind === 'branch'
              ? { kind, config: { conditions: [{ field: 'is_hot', op: 'eq', value: true }], yes_step: null, no_step: null } }
              : { kind, config: {} },
      ],
    }))

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4 sm:p-4">
        <div className="flex items-center gap-2">
          <p className="font-medium">{existing ? `Edit “${existing.name}”` : 'New workflow'}</p>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>
            <X /> Close
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1 lg:col-span-2">
            <Label htmlFor="wf-name">Name</Label>
            <Input id="wf-name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. Facebook nurture" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="wf-trigger">When</Label>
            <Select id="wf-trigger" value={d.trigger} onChange={(e) => setD({ ...d, trigger: e.target.value as WorkflowTrigger })}>
              {TRIGGERS.map((t) => (
                <option key={t} value={t}>
                  {TRIGGER_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="wf-source">From source</Label>
            <Select id="wf-source" value={d.source} onChange={(e) => setD({ ...d, source: e.target.value })}>
              <option value="">any source</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
          {d.trigger === 'stage_changed' && (
            <>
              <div className="flex flex-col gap-1">
                <Label htmlFor="wf-from">Leaving</Label>
                <Select id="wf-from" value={d.fromStatus} onChange={(e) => setD({ ...d, fromStatus: e.target.value })}>
                  <option value="">any stage</option>
                  {STAGES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="wf-to">Into</Label>
                <Select id="wf-to" value={d.toStatus} onChange={(e) => setD({ ...d, toStatus: e.target.value })}>
                  <option value="">any stage</option>
                  {STAGES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </div>
            </>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor="wf-hot">Hot?</Label>
            <Select id="wf-hot" value={d.isHot} onChange={(e) => setD({ ...d, isHot: e.target.value as Draft['isHot'] })}>
              <option value="">either</option>
              <option value="true">only hot leads</option>
              <option value="false">only leads that are not hot</option>
            </Select>
          </div>
        </div>

        <ConditionsEditor value={d.conditions} onChange={(conditions) => setD({ ...d, conditions })} label="Only when" />

        <div className="flex flex-col gap-2">
          <Label>Steps</Label>
          <ol className="flex flex-col gap-2">
            {d.steps.map((s, i) => (
              <li key={i} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-6 text-xs font-semibold tabular-nums text-muted-foreground">{i + 1}.</span>
                  <StatusBadge tone={s.kind === 'action' ? 'info' : s.kind === 'delay' ? 'warning' : s.kind === 'branch' ? 'neutral' : 'danger'}>
                    {s.kind === 'action' ? <Zap className="mr-1 size-3" /> : s.kind === 'delay' ? <Timer className="mr-1 size-3" /> : s.kind === 'branch' ? <GitBranch className="mr-1 size-3" /> : null}
                    {s.kind}
                  </StatusBadge>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{describeStep(s, names)}</span>
                  <Button size="icon" variant="ghost" className="size-7" disabled={i === 0} onClick={() => moveStep(i, -1)} aria-label="Move up">
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-7" disabled={i === d.steps.length - 1} onClick={() => moveStep(i, 1)} aria-label="Move down">
                    <ArrowDown className="size-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-7" disabled={d.steps.length === 1} onClick={() => setD({ ...d, steps: d.steps.filter((_, j) => j !== i) })} aria-label="Remove step">
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <StepEditor step={s} index={i} total={d.steps.length} onChange={(next) => setStep(i, next)} />
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => addStep('action')}>
              <Zap /> Action
            </Button>
            <Button size="sm" variant="outline" onClick={() => addStep('delay')}>
              <Timer /> Wait
            </Button>
            <Button size="sm" variant="outline" onClick={() => addStep('branch')}>
              <GitBranch /> Branch
            </Button>
            <Button size="sm" variant="outline" onClick={() => addStep('exit')}>
              Stop
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={d.exit_on_reply} onChange={(e) => setD({ ...d, exit_on_reply: e.target.checked })} />
            Stop when the lead replies
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={d.allow_reenroll} onChange={(e) => setD({ ...d, allow_reenroll: e.target.checked })} />
            Allow a lead to go through it again
          </label>
        </div>

        <div className="rounded-md border border-border p-3">
          <p className="text-xs font-medium">When it notifies someone</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="wf-severity">How urgent</Label>
              <Select
                id="wf-severity"
                value={d.severity}
                onChange={(e) => setD({ ...d, severity: e.target.value as Draft['severity'] })}
              >
                <option value="info">For information</option>
                <option value="warning">Needs attention</option>
                <option value="critical">Critical</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="wf-cooldown">Do not repeat within</Label>
              <Input
                id="wf-cooldown"
                type="number"
                min={0}
                max={720}
                value={d.cooldown_hours}
                onChange={(e) => setD({ ...d, cooldown_hours: Math.max(0, Math.min(720, Number(e.target.value) || 0)) })}
              />
              <p className="text-xs text-muted-foreground">
                Hours. 0 notifies every time the rule fires.
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={d.notify_assignee}
                onChange={(e) => setD({ ...d, notify_assignee: e.target.checked })}
              />
              Tell whoever owns the lead
            </label>
            {NOTIFY_ROLES.map((r) => (
              <label key={r.value} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={d.notify_roles.includes(r.value)}
                  onChange={(e) =>
                    setD({
                      ...d,
                      notify_roles: e.target.checked
                        ? [...d.notify_roles, r.value]
                        : d.notify_roles.filter((x) => x !== r.value),
                    })
                  }
                />
                Also tell {r.label.toLowerCase()}
              </label>
            ))}
          </div>
          {!d.notify_assignee && d.notify_roles.length === 0 && (
            <p className="mt-2 text-xs text-warning">
              Nobody is set to hear this. A notify step will run and reach no one.
            </p>
          )}
        </div>

        {preview && <p className="text-sm text-muted-foreground">{preview}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div>
          <Button onClick={save} disabled={pending || d.name.trim().length < 2 || d.steps.length === 0}>
            {pending ? 'Saving…' : existing ? 'Save changes' : 'Save workflow'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function StepEditor({ step, index, total, onChange }: { step: WorkflowStepInput; index: number; total: number; onChange: (s: WorkflowStepInput) => void }) {
  const members = useMembers()
  const cadences = useCadences()
  const pipelines = usePipelines()
  const templates = useTemplates()
  if (step.kind === 'exit') return null
  if (step.kind === 'delay') {
    return (
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`st-amount-${index}`}>Wait</Label>
          <Input id={`st-amount-${index}`} inputMode="numeric" value={step.config.amount} onChange={(e) => onChange({ kind: 'delay', config: { ...step.config, amount: Math.max(1, Number(e.target.value) || 1) } })} className="w-24" />
        </div>
        <Select value={step.config.unit} onChange={(e) => onChange({ kind: 'delay', config: { ...step.config, unit: e.target.value as 'minutes' | 'hours' | 'days' } })} className="w-32" aria-label="Unit">
          <option value="minutes">minutes</option>
          <option value="hours">hours</option>
          <option value="days">days</option>
        </Select>
      </div>
    )
  }
  if (step.kind === 'branch') {
    const stepOptions = Array.from({ length: total }, (_, i) => i + 1).filter((n) => n !== index + 1)
    return (
      <div className="flex flex-col gap-2">
        <ConditionsEditor value={step.config.conditions} onChange={(conditions) => onChange({ kind: 'branch', config: { ...step.config, conditions } })} label="If" min={1} />
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`st-yes-${index}`}>then go to</Label>
            <Select id={`st-yes-${index}`} value={step.config.yes_step ?? ''} onChange={(e) => onChange({ kind: 'branch', config: { ...step.config, yes_step: e.target.value ? Number(e.target.value) : null } })} className="w-36">
              <option value="">next step</option>
              {stepOptions.map((n) => (
                <option key={n} value={n}>
                  step {n}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`st-no-${index}`}>otherwise go to</Label>
            <Select id={`st-no-${index}`} value={step.config.no_step ?? ''} onChange={(e) => onChange({ kind: 'branch', config: { ...step.config, no_step: e.target.value ? Number(e.target.value) : null } })} className="w-36">
              <option value="">next step</option>
              {stepOptions.map((n) => (
                <option key={n} value={n}>
                  step {n}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>
    )
  }
  const c = step.config
  const set = (patch: Partial<typeof c>) => onChange({ kind: 'action', config: { ...c, ...patch } })
  const stages = (pipelines.data ?? []).flatMap((p) => sortStages(p.stages).map((s) => ({ id: s.id, label: `${s.name}${(pipelines.data ?? []).length > 1 ? ` (${p.name})` : ''}` })))
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`st-action-${index}`}>Do</Label>
        <Select id={`st-action-${index}`} value={c.action} onChange={(e) => onChange({ kind: 'action', config: { action: e.target.value as WorkflowAction } })} className="w-52">
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABEL[a]}
            </option>
          ))}
        </Select>
      </div>
      {(c.action === 'assign_to' || c.action === 'notify_user') && (
        <Select value={c.user_id ?? ''} onChange={(e) => set({ user_id: e.target.value || undefined })} className="w-44" aria-label="Team member">
          <option value="">Pick someone…</option>
          {(members.data ?? []).map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.name}
            </option>
          ))}
        </Select>
      )}
      {c.action === 'set_follow_up_days' && (
        <Input inputMode="numeric" value={c.days ?? 1} onChange={(e) => set({ days: Number(e.target.value) || 0 })} className="w-24" aria-label="Days" />
      )}
      {(c.action === 'add_note' || c.action === 'notify_assignee' || c.action === 'notify_user') && (
        <Input value={c.note ?? ''} onChange={(e) => set({ note: e.target.value || undefined })} placeholder={c.action === 'add_note' ? 'Note to add' : 'Message (optional)'} className="w-64" aria-label="Note" />
      )}
      {c.action === 'start_cadence' && (
        <Select value={c.cadence_id ?? ''} onChange={(e) => set({ cadence_id: e.target.value || undefined })} className="w-52" aria-label="Cadence">
          <option value="">Pick a cadence…</option>
          {(cadences.data ?? []).filter((x) => x.is_active).map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Select>
      )}
      {c.action === 'set_stage' && (
        <>
          <Select value={c.stage_id ?? ''} onChange={(e) => set({ stage_id: e.target.value || undefined })} className="w-52" aria-label="Stage">
            <option value="">Pick a stage…</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
          <Input value={c.lost_reason ?? ''} onChange={(e) => set({ lost_reason: e.target.value || undefined })} placeholder="Lost reason (if the stage is Lost)" className="w-56" aria-label="Lost reason" />
        </>
      )}
      {c.action === 'create_task' && (
        <>
          <Input value={c.subject ?? ''} onChange={(e) => set({ subject: e.target.value || undefined })} placeholder="Task" className="w-56" aria-label="Task" />
          <Input inputMode="numeric" value={c.days ?? 0} onChange={(e) => set({ days: Number(e.target.value) || 0 })} className="w-24" aria-label="Due in days" title="Due in days" />
        </>
      )}
      {c.action === 'add_score' && (
        <Input inputMode="numeric" value={c.points ?? 10} onChange={(e) => set({ points: Number(e.target.value) || 0 })} className="w-24" aria-label="Points" />
      )}
      {c.action === 'send_template' && (
        <>
          <Select value={c.template_id ?? ''} onChange={(e) => set({ template_id: e.target.value || undefined })} className="w-52" aria-label="Template">
            <option value="">Pick a template…</option>
            {(templates.data ?? []).filter((t) => t.kind !== 'note').map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Select value={c.channel ?? 'whatsapp'} onChange={(e) => set({ channel: e.target.value as 'whatsapp' | 'email' })} className="w-32" aria-label="Channel">
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
          </Select>
        </>
      )}
    </div>
  )
}

/** Rows of field / operator / value over the lead's facts. */
export function ConditionsEditor({ value, onChange, label, min = 0 }: { value: FieldCondition[]; onChange: (v: FieldCondition[]) => void; label: string; min?: number }) {
  const setRow = (i: number, row: FieldCondition) => onChange(value.map((r, j) => (j === i ? row : r)))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Label>{label}</Label>
        <Button size="sm" variant="ghost" onClick={() => onChange([...value, { field: 'score', op: 'gte', value: 40 }])}>
          <Plus /> Condition
        </Button>
      </div>
      {value.map((row, i) => {
        const meta = CONDITION_FIELDS.find((f) => f.key === row.field)
        const noValue = row.op === 'is_null' || row.op === 'not_null'
        return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Select value={row.field} onChange={(e) => setRow(i, { ...row, field: e.target.value })} className="w-56" aria-label="Field">
              {CONDITION_FIELDS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </Select>
            <Select value={row.op} onChange={(e) => setRow(i, { ...row, op: e.target.value as ConditionOp })} className="w-40" aria-label="Operator">
              {OPS.map((o) => (
                <option key={o} value={o}>
                  {OP_LABEL[o]}
                </option>
              ))}
            </Select>
            {!noValue &&
              (meta?.type === 'boolean' ? (
                <Select value={String(row.value ?? 'true')} onChange={(e) => setRow(i, { ...row, value: e.target.value === 'true' })} className="w-28" aria-label="Value">
                  <option value="true">yes</option>
                  <option value="false">no</option>
                </Select>
              ) : row.op === 'in' ? (
                <Input
                  value={Array.isArray(row.value) ? row.value.join(', ') : ''}
                  onChange={(e) => setRow(i, { ...row, value: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                  placeholder="a, b, c"
                  className="w-56"
                  aria-label="Values"
                />
              ) : (
                <Input
                  type={meta?.type === 'number' ? 'number' : meta?.type === 'date' ? 'date' : 'text'}
                  value={row.value === undefined || row.value === null || Array.isArray(row.value) ? '' : String(row.value)}
                  onChange={(e) => setRow(i, { ...row, value: meta?.type === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value })}
                  className="w-40"
                  aria-label="Value"
                />
              ))}
            <Button size="icon" variant="ghost" className="size-7" disabled={value.length <= min} onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove condition">
              <X className="size-3.5" />
            </Button>
          </div>
        )
      })}
    </div>
  )
}
