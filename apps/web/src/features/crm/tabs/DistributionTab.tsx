import { useState } from 'react'
import { ArrowRightLeft, Trash2, UserPlus, Users } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { useAccess } from '@/shared/auth/useAccess'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useMembers } from '@/features/allocation/api'
import { isOpen } from '../leads'
import {
  useAddToRota,
  useBulkPatch,
  useLeads,
  useCrmSettings,
  useDistribution,
  useRemoveFromRota,
  useUpdateCrmSettings,
  useUpdateDistribution,
} from '../api'

/**
 * Hand one person's whole desk to someone else.
 *
 * The bulk toolbar can only reassign what is selected on screen, so moving a
 * leaving rep's four hundred open leads meant selecting them in batches. This
 * is the question actually being asked when someone leaves or goes on leave.
 *
 * It moves OPEN leads only. A converted or lost lead belongs to the history of
 * who worked it, and rewriting that would quietly change every past report.
 */
function HandOverCard() {
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const members = useMembers()
  const { data: leads } = useLeads(false)
  const bulk = useBulkPatch()
  const confirm = useConfirm()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const open = (leads ?? []).filter(isOpen)
  const moving = from ? open.filter((l) => (from === 'none' ? l.assigned_to === null : l.assigned_to === from)) : []
  const fromName =
    from === 'none' ? 'nobody' : (members.data ?? []).find((m) => m.user_id === from)?.name ?? 'them'
  const toName = (members.data ?? []).find((m) => m.user_id === to)?.name ?? ''

  async function go() {
    if (!from || !to || moving.length === 0) return
    const ok = await confirm({
      title: `Move ${moving.length} open ${moving.length === 1 ? 'lead' : 'leads'} to ${toName}?`,
      description: `Currently with ${fromName}. Closed and lost leads stay where they are, so past reports do not change.`,
      confirmLabel: 'Move them',
    })
    if (!ok) return
    // crm_bulk_patch takes 200 ids at a time, so a full desk goes in batches.
    for (let i = 0; i < moving.length; i += 200) {
      bulk.mutate({ ids: moving.slice(i, i + 200).map((l) => l.id), patch: { assigned_to: to } })
    }
    setFrom('')
    setTo('')
  }

  if (!canEdit) return null

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div>
          <p className="flex items-center gap-2 font-medium">
            <ArrowRightLeft className="size-4 text-muted-foreground" /> Hand a desk over
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            For somebody leaving or going on leave. Open leads move; closed and lost ones stay.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-44 flex-col gap-1">
            <Label htmlFor="handover-from">From</Label>
            <Select id="handover-from" value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">Pick a person…</option>
              <option value="none">— Unassigned —</option>
              {(members.data ?? []).map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex min-w-44 flex-col gap-1">
            <Label htmlFor="handover-to">To</Label>
            <Select id="handover-to" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Pick a person…</option>
              {(members.data ?? [])
                .filter((m) => m.user_id !== from)
                .map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name}
                  </option>
                ))}
            </Select>
          </div>
          <Button disabled={!from || !to || moving.length === 0 || bulk.isPending} onClick={() => void go()}>
            Move {moving.length > 0 ? moving.length : ''}
          </Button>
        </div>
        {from && moving.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing open is with {fromName}.</p>
        )}
      </CardContent>
    </Card>
  )
}

