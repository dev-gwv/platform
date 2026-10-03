import { useState } from 'react'
import { CalendarDays, Database, FileSignature, Pencil, X } from 'lucide-react'
import type { DataRecord, ShootListItem, TeamSlot, TeamTermsSend } from '@ipc/contracts'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'
import { RowMenu } from '@/shared/ui/row-menu'
import { StatusBadge } from '@/shared/ui/status-badge'
import { cn } from '@/shared/ui/cn'
import { useINR } from '@/shared/money/MoneyMask'
import { useSetSlotData } from '@/features/allocation/api'
import { SendTermsDialog } from '@/features/team-terms/SendTermsDialog'
import { DataRecordDialog } from '@/features/data/DataRecordDialog'
import { AlsoBookedLine, dayOfSlot } from './PersonDay'
import { STAGE_LABEL, STAGE_TONE, dataRowTone, optedOut, slotDay, slotStage, whenLabel } from '@/features/data/stage'

/**
 * One person on one shoot day: who, which day and hours, what they are paid,
 * and whether their footage is safe -- with the one action that matters here,
 * Data.
 *
 * It was a small chip with a time and no date, so "which day is Rahul on?"
 * meant opening the booking; and there was nowhere to say the cards had come
 * in. The old platform answered that with ten chips and six buttons per
 * person. This keeps it to a name, a date, one data chip and one line of
 * where the copies are.
 */
export function AssignmentRow({
  projectId,
  shoot,
  slot,
  record,
  canEdit,
  onRemove,
  daySlots,
  terms,
}: {
  projectId: string
  shoot: ShootListItem
  slot: TeamSlot
  record: DataRecord | undefined
  canEdit: boolean
  onRemove: () => void
  /** Everyone's bookings, so the row can say what else this person has that day. */
  daySlots?: readonly TeamSlot[] | undefined
  /** Their latest terms for this shoot: undefined when the studio does not use team terms, null when none were sent. */
  terms?: TeamTermsSend | null | undefined
}) {
  const inr = useINR()
  const [editing, setEditing] = useState(false)
  const [optingOut, setOptingOut] = useState(false)
  const setSlotData = useSetSlotData()
  const stage = slotStage(slot, record)
  const payout = slot.final_cost ?? slot.estimated_cost
  const otherDay = !!shoot.shoot_date && slotDay(slot) !== shoot.shoot_date
  // Before the shoot day there are no cards yet: no chip, and a quiet button.
  const dayPassed = slotDay(slot) <= new Date().toLocaleDateString('en-CA')
  // Owed but not in is the one thing to chase -- amber, not alarm red.
  const tone = stage === 'missing' ? 'warning' : STAGE_TONE[stage]
  const row = dataRowTone(stage)

  const where = record
    ? [
        record.primary_location_name ? `Main: ${record.primary_location_name}` : null,
        record.backup_status === 'not_required'
          ? 'No backup needed'
          : record.backup_location_name
            ? `Backup: ${record.backup_location_name}`
            : null,
        record.copied_by_name ? `Copied by ${record.copied_by_name}` : null,
        record.size_gb ? `${record.size_gb} GB` : null,
      ].filter(Boolean)
    : []

  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2',
        row === 'green' ? 'border-success/50 bg-success/15' : row === 'red' ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-card',
      )}
    >
      <Avatar name={slot.user_name ?? '?'} size="md" />
      <div className="min-w-[12rem] flex-1">
        <p className="truncate text-sm font-semibold">{slot.user_name ?? 'Unknown'}</p>
        <p
          className={cn('mt-0.5 flex items-center gap-1 text-xs font-medium', otherDay ? 'text-warning' : 'text-foreground')}
          title={otherDay ? 'Booked on a different day from the shoot' : undefined}
        >
          <CalendarDays className="size-3.5 shrink-0" aria-hidden />
          {whenLabel(slot)}
        </p>
        {canEdit && daySlots && (
          <AlsoBookedLine
            userId={slot.user_id}
            name={slot.user_name ?? 'Someone'}
            day={dayOfSlot(slot)}
            slots={daySlots}
            ignoreSlotId={slot.id}
            className="mt-1"
          />
        )}
      </div>

      <div className="flex min-w-[10rem] flex-col items-start gap-0.5">
        {(dayPassed || record) && (
          <StatusBadge tone={tone} title={stage === 'opted_out' ? (slot.data_not_required_reason ?? undefined) : undefined}>
            {STAGE_LABEL[stage]}
          </StatusBadge>
        )}
        {where.length > 0 && <p className="text-[11px] text-muted-foreground">{where.join(' · ')}</p>}
        {terms !== undefined && <TermsLine send={terms} />}
      </div>

      <span className="w-20 text-right text-xs tabular-nums text-muted-foreground">
        {payout != null ? inr(payout) : 'No payout'}
      </span>

      {canEdit && (
        <div className="flex items-center gap-1">
          {terms !== undefined && terms?.status !== 'acknowledged' && slot.user_id && (
            <SendTermsDialog
              shoot={shoot}
              forMember={slot.user_id}
              trigger={
                <Button size="sm" variant="ghost" title={`Send ${slot.user_name ?? 'them'} the team terms`}>
                  <FileSignature /> {terms ? 'Resend terms' : 'Send terms'}
                </Button>
              }
            />
          )}
          {!optedOut(slot) && (
            <Button size="sm" variant={record || dayPassed ? 'outline' : 'ghost'} onClick={() => setEditing(true)}>
              {record ? <Pencil /> : <Database />} {record ? 'Data' : 'Add data'}
            </Button>
          )}
          <RowMenu
            label={`More for ${slot.user_name ?? 'this booking'}`}
            items={[
              optedOut(slot)
                ? {
                    label: 'Data needed again',
                    onSelect: () => setSlotData.mutate({ id: slot.id, data_required: true, data_not_required_reason: null }),
                  }
                : { label: 'No data needed from them…', onSelect: () => setOptingOut(true), disabled: !!record },
              { label: 'Remove from shoot', icon: <X className="size-4" />, onSelect: onRemove },
            ]}
          />
        </div>
      )}

      {editing && (
        <DataRecordDialog projectId={projectId} shoot={shoot} slot={slot} record={record} onClose={() => setEditing(false)} />
      )}
      {optingOut && (
        <NoDataDialog
          name={slot.user_name ?? 'this person'}
          busy={setSlotData.isPending}
          onClose={() => setOptingOut(false)}
          onConfirm={(reason) =>
            setSlotData.mutate(
              { id: slot.id, data_required: false, data_not_required_reason: reason },
              { onSuccess: () => setOptingOut(false) },
            )
          }
        />
      )}
    </li>
  )
}

