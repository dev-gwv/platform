import { useState } from 'react'
import { toast } from 'sonner'
import { Users } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { useHints, useSetHint } from '@/features/team/hints-api'

export type RequirementsChoice = 'now' | 'later'

/** The person's remembered answer, or null to ask each time. */
export function useRequirementsChoice(): RequirementsChoice | null {
  return useHints().data?.requirements_choice?.choice ?? null
}

const list = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? 'This function') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

/**
 * Next pressed on Event days with a function that has nobody planned for it
 * (owner, 5 Nov): add the requirements now, or go on and add them later on the
 * project's Shoots tab. "Remember my choice" keeps the answer, so the
 * question is not one more step every time; it is changed back from the step.
 */
export function RequirementsChoiceDialog({
  names,
  onNow,
  onLater,
  onClose,
}: {
  names: readonly string[]
  onNow: () => void
  onLater: () => void
  onClose: () => void
}) {
  const [remember, setRemember] = useState(false)
  const setHint = useSetHint()

  function pick(choice: RequirementsChoice) {
    if (remember) {
      setHint.mutate({ key: 'requirements_choice', value: { choice } })
      toast.success(
        choice === 'later'
          ? 'Saved. Next will not ask again; you can change this on Event days.'
          : 'Saved. Next will take you to the requirements; you can change this on Event days.',
      )
    }
    if (choice === 'now') onNow()
    else onLater()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`${list(names)} ${names.length === 1 ? 'has' : 'have'} no shoot requirements yet`}
        description="Who will shoot it? Add the team needed now, or go on and add it later on the project's Shoots tab."
      >
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <input type="checkbox" className="size-4" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember my choice for next time
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => pick('later')}>
            Add them later
          </Button>
          <Button className="ipc-nudge bg-tone-amber text-white hover:bg-tone-amber/90" onClick={() => pick('now')}>
            <Users /> Add shoot requirements now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * One quiet line on Event days while a choice is remembered, with the way
 * back to being asked each time, and a word that it changed.
 */
export function RememberedChoiceLine({ choice }: { choice: RequirementsChoice }) {
  const setHint = useSetHint()
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {choice === 'later'
        ? 'You chose to add shoot requirements later, so Next does not ask.'
        : 'You chose to add shoot requirements before going on.'}
      <button
        type="button"
        className="font-medium text-primary underline-offset-2 hover:underline"
        disabled={setHint.isPending}
        onClick={() =>
          setHint.mutate(
            { key: 'requirements_choice', value: null },
            { onSuccess: () => toast.success('Changed. Next will ask you again when a function has no requirements.') },
          )
        }
      >
        Ask me each time
      </button>
    </p>
  )
}
