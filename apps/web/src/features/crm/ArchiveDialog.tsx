import { useEffect, useState } from 'react'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Label } from '@/shared/ui/input'

/** The reasons a studio actually archives a lead, so most times it is one click. */
const COMMON = [
  'Duplicate',
  'Wrong number',
  'Not a real enquiry',
  'Out of our area',
  'Budget too low',
  'Went quiet',
] as const

/**
 * Why this lead is being archived.
 *
 * Until 0200 archiving recorded a boolean and a timestamp, so a lead found in
 * the archive months later said only that someone had archived it at some
 * point. The reason is optional: bulk-archiving four hundred stale leads should
 * not demand an essay, and a required field people fill with "." is worse than
 * an empty one.
 */
export function ArchiveDialog({
  open,
  count = 1,
  onCancel,
  onConfirm,
  pending = false,
}: {
  open: boolean
  count?: number
  onCancel: () => void
  onConfirm: (reason: string | null) => void
  pending?: boolean
}) {
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (open) setReason('')
  }, [open])

  const what = count === 1 ? 'this lead' : `these ${count} leads`

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-md">
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Archive {what}?</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {count === 1 ? 'It' : 'They'} leave the inbox and stay searchable. You can restore{' '}
              {count === 1 ? 'it' : 'them'} at any time.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="archive-reason">Why? (optional)</Label>
            <div className="flex flex-wrap gap-1.5">
              {COMMON.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason((v) => (v === r ? '' : r))}
                  aria-pressed={reason === r}
                  className={
                    reason === r
                      ? 'rounded-full border border-primary bg-primary/10 px-3 py-1 text-sm text-primary'
                      : 'rounded-full border border-border px-3 py-1 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground'
                  }
                >
                  {r}
                </button>
              ))}
            </div>
            <textarea
              id="archive-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder="Or write your own…"
              className="w-full rounded-md border border-input bg-card p-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() => onConfirm(reason.trim().length >= 2 ? reason.trim() : null)}
            >
              {pending ? 'Archiving…' : `Archive ${count === 1 ? '' : count}`.trim()}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
