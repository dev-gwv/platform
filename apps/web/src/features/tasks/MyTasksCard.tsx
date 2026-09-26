import { Link } from '@tanstack/react-router'
import { ListChecks } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { useMyTasks } from './api'
import { STATUS_LABEL, isOverdue, todayISO } from './board'
import { soonestOpen } from './delegation'
import { DueText } from './TaskCard'

/**
 * The three things on my plate soonest, on every dashboard (the owner has
 * tasks too). Late ones in red. A tap opens the task.
 */
export function MyTasksCard({ className }: { className?: string }) {
  const { data, isLoading } = useMyTasks()
  const today = todayISO()
  const next = soonestOpen(data ?? [], today, 3)

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="size-4 text-muted-foreground" aria-hidden /> My tasks
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link to="/tasks" search={{ view: 'people', mine: '1' }}>
            View all
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : next.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing open. You are all caught up.</p>
        ) : (
          <ul className="divide-y divide-border">
            {next.map((t) => (
              <li key={t.id}>
                <Link
                  to="/tasks"
                  search={{ open: t.id, mine: '1' }}
                  className="flex items-center justify-between gap-3 py-2 hover:text-primary"
                >
                  <span className="min-w-0">
                    <span className={cn('block truncate text-sm font-medium', isOverdue(t, today) && 'text-destructive')}>{t.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {STATUS_LABEL[t.status]}
                      {t.project_name ? ` · ${t.project_name}` : ''}
                    </span>
                  </span>
                  <DueText task={t} today={today} className="shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
