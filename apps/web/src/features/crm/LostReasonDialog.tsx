import { useEffect, useState } from 'react'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { useAccess } from '@/shared/auth/useAccess'
import { useCreateLostReason, useLostReasons } from './api'

export interface LostDetails {
  lost_reason: string
  lost_competitor?: string
}

/**
 * Why a deal was lost. A stage of kind "lost" cannot be entered without a
 * reason (the database refuses), so every path that loses a deal — the
 * drawer, a drag on the pipeline, a bulk move — asks through this one dialog.
 * The studio's own picklist comes first; "Other" opens a free-text line.
 */
export function LostReasonDialog({
  open,
  count = 1,
  onCancel,
  onConfirm,
  pending = false,
}: {
  open: boolean
  /** How many deals are being lost, for the copy. */
  count?: number
  onCancel: () => void
  onConfirm: (details: LostDetails) => void
  pending?: boolean
}) {
  const { data: reasons } = useLostReasons()
  const options = (reasons ?? []).filter((r) => r.is_active)
  const [pick, setPick] = useState('')
  const [other, setOther] = useState('')
  const [competitor, setCompetitor] = useState('')
  const [error, setError] = useState<string | null>(null)
  // A reason typed under "Other" is usually one that will come up again;
  // saving it here puts it in the list for next time instead of in Settings.
  const canSave = useAccess().hasAction('crm', 'edit')
  const [saveReason, setSaveReason] = useState(true)
  const createReason = useCreateLostReason()

  useEffect(() => {
    if (!open) return
    setPick(options[0]?.label ?? '')
    setOther('')
    setCompetitor('')
    setError(null)
    setSaveReason(true)
    // Reset only when the dialog opens; the picklist rarely changes underneath it.
  }, [open])

  const reason = pick === '__other' || options.length === 0 ? other.trim() : pick

  function submit() {
    if (reason.length < 3) {
      setError('Give a reason of at least 3 characters.')
      return
    }
    const typed = pick === '__other' || options.length === 0
    if (typed && canSave && saveReason && !options.some((o) => o.label.toLowerCase() === reason.toLowerCase())) {
      createReason.mutate({ label: reason.slice(0, 80) })
    }
    onConfirm({ lost_reason: reason, ...(competitor.trim() ? { lost_competitor: competitor.trim() } : {}) })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent
        title={count === 1 ? 'Mark as lost' : `Mark ${count} deals as lost`}
        description="The reason is kept on the deal and shows up in the lost analysis."
      >
        <div className="flex flex-col gap-3">
          {options.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lost-reason">Reason</Label>
              <Select id="lost-reason" value={pick} onChange={(e) => setPick(e.target.value)} autoFocus>
                {options.map((r) => (
                  <option key={r.id} value={r.label}>
                    {r.label}
                  </option>
                ))}
                <option value="__other">Other…</option>
              </Select>
            </div>
          )}
          {(pick === '__other' || options.length === 0) && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lost-other">Tell us more</Label>
              <Input
                id="lost-other"
                value={other}
                onChange={(e) => setOther(e.target.value)}
                placeholder="e.g. Chose a studio closer to the venue"
                aria-invalid={!!error}
                autoFocus={options.length === 0}
              />
              {canSave && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={saveReason} onChange={(e) => setSaveReason(e.target.checked)} />
                  Add this to our list of reasons
                </label>
              )}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lost-competitor">Lost to (optional)</Label>
            <Input id="lost-competitor" value={competitor} onChange={(e) => setCompetitor(e.target.value)} placeholder="Competitor or alternative" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="button" onClick={submit} disabled={pending}>
              {pending ? 'Saving…' : 'Mark lost'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
