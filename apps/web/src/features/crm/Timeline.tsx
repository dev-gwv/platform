import { useMemo, useState } from 'react'
import { CalendarPlus, Check, ClipboardList, Download, Mail, MapPin, MessageCircle, Pencil, Phone, StickyNote, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { ActivityType, CrmActivity, CrmLead, TimelineItem, UpdateActivityRequest } from '@ipc/contracts'
import { ACTIVITY_LABEL, CALL_OUTCOMES, describeActivity } from '@ipc/domain'
import { Button } from '@/shared/ui/button'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SkeletonList } from '@/shared/ui/skeleton'
import { cn } from '@/shared/ui/cn'
import { toast as notify } from 'sonner'
import { downloadFile, ApiError } from '@/shared/api/client'
import { useConfirm } from '@/shared/ui/confirm'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { useMembers } from '@/features/allocation/api'
import { useCrmAccess } from './access'
import { useDeleteActivity, useLogActivity, usePlaceCall, useScheduleMeeting, useTimeline, useUpdateActivity } from './api'
import { STAGE_LABEL } from './leads'

const when = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

type Filter = 'all' | ActivityType | 'stage'
const FILTERS: ReadonlyArray<{ key: Filter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'call', label: 'Calls' },
  { key: 'email', label: 'Emails' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'meeting', label: 'Meetings' },
  { key: 'note', label: 'Notes' },
  { key: 'task', label: 'Tasks' },
  { key: 'stage', label: 'Stage moves' },
]

const ICON: Record<ActivityType, typeof Phone> = {
  call: Phone,
  email: Mail,
  meeting: CalendarPlus,
  note: StickyNote,
  task: ClipboardList,
  whatsapp: MessageCircle,
  sms: MessageCircle,
}

/** A datetime-local value from an ISO timestamp, in the viewer's timezone. */
function toLocalInput(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** A datetime-local value for "now", rounded to the minute. */
function nowLocal(offsetMinutes = 0): string {
  const at = new Date(Date.now() + offsetMinutes * 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/**
 * The deal's timeline: every stage move and every activity, newest first,
 * with the quick forms to log the next one. Opened between calls, so each
 * form is two fields and a button.
 */
export function Timeline({ lead }: { lead: CrmLead }) {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useTimeline(lead.id)
  const update = useUpdateActivity()
  const del = useDeleteActivity()
  const confirm = useConfirm()
  const { canEdit, canDelete } = useCrmAccess()
  const [editing, setEditing] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [form, setForm] = useState<ActivityType | null>(null)

  const items = useMemo(() => {
    const all = (data?.pages ?? []).flatMap((p) => p.items)
    if (filter === 'all') return all
    if (filter === 'stage') return all.filter((i) => i.kind === 'event')
    return all.filter((i) => i.kind === 'activity' && i.activity.type === filter)
  }, [data, filter])

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Timeline</p>
        {canEdit && (
          <span className="ml-auto flex flex-wrap gap-1">
            {(['call', 'note', 'meeting', 'task', 'email'] as const).map((t) => {
              const Icon = ICON[t]
              return (
                <Button key={t} size="sm" variant={form === t ? 'default' : 'outline'} onClick={() => setForm(form === t ? null : t)}>
                  <Icon /> {t === 'email' ? 'Log email' : t === 'note' ? 'Note' : ACTIVITY_LABEL[t]}
                </Button>
              )
            })}
          </span>
        )}
      </div>

      {form === 'call' && <CallForm lead={lead} onDone={() => setForm(null)} />}
      {form === 'note' && <QuickForm lead={lead} type="note" onDone={() => setForm(null)} />}
      {form === 'email' && <QuickForm lead={lead} type="email" onDone={() => setForm(null)} />}
      {form === 'task' && <TaskForm lead={lead} onDone={() => setForm(null)} />}
      {form === 'meeting' && <MeetingForm lead={lead} onDone={() => setForm(null)} />}

      <div className="mt-2 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn('rounded-full border px-2 py-0.5 text-[0.7rem]', filter === f.key ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <SkeletonList rows={3} columns={2} />
      ) : items.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">Nothing here yet.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {items.map((item) => (
            <TimelineRow
              key={item.kind === 'event' ? `e-${item.event.id}` : `a-${item.activity.id}`}
              item={item}
              canEdit={canEdit}
              canDelete={canDelete}
              editing={editing}
              onEdit={setEditing}
              onSave={(id, patch, onSaved) =>
                update.mutate(
                  { id, patch },
                  {
                    onSuccess: () => {
                      onSaved()
                      setEditing(null)
                    },
                  },
                )
              }
              pending={update.isPending}
              onDone={(a) => update.mutate({ id: a.id, patch: { done: !a.done_at } })}
              onDelete={async (a) => {
                const yes = await confirm({
                  title: 'Remove this from the timeline?',
                  description: 'It disappears from the deal’s history for everyone.',
                  confirmLabel: 'Remove',
                  destructive: true,
                })
                if (yes) del.mutate(a.id)
              }}
            />
          ))}
        </ul>
      )}
      {hasNextPage && (
        <Button size="sm" variant="ghost" className="mt-2" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
          {isFetchingNextPage ? 'Loading…' : 'Earlier'}
        </Button>
      )}
    </div>
  )
}