/** Who new leads get handed to, and what each is carrying. */
export function DistributionTab() {
  const { data, isLoading, isError, error, refetch } = useDistribution()
  const members = useMembers()
  const patch = useUpdateDistribution()
  const add = useAddToRota()
  const remove = useRemoveFromRota()
  const confirm = useConfirm()
  const access = useAccess()
  const { session } = useAuth()
  const isOwner = !!session?.is_owner
  const canEdit = access.hasAction('crm', 'edit')
  const canDelete = access.hasAction('crm', 'delete')
  const [pick, setPick] = useState('')
  const settings = useCrmSettings()
  const saveSettings = useUpdateCrmSettings()
  const strategy = settings.data?.assign_strategy ?? 'least_loaded'

  if (isLoading) return <SkeletonCards count={4} />
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />

  const onRota = new Set((data ?? []).map((r) => r.user_id))
  const candidates = (members.data ?? []).filter((m) => !onRota.has(m.user_id))

  async function onRemove(id: string, name: string) {
    if (await confirm({ title: `Take ${name} off the rota?`, description: 'Leads they already own stay with them.', confirmLabel: 'Remove', destructive: true })) {
      remove.mutate(id)
    }
  }

  return (
    <div className="flex flex-col gap-4">
    <Card>
      <CardContent className="p-4 sm:p-4">
        <h3 className="font-semibold tracking-tight">Lead distribution</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {strategy === 'round_robin'
            ? 'New unassigned leads go round the active members in turn. Priority sets who starts (0 = first).'
            : 'New unassigned leads go to the active member with fewest open leads. Priority breaks ties (0 = first).'}
        </p>

        {/* Until now this was a sentence and not a setting: the rota row had a
            strategy column nothing read, so the choice was made in a comment.
            The picker below is the whole studio's rule, which is what it always
            was -- a per-person strategy is not a thing that can mean anything. */}
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="flex min-w-56 flex-col gap-1">
            <Label htmlFor="assign-strategy">How to share them out</Label>
            <Select
              id="assign-strategy"
              value={strategy}
              disabled={!isOwner || saveSettings.isPending}
              onChange={(e) => saveSettings.mutate({ assign_strategy: e.target.value as typeof strategy })}
            >
              <option value="least_loaded">Whoever is carrying least</option>
              <option value="round_robin">Take turns</option>
            </Select>
          </div>
          {!isOwner && <p className="pb-2 text-xs text-muted-foreground">Only the studio owner can change this.</p>}
        </div>

        {canEdit && (
          <div className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <Label htmlFor="rota-pick">Add to the rota</Label>
              <Select id="rota-pick" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Pick a team member…</option>
                {candidates.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button disabled={!pick || add.isPending} onClick={() => add.mutate({ user_id: pick, priority: 0, source_filter: [] }, { onSuccess: () => setPick('') })}>
              <UserPlus /> Add
            </Button>
          </div>
        )}

        {!data || data.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="No rota set up" description="Until someone is on the rota, new leads arrive unassigned." />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Users className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.user_name ?? 'Unknown'}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Label htmlFor={`prio-${r.id}`} className="text-xs text-muted-foreground">
                      Priority
                    </Label>
                    <Input
                      id={`prio-${r.id}`}
                      type="number"
                      defaultValue={r.priority}
                      min={0}
                      max={100}
                      disabled={!canEdit}
                      className="h-8 w-20"
                      onBlur={(e) => {
                        const v = parseInt(e.target.value, 10)
                        if (!Number.isNaN(v) && v !== r.priority) patch.mutate({ id: r.id, patch: { priority: v } })
                      }}
                    />
                  </div>
                </div>
                <StatusBadge tone={r.is_active ? 'success' : 'neutral'}>{r.is_active ? 'Active' : 'Paused'}</StatusBadge>
                <StatusBadge>{r.lead_count} open</StatusBadge>
                {strategy === 'round_robin' && r.assigned_count > 0 && (
                  <StatusBadge tone="neutral">{r.assigned_count} given</StatusBadge>
                )}
                {canEdit && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => patch.mutate({ id: r.id, patch: { is_active: !r.is_active } })}>
                      {r.is_active ? 'Pause' : 'Activate'}
                    </Button>
                  </>
                )}
                {canDelete && (
                  <Button size="sm" variant="ghost" onClick={() => void onRemove(r.id, r.user_name ?? 'this member')}>
                    <Trash2 />
                    <span className="sr-only">Remove {r.user_name ?? 'member'} from the rota</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
    <HandOverCard />
    </div>
  )
}
