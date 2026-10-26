import { useState } from 'react'
import { Check, RefreshCcw, Undo2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Label, Textarea } from '@/shared/ui/input'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { useReviewWork } from './api'

/**
 * Approve, or send back for changes. Sending back asks what to change and
 * will not go without it: the editor gets those words in the notification and
 * on their list, and work sent back with no word on why only comes back the
 * same. Used wherever someone reviews handed-in work.
 */
export function ReviewButtons({
  submissionId,
  editorName,
  decided,
}: {
  submissionId: string
  editorName?: string | null | undefined
  /** Already reviewed: show "Change decision", which offers only the other answer. */
  decided?: 'approved' | 'rejected' | undefined
}) {
  const review = useReviewWork()
  const [sendingBack, setSendingBack] = useState(false)
  const [changing, setChanging] = useState(false)
  const [note, setNote] = useState('')
  // What was typed survives a refresh until it is sent.
  const draft = useFormDraft(sendingBack ? `send-back:${submissionId}` : null, { note }, (v) => setNote(v.note))
  const text = note.trim()
  const fieldId = `send-back-${submissionId}`

  // A decision made in a hurry is changed here, by whoever reviews work.
  if (decided && !changing && !sendingBack) {
    return (
      <div>
        <Button size="sm" variant="outline" onClick={() => setChanging(true)}>
          <RefreshCcw /> Change decision
        </Button>
      </div>
    )
  }

  if (!sendingBack) {
    return (
      <div className="flex flex-wrap gap-2">
        {decided !== 'approved' && (
          <Button
            size="sm"
            disabled={review.isPending}
            onClick={() => review.mutate({ id: submissionId, approve: true }, { onSuccess: () => setChanging(false) })}
          >
            <Check /> Approve
          </Button>
        )}
        {decided !== 'rejected' && (
          <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => setSendingBack(true)}>
            <Undo2 /> Send back for changes
          </Button>
        )}
        {decided && (
          <Button size="sm" variant="ghost" onClick={() => setChanging(false)}>
            Keep as it is
          </Button>
        )}
      </div>
    )
  }

  return (
    <form
      className="flex w-full flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!text) return
        review.mutate(
          { id: submissionId, approve: false, review_notes: text },
          {
            onSuccess: () => {
              draft.clear()
              setNote('')
              setSendingBack(false)
              setChanging(false)
            },
          },
        )
      }}
    >
      <Label htmlFor={fieldId}>What needs changing?</Label>
      <Textarea
        id={fieldId}
        autoFocus
        required
        rows={2}
        maxLength={1000}
        placeholder="e.g. Colour on the reception photos is too warm"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        {editorName ? editorName.split(' ')[0] : 'The editor'} gets an alert with this note.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant="destructive" disabled={!text || review.isPending}>
          <Undo2 /> Send back for changes
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setSendingBack(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