interface RowProps {
  item: TimelineItem
  canEdit: boolean
  canDelete: boolean
  editing: string | null
  onEdit: (id: string | null) => void
  onSave: (id: string, patch: UpdateActivityRequest, onSaved: () => void) => void
  pending: boolean
  onDone: (a: CrmActivity) => void
  onDelete: (a: CrmActivity) => void
}

function TimelineRow({ item, canEdit, canDelete, editing, onEdit, onSave, pending, onDone, onDelete }: RowProps) {
  if (item.kind === 'event') {
    const e = item.event
    return (
      <li className="text-xs text-muted-foreground">
        <span className="tabular-nums">{when.format(new Date(e.created_at))}</span>
        {' — '}
        {e.to_status ? `${e.from_status ? STAGE_LABEL[e.from_status] : 'Arrived'} → ${STAGE_LABEL[e.to_status]}` : (e.note ?? 'note')}
        {e.to_status && e.note ? ` · ${e.note}` : ''}
        {e.actor_name ? ` · ${e.actor_name}` : ''}
      </li>
    )
  }
  const a = item.activity
  const Icon = ICON[a.type]
  const overdue = a.type === 'task' && !a.done_at && !!a.due_at && new Date(a.due_at).getTime() < Date.now()

  if (editing === a.id) return <RowEditor activity={a} pending={pending} onCancel={() => onEdit(null)} onSave={(patch, onSaved) => onSave(a.id, patch, onSaved)} />

  return (
    <li className="flex items-start gap-2 rounded-md bg-muted/30 px-2 py-1.5 text-xs">
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', overdue ? 'text-destructive' : 'text-muted-foreground')} />
      <span className="min-w-0 flex-1">
        <span className={cn('font-medium', a.done_at && 'text-muted-foreground line-through')}>{describeActivity(a)}</span>
        {a.body && <span className="block truncate text-muted-foreground" title={a.body}>{a.body}</span>}
        {a.location && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <MapPin className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{a.location}</span>
          </span>
        )}
        <span className="block text-muted-foreground">
          <span className="tabular-nums">{when.format(new Date(a.started_at ?? a.created_at))}</span>
          {a.actor_name ? ` · ${a.actor_name}` : ''}
          {a.provider !== 'manual' ? ` · via ${a.provider}` : ''}
          {a.type === 'task' && a.assignee_name ? ` · for ${a.assignee_name}` : ''}
        </span>
      </span>
      {a.type === 'meeting' && a.started_at && (
        <Button
          size="sm"
          variant="ghost"
          title="Download the calendar invite"
          onClick={() => {
            // The endpoint needs the auth header, which a plain link cannot
            // carry — every one of these used to come back 401.
            void downloadFile(`/crm/activities/${a.id}/ics`, `meeting-${a.id.slice(0, 8)}.ics`).catch((err: unknown) =>
              notify.error(err instanceof ApiError ? err.message : 'We could not download the invite.'),
            )
          }}
        >
          <Download />
          <span className="sr-only">Download the calendar invite</span>
        </Button>
      )}
      {a.type === 'task' && canEdit && (
        <Button size="sm" variant={a.done_at ? 'ghost' : 'outline'} onClick={() => onDone(a)}>
          <Check /> {a.done_at ? 'Reopen' : 'Done'}
        </Button>
      )}
      {canEdit && a.provider === 'manual' && (
        <Button size="sm" variant="ghost" onClick={() => onEdit(a.id)} title="Edit">
          <Pencil className="size-3.5" />
          <span className="sr-only">Edit</span>
        </Button>
      )}
      {canDelete && (
        <Button size="sm" variant="ghost" onClick={() => onDelete(a)} title="Remove">
          <Trash2 className="size-3.5" />
          <span className="sr-only">Remove</span>
        </Button>
      )}
    </li>
  )
}