/** Why no footage is expected -- the reason is what makes it an answer, not a gap. */
function NoDataDialog({
  name,
  busy,
  onClose,
  onConfirm,
}: {
  name: string
  busy: boolean
  onClose: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const quick = ['Assistant — no camera', 'Shot on another person’s cards', 'Live stream only']
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={`No data needed from ${name}?`} description="Their row stops asking for data. You can turn it back on any time.">
        <div className="flex flex-col gap-2">
          <Label htmlFor="nodata-reason" className="text-xs">
            Why
          </Label>
          <Input id="nodata-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="e.g. Assistant, no camera" />
          <div className="flex flex-wrap gap-1.5">
            {quick.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setReason(q)}
                className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!reason.trim() || busy} onClick={() => onConfirm(reason.trim())}>
            No data needed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Neutral until it matters: green once signed, amber while it waits, plain when never sent. */
function TermsLine({ send }: { send: TeamTermsSend | null }) {
  if (!send) return <p className="text-[11px] text-muted-foreground">Terms not sent</p>
  if (send.status === 'acknowledged') return <p className="text-[11px] font-medium text-success">Terms signed</p>
  if (send.status === 'revoked' || send.status === 'expired')
    return <p className="text-[11px] text-muted-foreground">Terms link {send.status === 'revoked' ? 'withdrawn' : 'expired'}</p>
  return <p className="text-[11px] font-medium text-warning">Terms {send.status === 'viewed' ? 'opened, not signed' : 'sent, not opened'}</p>
}
