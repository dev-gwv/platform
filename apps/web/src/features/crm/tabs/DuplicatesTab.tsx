import { useState } from 'react'
import { Archive, Merge, Split, Undo2 } from 'lucide-react'
import type { CrmLead } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { useAccess } from '@/shared/auth/useAccess'
import { useDismissedDuplicates, useDuplicateGroups, useMerge, useResolveDuplicates, useUndoDismissal, useUnmerge } from '../api'
import { STAGE_LABEL } from '../leads'
import { STAGE_TONE, prettyDate } from './shared'

/**
 * Leads that share a phone number. Merge folds the others into a survivor;
 * the survivor keeps a note of what was folded in and can unmerge it.
 * `archivedLeads` are the ones merged so far, so the undo is right here —
 * and `allLeads` includes the survivors, which merge deliberately leaves
 * unarchived and which the undo list therefore could not name.
 */
export function DuplicatesTab({ archivedLeads, allLeads }: { archivedLeads: readonly CrmLead[]; allLeads: readonly CrmLead[] }) {
  const { data, isLoading, isError, error, refetch } = useDuplicateGroups()
  const merge = useMerge()
  const resolve = useResolveDuplicates()
  const unmerge = useUnmerge()
  const confirm = useConfirm()
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const [pick, setPick] = useState<Record<string, string>>({})
  const [showSetAside, setShowSetAside] = useState(false)
  const setAside = useDismissedDuplicates(showSetAside)
  const undoSetAside = useUndoDismissal()
  const busy = merge.isPending || resolve.isPending

  // Survivors with something merged into them, for the undo list.
  const merged = new Map<string, number>()
  for (const l of archivedLeads) if (l.merged_into) merged.set(l.merged_into, (merged.get(l.merged_into) ?? 0) + 1)

  if (isLoading) return <SkeletonCards count={3} />
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />

  async function doMerge(phone: string, ids: string[]) {
    const survivor = pick[phone]
    if (!survivor) return
    const dups = ids.filter((x) => x !== survivor)
    const yes = await confirm({
      title: `Merge ${dups.length} duplicate${dups.length === 1 ? '' : 's'}?`,
      description: 'Their notes move onto the lead you picked and they are archived. You can unmerge from this tab.',
      confirmLabel: 'Merge',
    })
    if (yes) merge.mutate({ survivor_id: survivor, duplicate_ids: dups })
  }

  /**
   * The two answers that are not a merge. Archiving drops the duplicates
   * without folding their notes in; "not duplicates" records that they are
   * genuinely different people, so the group stops being offered.
   */
  async function doResolve(groupKey: string, ids: string[], action: 'archive' | 'keep_separate') {
    // "Not duplicates" is about the whole group, so it needs no pick.
    const survivor = pick[groupKey] ?? (action === 'keep_separate' ? ids[0] : undefined)
    if (!survivor) return
    const dups = ids.filter((x) => x !== survivor)
    const yes = await confirm({
      title:
        action === 'archive'
          ? `Archive ${dups.length} lead${dups.length === 1 ? '' : 's'}?`
          : 'Keep these leads separate?',
      description:
        action === 'archive'
          ? 'They are archived without their notes moving onto the lead you picked.'
          : 'They stay as they are and this group stops being flagged as a duplicate. You can undo it under “Set aside as not duplicates”.',
      confirmLabel: action === 'archive' ? 'Archive' : 'Keep separate',
    })
    if (yes) resolve.mutate({ survivor_id: survivor, duplicate_ids: dups, action })
  }

  const groups = data ?? []

  return (
    <div className="flex flex-col gap-4">
      {groups.length === 0 ? (
        <Card>
          <CardContent className="py-4">
            <EmptyState title="No duplicates" description="No two open leads share a phone number." />
          </CardContent>
        </Card>
      ) : (
        groups.map((g) => {
          const key = g.phone_norm ?? g.match_value_masked ?? g.lead_ids[0] ?? 'group'
          return (
          <Card key={key}>
            <CardContent className="p-4">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                Phone +{g.phone_norm ?? key}
                <StatusBadge tone="warning">{g.lead_count} leads</StatusBadge>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">Pick the one to keep. The others fold into it.</p>
              <ul className="mt-3 flex flex-col gap-1.5">
                {g.leads.map((l) => (
                  <li key={l.id}>
                    <label className="flex cursor-pointer flex-wrap items-center gap-2 rounded-md border border-border p-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                      <input
                        type="radio"
                        name={`survivor-${key}`}
                        checked={pick[key] === l.id}
                        onChange={() => setPick((p) => ({ ...p, [key]: l.id }))}
                        disabled={!canEdit}
                      />
                      <span className="font-medium">{l.name ?? 'Unnamed lead'}</span>
                      <StatusBadge tone={STAGE_TONE[l.status]}>{STAGE_LABEL[l.status]}</StatusBadge>
                      <span className="text-xs text-muted-foreground">{l.source} · added {prettyDate(l.created_at)}</span>
                      {l.notes && <span className="w-full truncate text-xs text-muted-foreground">{l.notes}</span>}
                    </label>
                  </li>
                ))}
              </ul>
              {canEdit && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" disabled={!pick[key] || busy} onClick={() => void doMerge(key, g.lead_ids)}>
                    <Merge /> Merge into the selected lead
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!pick[key] || busy}
                    onClick={() => void doResolve(key, g.lead_ids, 'archive')}
                  >
                    <Archive /> Archive the others
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void doResolve(key, g.lead_ids, 'keep_separate')}
                  >
                    <Split /> Not duplicates
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          )
        })
      )}

      {merged.size > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="font-medium">Merged recently</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Unmerging brings the folded leads back exactly as they were.</p>
            <ul className="mt-3 divide-y divide-border">
              {[...merged.entries()].map(([survivorId, n]) => {
                const survivor = allLeads.find((l) => l.id === survivorId)
                return (
                  <li key={survivorId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium">{survivor?.name ?? survivor?.phone ?? 'Lead'}</span>
                    <StatusBadge tone="neutral">{n} merged in</StatusBadge>
                    {canEdit && (
                      <Button size="sm" variant="outline" disabled={unmerge.isPending} onClick={() => unmerge.mutate(survivorId)}>
                        <Undo2 /> Unmerge
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* "Not duplicates" said by mistake: put the pair back on the list (0286). */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setShowSetAside((v) => !v)}
          className="w-fit text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          {showSetAside ? 'Hide the pairs set aside' : 'Set aside as not duplicates'}
        </button>
        {showSetAside &&
          (setAside.isLoading ? (
            <SkeletonCards count={1} />
          ) : (setAside.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing set aside.</p>
          ) : (
            <Card>
              <CardContent className="p-4">
                <ul className="divide-y divide-border">
                  {(setAside.data ?? []).map((d) => (
                    <li key={`${d.lead_a}-${d.lead_b}`} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">
                          {d.name_a} and {d.name_b}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          Same {d.matched_on} · set aside {prettyDate(d.created_at)}
                          {d.dismissed_by ? ` by ${d.dismissed_by}` : ''}
                        </span>
                      </span>
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={undoSetAside.isPending}
                          onClick={() => undoSetAside.mutate({ lead_a: d.lead_a, lead_b: d.lead_b })}
                        >
                          <Undo2 /> Undo
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
      </div>
    </div>
  )
}
