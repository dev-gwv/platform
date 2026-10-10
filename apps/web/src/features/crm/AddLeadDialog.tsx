import { useState, type FormEvent } from 'react'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { Plus, Tag as TagIcon } from 'lucide-react'
import { LEAD_QUALITY_DEFAULTS, LEAD_SOURCE_DEFAULTS, createLeadRequest, type CreateLeadRequest } from '@ipc/contracts'
import { LookupChip } from './fields'
import { fieldErrors, type FieldErrors } from '@/shared/forms/field-errors'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { useAddLead, usePipelines } from './api'
import { useMembers } from '@/features/allocation/api'
import { useAccess } from '@/shared/auth/useAccess'
import { useCrmAccess } from './access'
import { useTags } from './api'
import { LabelMenu } from './LabelMenu'
import { LeadEvents, toFunctions, type EventRow } from './LeadEvents'
import { TagChip } from './TagChip'

type Field = 'name' | 'phone' | 'email'

const LABELS: Record<Field, string> = { name: 'Name', phone: 'Phone', email: 'Email' }

/**
 * Adding a lead by hand — the enquiry that came in over the phone.
 *
 * Only the number is required: it is how the studio finds them again, and it is
 * what the server dedupes on. Everything else can be filled in from the drawer
 * once there is time.
 */
/*
 * There is no "Group / segment" box here any more.
 *
 * It wrote crm_leads.group_name, which 0197 replaced with tags -- and since the
 * drawer no longer shows that column, anything typed here would have been saved
 * where nobody could see it or filter by it. Tags are set from the drawer the
 * moment this dialog hands over to it.
 */
