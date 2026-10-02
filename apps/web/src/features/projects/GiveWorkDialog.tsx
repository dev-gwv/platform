import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z, type Deliverable, type TeamMember } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input, Label, Textarea } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { daysLeft } from '@/shared/ui/days-left'
import { callApi } from '@/shared/api/client'
import { PersonList } from '@/features/team/PersonPicker'
import { useBulkDeliverables } from '@/features/board/api'
import { useDeliverableTypeList } from './api'
import { stageOf } from './deliverable-stage'
import { suggestDue, useWorkload } from './give-work'

/**
 * "Who will edit it?" -- the one way work is given out. Start editing opens it
 * when nobody is on the deliverable yet, and so does the editor chip and the
 * bulk bar. Pick a person (editors first, each with how much they already
 * have), check the due date (filled in from what the studio gives this kind
 * of work), add a line of brief, and "Start editing with Nitin" gives it to
 * them and moves it to Editing. They see it on their own login straight away.
 */
export function GiveWorkDialog({
  deliverables,
  onClose,
  onGiven,
}: {
  deliverables: readonly Deliverable[]
  onClose: () => void
  /** Who it went to -- the card offers them a voice brief next. */
  onGiven?: (member: TeamMember) => void
}) {
  const one = deliverables.length === 1 ? deliverables[0]! : null
  const qc = useQueryClient()
  const types = useDeliverableTypeList()
  const load = useWorkload()
  const bulk = useBulkDeliverables()
  const [who, setWho] = useState<TeamMember | null>(null)
  const picked = who?.user_id ?? one?.assignee_id ?? null
  // The suggestion follows the studio's work days until someone types a date.
  const [typedDue, setDue] = useState<string | null>(null)
  const due = typedDue ?? (one ? suggestDue(one, types) : '')
  const [brief, setBrief] = useState(one?.description ?? '')
  const [saving, setSaving] = useState(false)
  const left = daysLeft(due || null)
  const pickedName = who?.name ?? (one && one.assignee_id === picked ? one.assignee_name : null) ?? null
  const title = one ? `Who will edit ${one.title}?` : `Who will edit these ${deliverables.length}?`
  const first = useMemo(() => (pickedName ?? '').split(' ')[0], [pickedName])

  async function save() {
    if (!picked) return
    setSaving(true)
    try {
      if (one) {
        const patch: Record<string, unknown> = {}
        if (picked !== one.assignee_id) patch.assignee_id = picked
        if ((due || null) !== (one.estimated_date ?? null)) patch.estimated_date = due || null
        if (brief.trim() !== (one.description ?? '').trim()) patch.description = brief.trim() || null
        if (Object.keys(patch).length) {
          await callApi(`/projects/${one.project_id}/deliverables/${one.id}`, { method: 'PATCH', body: patch, responseSchema: z.unknown() })
        }
        // Giving it to someone moves To do to Editing on its own (0166) when
        // nobody had it; otherwise move it here.
        if (stageOf(one.status) === 'pending' && one.assignee_id) {
          await callApi(`/projects/deliverables/${one.id}/stage`, {
            method: 'POST',
            body: { status: 'in_progress', custom_status_code: null },
            responseSchema: z.unknown(),
          })
        }
      } else {
        const ids = deliverables.map((d) => d.id)
        await bulk.mutateAsync({ ids, assignee_id: picked })
        if (due) await bulk.mutateAsync({ ids, estimated_date: due })
      }
      void qc.invalidateQueries({ queryKey: ['projects'] })
      if (one) toast.success(`${first || 'They'} can start on ${one.title}`)
      const member = who ?? null
      onClose()
      if (member) onGiven?.(member)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'We could not give out the work.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={title} className="max-w-lg">
        <div className="flex flex-col gap-4">
          <PersonList selected={picked} onPick={setWho} load={load.data} />
          <div className="grid gap-3 sm:grid-cols-[11rem_1fr]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="give-due">Due date</Label>
              <Input
                id="give-due"
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                className={cn(!due && 'border-dashed border-warning/70 bg-warning/10')}
              />
              {left && <span className={cn('text-xs', left.tone === 'late' ? 'text-destructive' : 'text-muted-foreground')}>{left.text}</span>}
            </div>
            {one && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="give-brief">Brief (optional)</Label>
                <Textarea
                  id="give-brief"
                  rows={3}
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  placeholder="Songs, shots to include, the feel the couple wants…"
                />
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!picked || saving} className={cn(picked && !saving && 'ipc-nudge')}>
            {saving ? 'Saving…' : picked ? `Start editing with ${first || 'them'}` : 'Pick who edits it'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