/**
 * Correcting what was logged. A call noted against the wrong deal, a task
 * that needs another week, a name typed wrong — all of it used to be
 * permanent, because the only patch the product ever sent was "done".
 */
function RowEditor({
  activity: a,
  pending,
  onCancel,
  onSave,
}: {
  activity: CrmActivity
  pending: boolean
  onCancel: () => void
  onSave: (patch: UpdateActivityRequest, onSaved: () => void) => void
}) {
  const { data: members } = useMembers()
  const [subject, setSubject] = useState(a.subject ?? '')
  const [body, setBody] = useState(a.body ?? '')
  const [location, setLocation] = useState(a.location ?? '')
  const [due, setDue] = useState(a.due_at ? toLocalInput(a.due_at) : '')
  const [assignee, setAssignee] = useState(a.assigned_to ?? '')
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(`activity-edit:${a.id}`, { subject, body, location, due, assignee }, (v) => {
    setSubject(v.subject)
    setBody(v.body)
    setLocation(v.location)
    setDue(v.due)
    setAssignee(v.assignee)
  })

  function save() {
    const patch: UpdateActivityRequest = {
      subject: subject.trim() || null,
      body: body.trim() || null,
    }
    if (a.type === 'meeting') patch.location = location.trim() || null
    if (a.type === 'task') {
      patch.due_at = due ? new Date(due).toISOString() : null
      patch.assigned_to = assignee || null
    }
    onSave(patch, draft.clear)
  }

  return (
    <li className="flex flex-col gap-2 rounded-md bg-muted/40 p-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor={`ed-subject-${a.id}`}>{a.type === 'task' ? 'Task' : 'Subject'}</Label>
          <Input id={`ed-subject-${a.id}`} value={subject} onChange={(e) => setSubject(e.target.value)} autoFocus />
        </div>
        {a.type === 'task' && (
          <>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`ed-due-${a.id}`}>Due</Label>
              <Input id={`ed-due-${a.id}`} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`ed-who-${a.id}`}>For</Label>
              <Select id={`ed-who-${a.id}`} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">Nobody in particular</option>
                {(members ?? []).map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>
          </>
        )}
        {a.type === 'meeting' && (
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor={`ed-where-${a.id}`}>Where</Label>
            <Input id={`ed-where-${a.id}`} value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
        )}
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor={`ed-body-${a.id}`}>Details</Label>
          <textarea
            id={`ed-body-${a.id}`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <X /> Cancel
        </Button>
        <Button size="sm" disabled={pending} onClick={save}>
          Save
        </Button>
      </div>
    </li>
  )
}

