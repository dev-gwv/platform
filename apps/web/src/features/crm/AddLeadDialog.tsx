import { useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { createLeadRequest, type CreateLeadRequest, type LeadQuality } from '@ipc/contracts'
import { fieldErrors, type FieldErrors } from '@/shared/forms/field-errors'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { useAddLead, usePipelines } from './api'
import { useMembers } from '@/features/allocation/api'
import { LookupSelect } from '@/features/settings/LookupSelect'
import { EVENT_TYPE_DEFAULTS } from './event-types'
import { useCrmAccess } from './access'

type Field = 'name' | 'phone' | 'email'

const LABELS: Record<Field, string> = { name: 'Name', phone: 'Phone', email: 'Email' }

/**
 * Adding a lead by hand — the enquiry that came in over the phone.
 *
 * Only the number is required: it is how the studio finds them again, and it is
 * what the server dedupes on. Everything else can be filled in from the drawer
 * once there is time.
 */
export function AddLeadDialog({
  onAdded,
  open: openProp,
  onOpenChange,
}: {
  onAdded?: (id: string) => void
  /** Controlled when given, so the setup checklist can open it. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const add = useAddLead()
  const { canCreate } = useCrmAccess()
  const [openSelf, setOpenSelf] = useState(false)
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
  const [eventType, setEventType] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [eventLocation, setEventLocation] = useState('')
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
  const [groupName, setGroupName] = useState('')
  const [stageId, setStageId] = useState('')
  /**
   * Hot / warm / cold. createLeadRequest, the leads filter and the update
   * patch have all carried `quality` from the start, and a trigger keeps it
   * consistent with the is_hot flag the Hot chip reads — but no screen ever
   * offered it, so every lead was created without one.
   */
  const [quality, setQuality] = useState<LeadQuality | ''>('')
  const [errors, setErrors] = useState<FieldErrors<Field>>({})

  function reset() {
    setName('')
    setPhone('')
    setEmail('')
    setSource('enquiry')
    setNotes('')
    setValue('')
    setCloseDate('')
    setEventType('')
    setEventDate('')
    setEventLocation('')
    setAlternatePhone('')
    setCity('')
    setAssignedTo('')
    setFollowUpAt('')
    setGroupName('')
    setStageId('')
    setQuality('')
    setErrors({})
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const body = {
      phone: phone.trim(),
      source,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(value.trim() && Number(value) >= 0 ? { deal_value: Number(value) } : {}),
      ...(closeDate ? { close_date: closeDate } : {}),
      ...(eventType.trim() ? { event_type: eventType.trim() } : {}),
      ...(eventDate ? { event_date: eventDate } : {}),
      ...(eventLocation.trim() ? { event_location: eventLocation.trim() } : {}),
      ...(alternatePhone.trim() ? { alternate_phone: alternatePhone.trim() } : {}),
      ...(city.trim() ? { city: city.trim() } : {}),
      ...(assignedTo ? { assigned_to: assignedTo } : {}),
      ...(quality ? { quality } : {}),
      ...(followUpAt ? { follow_up_at: new Date(followUpAt).toISOString() } : {}),
      ...(groupName.trim() ? { group_name: groupName.trim() } : {}),
      ...(stageId ? { stage_id: stageId } : {}),
    }
    const found = fieldErrors<Field>(createLeadRequest, body, { labels: LABELS })
    setErrors(found)
    if (Object.keys(found).length > 0) return

    add.mutate(createLeadRequest.parse(body), {
      onSuccess: (r) => {
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
      <DialogTrigger asChild>
        <Button>
          <Plus /> Add lead
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Add a lead"
        description="A number is enough to start. If we already have it, you'll be taken to that lead instead."
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>
              Phone <span className="text-destructive">*</span>
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
              <Select
                value={source}
                onChange={(e) => setSource(e.target.value as CreateLeadRequest['source'])}
              >
                <option value="enquiry">Enquiry</option>
                <option value="referral">Referral</option>
                <option value="manual">Manual</option>
                <option value="webform">Web form</option>
                <option value="facebook">Facebook</option>
                <option value="instagram">Instagram</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="google_form">Google Form</option>
                <option value="csv_import">CSV import</option>
                <option value="other">Other</option>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Event type</Label>
              <LookupSelect
                category="project_type"
                aria-label="Event type"
                value={eventType}
                onChange={setEventType}
                defaults={EVENT_TYPE_DEFAULTS}
                placeholder="—"
                addLabel="Add an event type…"
                inputPlaceholder="e.g. Baby shower"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Event date</Label>
              <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Venue / location</Label>
              <Input value={eventLocation} onChange={(e) => setEventLocation(e.target.value)} placeholder="Optional" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>City</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Optional" />
            </div>
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
              <Label>Group / segment</Label>
              <Input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Wedding 2027, Corporate…"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Quality</Label>
              <Select value={quality} onChange={(e) => setQuality(e.target.value as LeadQuality | '')}>
                <option value="">Not rated yet</option>
                <option value="hot">Hot — ready to book</option>
                <option value="warm">Warm — interested, no date</option>
                <option value="cold">Cold — just looking</option>
              </Select>
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
