import { useState } from 'react'
import { UserRoundPlus } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { SkeletonList } from '@/shared/ui/skeleton'
import { useConfirm } from '@/shared/ui/confirm'
import { useRemovedMembers, useRestoreMember } from './api'

const when = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * People removed from the team, under the directory and closed until asked
 * for. Removing someone by mistake used to be for good (owner, 26 Oct);
 * Put back brings them in switched off, with their history, so nothing they
 * could do starts again until someone turns them on.
 */
export function RemovedPeople() {
  const [open, setOpen] = useState(false)
  const removed = useRemovedMembers(open)
  const restore = useRestoreMember()
  const confirm = useConfirm()
  const rows = removed.data ?? []

  return (
    <div className="mt-4 flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-fit text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? 'Hide people removed' : 'People removed'}
      </button>
      {open &&
        (removed.isLoading ? (
          <SkeletonList rows={2} columns={2} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody has been removed.</p>
        ) : (
          <Card>
            <CardContent className="p-4">
              <ul className="divide-y divide-border">
                {rows.map((m) => (
                  <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{m.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        Removed {when.format(new Date(m.removed_at))}
                        {m.removed_by_name ? ` by ${m.removed_by_name}` : ''}
                        {m.email ? ` · ${m.email}` : ''}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={restore.isPending}
                      onClick={async () => {
                        const yes = await confirm({
                          title: `Put ${m.name} back on the team?`,
                          description: 'They come back switched off, with their past shoots and pay. Turn them on from the Team list when they work with you again.',
                          confirmLabel: 'Put back',
                        })
                        if (yes) restore.mutate({ userId: m.user_id, name: m.name })
                      }}
                    >
                      <UserRoundPlus /> Put back
                    </Button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
    </div>
  )
}