function CallForm({ lead, onDone }: { lead: CrmLead; onDone: () => void }) {
  const log = useLogActivity()
  const call = usePlaceCall()
  const [outcome, setOutcome] = useState('answered')
  const [minutes, setMinutes] = useState('5')
  const [notes, setNotes] = useState('')
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(`lead-call:${lead.id}`, { outcome, minutes, notes }, (v) => {
    setOutcome(v.outcome)
    setMinutes(v.minutes)
    setNotes(v.notes)
  })
  return (
    <div className="mt-2 grid gap-2 rounded-md bg-muted/30 p-2 sm:grid-cols-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="act-outcome">Outcome</Label>
        <Select id="act-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          {CALL_OUTCOMES.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="act-minutes">Minutes</Label>
        <Input id="act-minutes" type="number" min={0} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <Label htmlFor="act-call-notes">What was said</Label>
        <Input id="act-call-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </div>
      <div className="flex flex-wrap gap-2 sm:col-span-4">
        <Button
          size="sm"
          disabled={log.isPending}
          onClick={() =>
            log.mutate(
              {
                lead_id: lead.id,
                type: 'call',
                direction: 'out',
                outcome,
                duration_s: Math.max(0, Math.round(Number(minutes) || 0) * 60),
                ...(notes.trim() ? { body: notes.trim() } : {}),
                started_at: new Date().toISOString(),
              },
              {
                onSuccess: () => {
                  draft.clear()
                  onDone()
                },
              },
            )
          }
        >
          Log call
        </Button>
        {lead.phone && (
          <Button
            size="sm"
            variant="outline"
            disabled={call.isPending}
            title="Rings you first when Twilio is connected; otherwise opens your dialler"
            onClick={() =>
              call.mutate(
                { lead_id: lead.id },
                {
                  onSuccess: (r) => {
                    if (r.placed) toast.success('Ringing you now…')
                    else if (r.dial_url) window.location.href = r.dial_url
                    onDone()
                  },
                },
              )
            }
          >
            <Phone /> Call now
          </Button>
        )}
      </div>
    </div>
  )
}

function QuickForm({ lead, type, onDone }: { lead: CrmLead; type: 'note' | 'email'; onDone: () => void }) {
  const log = useLogActivity()
  const [direction, setDirection] = useState<'in' | 'out'>('out')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(`lead-${type}:${lead.id}`, { direction, subject, body }, (v) => {
    setDirection(v.direction)
    setSubject(v.subject)
    setBody(v.body)
  })
  return (
    <div className="mt-2 grid gap-2 rounded-md bg-muted/30 p-2 sm:grid-cols-4">
      {type === 'email' && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="act-dir">Direction</Label>
          <Select id="act-dir" value={direction} onChange={(e) => setDirection(e.target.value as 'in' | 'out')}>
            <option value="out">Sent</option>
            <option value="in">Received</option>
          </Select>
        </div>
      )}
      <div className={cn('flex flex-col gap-1', type === 'email' ? 'sm:col-span-3' : 'sm:col-span-4')}>
        <Label htmlFor="act-subject">{type === 'email' ? 'Subject' : 'Note'}</Label>
        <Input id="act-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={type === 'email' ? 'Re: December wedding quote' : 'Prefers candid style, budget 1.5L'} autoFocus />
      </div>
      <div className="flex flex-col gap-1 sm:col-span-4">
        <Label htmlFor="act-body">Details</Label>
        <textarea id="act-body" value={body} onChange={(e) => setBody(e.target.value)} rows={2} className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm" placeholder="Optional" />
      </div>
      <div className="sm:col-span-4">
        <Button
          size="sm"
          disabled={log.isPending || (!subject.trim() && !body.trim())}
          onClick={() =>
            log.mutate(
              {
                lead_id: lead.id,
                type,
                direction: type === 'email' ? direction : 'none',
                ...(subject.trim() ? { subject: subject.trim() } : {}),
                ...(body.trim() ? { body: body.trim() } : {}),
                started_at: new Date().toISOString(),
              },
              {
                onSuccess: () => {
                  draft.clear()
                  onDone()
                },
              },
            )
          }
        >
          Save
        </Button>
      </div>
    </div>
  )
}

