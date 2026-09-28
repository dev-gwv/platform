import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { AlarmClock, Check, Moon } from 'lucide-react'
import type { CrmActivity } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { TONE_CHIP, type ToneName } from '@/shared/ui/tones'
import { useActivities, useUpdateActivity } from './api'
import { useLookupColor } from './fields'
import { BUCKET_LABEL, dueWords, followUpBucket, presetAt, type FollowUpBucket } from './follow-ups'

const ORDER: FollowUpBucket[] = ['overdue', 'today', 'tomorrow', 'week']
const TONE: Record<FollowUpBucket, ToneName> = { overdue: 'rose', today: 'amber', tomorrow: 'blue', week: 'violet', later: 'slate' }

/**
 * Every follow-up owed, grouped the way a day is planned: what is late, what
 * is today, tomorrow, the rest of the week. Mark one done or push it on from
 * the row -- the Control Center's follow-up board, on the page callers
 * already open every morning.
 */
export function FollowUpBuckets({ scope }: { scope: 'mine' | 'all' }) {
  const q = useActivities({ openTasks: true, mine: scope === 'mine' })
  const update = useUpdateActivity()
  const typeColor = useLookupColor('follow_up_type')
  const priorityColor = useLookupColor('follow_up_priority')
  const now = useMemo(() => new Date(), [q.data])

  const groups = useMemo(() => {
    const g = new Map<FollowUpBucket, CrmActivity[]>()
    for (const t of q.data ?? []) {
      if (!t.due_at || !t.lead_id) continue
      const b = followUpBucket(t.due_at, now)
      if (b === 'later') continue
      g.set(b, [...(g.get(b) ?? []), t])
    }
    return g
  }, [q.data, now])

  const total = ORDER.reduce((n, b) => n + (groups.get(b)?.length ?? 0), 0)
  if (q.isLoading || total === 0) return null

  return (
    <section aria-label="Follow-ups" className="mb-4 rounded-xl border border-border bg-card p-3">
      <h2 className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold">
        <AlarmClock className="size-4 text-tone-amber" /> Follow-ups promised
        {ORDER.map((b) =>
          groups.get(b)?.length ? (
            <span key={b} className={cn('rounded-full border px-2 py-0.5 text-xs font-medium', TONE_CHIP[TONE[b]])}>
              {groups.get(b)!.length} {BUCKET_LABEL[b].toLowerCase()}
            </span>
          ) : null,
        )}
      </h2>
      <div className="flex flex-col gap-3">
        {ORDER.map((b) => {
          const rows = groups.get(b)
          if (!rows?.length) return null
          return (
            <div key={b}>
              <p className={cn('mb-1 text-xs font-semibold uppercase tracking-wider', b === 'overdue' ? 'text-tone-rose' : 'text-muted-foreground')}>
                {BUCKET_LABEL[b]}
              </p>
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {rows.map((t) => {
                  const tc = typeColor(t.subject)
                  const pc = priorityColor(t.priority)
                  return (
                    <li
                      key={t.id}
                      className={cn('flex flex-wrap items-center gap-2 px-3 py-2', b === 'overdue' && 'border-l-4 border-l-tone-rose')}
                    >
                      <Link
                        to="/follow-ups"
                        search={{ lead: t.lead_id } as never}
                        className="min-w-0 font-medium hover:underline"
                      >
                        {t.lead_name ?? 'Lead'}
                      </Link>
                      <span className={cn('rounded-full border px-2 py-0.5 text-[0.7rem]', tc ? TONE_CHIP[tc] : 'border-border bg-muted')}>
                        {t.subject ?? 'Follow-up'}
                      </span>
                      {t.priority && t.priority !== 'Normal' && (
                        <span className={cn('rounded-full border px-2 py-0.5 text-[0.7rem]', pc ? TONE_CHIP[pc] : 'border-border bg-muted')}>
                          {t.priority}
                        </span>
                      )}
                      <span className={cn('text-xs', b === 'overdue' ? 'font-medium text-tone-rose' : 'text-muted-foreground')}>
                        {dueWords(t.due_at!, now)}
                      </span>
                      {scope === 'all' && t.assignee_name && <span className="text-xs text-muted-foreground">· {t.assignee_name}</span>}
                      <span className="ml-auto flex gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          title="Move to tomorrow 11 am"
                          disabled={update.isPending}
                          onClick={() => update.mutate({ id: t.id, patch: { due_at: presetAt('tomorrow').toISOString() } })}
                        >
                          <Moon /> Tomorrow
                        </Button>
                        <Button
                          size="sm"
                          className="h-7 bg-tone-green text-card hover:bg-tone-green/90"
                          disabled={update.isPending}
                          onClick={() => update.mutate({ id: t.id, patch: { done: true } })}
                        >
                          <Check /> Done
                        </Button>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}
