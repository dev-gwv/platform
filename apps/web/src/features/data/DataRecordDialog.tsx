import { useState, type ReactNode } from 'react'
import { HardDrive, Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import type { CustodyStatus, DataRecord, ShootListItem, StorageLocationKind, TeamSlot } from '@ipc/contracts'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input, Label, Select, Textarea } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { useMembers } from '@/features/allocation/api'
import { useCreateDataRecord, useCreateStorageLocation, useStorageLocations, useUpdateDataRecord } from './api'
import { DATA_TYPES, TRACK_LABEL, defaultDataType, defaultLabel, slotDay, whenLabel } from './stage'

const OTHER = '__other'
const NEW = '__new'

interface Copy {
  location: string
  folder: string
  link: string
  status: CustodyStatus
}

/**
 * The data from one booking: what came in, and where its two copies went.
 *
 * The old platform's version was three steps (data, link work, assign task)
 * with a status manager and a dozen fields in view. This keeps what a studio
 * actually checks the next morning -- whose cards, who copied them, where the
 * main copy and the backup are, and whether each is done -- and puts the rest
 * one click away under "More".
 */
export function DataRecordDialog({
  projectId,
  shoot,
  slot,
  record,
  onClose,
}: {
  projectId: string
  shoot: ShootListItem
  slot: TeamSlot
  record?: DataRecord | undefined
  onClose: () => void
}) {
  const { session } = useAuth()
  const members = useMembers()
  const create = useCreateDataRecord()
  const update = useUpdateDataRecord()
  const busy = create.isPending || update.isPending

  const [type, setType] = useState(record?.data_type ?? defaultDataType(slot.service_name))
  const [received, setReceived] = useState(record?.date_received ?? slotDay(slot))
  const [copiedBy, setCopiedBy] = useState(
    record ? (record.copied_by_uid ?? (record.copied_by_name ? OTHER : '')) : (session?.user_id ?? ''),
  )
  const [copiedByName, setCopiedByName] = useState(record && !record.copied_by_uid ? (record.copied_by_name ?? '') : '')
  const [size, setSize] = useState(record?.size_gb ? String(record.size_gb) : '')
  const [cards, setCards] = useState(record?.card_count ? String(record.card_count) : '')
  const [label, setLabel] = useState(record?.data_label ?? defaultLabel(shoot, slot))
  const [notes, setNotes] = useState(record?.notes ?? '')
  const [primary, setPrimary] = useState<Copy>({
    location: record?.primary_location_id ?? '',
    folder: record?.folder_path ?? '',
    link: record?.cloud_link ?? '',
    status: record?.primary_status ?? 'pending',
  })
  const [backup, setBackup] = useState<Copy>({
    location: record?.backup_location_id ?? '',
    folder: record?.backup_folder_path ?? '',
    link: record?.backup_cloud_link ?? '',
    status: record?.backup_status ?? 'pending',
  })

  const who = slot.user_name ?? 'this booking'

  async function save() {
    if (copiedBy === OTHER && !copiedByName.trim()) {
      toast.error('Type the name of whoever copied the data.')
      return
    }
    const sizeN = size.trim() ? Number(size) : 0
    const cardsN = cards.trim() ? Math.round(Number(cards)) : 0
    if (!Number.isFinite(sizeN) || sizeN < 0 || !Number.isFinite(cardsN) || cardsN < 0) {
      toast.error('Size and cards must be positive numbers.')
      return
    }
    const fields = {
      data_type: type,
      data_label: label.trim() || defaultLabel(shoot, slot),
      date_received: received || null,
      size_gb: sizeN,
      card_count: cardsN,
      notes: notes.trim() || null,
      copied_by_uid: copiedBy && copiedBy !== OTHER ? copiedBy : null,
      copied_by_name: copiedBy === OTHER ? copiedByName.trim() : null,
      primary_location_id: primary.location || null,
      folder_path: primary.folder.trim() || null,
      cloud_link: primary.link.trim() || null,
      primary_status: primary.status === 'not_required' ? 'pending' : primary.status,
      backup_location_id: backup.location || null,
      backup_folder_path: backup.folder.trim() || null,
      backup_cloud_link: backup.link.trim() || null,
      backup_status: backup.status,
      // Linking an older record to this booking the first time it is saved here.
      slot_id: slot.id,
      user_id: slot.user_id,
    } as const
    try {
      if (record) await update.mutateAsync({ id: record.id, patch: fields })
      else
        await create.mutateAsync({
          ...fields,
          project_id: projectId,
          shoot_id: shoot.id,
          date_received: fields.date_received ?? undefined,
          notes: fields.notes ?? undefined,
          folder_path: fields.folder_path ?? undefined,
          cloud_link: fields.cloud_link ?? undefined,
          backup_folder_path: fields.backup_folder_path ?? undefined,
          backup_cloud_link: fields.backup_cloud_link ?? undefined,
          team_member_name: slot.user_name ?? undefined,
          requirement_name: slot.service_name ?? undefined,
        })
      onClose()
    } catch {
      // The hooks toast the server's reason.
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="max-w-2xl"
        title={`Data from ${who}`}
        description={`${shoot.name} · ${slot.service_name ?? 'Crew'} · ${whenLabel(slot)}`}
      >
        <div className="flex flex-col gap-3">
          {/* What came in, and who handled it. */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dr-type" className="text-xs">
                Data type
              </Label>
              <Select id="dr-type" value={type} onChange={(e) => setType(e.target.value)}>
                {DATA_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dr-received" className="text-xs">
                Received on
              </Label>
              <Input id="dr-received" type="date" value={received} onChange={(e) => setReceived(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dr-copied" className="text-xs">
                Copied by
              </Label>
              <Select id="dr-copied" value={copiedBy} onChange={(e) => setCopiedBy(e.target.value)}>
                <option value="">Not recorded</option>
                {(members.data ?? []).map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name}
                  </option>
                ))}
                <option value={OTHER}>Someone else…</option>
              </Select>
            </div>
            {copiedBy === OTHER && (
              <div className="flex flex-col gap-1.5 sm:col-span-3">
                <Label htmlFor="dr-copied-name" className="text-xs">
                  Their name
                </Label>
                <Input
                  id="dr-copied-name"
                  value={copiedByName}
                  onChange={(e) => setCopiedByName(e.target.value)}
                  placeholder="e.g. Aman (studio intern)"
                  autoFocus
                />
              </div>
            )}
          </div>

          <CopySection
            title="Main copy"
            hint="Where the cards were copied to first — hard disk, NAS or cloud."
            icon={<HardDrive className="size-4" />}
            tone="primary"
            value={primary}
            onChange={setPrimary}
            statuses={['pending', 'copied', 'verified', 'issue']}
          />
          <CopySection
            title="Backup copy"
            hint="The second copy, somewhere else. Mark it not needed if this data doesn’t need one."
            icon={<ShieldCheck className="size-4" />}
            tone="backup"
            value={backup}
            onChange={setBackup}
            statuses={['pending', 'copied', 'verified', 'issue', 'not_required']}
          />

          <details className="rounded-md border border-border px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              More — size, cards, label, notes
            </summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dr-size" className="text-xs">
                  Size (GB)
                </Label>
                <Input id="dr-size" inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value.replace(/[^\d.]/g, ''))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dr-cards" className="text-xs">
                  Cards
                </Label>
                <Input id="dr-cards" inputMode="numeric" value={cards} onChange={(e) => setCards(e.target.value.replace(/\D/g, ''))} />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="dr-label" className="text-xs">
                  Label
                </Label>
                <Input id="dr-label" value={label} onChange={(e) => setLabel(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="dr-notes" className="text-xs">
                  Notes
                </Label>
                <Textarea id="dr-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
          </details>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy && <Loader2 className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const SEG_ON: Record<CustodyStatus, string> = {
  pending: 'border-border bg-muted text-foreground',
  copied: 'border-warning bg-warning/15 text-warning',
  verified: 'border-success bg-success/15 text-success',
  issue: 'border-destructive bg-destructive/15 text-destructive',
  not_required: 'border-border bg-muted text-foreground',
}

function CopySection({
  title,
  hint,
  icon,
  tone,
  value,
  onChange,
  statuses,
}: {
  title: string
  hint: string
  icon: ReactNode
  tone: 'primary' | 'backup'
  value: Copy
  onChange: (next: Copy) => void
  statuses: CustodyStatus[]
}) {
  const skipped = value.status === 'not_required'
  return (
    <section
      className={cn(
        'rounded-lg border p-3',
        tone === 'primary' ? 'border-tone-blue/30 bg-tone-blue-soft/40' : 'border-tone-amber/30 bg-tone-amber-soft/40',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn('flex items-center gap-1.5 text-sm font-semibold', tone === 'primary' ? 'text-tone-blue' : 'text-tone-amber')}>
          {icon} {title}
        </p>
        {/* Where this copy stands: one tap, no dropdown. */}
        <div role="radiogroup" aria-label={`${title} status`} className="flex flex-wrap gap-1">
          {statuses.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={value.status === s}
              onClick={() => onChange({ ...value, status: s })}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                value.status === s ? SEG_ON[s] : 'border-transparent text-muted-foreground hover:bg-muted',
              )}
            >
              {TRACK_LABEL[s]}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      {!skipped && (
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <LocationPicker value={value.location} onChange={(location) => onChange({ ...value, location })} label={`${title} location`} />
          <Input
            aria-label={`${title} folder`}
            placeholder="Folder, e.g. /2026/Haldi/Photos"
            value={value.folder}
            onChange={(e) => onChange({ ...value, folder: e.target.value })}
          />
          <Input
            aria-label={`${title} link`}
            placeholder="Link (Drive, Dropbox…)"
            value={value.link}
            onChange={(e) => onChange({ ...value, link: e.target.value })}
          />
        </div>
      )}
    </section>
  )
}

const KINDS: { value: StorageLocationKind; label: string }[] = [
  { value: 'drive', label: 'Hard disk / SSD' },
  { value: 'nas', label: 'NAS' },
  { value: 'cloud', label: 'Cloud' },
  { value: 'other', label: 'Other' },
]

/** Pick a saved disk/cloud, or name a new one on the spot. */
function LocationPicker({ value, onChange, label }: { value: string; onChange: (id: string) => void; label: string }) {
  const locations = useStorageLocations()
  const create = useCreateStorageLocation()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<StorageLocationKind>('drive')

  if (adding) {
    return (
      <div className="flex gap-1.5 sm:col-span-3">
        <Input aria-label="New location name" placeholder="e.g. Studio HDD 4" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <Select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as StorageLocationKind)} className="w-40">
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          disabled={!name.trim() || create.isPending}
          onClick={() =>
            create.mutate(
              { name: name.trim(), kind },
              {
                onSuccess: (loc) => {
                  onChange(loc.id)
                  setAdding(false)
                  setName('')
                },
                onError: (e) => toast.error(e.message),
              },
            )
          }
        >
          Add
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <Select
      aria-label={label}
      value={value}
      onChange={(e) => (e.target.value === NEW ? setAdding(true) : onChange(e.target.value))}
    >
      <option value="">Where? (pick a disk or cloud)</option>
      {(locations.data ?? [])
        .filter((l) => l.is_active || l.id === value)
        .map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      <option value={NEW}>+ New location…</option>
    </Select>
  )
}