export function AddLeadDialog({
  onAdded,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}: {
  onAdded?: (id: string) => void
  /** Opened from elsewhere (the top bar's + New): no button of its own. */
  hideTrigger?: boolean
  /** Controlled when given, so the setup checklist can open it. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const add = useAddLead()
  const { canCreate } = useCrmAccess()
  const [openSelf, setOpenSelf] = useState(false)
  /** The fifteen fields a studio fills in later, if ever. */
  const [showMore, setShowMore] = useState(false)
  const members = useMembers()
  const pipelines = usePipelines()
  // The default pipeline's stages — a lead can start anywhere, not only at the
  // top, because a studio often adds one that is already part-way along.
  const stages = pipelines.data?.[0]?.stages ?? []
  const open = openProp ?? openSelf
  const setOpen = (v: boolean) => {
    setOpenSelf(v)
    onOpenChange?.(v)
  }
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [source, setSource] = useState<CreateLeadRequest['source']>('enquiry')
  const [notes, setNotes] = useState('')
  const [value, setValue] = useState('')
  const [closeDate, setCloseDate] = useState('')
  // Every function they asked for, and the labels to put on them.
  const [events, setEvents] = useState<EventRow[]>([])
  const [tagIds, setTagIds] = useState<string[]>([])
  const allTags = useTags()
  const canEdit = useAccess().hasAction('crm', 'edit')
  const [alternatePhone, setAlternatePhone] = useState('')
  const [city, setCity] = useState('')
  /**
   * The four the old form had and this one did not. All were already in
   * createLeadRequest — the dialog simply never asked, so a lead arrived
   * unowned, undated and untagged and someone had to open it again to fix
   * that.
   */
  const [assignedTo, setAssignedTo] = useState('')
  const [followUpAt, setFollowUpAt] = useState('')
  const [stageId, setStageId] = useState('')
  /**
   * Hot / warm / cold. createLeadRequest, the leads filter and the update
   * patch have all carried `quality` from the start, and a trigger keeps it
   * consistent with the is_hot flag the Hot chip reads — but no screen ever
   * offered it, so every lead was created without one.
   */
  const [quality, setQuality] = useState<string>('')
  const [errors, setErrors] = useState<FieldErrors<Field>>({})
  // A lead half-typed during a call survives a refresh or a closed tab.
  const draft = useFormDraft(
    open ? 'lead:new' : null,
    { name, phone, email, source, notes, value, closeDate, events, tagIds, alternatePhone, city, assignedTo, followUpAt, stageId, quality },
    (v) => {
      setName(v.name)
      setPhone(v.phone)
      setEmail(v.email)
      setSource(v.source)
      setNotes(v.notes)
      setValue(v.value)
      setCloseDate(v.closeDate)
      setEvents(Array.isArray(v.events) ? v.events : [])
      setTagIds(Array.isArray(v.tagIds) ? v.tagIds : [])
      setAlternatePhone(v.alternatePhone)
      setCity(v.city)
      setAssignedTo(v.assignedTo)
      setFollowUpAt(v.followUpAt)
      setStageId(v.stageId)
      setQuality(v.quality)
    },
  )

  function reset() {
    setName('')
    setPhone('')
    setEmail('')
    setSource('enquiry')
    setNotes('')
    setValue('')
    setCloseDate('')
    setEvents([])
    setTagIds([])
    setAlternatePhone('')
    setCity('')
    setAssignedTo('')
    setFollowUpAt('')
    setStageId('')
    setQuality('')
    setErrors({})
    setShowMore(false)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const body = {
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      source,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(value.trim() && Number(value) >= 0 ? { deal_value: Number(value) } : {}),
      ...(closeDate ? { close_date: closeDate } : {}),
      ...(toFunctions(events).length ? { functions: toFunctions(events) } : {}),
      ...(tagIds.length ? { tag_ids: tagIds } : {}),
      ...(alternatePhone.trim() ? { alternate_phone: alternatePhone.trim() } : {}),
      ...(city.trim() ? { city: city.trim() } : {}),
      ...(assignedTo ? { assigned_to: assignedTo } : {}),
      ...(quality ? { quality } : {}),
      ...(followUpAt ? { follow_up_at: new Date(followUpAt).toISOString() } : {}),
      ...(stageId ? { stage_id: stageId } : {}),
    }
    const found = fieldErrors<Field>(createLeadRequest, body, { labels: LABELS })
    setErrors(found)
    if (Object.keys(found).length > 0) return

    add.mutate(createLeadRequest.parse(body), {
      onSuccess: (r) => {
        draft.clear()
        setOpen(false)
        reset()
        onAdded?.(r.lead.id)
      },
    })
  }

  // The endpoint needs crm:create; a view-only account was being shown the
  // page's main call to action and refused on submit.
  if (!canCreate) return null

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button>
            <Plus /> Add lead
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        title="Add a lead"
        description="A number or a name is enough to start. If we already have the number, you'll be taken to that lead instead."
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          {/*
            * Two questions, then everything else.
            *
            * This form asked seventeen. Exactly one -- the phone number -- is
            * required, and a studio taking a call at a wedding venue has the
            * number and a name and nothing else yet. The other fifteen are
            * answers you learn later, on the lead itself, so they wait behind
            * one toggle instead of standing between the call and the record.
            */}
          <div className="flex flex-col gap-1.5">
            <Label>
              Phone
            </Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="9876543210"
              aria-invalid={!!errors.phone}
              autoFocus
            />
            {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Aanya Sharma"
              aria-invalid={!!errors.name}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Events</Label>
            <LeadEvents value={events} onCommit={setEvents} compact />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <TagIcon className="size-3.5 text-muted-foreground" aria-hidden />
            {(allTags.data ?? [])
              .filter((t) => tagIds.includes(t.id))
              .map((t) => (
                <TagChip key={t.id} tag={t} onRemove={() => setTagIds((ids) => ids.filter((x) => x !== t.id))} />
              ))}
            <LabelMenu
              selected={new Set(tagIds)}
              canCreate={canEdit}
              onToggle={(t, on) => setTagIds((ids) => (on ? [...new Set([...ids, t.id])] : ids.filter((x) => x !== t.id)))}
              trigger={
                <Button type="button" size="sm" variant="outline" className="h-7">
                  <Plus /> {tagIds.length ? 'Label' : 'Add a label'}
                </Button>
              }
            />
          </div>

          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className="self-start text-sm font-medium text-primary hover:underline"
          >
            {showMore ? 'Fewer details' : 'More details'}
          </button>

          {showMore && (
            <div className="flex flex-col gap-3 rounded-md border border-border p-3">
            <div className="flex flex-col gap-1.5">
              <Label>Alternate phone</Label>
              <Input value={alternatePhone} onChange={(e) => setAlternatePhone(e.target.value)} placeholder="Optional" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Optional"
                  aria-invalid={!!errors.email}
                />
                {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Source</Label>
                <LookupChip
                  variant="field"
                  category="lead_source"
                  noun="source"
                  value={source}
                  defaults={LEAD_SOURCE_DEFAULTS}
                  clearable={false}
                  onChange={(v) => v && setSource(v)}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>City</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Optional" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Deal value (₹)</Label>
                <Input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Optional" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Expected close</Label>
                <Input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Assign to</Label>
                <Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                  <option value="">
                    {/* Empty is not "nobody" — the distribution rota picks. */}
                    Auto-assign
                  </option>
                  {(members.data ?? []).map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Follow up at</Label>
                <Input
                  type="datetime-local"
                  value={followUpAt}
                  onChange={(e) => setFollowUpAt(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Stage</Label>
                <Select value={stageId} onChange={(e) => setStageId(e.target.value)}>
                  <option value="">First stage</option>
                  {stages.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Quality</Label>
                <LookupChip
                  variant="field"
                  category="lead_quality"
                  noun="quality"
                  value={quality || null}
                  defaults={LEAD_QUALITY_DEFAULTS}
                  placeholder="Not rated yet"
                  onChange={(v) => setQuality(v ?? '')}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Notes</Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="What are they asking for? Dates, budget, how they found you."
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={add.isPending}>
              {add.isPending ? 'Adding…' : 'Add lead'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
