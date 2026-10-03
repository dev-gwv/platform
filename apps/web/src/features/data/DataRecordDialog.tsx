import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, HardDrive, Link2, Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import type { CustodyStatus, DataRecord, ShootListItem, TeamSlot } from '@ipc/contracts'
import { useAuth } from '@/shared/auth/AuthProvider'
import { DraftRestoredBanner, useFormDraft } from '@/shared/hooks/use-form-draft'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input, Label, Select, Textarea } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { useMembers } from '@/features/allocation/api'
import {
  useCreateDataPerson,
  useCreateDataRecord,
  useCreateStorageLocation,
  useDataPeople,
  useStorageLocations,
  useUpdateDataRecord,
} from './api'
import { LookupSelect } from '@/features/settings/LookupSelect'
import { CardLabelsField } from './CardLabelsField'
import { LocationKindSelect, kindFields } from './LocationKindSelect'
import { DATA_TYPES, TRACK_LABEL, defaultDataType, defaultLabel, slotDay, whenLabel } from './stage'
import { useCanPay, usePaySlot, useSlotPayStatus } from '@/features/team-payouts/pay'
import {
  PayoutLine,
  payoutRequest,
  startPayout,
  type PayoutDraft,
} from '@/features/team-payouts/PayoutLine'

const OTHER = '__other'
const NEW = '__new'

interface Copy {
  location: string
  folder: string
  link: string
  status: CustodyStatus
}

/**
 * The last copier and disks this studio used, so the next record starts
 * from them ("quick save"). Ids only, per studio, in this browser.
 */
interface Remembered {
  copiedBy?: string
  primary?: string
  backup?: string
}
const rememberKey = (company: string | undefined) => `data-defaults:${company ?? 'none'}`
function readRemembered(company: string | undefined): Remembered {
  try {
    const raw = localStorage.getItem(rememberKey(company))
    return raw ? (JSON.parse(raw) as Remembered) : {}
  } catch {
    return {}
  }
}
function writeRemembered(company: string | undefined, v: Remembered) {
  try {
    localStorage.setItem(rememberKey(company), JSON.stringify(v))
  } catch {
    // Private windows and full storage: nothing to remember, nothing breaks.
  }
}

/**
 * The data from one booking: what came in, and where its two copies went.
 *
 * What a studio checks the next morning is in view -- who copied the cards,
 * where the main copy and the backup went, and whether each is done. Folder
 * and link open per copy; type, size, cards, label and notes sit under
 * "More details". A new record starts from the copier and disks used last
 * (the owner: "every time I have to enter it fresh").
 */
