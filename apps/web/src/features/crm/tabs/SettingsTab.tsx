import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Archive, ArrowDown, ArrowUp, Columns3, Gauge, KanbanSquare, Megaphone, Plug, Plus, RefreshCw, RotateCcw, Timer, Trash2, XCircle } from 'lucide-react'
import type { ConditionOp, CrmLead, PipelineStage, StageKind, StageRequiredField } from '@ipc/contracts'
import { CONDITION_FIELDS, OP_LABEL, REQUIRED_FIELD_LABEL, sortStages } from '@ipc/domain'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label, Select } from '@/shared/ui/input'
import { Skeleton } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { useConfirm } from '@/shared/ui/confirm'
import { useAccess } from '@/shared/auth/useAccess'
import { useAuth } from '@/shared/auth/AuthProvider'
import {
  useBulkPatch,
  useCreateLostReason,
  useCreatePipeline,
  useCreateScoringRule,
  useCreateStage,
  useCrmPrefs,
  useCrmSettings,
  useDeleteLostReason,
  useDeletePipeline,
  useDeleteScoringRule,
  useDeleteStage,
  useEmailSync,
  useIntegrations,
  useLostReasons,
  usePipelines,
  useRecomputeScores,
  useReorderStages,
  useSavedViews,
  useScoringRules,
  useUpdateCrmPrefs,
  useUpdateCrmSettings,
  useUpdateIntegration,
  useUpdateLostReason,
  useUpdatePipeline,
  useUpdateScoringRule,
  useUpdateStage,
} from '../api'
import { DEFAULT_INBOX_COLUMNS } from './shared'

const REQUIRED_OPTIONS: StageRequiredField[] = ['deal_value', 'close_date', 'email', 'name', 'assigned_to', 'title', 'lost_reason']
const STAGE_KINDS: Array<{ key: StageKind; label: string; hint: string }> = [
  { key: 'open', label: 'Open', hint: 'still being worked' },
  { key: 'won', label: 'Won', hint: 'counts as a sale' },
  { key: 'lost', label: 'Lost', hint: 'asks for a reason' },
]

