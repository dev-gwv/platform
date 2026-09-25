import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Play, Timer } from 'lucide-react'
import { toast } from 'sonner'
import { z } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { useMyTasks, useUpdateMyTaskStatus } from '@/features/tasks/api'
import { useMyDeliverables } from './api'
import { todayIso } from './deliverable-stage'
import { startLabel, toStart, type StartItem } from './start-model'

/**
 * "Start these now": the work someone has to begin today (or is already
 * behind on) to finish on time. It stays until they tap Start -- and the
 * same reminder comes as a notification every morning until they do.
 */
export function StartNowCard() {
  const deliverables = useMyDeliverables()
  const tasks = useMyTasks()
  const qc = useQueryClient()
  const startTask = useUpdateMyTaskStatus()
  const startDeliverable = useMutation({
    mutationFn: (id: string) => callApi(`/projects/deliverables/${id}/start`, { method: 'POST', responseSchema: z.unknown() }),
    onSuccess: () => {
      toast.success('Started. Good luck!')
      void qc.invalidateQueries({ queryKey: ['projects', 'my-deliverables'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const items = toStart(deliverables.data ?? [], tasks.data ?? [], todayIso())
  if (!items.length) return null
  const behind = items.filter((i) => i.left < 0).length

  function start(i: StartItem) {
    if (i.kind === 'deliverable') startDeliverable.mutate(i.id)
    else startTask.mutate({ id: i.id, status: 'in_progress' })
  }

  return (
    <Card className={cn(behind ? 'border-destructive/40 bg-destructive/5' : 'border-warning/40 bg-warning/5')}>
      <CardContent className="p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Timer className={cn('size-4', behind ? 'text-destructive' : 'text-warning')} aria-hidden />
          Start these to finish on time
          {behind > 0 && <span className="text-xs font-medium text-destructive">· {behind} behind</span>}
        </p>
        <ul className="mt-2 divide-y divide-border">
          {items.slice(0, 5).map((i) => (
            <li key={`${i.kind}:${i.id}`} className="flex flex-wrap items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{i.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[i.project, i.due ? `due ${new Date(`${i.due}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : null, i.workDays ? `needs ~${i.workDays} ${i.workDays === 1 ? 'day' : 'days'}` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <span className={cn('text-xs font-semibold', i.left < 0 ? 'text-destructive' : i.left === 0 ? 'text-warning' : 'text-muted-foreground')}>
                {startLabel(i)}
              </span>
              <Button size="sm" onClick={() => start(i)} disabled={startDeliverable.isPending || startTask.isPending}>
                <Play /> Start
              </Button>
            </li>
          ))}
        </ul>
        {items.length > 5 && (
          <Link to="/my-work" className="text-xs font-medium text-primary hover:underline">
            +{items.length - 5} more in My Work
          </Link>
        )}
      </CardContent>
    </Card>
  )
}