export function DataRecordDialog({
  projectId,
  shoot,
  slot,
  record,
  onClose,
}: {
  projectId: string | null
  shoot: Pick<ShootListItem, 'id' | 'name'>
  slot: Pick<TeamSlot, 'id' | 'user_id' | 'user_name' | 'service_name' | 'start_at' | 'end_at'>
  record?: DataRecord | undefined
  onClose: () => void
}) {
  const { session } = useAuth()
  const members = useMembers()
  const people = useDataPeople()
  const addPerson = useCreateDataPerson()
  const create = useCreateDataRecord()
  const update = useUpdateDataRecord()
  // Paying the person as their cards come in (owners and managers only).
  const canPay = useCanPay()
  const payStatus = useSlotPayStatus(slot.id, canPay)
  const paySlot = usePaySlot()
  const [payout, setPayout] = useState<PayoutDraft | null>(null)
  useEffect(() => {
    if (payStatus.data && payout === null) setPayout(startPayout(payStatus.data))
  }, [payStatus.data, payout])
  const busy = create.isPending || update.isPending || addPerson.isPending || paySlot.isPending

  const [type, setType] = useState(record?.data_type ?? defaultDataType(slot.service_name))
  const [received, setReceived] = useState(record?.date_received ?? slotDay(slot))
  // A team member's id, "p:<id>" for an outside helper, OTHER to type a new name.
  const [remembered] = useState(() => (record ? {} : readRemembered(session?.company_id)))
  const [copiedBy, setCopiedBy] = useState(
    record
      ? (record.copied_by_uid ??
          (record.copied_by_person_id
            ? `p:${record.copied_by_person_id}`
            : record.copied_by_name
              ? OTHER
              : ''))
      : (remembered.copiedBy ?? session?.user_id ?? ''),
  )
  const [copiedByName, setCopiedByName] = useState(
    record && !record.copied_by_uid ? (record.copied_by_name ?? '') : '',
  )
  const [size, setSize] = useState(record?.size_gb ? String(record.size_gb) : '')
  const [cards, setCards] = useState(record?.card_count ? String(record.card_count) : '')
  const [cardNames, setCardNames] = useState<string[]>(record?.card_labels ?? [])
  const [label, setLabel] = useState(record?.data_label ?? defaultLabel(shoot, slot))
  const [notes, setNotes] = useState(record?.notes ?? '')
  const [primary, setPrimary] = useState<Copy>({
    location: record?.primary_location_id ?? remembered.primary ?? '',
    folder: record?.folder_path ?? '',
    link: record?.cloud_link ?? '',
    status: record?.primary_status ?? 'pending',
  })
  const [backup, setBackup] = useState<Copy>({
    location: record?.backup_location_id ?? remembered.backup ?? '',
    folder: record?.backup_folder_path ?? '',
    link: record?.backup_cloud_link ?? '',
    status: record?.backup_status ?? 'pending',
  })

  // What was typed survives a refresh or a closed tab until it is saved.
  const initial = useState(() => ({
    type,
    received,
    copiedBy,
    copiedByName,
    size,
    cards,
    cardNames,
    label,
    notes,
    primary,
    backup,
  }))[0]
  const draft = useFormDraft(
    `data-record:${record?.id ?? `new:${slot.id}`}`,
    {
      type,
      received,
      copiedBy,
      copiedByName,
      size,
      cards,
      cardNames,
      label,
      notes,
      primary,
      backup,
    },
    restore,
  )
  function restore(v: typeof initial) {
    setType(v.type)
    setReceived(v.received)
    setCopiedBy(v.copiedBy)
    setCopiedByName(v.copiedByName)
    setSize(v.size)
    setCards(v.cards)
    setCardNames(v.cardNames ?? [])
    setLabel(v.label)
    setNotes(v.notes)
    setPrimary(v.primary)
    setBackup(v.backup)
  }

  const who = slot.user_name ?? 'this booking'
  const locations = useStorageLocations()
  const [more, setMore] = useState(
    () =>
      !!(
        record?.size_gb ||
        record?.card_count ||
        record?.card_labels?.length ||
        record?.notes ||
        (record?.data_type && record.data_type !== defaultDataType(slot.service_name))
      ),
  )

  // A remembered disk or helper that has since been removed is not offered.
  useEffect(() => {
    if (record || !locations.data) return
    const live = new Set(locations.data.filter((l) => l.is_active).map((l) => l.id))
    setPrimary((p) => (p.location && !live.has(p.location) ? { ...p, location: '' } : p))
    setBackup((b) => (b.location && !live.has(b.location) ? { ...b, location: '' } : b))
  }, [record, locations.data])
  useEffect(() => {
    if (record || !people.data || !members.data) return
    setCopiedBy((c) => {
      if (c.startsWith('p:'))
        return people.data.some((p) => `p:${p.id}` === c && p.is_active)
          ? c
          : (session?.user_id ?? '')
      if (c && c !== OTHER && c !== slot.user_id && !members.data.some((m) => m.user_id === c))
        return session?.user_id ?? ''
      return c
    })
  }, [record, people.data, members.data, session?.user_id, slot.user_id])

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
    // An outside helper: picked from the list, or a typed name saved to it
    // (the server hands back the same helper for a name it already has).
    let helper: { id: string; name: string } | null = null
    if (copiedBy.startsWith('p:')) {
      const p = (people.data ?? []).find((x) => x.id === copiedBy.slice(2))
      helper = p ? { id: p.id, name: p.name } : null
    } else if (copiedBy === OTHER) {
      try {
        const p = await addPerson.mutateAsync({ name: copiedByName.trim() })
        helper = { id: p.id, name: p.name }
      } catch {
        return
      }
    }
    const fields = {
      data_type: type,
      data_label: label.trim() || defaultLabel(shoot, slot),
      date_received: received || null,
      size_gb: sizeN,
      card_count: Math.max(cardsN, cardNames.length),
      card_labels: cardNames,
      notes: notes.trim() || null,
      copied_by_uid: copiedBy && copiedBy !== OTHER && !copiedBy.startsWith('p:') ? copiedBy : null,
      copied_by_person_id: helper?.id ?? null,
      copied_by_name: helper?.name ?? null,
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
      const pay =
        payStatus.data && payout
          ? payoutRequest(payout, payStatus.data, new Date().toISOString().slice(0, 10))
          : null
      if (pay) {
        await paySlot.mutateAsync({ slotId: slot.id, body: pay })
        if (pay.paid_now > 0) toast.success(`Paid ${who} ₹${pay.paid_now.toLocaleString('en-IN')}`)
      }
      writeRemembered(session?.company_id, {
        copiedBy: helper ? `p:${helper.id}` : (fields.copied_by_uid ?? ''),
        primary: fields.primary_location_id ?? '',
        backup: fields.backup_location_id ?? '',
      })
      draft.clear()
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
          <DraftRestoredBanner
            at={draft.restoredAt}
            onDismiss={draft.dismissRestored}
            onDiscard={() => {
              draft.clear()
              restore(initial)
            }}
          />
          {/* Who copied the cards, and when they came in. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dr-copied" className="text-xs">
                Copied by
              </Label>
              <Select id="dr-copied" value={copiedBy} onChange={(e) => setCopiedBy(e.target.value)}>
                <option value="">Not recorded</option>
                {slot.user_id && (
                  <optgroup label="On this shoot">
                    <option value={slot.user_id}>{slot.user_name ?? 'The shooter'}</option>
                  </optgroup>
                )}
                <optgroup label="Team">
                  {(members.data ?? [])
                    .filter((m) => m.user_id !== slot.user_id)
                    .map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.name}
                      </option>
                    ))}
                </optgroup>
                {(people.data ?? []).some((p) => p.is_active || `p:${p.id}` === copiedBy) && (
                  <optgroup label="Outside helpers">
                    {(people.data ?? [])
                      .filter((p) => p.is_active || `p:${p.id}` === copiedBy)
                      .map((p) => (
                        <option key={p.id} value={`p:${p.id}`}>
                          {p.role ? `${p.name} · ${p.role}` : p.name}
                        </option>
                      ))}
                  </optgroup>
                )}
                <option value={OTHER}>+ New helper…</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dr-received" className="text-xs">
                Received on
              </Label>
              <Input
                id="dr-received"
                type="date"
                value={received}
                onChange={(e) => setReceived(e.target.value)}
              />
            </div>
            {copiedBy === OTHER && (
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="dr-copied-name" className="text-xs">
                  Helper's name (saved for next time)
                </Label>
                <Input
                  id="dr-copied-name"
                  className={nudge(copiedByName)}
                  value={copiedByName}
                  onChange={(e) => setCopiedByName(e.target.value)}
                  placeholder="e.g. Aman (studio intern)"
                  autoFocus
                />
              </div>
            )}
          </div>

          {/* The two copies: one line each. */}
          <div className="divide-y divide-border rounded-lg border border-border">
            <CopyRow
              title="Main copy"
              example="WD-001"
              icon={<HardDrive className="size-4" />}
              value={primary}
              onChange={setPrimary}
              statuses={['pending', 'copied', 'verified', 'issue']}
            />
            <CopyRow
              title="Backup copy"
              example="SEA-002"
              icon={<ShieldCheck className="size-4" />}
              value={backup}
              onChange={setBackup}
              statuses={['pending', 'copied', 'verified', 'issue', 'not_required']}
            />
          </div>

          {canPay && payStatus.data && payout && (
            <PayoutLine name={who} status={payStatus.data} value={payout} onChange={setPayout} />
          )}

          <button
            type="button"
            onClick={() => setMore((v) => !v)}
            aria-expanded={more}
            className="flex w-fit items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn('size-4 transition-transform', more && 'rotate-180')} /> More
            details
            <span className="font-normal">· type, size, cards, notes</span>
          </button>
          {more && (
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="dr-type" className="text-xs">
                  Data type
                </Label>
                <LookupSelect
                  category="data_type"
                  id="dr-type"
                  aria-label="Data type"
                  value={type}
                  onChange={setType}
                  defaults={DATA_TYPES}
                  addLabel="Add a type…"
                  inputPlaceholder="e.g. Reels, 360° video"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dr-size" className="text-xs">
                  Size (GB)
                </Label>
                <Input
                  id="dr-size"
                  inputMode="decimal"
                  placeholder="e.g. 256"
                  value={size}
                  onChange={(e) => setSize(e.target.value.replace(/[^\d.]/g, ''))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dr-cards" className="text-xs">
                  How many cards
                </Label>
                <Input
                  id="dr-cards"
                  inputMode="numeric"
                  placeholder="e.g. 3"
                  value={cardNames.length > Number(cards || 0) ? String(cardNames.length) : cards}
                  onChange={(e) => setCards(e.target.value.replace(/\D/g, ''))}
                />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-4">
                <Label htmlFor="dr-card-names" className="text-xs">
                  Card names
                </Label>
                <CardLabelsField id="dr-card-names" value={cardNames} onChange={setCardNames} />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-4">
                <Label htmlFor="dr-label" className="text-xs">
                  Label
                </Label>
                <Input id="dr-label" value={label} onChange={(e) => setLabel(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-4">
                <Label htmlFor="dr-notes" className="text-xs">
                  Notes
                </Label>
                <Textarea
                  id="dr-notes"
                  rows={2}
                  placeholder="A corrupted card, a missing clip…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>
          )}
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

/** Amber until something is filled in, green once it is. */
const nudge = (v: string) => (v.trim() ? 'border-success/50' : 'border-warning/60 bg-warning/5')

const STATUS_TONE: Record<CustodyStatus, string> = {
  pending: '',
  copied: 'text-warning',
  verified: 'text-success',
  issue: 'text-destructive',
  not_required: 'text-muted-foreground',
}

/**
 * One copy on one line: where it went and how far it got. Folder and link
 * open on demand, or by themselves when they already hold something.
 */
function CopyRow({
  title,
  example,
  icon,
  value,
  onChange,
  statuses,
}: {
  title: string
  /** A disk name to show how studios label theirs: "WD-001". */
  example: string
  icon: ReactNode
  value: Copy
  onChange: (next: Copy) => void
  statuses: CustodyStatus[]
}) {
  const skipped = value.status === 'not_required'
  const [paths, setPaths] = useState(!!(value.folder || value.link))
  const open = paths || !!(value.folder || value.link)
  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="grid items-center gap-2 sm:grid-cols-[8.5rem_1fr_9rem]">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <span className="text-muted-foreground">{icon}</span> {title}
        </p>
        {skipped ? (
          <p className="text-sm text-muted-foreground">Not needed for this data.</p>
        ) : (
          <LocationPicker
            value={value.location}
            onChange={(location) => onChange({ ...value, location })}
            label={`${title} location`}
            example={example}
          />
        )}
        <Select
          aria-label={`${title} status`}
          className={STATUS_TONE[value.status]}
          value={value.status}
          onChange={(e) => onChange({ ...value, status: e.target.value as CustodyStatus })}
        >
          {statuses.map((st) => (
            <option key={st} value={st}>
              {TRACK_LABEL[st]}
            </option>
          ))}
        </Select>
      </div>
      {!skipped &&
        (open ? (
          <div className="grid gap-2 sm:grid-cols-2 sm:pl-[9rem]">
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
        ) : (
          <button
            type="button"
            onClick={() => setPaths(true)}
            className="flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground sm:ml-[9rem]"
          >
            <Link2 className="size-3.5" /> + Folder or link
          </button>
        ))}
    </div>
  )
}

/** Pick a saved disk/cloud, or name a new one on the spot. */
function LocationPicker({
  value,
  onChange,
  label,
  example,
}: {
  value: string
  onChange: (id: string) => void
  label: string
  example?: string
}) {
  const locations = useStorageLocations()
  const create = useCreateStorageLocation()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<string>('drive')

  if (adding) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          aria-label="New location name"
          placeholder={`Name, e.g. ${example ?? 'Studio HDD 4'}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-[12rem] flex-1"
          autoFocus
        />
        <LocationKindSelect value={kind} onChange={setKind} className="w-64 shrink-0" />
        <Button
          size="sm"
          disabled={!name.trim() || create.isPending}
          onClick={() =>
            create.mutate(
              {
                name: name.trim(),
                ...kindFields(kind),
                location_type: kindFields(kind).location_type ?? undefined,
              },
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
      className={cn(
        '[&>button]:transition-colors',
        value
          ? '[&>button]:border-success/50'
          : '[&>button]:border-warning/60 [&>button]:bg-warning/5',
      )}
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
