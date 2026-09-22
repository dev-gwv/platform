import { useState } from 'react'
import { Trash2, UserPlus, Users } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { useAccess } from '@/shared/auth/useAccess'
import { useMembers } from '@/features/allocation/api'
import { useAddToRota, useDistribution, useRemoveFromRota, useUpdateDistribution } from '../api'

/** Who new leads get handed to, and what each is carrying. */
export function DistributionTab() {
  const { data, isLoading, isError, error, refetch } = useDistribution()
  const members = useMembers()
  const patch = useUpdateDistribution()
  const add = useAddToRota()
  const remove = useRemoveFromRota()
  const confirm = useConfirm()
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const canDelete = access.hasAction('crm', 'delete')
  const [pick, setPick] = useState('')

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
    <Card>
      <CardContent className="p-4 sm:p-4">
        <h3 className="font-semibold tracking-tight">Lead distribution</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          New unassigned leads go to the active member with fewest open leads. Priority breaks ties (0 = first).
        </p>

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
            <Button disabled={!pick || add.isPending} onClick={() => add.mutate({ user_id: pick, priority: 0, source_filter: [], strategy: "round_robin" }, { onSuccess: () => setPick('') })}>
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
  )
}
