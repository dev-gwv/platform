import { useState, type FormEvent, type ReactNode } from 'react'
import type { TaskListItem } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent } from '@/shared/ui/dialog'
import { Input, Label, Textarea } from '@/shared/ui/input'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { useBlockTask, useMoveTask, useReviewTask, useSubmitTask } from './api'
import { isWebLink, type QuickAction } from './delegation'

/** Who is looking, and whether they manage tasks. */
export function useTaskViewer() {
  const { session } = useAuth()
  const access = useAccess()
  return {
    me: session?.user_id ?? null,
    canManage: access.hasAction('tasks', 'edit'),
    canAssign: access.hasAction('tasks', 'create'),
  }
}

/**
 * What a card's quick buttons do. Moves happen straight away; Submit and
 * Blocked ask one question first (the link; the reason), in a small dialog
 * rendered by `dialogs`.
 */
export function useTaskActions() {
  const { me, canManage } = useTaskViewer()
  const move = useMoveTask()
  const [submitting, setSubmitting] = useState<TaskListItem | null>(null)
  const [blocking, setBlocking] = useState<TaskListItem | null>(null)

  function run(task: TaskListItem, action: QuickAction) {
    if (action === 'submit') return setSubmitting(task)
    if (action === 'blocked') return setBlocking(task)
    const status = action === 'done' ? 'completed' : action
    // The person on a task uses their own route (it refuses Done); a manager
    // who is not on it, or who is closing it, uses theirs.
    const onIt = !!me && task.assignee_ids.includes(me)
    move.mutate({ id: task.id, status, manage: canManage && (!onIt || action === 'done') })
  }

  const dialogs: ReactNode = (
    <>
      {submitting && <SubmitWorkDialog task={submitting} onClose={() => setSubmitting(null)} />}
      {blocking && <BlockDialog task={blocking} onClose={() => setBlocking(null)} />}
    </>
  )
  return { run, dialogs, busy: move.isPending }
}

/** Link + note: hand the work in. Used by the card's Submit and the drawer. */
export function SubmitWorkForm({ taskId, onDone }: { taskId: string; onDone?: () => void }) {
  const submit = useSubmitTask()
  const [link, setLink] = useState('')
  const [note, setNote] = useState('')
  const valid = isWebLink(link)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    submit.mutate(
      { id: taskId, input: { link: link.trim(), ...(note.trim() ? { note: note.trim() } : {}) } },
      {
        onSuccess: () => {
          setLink('')
          setNote('')
          onDone?.()
        },
      },
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`submit-link-${taskId}`}>
          Link to your work <span className="text-destructive">*</span>
        </Label>
        <Input
          id={`submit-link-${taskId}`}
          type="url"
          inputMode="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://drive.google.com/…"
          aria-invalid={link.length > 0 && !valid}
          autoFocus
        />
        {link.length > 0 && !valid && (
          <p className="text-xs text-destructive">Paste a link that starts with http:// or https://</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`submit-note-${taskId}`}>Note (optional)</Label>
        <Textarea
          id={`submit-note-${taskId}`}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything the reviewer should know"
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={!valid || submit.isPending}>
          {submit.isPending ? 'Submitting…' : 'Submit for review'}
        </Button>
      </div>
    </form>
  )
}

function SubmitWorkDialog({ task, onClose }: { task: TaskListItem; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Submit work" description={`${task.title} goes to review.`}>
        <SubmitWorkForm taskId={task.id} onDone={onClose} />
      </DialogContent>
    </Dialog>
  )
}

function BlockDialog({ task, onClose }: { task: TaskListItem; onClose: () => void }) {
  const block = useBlockTask()
  const [reason, setReason] = useState('')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="What is blocking this?" description={task.title}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!reason.trim()) return
            block.mutate({ id: task.id, input: { reason: reason.trim() } }, { onSuccess: onClose })
          }}
          className="flex flex-col gap-3"
        >
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Waiting for the client's photo selection"
            aria-label="Reason"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!reason.trim() || block.isPending}>
              Mark blocked
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Approve, or send back with what to change. Shown on a task in Review. */
export function ReviewBox({ task }: { task: TaskListItem }) {
  const review = useReviewTask()
  const [sendingBack, setSendingBack] = useState(false)
  const [note, setNote] = useState('')
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
      <p className="text-sm font-medium">Waiting for your review</p>
      <p className="mt-0.5 text-xs text-muted-foreground">Check the work, then approve it or send it back.</p>
      {sendingBack ? (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!note.trim()) return
            review.mutate({ id: task.id, input: { approve: false, note: note.trim() } })
          }}
        >
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What needs to change?"
            aria-label="What needs to change"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setSendingBack(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!note.trim() || review.isPending}>
              Send back
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button size="sm" disabled={review.isPending} onClick={() => review.mutate({ id: task.id, input: { approve: true } })}>
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSendingBack(true)}>
            Send back
          </Button>
        </div>
      )}
    </div>
  )
}
