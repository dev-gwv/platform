import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { z, type SubmitWorkRequest, type UpdateWorkSubmissionRequest, type WorkSubmission } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { useMyTasks } from '@/features/tasks/api'
import { useMyDeliverables } from '@/features/projects/api'
import { revisionHint, submittedMessage } from '@/features/projects/revisions'

function useSubmitWork() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SubmitWorkRequest) =>
      callApi('/work/submissions', {
        method: 'POST',
        body: input,
        // The database numbers a deliverable's versions; a revision says which it was.
        responseSchema: z.object({ id: z.string(), version: z.number().int().nullish() }),
      }),
    onSuccess: (data) => {
      toast.success(submittedMessage(data.version))
      void qc.invalidateQueries({ queryKey: ['work', 'submissions'] })
      // A submission for a deliverable moves it to Review.
      void qc.invalidateQueries({ queryKey: ['projects'] })
      void qc.invalidateQueries({ queryKey: ['deliverable-notes'] })
    },
  })
}

function useUpdateWorkSubmission() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateWorkSubmissionRequest }) =>
      callApi(`/work/submissions/${id}`, {
        method: 'PATCH',
        body: patch,
        responseSchema: z.unknown(),
      }),
    onSuccess: () => {
      toast.success('Submission updated')
      void qc.invalidateQueries({ queryKey: ['work', 'submissions'] })
    },
  })
}

/**
 * Hand in work for review: the link, where the files live, and -- new -- which
 * deliverable it is for. Submitting for a deliverable moves it to Review
 * ("With manager") and puts the link in its timeline, where the reviewer
 * approves it or sends it back.
 *
 * A revision -- work sent back and done again -- is the same hand-in for the
 * same deliverable. It opens with what the reviewer asked for above the form,
 * so the editor can check it off before sending.
 */
export function SubmitWorkDialog({
  submission,
  trigger,
  taskId,
  projectId,
  deliverableId,
  revision,
}: {
  submission?: WorkSubmission
  trigger?: ReactNode
  taskId?: string
  projectId?: string | null
  /** Open already pointed at one deliverable -- from its card. */
  deliverableId?: string
  /** Handing in again what was sent back: the last version, and what to change. */
  revision?: { lastVersion: number | null; note: string | null }
} = {}) {
  const isEdit = !!submission
  const submit = useSubmitWork()
  const update = useUpdateWorkSubmission()
  const { data: myTasks } = useMyTasks()
  const { data: myDeliverables } = useMyDeliverables()
  const [open, setOpen] = useState(false)
  const [task, setTask] = useState(taskId ?? '')
  const [deliverable, setDeliverable] = useState(deliverableId ?? '')
  const [link, setLink] = useState(submission?.submission_link ?? '')
  const [workType, setWorkType] = useState(submission?.work_type ?? '')
  const [method, setMethod] = useState(submission?.method ?? '')
  const [storageRef, setStorageRef] = useState(submission?.storage_ref ?? submission?.location_note ?? '')
  const [notes, setNotes] = useState(submission?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(
    open ? `work-submission:${submission?.id ?? `new:${deliverableId ?? taskId ?? projectId ?? ''}`}` : null,
    { task, deliverable, link, workType, method, storageRef, notes },
    (v) => {
      setTask(v.task)
      setDeliverable(v.deliverable)
      setLink(v.link)
      setWorkType(v.workType)
      setMethod(v.method)
      setStorageRef(v.storageRef)
      setNotes(v.notes)
    },
  )

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const extra = {
        ...(workType.trim() ? { work_type: workType.trim() } : {}),
        ...(method.trim() ? { method: method.trim() } : {}),
        ...(storageRef.trim() ? { storage_ref: storageRef.trim(), location_note: storageRef.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      }
      if (isEdit) {
        await update.mutateAsync({
          id: submission.id,
          patch: {
            submission_link: link.trim(),
            review_required: submission.review_required ?? true,
            ...extra,
          },
        })
      } else {
        const found = (myTasks ?? []).find((t) => t.id === task)
        const forDeliverable = (myDeliverables ?? []).find((d) => d.id === deliverable)
        await submit.mutateAsync({
          task_id: task || null,
          project_id: forDeliverable?.project_id ?? found?.project_id ?? projectId ?? null,
          deliverable_id: deliverable || null,
          submission_link: link.trim(),
          review_required: true,
          ...extra,
        })
      }
      draft.clear()
      setOpen(false)
      if (!isEdit) {
        setTask(taskId ?? '')
        setDeliverable(deliverableId ?? '')
        setLink('')
        setWorkType('')
        setMethod('')
        setStorageRef('')
        setNotes('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${isEdit ? 'update' : 'submit'}.`)
    }
  }

  const busy = submit.isPending || update.isPending

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus /> Submit work
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title={isEdit ? 'Edit submission' : revision ? 'Upload revision' : 'Submit work'}
        description={revision ? revisionHint(revision.lastVersion) : 'Share a link or drive location for review.'}
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          {revision?.note && (
            <div className="rounded-lg border-l-2 border-tone-rose bg-tone-rose-soft px-3 py-2 text-sm">
              <p className="text-xs font-semibold text-tone-rose">What to change</p>
              <p className="mt-0.5 max-h-32 overflow-y-auto whitespace-pre-line break-words">{revision.note}</p>
            </div>
          )}
          {/* A revision is for the deliverable it came back on; nothing to pick. */}
          {!isEdit && !revision && (myDeliverables?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>For which deliverable</Label>
              <Select value={deliverable} onChange={(e) => setDeliverable(e.target.value)} aria-label="For which deliverable">
                <option value="">Not for a deliverable</option>
                {(myDeliverables ?? [])
                  .filter((d) => !projectId || d.project_id === projectId || d.id === deliverable)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title} · {d.project_name}
                    </option>
                  ))}
              </Select>
              {deliverable && <p className="text-xs text-muted-foreground">It moves to Review, and your manager is told.</p>}
            </div>
          )}
          {!isEdit && !revision && (
            <div className="flex flex-col gap-1.5">
              <Label>Task</Label>
              <Select value={task} onChange={(e) => setTask(e.target.value)}>
                <option value="">Not linked to a task</option>
                {(myTasks ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>Link</Label>
            <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://drive.google.com/…" required autoFocus />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Work type</Label>
              <Input value={workType} onChange={(e) => setWorkType(e.target.value)} placeholder="e.g. Edited photos" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Method</Label>
              <Input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="e.g. Drive link" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Storage / drive location</Label>
            <Input value={storageRef} onChange={(e) => setStorageRef(e.target.value)} placeholder="e.g. Backup HDD 3, /Weddings/Sharma" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Notes</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={revision ? 'What did you change?' : 'What is this?'}
            />
          </div>
          {error && (
            <p id="form-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : isEdit ? 'Save changes' : revision ? 'Send for review' : 'Submit'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
