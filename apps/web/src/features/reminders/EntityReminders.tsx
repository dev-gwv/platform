import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Bell, Plus } from 'lucide-react'
import type { ReminderEntityType } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { useReminders, useSaveReminder } from './api'

const PRIORITY_TONE: Record<string, 'danger' | 'warning' | 'info' | 'neutral'> = {
  urgent: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
}

/**
 * Reminders for one entity (project, client, …): open follow-ups at a glance
 * with a handoff to the reminders board for the rest.
 *
 * The list endpoint only filters by status/priority server-side, so the
 * entity match happens here — the board is small enough that one cached
 * query feeds every panel on the page.
 */
export function EntityReminders({
  entityType,
  entityId,
  title,
  onNavigate,
  hideWhenEmpty,
}: {
  entityType: ReminderEntityType
  entityId: string
  title?: string
  /** Called when the board link is pressed (e.g. to close a dialog first). */
  onNavigate?: () => void
  /** Show nothing while none are open -- the page has its own bell to add one. */
  hideWhenEmpty?: boolean
}) {
  const { data, isLoading } = useReminders({ status: 'active' })
  const rows = (data?.items ?? []).filter((r) => r.entity_type === entityType && r.entity_id === entityId)
  const [adding, setAdding] = useState(false)

  if (hideWhenEmpty && rows.length === 0) return null

  return (
    <Card className="self-start border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Bell className="size-4" aria-hidden /> {title ?? 'Reminders'}
          {rows.length > 0 && <StatusBadge tone="warning">{rows.length} open</StatusBadge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading reminders…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing open for this {entityType}. Follow-ups live on the reminders board.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {rows.slice(0, 3).map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5 text-sm"
              >
                <span className="min-w-0 truncate font-medium">{r.title}</span>
                <StatusBadge tone={PRIORITY_TONE[r.priority] ?? 'neutral'}>{r.priority}</StatusBadge>
              </li>
            ))}
            {rows.length > 3 && (
              <li className="text-xs text-muted-foreground">+ {rows.length - 3} more open</li>
            )}
          </ul>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {/* Adding one used to mean leaving for the board and re-attaching it
              to this record by hand. */}
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus /> Add reminder
          </Button>
          <Button variant="outline" size="sm" asChild onClick={onNavigate}>
            <Link to="/reminders">Open reminders</Link>
          </Button>
        </div>
        {adding && (
          <AddReminderDialog entityType={entityType} entityId={entityId} onClose={() => setAdding(false)} />
        )}
      </CardContent>
    </Card>
  )
}

/** A follow-up already attached to the record you are looking at. */
function AddReminderDialog({
  entityType,
  entityId,
  onClose,
}: {
  entityType: ReminderEntityType
  entityId: string
  onClose: () => void
}) {
  const save = useSaveReminder()
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState('medium')
  const [dueAt, setDueAt] = useState('')

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title="Add reminder" description={`Linked to this ${entityType}.`}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rem-title">
              What needs doing <span className="text-destructive">*</span>
            </Label>
            <Input
              id="rem-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Call about the album selection"
              autoFocus
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rem-priority">Priority</Label>
              <Select id="rem-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rem-due">Due</Label>
              <Input
                id="rem-due"
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={title.trim().length < 2 || save.isPending}
              onClick={() =>
                save.mutate(
                  {
                    body: {
                      title: title.trim(),
                      priority: priority as 'low' | 'medium' | 'high' | 'urgent',
                      entity_type: entityType,
                      entity_id: entityId,
                      ...(dueAt ? { due_at: new Date(dueAt).toISOString() } : {}),
                    },
                  },
                  { onSuccess: onClose },
                )
              }
            >
              {save.isPending ? 'Saving…' : 'Add reminder'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