/** Housekeeping: the things done once a quarter, not once an hour. */
export function CrmSettingsTab({ leads, archived }: { leads: readonly CrmLead[]; archived: readonly CrmLead[] }) {
  const bulk = useBulkPatch()
  const confirm = useConfirm()
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const lost = leads.filter((l) => l.status === 'lost')

  async function archiveLost() {
    if (lost.length === 0) return
    const yes = await confirm({
      title: `Archive ${lost.length} lost lead${lost.length === 1 ? '' : 's'}?`,
      description: 'They leave the inbox and boards but stay in reports and history. Undo is offered right after.',
      confirmLabel: 'Archive',
    })
    if (yes) bulk.mutate({ ids: lost.map((l) => l.id), patch: { is_archived: true } })
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <PipelinesCard />
      <LostReasonsCard />
      <IntegrationsCard />
      <ScoringCard />
      <SlaCard />
      <MyViewCard />
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <p className="flex items-center gap-2 font-medium">
            <Archive className="size-4 text-muted-foreground" /> Archive lost leads
          </p>
          <p className="text-sm text-muted-foreground">
            {lost.length} lost lead{lost.length === 1 ? '' : 's'} in the inbox, {archived.length} already archived. Archiving keeps them for reports and hides them from the working lists.
          </p>
          <div>
            <Button variant="outline" disabled={!canEdit || lost.length === 0 || bulk.isPending} onClick={() => void archiveLost()}>
              Archive {lost.length} lost lead{lost.length === 1 ? '' : 's'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Tick “Show archived” in the inbox to see or restore them.</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <p className="flex items-center gap-2 font-medium">
            <Megaphone className="size-4 text-muted-foreground" /> Where leads come from
          </p>
          <p className="text-sm text-muted-foreground">
            Web forms and Meta lead ads post straight into this inbox. Each source has its own URL you can pause or delete.
          </p>
          {access.hasModule('lead_sources') && (
            <div>
              <Button variant="outline" asChild>
                <Link to="/lead-sources">Manage lead sources</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/** How this person likes the inbox: density, columns and the view it opens on. */
function MyViewCard() {
  const { data: prefs } = useCrmPrefs()
  const update = useUpdateCrmPrefs()
  const { data: views } = useSavedViews()
  const columns = prefs?.columns ?? DEFAULT_INBOX_COLUMNS

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <p className="flex items-center gap-2 font-medium">
          <Columns3 className="size-4 text-muted-foreground" /> My inbox view
        </p>
        <div className="flex flex-col gap-1.5">
          <Label>Open the inbox on</Label>
          <Select
            value={prefs?.default_view_id ?? ''}
            onChange={(e) => update.mutate({ default_view_id: e.target.value || null })}
            disabled={update.isPending}
          >
            <option value="">The full list</option>
            {(views ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Density</Label>
          <div className="flex gap-2">
            {(['comfortable', 'compact'] as const).map((d) => (
              <Button
                key={d}
                size="sm"
                variant={prefs?.density === d ? 'default' : 'outline'}
                disabled={update.isPending}
                onClick={() => update.mutate({ density: d })}
              >
                {d === 'comfortable' ? 'Roomy' : 'Compact'}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {columns.length} of {10} columns showing. Change them from the Columns button in the inbox.
          </p>
          <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ columns: [...DEFAULT_INBOX_COLUMNS] })}>
            <RotateCcw /> Reset
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * The studio's pipelines and their stages. Stage moves are enforced in the
 * database (WIP limit, required fields), so what is set here is what the
 * board and the drawer obey.
 */
function PipelinesCard() {
  const { session } = useAuth()
  const isOwner = !!session?.is_owner
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const canDelete = access.hasAction('crm', 'delete')
  const { data, isLoading } = usePipelines()
  const createPipeline = useCreatePipeline()
  const updatePipeline = useUpdatePipeline()
  const deletePipeline = useDeletePipeline()
  const createStage = useCreateStage()
  const updateStage = useUpdateStage()
  const reorder = useReorderStages()
  const deleteStage = useDeleteStage()
  const confirm = useConfirm()
  const [pick, setPick] = useState<string | null>(null)
  const [newPipeline, setNewPipeline] = useState('')
  const [newStage, setNewStage] = useState('')
  const [newStageKind, setNewStageKind] = useState<StageKind>('open')
  const [editing, setEditing] = useState<string | null>(null)

  const list = data ?? []
  const current = list.find((p) => p.id === pick) ?? list.find((p) => p.is_default) ?? list[0] ?? null
  const stages = current ? sortStages(current.stages) : []

  function moveStage(index: number, dir: -1 | 1) {
    if (!current) return
    const next = [...stages]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    reorder.mutate({ pipelineId: current.id, stage_ids: next.map((s) => s.id) })
  }

  async function removeStage(s: PipelineStage) {
    if (s.deal_count > 0) return
    if (await confirm({ title: `Remove the stage "${s.name}"?`, confirmLabel: 'Remove', destructive: true })) deleteStage.mutate(s.id)
  }

  async function removePipeline() {
    if (!current || current.is_default) return
    const yes = await confirm({
      title: `Delete the pipeline "${current.name}"?`,
      description: 'Its deals move to the default pipeline, stage by stage.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (yes) deletePipeline.mutate(current.id, { onSuccess: () => setPick(null) })
  }

  return (
    <Card className="md:col-span-2">
      <CardContent className="flex flex-col gap-3 p-4">
        <p className="flex items-center gap-2 font-medium">
          <KanbanSquare className="size-4 text-muted-foreground" /> Pipelines &amp; stages
        </p>
        <p className="text-sm text-muted-foreground">
          The columns on the Pipeline View. A stage can cap how many deals sit in it and insist on fields before a deal enters.
        </p>
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {list.length > 1 && current && (
                <Select value={current.id} onChange={(e) => setPick(e.target.value)} className="w-56" aria-label="Pipeline">
                  {list.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.is_default ? ' (default)' : ''}
                    </option>
                  ))}
                </Select>
              )}
              {current && list.length === 1 && <span className="text-sm font-medium">{current.name}</span>}
              {current && !current.is_default && isOwner && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => updatePipeline.mutate({ id: current.id, patch: { is_default: true } })}>
                    Make default
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void removePipeline()}>
                    <Trash2 /> Delete pipeline
                  </Button>
                </>
              )}
              {isOwner && (
                <span className="ml-auto flex items-center gap-2">
                  <Input value={newPipeline} onChange={(e) => setNewPipeline(e.target.value)} placeholder="New pipeline" className="w-40" aria-label="New pipeline name" />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={newPipeline.trim().length < 2 || createPipeline.isPending}
                    onClick={() => createPipeline.mutate({ name: newPipeline.trim(), is_default: false }, { onSuccess: (p) => { setNewPipeline(''); setPick(p.id) } })}
                  >
                    <Plus /> Add
                  </Button>
                </span>
              )}
            </div>

            {current && (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {stages.map((s, i) => (
                  <li key={s.id} className="flex flex-col gap-2 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex flex-col">
                        <Button size="icon" variant="ghost" className="size-6" disabled={!canEdit || i === 0} onClick={() => moveStage(i, -1)} aria-label={`Move ${s.name} up`}>
                          <ArrowUp className="size-3" />
                        </Button>
                        <Button size="icon" variant="ghost" className="size-6" disabled={!canEdit || i === stages.length - 1} onClick={() => moveStage(i, 1)} aria-label={`Move ${s.name} down`}>
                          <ArrowDown className="size-3" />
                        </Button>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{s.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{s.key}</span>
                      </span>
                      <StatusBadge tone={s.kind === 'won' ? 'success' : s.kind === 'lost' ? 'danger' : 'info'}>{s.kind}</StatusBadge>
                      <span className="text-xs text-muted-foreground">{s.probability_default}%</span>
                      {s.wip_limit !== null && <StatusBadge tone="neutral">WIP {s.wip_limit}</StatusBadge>}
                      <span className="text-xs text-muted-foreground">{s.deal_count} deal{s.deal_count === 1 ? '' : 's'}</span>
                      {canEdit && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(editing === s.id ? null : s.id)}>
                            {editing === s.id ? 'Done' : 'Edit'}
                          </Button>
                        </>
                      )}
                      {canDelete && (
                        <Button size="sm" variant="ghost" disabled={s.deal_count > 0} title={s.deal_count > 0 ? 'Move its deals out first' : undefined} onClick={() => void removeStage(s)}>
                          <Trash2 />
                          <span className="sr-only">Remove {s.name}</span>
                        </Button>
                      )}
                    </div>
                    {editing === s.id && <StageEditor stage={s} onSave={(patch) => updateStage.mutate({ id: s.id, patch })} pending={updateStage.isPending} />}
                  </li>
                ))}
              </ul>
            )}

            {current && canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                <Input value={newStage} onChange={(e) => setNewStage(e.target.value)} placeholder="New stage, e.g. Negotiation" className="w-56" aria-label="New stage name" />
                <Select value={newStageKind} onChange={(e) => setNewStageKind(e.target.value as StageKind)} className="w-32" aria-label="What the stage means">
                  {STAGE_KINDS.map((k) => (
                    <option key={k.key} value={k.key}>
                      {k.label}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!newStage.trim() || createStage.isPending}
                  onClick={() =>
                    createStage.mutate(
                      { pipelineId: current.id, name: newStage.trim(), kind: newStageKind, required_fields: [] },
                      { onSuccess: () => { setNewStage(''); setNewStageKind('open') } },
                    )
                  }
                >
                  <Plus /> Add stage
                </Button>
                <span className="text-xs text-muted-foreground">Use the arrows to place it. A second Won stage lets you tell a deposit from a full booking.</span>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function StageEditor({
  stage,
  onSave,
  pending,
}: {
  stage: PipelineStage
  onSave: (patch: { name?: string; kind?: StageKind; probability_default?: number; wip_limit?: number | null; required_fields?: StageRequiredField[] }) => void
  pending: boolean
}) {
  const [name, setName] = useState(stage.name)
  const [kind, setKind] = useState<StageKind>(stage.kind)
  const [prob, setProb] = useState(String(stage.probability_default))
  const [wip, setWip] = useState(stage.wip_limit === null ? '' : String(stage.wip_limit))
  const [required, setRequired] = useState<StageRequiredField[]>(stage.required_fields)
  const toggle = (f: StageRequiredField) => setRequired((r) => (r.includes(f) ? r.filter((x) => x !== f) : [...r, f]))
  const p = Number(prob)
  const w = wip === '' ? null : Number(wip)
  const valid = name.trim().length > 0 && Number.isInteger(p) && p >= 0 && p <= 100 && (w === null || (Number.isInteger(w) && w >= 1 && w <= 1000))
  return (
    <div className="grid gap-3 rounded-lg bg-muted/30 p-3 sm:grid-cols-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`st-name-${stage.id}`}>Name</Label>
        <Input id={`st-name-${stage.id}`} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`st-kind-${stage.id}`}>This stage means</Label>
        <Select id={`st-kind-${stage.id}`} value={kind} onChange={(e) => setKind(e.target.value as StageKind)}>
          {STAGE_KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label} — {k.hint}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`st-prob-${stage.id}`}>Default probability %</Label>
        <Input id={`st-prob-${stage.id}`} type="number" min={0} max={100} value={prob} onChange={(e) => setProb(e.target.value)} disabled={kind !== 'open'} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`st-wip-${stage.id}`}>WIP limit</Label>
        <Input id={`st-wip-${stage.id}`} type="number" min={1} max={1000} value={wip} onChange={(e) => setWip(e.target.value)} placeholder="No limit" />
      </div>
      {kind === 'open' && (
        <div className="flex flex-col gap-1 sm:col-span-3">
          <Label>Required before entering</Label>
          <div className="flex flex-wrap gap-2">
            {REQUIRED_OPTIONS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={required.includes(f)}
                onClick={() => toggle(f)}
                className={`rounded-full border px-2.5 py-1 text-xs ${required.includes(f) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}
              >
                {REQUIRED_FIELD_LABEL[f] ?? f}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="sm:col-span-3">
        <Button size="sm" disabled={!valid || pending} onClick={() => onSave({ name: name.trim(), kind, probability_default: p, wip_limit: w, required_fields: required })}>
          Save stage
        </Button>
      </div>
    </div>
  )
}

/** The picklist offered whenever a deal is marked lost. */
function LostReasonsCard() {
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const canDelete = access.hasAction('crm', 'delete')
  const { data, isLoading } = useLostReasons()
  const create = useCreateLostReason()
  const update = useUpdateLostReason()
  const remove = useDeleteLostReason()
  const [label, setLabel] = useState('')
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <p className="flex items-center gap-2 font-medium">
          <XCircle className="size-4 text-muted-foreground" /> Lost reasons
        </p>
        <p className="text-sm text-muted-foreground">Every lost deal picks one of these, so the lost analysis in Reports means something.</p>
        {isLoading ? (
          <Skeleton className="h-20" />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {(data ?? []).map((r) => (
              <li key={r.id} className={`flex items-center gap-1 rounded-full border border-border py-1 pl-3 pr-1 text-sm ${r.is_active ? '' : 'opacity-50'}`}>
                <span>{r.label}</span>
                {canEdit && (
                  <>
                    <button type="button" className="rounded-full px-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => update.mutate({ id: r.id, patch: { is_active: !r.is_active } })}>
                      {r.is_active ? 'hide' : 'show'}
                    </button>
                  </>
                )}
                {canDelete && (
                  <button type="button" className="rounded-full p-0.5 text-muted-foreground hover:text-destructive" onClick={() => remove.mutate(r.id)} aria-label={`Remove ${r.label}`}>
                    <Trash2 className="size-3" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="flex items-center gap-2">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Add a reason" className="w-48" aria-label="New lost reason" />
            <Button size="sm" variant="outline" disabled={label.trim().length < 3 || create.isPending} onClick={() => create.mutate({ label: label.trim() }, { onSuccess: () => setLabel('') })}>
              <Plus /> Add
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

const PROVIDER_LABEL: Record<string, string> = { gmail: 'Gmail', o365: 'Microsoft 365', twilio: 'Twilio calling' }
const PROVIDER_HINT: Record<string, string> = {
  gmail: 'Files sent and received mail under the matching deal. Needs EMAIL_SYNC_PROVIDER=gmail, a token and the mailbox on the API.',
  o365: 'Same as Gmail, for a Microsoft 365 mailbox (EMAIL_SYNC_PROVIDER=o365).',
  twilio: '“Call now” rings you first, then the lead. Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER on the API.',
}

/** What the studio has connected. Credentials live on the server; this shows whether they are there and lets the owner switch each one on. */
function IntegrationsCard() {
  const { session } = useAuth()
  const isOwner = !!session?.is_owner
  const { data, isLoading } = useIntegrations()
  const update = useUpdateIntegration()
  const sync = useEmailSync()
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <p className="flex items-center gap-2 font-medium">
          <Plug className="size-4 text-muted-foreground" /> Integrations
        </p>
        <p className="text-sm text-muted-foreground">Email and calling, wired to the timeline. See the runbook for the credentials each one needs.</p>
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {(data ?? []).map((i) => {
              const on = i.status === 'connected'
              return (
                <li key={i.provider} className="flex flex-col gap-1 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{PROVIDER_LABEL[i.provider] ?? i.provider}</span>
                    <StatusBadge tone={i.status === 'error' ? 'danger' : on ? 'success' : 'neutral'}>{i.status === 'error' ? 'Error' : on ? 'On' : 'Off'}</StatusBadge>
                    <StatusBadge tone={i.credentials_present ? 'info' : 'warning'}>{i.credentials_present ? 'Credentials on server' : 'No credentials'}</StatusBadge>
                    <span className="ml-auto flex gap-1">
                      {i.provider !== 'twilio' && on && (
                        <Button size="sm" variant="ghost" disabled={sync.isPending || !i.credentials_present} onClick={() => sync.mutate(7)}>
                          <RefreshCw /> Sync now
                        </Button>
                      )}
                      {isOwner && (
                        <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ provider: i.provider, patch: { status: on ? 'not_configured' : 'connected' } })}>
                          {on ? 'Switch off' : 'Switch on'}
                        </Button>
                      )}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{PROVIDER_HINT[i.provider]}</p>
                  {i.last_error && <p className="text-xs text-destructive">{i.last_error}</p>}
                  {i.last_sync_at && <p className="text-xs text-muted-foreground">Last sync {new Date(i.last_sync_at).toLocaleString('en-IN')}</p>}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

const OPS: ConditionOp[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in', 'is_null', 'not_null']

/** Points a lead earns for each fact about it; the sum is its score, recomputed on every change. */
function ScoringCard() {
  const { session } = useAuth()
  const isOwner = !!session?.is_owner
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const canDelete = access.hasAction('crm', 'delete')
  const { data, isLoading } = useScoringRules()
  const settings = useCrmSettings()
  const saveSettings = useUpdateCrmSettings()
  const create = useCreateScoringRule()
  const update = useUpdateScoringRule()
  const remove = useDeleteScoringRule()
  const recompute = useRecomputeScores()
  const [label, setLabel] = useState('')
  const [field, setField] = useState('deal_value')
  const [op, setOp] = useState<ConditionOp>('gte')
  const [value, setValue] = useState('')
  const [points, setPoints] = useState('10')
  const [hot, setHot] = useState('')
  useEffect(() => {
    if (settings.data) setHot(String(settings.data.hot_score))
  }, [settings.data])
  const meta = CONDITION_FIELDS.find((f) => f.key === field)
  const noValue = op === 'is_null' || op === 'not_null'

  function add() {
    const p = Number(points)
    if (!Number.isInteger(p) || label.trim().length < 2) return
    const v: string | number | boolean | Array<string | number> | undefined = noValue
      ? undefined
      : op === 'in'
        ? value.split(',').map((x) => x.trim()).filter(Boolean).map((x) => (meta?.type === 'number' ? Number(x) : x))
        : meta?.type === 'number'
          ? Number(value)
          : meta?.type === 'boolean'
            ? value !== 'false'
            : value
    create.mutate({ label: label.trim(), field, op, points: p, ...(v === undefined ? {} : { value: v }) }, { onSuccess: () => { setLabel(''); setValue('') } })
  }

  return (
    <Card className="md:col-span-2">
      <CardContent className="flex flex-col gap-3 p-4">
        <p className="flex items-center gap-2 font-medium">
          <Gauge className="size-4 text-muted-foreground" /> Lead scoring
        </p>
        <p className="text-sm text-muted-foreground">
          Each rule adds or removes points when its fact is true of a deal. Scores recompute on every change; deals at or above the hot score show a flame.
        </p>
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {(data ?? []).map((r) => (
              <li key={r.id} className={`flex flex-wrap items-center gap-2 p-2.5 ${r.is_active ? '' : 'opacity-50'}`}>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{r.label}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {CONDITION_FIELDS.find((f) => f.key === r.field)?.label ?? r.field} {OP_LABEL[r.op]}
                    {r.op === 'is_null' || r.op === 'not_null'
                      ? ''
                      : ` ${Array.isArray(r.value) ? r.value.join(', ') : String(r.value ?? '')}`}
                  </span>
                </span>
                <StatusBadge tone={r.points >= 0 ? 'success' : 'danger'}>
                  {r.points >= 0 ? '+' : ''}
                  {r.points}
                </StatusBadge>
                {canEdit && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: r.id, patch: { is_active: !r.is_active } })}>
                      {r.is_active ? 'Off' : 'On'}
                    </Button>
                  </>
                )}
                {canDelete && (
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(r.id)} aria-label={`Remove ${r.label}`}>
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="sc-label">Rule</Label>
              <Input id="sc-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Big wedding" className="w-40" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="sc-field">When</Label>
              <Select id="sc-field" value={field} onChange={(e) => setField(e.target.value)} className="w-52">
                {CONDITION_FIELDS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </div>
            <Select value={op} onChange={(e) => setOp(e.target.value as ConditionOp)} className="w-36" aria-label="Operator">
              {OPS.map((o) => (
                <option key={o} value={o}>
                  {OP_LABEL[o]}
                </option>
              ))}
            </Select>
            {!noValue &&
              (meta?.type === 'boolean' ? (
                <Select value={value || 'true'} onChange={(e) => setValue(e.target.value)} className="w-24" aria-label="Value">
                  <option value="true">yes</option>
                  <option value="false">no</option>
                </Select>
              ) : op === 'in' ? (
                <Input value={value} onChange={(e) => setValue(e.target.value)} className="w-44" placeholder="referral, webform" aria-label="Values, comma separated" />
              ) : (
                <Input type={meta?.type === 'number' ? 'number' : meta?.type === 'date' ? 'date' : 'text'} value={value} onChange={(e) => setValue(e.target.value)} className="w-32" aria-label="Value" />
              ))}
            <div className="flex flex-col gap-1">
              <Label htmlFor="sc-points">Points</Label>
              <Input id="sc-points" type="number" min={-100} max={100} value={points} onChange={(e) => setPoints(e.target.value)} className="w-20" />
            </div>
            <Button size="sm" variant="outline" disabled={create.isPending || label.trim().length < 2} onClick={add}>
              <Plus /> Add rule
            </Button>
            <Button size="sm" variant="ghost" disabled={recompute.isPending} onClick={() => recompute.mutate()} title="Apply the rules to every open deal now">
              <RefreshCw /> Rescore all
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="hot-score">Hot score</Label>
            <Input id="hot-score" type="number" min={1} max={1000} value={hot} onChange={(e) => setHot(e.target.value)} disabled={!isOwner} className="w-28" />
          </div>
          <Button size="sm" disabled={!isOwner || saveSettings.isPending || hot === String(settings.data?.hot_score ?? '')} onClick={() => saveSettings.mutate({ hot_score: Number(hot) })}>
            Save
          </Button>
          {!isOwner && <p className="text-xs text-muted-foreground">Only the studio owner can change the threshold.</p>}
        </div>
      </CardContent>
    </Card>
  )
}

/** The response-time target the Team Dashboard measures everyone against. */
function SlaCard() {
  const { session } = useAuth()
  const { data, isLoading } = useCrmSettings()
  const save = useUpdateCrmSettings()
  const [hours, setHours] = useState('')
  const [error, setError] = useState<string | null>(null)
  const isOwner = !!session?.is_owner

  useEffect(() => {
    if (data) setHours(String(data.sla_hours))
  }, [data])

  function onSave() {
    setError(null)
    const n = Number(hours)
    if (!Number.isInteger(n) || n < 1 || n > 720) {
      setError('Between 1 and 720 hours.')
      return
    }
    save.mutate({ sla_hours: n })
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <p className="flex items-center gap-2 font-medium">
          <Timer className="size-4 text-muted-foreground" /> First-contact SLA
        </p>
        <p className="text-sm text-muted-foreground">
          How long a new lead may wait before someone reaches out and it still counts as on time. The Team Dashboard shows each person's share within it.
        </p>
        {isLoading ? (
          <Skeleton className="h-9 w-40" />
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="sla-hours">Hours</Label>
              <Input
                id="sla-hours"
                type="number"
                min={1}
                max={720}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                disabled={!isOwner}
                className="w-28"
                aria-invalid={!!error}
                aria-describedby={error ? 'sla-error' : undefined}
              />
            </div>
            <Button size="sm" disabled={!isOwner || save.isPending || hours === String(data?.sla_hours ?? '')} onClick={onSave}>
              Save
            </Button>
          </div>
        )}
        {error && (
          <p id="sla-error" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {!isOwner && <p className="text-xs text-muted-foreground">Only the studio owner can change this.</p>}
      </CardContent>
    </Card>
  )
}
