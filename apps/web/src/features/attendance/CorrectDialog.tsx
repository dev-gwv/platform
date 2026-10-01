import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Pencil } from 'lucide-react'
import { attendanceStatus, setAttendanceRequest, z, type AttendanceDayRow, type SetAttendanceRequest } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { STATUS_LABEL } from '@/features/hr/attendance'

const idOnly = z.object({ id: z.string() })
/** A datetime-local value from an ISO string, in the viewer's own timezone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/**
 * Owner or admin rewriting one person's day: a missed tap, a check-in from the
 * wrong side of the fence, a shift that never got closed. Replaces the row for
 * that date, records who corrected it and why, and lands in the audit log.
 */
export function CorrectDialog({
  row,
  date,
}: {
  row: Pick<AttendanceDayRow, 'user_id' | 'name' | 'status' | 'check_in_at' | 'check_out_at' | 'correction_note'>
  date: string
}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<SetAttendanceRequest['status']>(row.status)
  const [checkIn, setCheckIn] = useState(toLocalInput(row.check_in_at))
  const [checkOut, setCheckOut] = useState(toLocalInput(row.check_out_at))
  const [note, setNote] = useState(row.correction_note ?? '')
  const [error, setError] = useState<string | null>(null)
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(
    open ? `attendance-correct:${row.user_id}:${date}` : null,
    { status, checkIn, checkOut, note },
    (v) => {
      setStatus(v.status)
      setCheckIn(v.checkIn)
      setCheckOut(v.checkOut)
      setNote(v.note)
    },
  )

  const save = useMutation({
    mutationFn: (input: SetAttendanceRequest) =>
      callApi(`/hr/attendance/${row.user_id}/${date}`, { method: 'PUT', body: input, responseSchema: idOnly }),
    onSuccess: () => {
      draft.clear()
      toast.success(`Attendance corrected for ${row.name}`)
      void qc.invalidateQueries({ queryKey: ['hr'] })
      setOpen(false)
    },
    onError: (e: Error) => setError(e.message),
  })

  function onSave() {
    setError(null)
    const parsed = setAttendanceRequest.safeParse({
      status,
      check_in_at: checkIn ? new Date(checkIn).toISOString() : null,
      check_out_at: checkOut ? new Date(checkOut).toISOString() : null,
      ...(note.trim() ? { note: note.trim() } : {}),
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check the times.')
      return
    }
    save.mutate(parsed.data)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          setStatus(row.status)
          setCheckIn(toLocalInput(row.check_in_at))
          setCheckOut(toLocalInput(row.check_out_at))
          setNote(row.correction_note ?? '')
          setError(null)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <Pencil /> Correct
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Correct ${row.name}`}
        description={`${date} · the row for this date is replaced with what you enter.`}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="corr-status">Status</Label>
            <Select
              id="corr-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as SetAttendanceRequest['status'])}
            >
              {attendanceStatus.options.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="corr-in">Checked in</Label>
              <Input id="corr-in" type="datetime-local" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="corr-out">Checked out</Label>
              <Input id="corr-out" type="datetime-local" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="corr-note">Why</Label>
            <Input
              id="corr-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Forgot to tap in; confirmed with the shoot lead"
            />
          </div>
          {error && (
            <p id="form-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={onSave} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save correction'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