function TaskForm({ lead, onDone }: { lead: CrmLead; onDone: () => void }) {
  const log = useLogActivity()
  const [subject, setSubject] = useState('')
  const [due, setDue] = useState(nowLocal(24 * 60))
  // What was typed survives a refresh or a closed tab until it is saved. The
  // default due time moves with the clock, so only the task text counts.
  const draft = useFormDraft(
    `lead-task:${lead.id}`,
    { subject, due },
    (v) => {
      setSubject(v.subject)
      setDue(v.due)
    },
    { isBlank: (v) => !v.subject.trim() },
  )
  return (
    <div className="mt-2 grid gap-2 rounded-md bg-muted/30 p-2 sm:grid-cols-4">
      <div className="flex flex-col gap-1 sm:col-span-3">
        <Label htmlFor="act-task">Task</Label>
        <Input id="act-task" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Send the album mock-up" autoFocus />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="act-due">Due</Label>
        <Input id="act-due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
      </div>
      <div className="sm:col-span-4">
        <Button
          size="sm"
          disabled={log.isPending || !subject.trim() || !due}
          onClick={() =>
            log.mutate(
              { lead_id: lead.id, type: 'task', direction: 'none', subject: subject.trim(), due_at: new Date(due).toISOString() },
              {
                onSuccess: () => {
                  draft.clear()
                  onDone()
                },
              },
            )
          }
        >
          Add task
        </Button>
      </div>
    </div>
  )
}

function MeetingForm({ lead, onDone }: { lead: CrmLead; onDone: () => void }) {
  const schedule = useScheduleMeeting()
  const [subject, setSubject] = useState(`Meeting with ${lead.name ?? 'lead'}`)
  const [start, setStart] = useState(nowLocal(24 * 60))
  const [minutes, setMinutes] = useState('60')
  const [location, setLocation] = useState('')
  // What was typed survives a refresh or a closed tab until it is saved. The
  // default start moves with the clock, so it alone is not worth keeping.
  const defaultSubject = `Meeting with ${lead.name ?? 'lead'}`
  const draft = useFormDraft(
    `lead-meeting:${lead.id}`,
    { subject, start, minutes, location },
    (v) => {
      setSubject(v.subject)
      setStart(v.start)
      setMinutes(v.minutes)
      setLocation(v.location)
    },
    { isBlank: (v) => v.subject === defaultSubject && v.minutes === '60' && !v.location.trim() },
  )
  return (
    <div className="mt-2 grid gap-2 rounded-md bg-muted/30 p-2 sm:grid-cols-4">
      <div className="flex flex-col gap-1 sm:col-span-2">
        <Label htmlFor="mt-subject">Subject</Label>
        <Input id="mt-subject" value={subject} onChange={(e) => setSubject(e.target.value)} autoFocus />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="mt-start">Starts</Label>
        <Input id="mt-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="mt-minutes">Minutes</Label>
        <Input id="mt-minutes" type="number" min={5} max={720} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1 sm:col-span-4">
        <Label htmlFor="mt-location">Where</Label>
        <Input id="mt-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Studio, venue, or a video link" />
      </div>
      <div className="flex items-center gap-2 sm:col-span-4">
        <Button
          size="sm"
          disabled={schedule.isPending || !subject.trim() || !start}
          onClick={() => {
            const s = new Date(start)
            const e = new Date(s.getTime() + Math.max(5, Number(minutes) || 60) * 60_000)
            schedule.mutate(
              { lead_id: lead.id, subject: subject.trim(), starts_at: s.toISOString(), ends_at: e.toISOString(), ...(location.trim() ? { location: location.trim() } : {}), invite_lead: true },
              {
                onSuccess: () => {
                  draft.clear()
                  onDone()
                },
              },
            )
          }}
        >
          Schedule
        </Button>
        <span className="text-xs text-muted-foreground">
          {lead.email ? 'The invite lists the lead as an attendee.' : 'The lead has no email; the invite is for you.'}
        </span>
        {lead.status && <StatusBadge tone="neutral">{STAGE_LABEL[lead.status]}</StatusBadge>}
      </div>
    </div>
  )
}
