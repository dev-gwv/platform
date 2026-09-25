import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Settings2 } from 'lucide-react'
import { shootListItem, type CreateDataRecordRequest, type DataBoardRow, type DataRecord } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { SkeletonList } from '@/shared/ui/skeleton'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { useAccess } from '@/shared/auth/useAccess'
import {
  useDataBoard,
  useCreateDataRecord,
  useUpdateDataRecord,
  useStorageLocations,
  useCreateStorageLocation,
  useUpdateStorageLocation,
  useDeleteStorageLocation,
} from '@/features/data/api'
import { DataBoardView } from '@/features/data/DataBoardView'
import { DataRecordDialog } from '@/features/data/DataRecordDialog'
import { DATA_TYPES } from '@/features/data/stage'
import { LocationKindSelect, kindFields, kindLabelOf, kindValueOf } from '@/features/data/LocationKindSelect'
import { LookupSelect } from '@/features/settings/LookupSelect'
import { useProjects } from '@/features/projects/api'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useFormDraft } from '@/shared/hooks/use-form-draft'

const shootsList = shootListItem.array()

type DmTab = 'records' | 'locations'

export function DataManagementPage({ initialTab }: { initialTab?: DmTab } = {}) {
  return (
    <AuthedPage module="projects">
      <DataPage initialTab={initialTab} />
    </AuthedPage>
  )
}

/**
 * Where every booked person's cards are, from the shoot day to the archive.
 * A studio manager's page: the crew hand their own cards over from My Shoots,
 * and see only their own records.
 */
function DataPage({ initialTab }: { initialTab?: DmTab | undefined }) {
  const canManage = useAccess().hasAction('projects', 'edit')
  const board = useDataBoard()
  const [tab, setTab] = useState<DmTab>(initialTab ?? 'records')
  const [opened, setOpened] = useState<DataBoardRow | null>(null)

  if (!canManage) {
    return (
      <>
        <PageHeader title="Data management" description="Where every shoot's cards are." />
        <EmptyState
          title="For studio managers"
          description="Hand your own cards over from My Shoots -- the studio sees them there."
        />
      </>
    )
  }

  const rows = board.data?.rows ?? []

  return (
    <>
      <PageHeader
        title="Data management"
        description="Every booked person's cards, from the shoot day to the archive."
        actions={
          <div className="flex gap-2">
            <ManageLocationsDialog />
            <AddRecordDialog />
          </div>
        }
      />
      <div className="inline-flex w-fit rounded-lg border border-border bg-card p-0.5 text-xs" role="tablist" aria-label="Data views">
        {(['records', 'locations'] as DmTab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={t === tab ? 'rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground' : 'rounded-md px-3 py-1.5 font-medium text-muted-foreground hover:text-foreground'}
          >
            {t === 'records' ? 'Board' : 'Locations'}
          </button>
        ))}
      </div>

      {tab === 'locations' ? (
        <LocationsTab />
      ) : board.isLoading ? (
        <SkeletonList rows={5} columns={5} />
      ) : board.isError ? (
        <ErrorState onRetry={() => void board.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No shoots to collect data from yet"
          description="Once a shoot day has passed, everyone booked on it shows up here until their cards are safe."
          action={<AddRecordDialog />}
        />
      ) : (
        <DataBoardView rows={rows} truncated={board.data?.truncated ?? false} onOpen={setOpened} />
      )}

      {opened &&
        (opened.slot_id && opened.shoot_id ? (
          <DataRecordDialog
            projectId={opened.project_id}
            shoot={{ id: opened.shoot_id, name: opened.shoot_name ?? 'Shoot' }}
            slot={{
              id: opened.slot_id,
              user_id: opened.user_id ?? '',
              user_name: opened.user_name,
              service_name: opened.role,
              start_at: opened.start_at ?? `${opened.shoot_date ?? new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
              end_at: opened.end_at ?? `${opened.shoot_date ?? new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
            }}
            record={opened.record ?? undefined}
            onClose={() => setOpened(null)}
          />
        ) : opened.record ? (
          <AddRecordDialog record={opened.record} open onOpenChange={(v) => !v && setOpened(null)} />
        ) : null)}
    </>
  )
}

/** Storage locations: capacity, holder and archive state at a glance. */
function LocationsTab() {
  const { data: locations, isLoading } = useStorageLocations()
  const update = useUpdateStorageLocation()
  const del = useDeleteStorageLocation()
  const confirm = useConfirm()
  const [editing, setEditing] = useState<string | null>(null)

  async function onArchive(id: string, name: string, active: boolean) {
    if (active) {
      const yes = await confirm({
        title: `Archive "${name}"?`,
        description: 'It stays on old records but leaves the pickers.',
        confirmLabel: 'Archive',
      })
      if (!yes) return
      update.mutate({ id, patch: { is_active: false } })
    } else {
      update.mutate({ id, patch: { is_active: true } })
    }
  }

  async function onDelete(id: string, name: string) {
    const yes = await confirm({
      title: `Remove "${name}"?`,
      description: 'If any record points at it, it is archived instead, so those records still say where their copies went.',
      destructive: true,
      confirmLabel: 'Remove',
    })
    if (yes) del.mutate(id)
  }

  if (isLoading) return <SkeletonList rows={3} columns={4} />
  if (!locations || locations.length === 0) {
    return <EmptyState title="No storage locations yet" description="Add drives, NAS shares and cloud destinations." action={<ManageLocationsDialog />} />
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Kind</th>
            <th className="px-4 py-2 font-medium">Used</th>
            <th className="px-4 py-2 font-medium">Holder</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {locations.map((loc) => (
            <tr key={loc.id} className="border-t border-border">
              <td className="px-4 py-2 font-medium">{loc.name}</td>
              <td className="px-4 py-2 text-muted-foreground">{kindLabelOf(loc)}</td>
              <td className="px-4 py-2">
                <UsageBar used={loc.used_gb} capacity={loc.capacity_gb} records={loc.record_count} />
              </td>
              <td className="px-4 py-2 text-muted-foreground">{loc.owner ?? '—'}</td>
              <td className="px-4 py-2">
                <StatusBadge tone={loc.is_active ? 'success' : 'neutral'}>{loc.is_active ? 'Active' : 'Archived'}</StatusBadge>
              </td>
              <td className="px-4 py-2">
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(editing === loc.id ? null : loc.id)}>
                    <Pencil />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void onArchive(loc.id, loc.name, loc.is_active)}>
                    {loc.is_active ? 'Archive' : 'Restore'}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void onDelete(loc.id, loc.name)}>
                    <Trash2 />
                  </Button>
                </div>
                {editing === loc.id && <LocationEditor id={loc.id} onDone={() => setEditing(null)} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** How full a disk is, from the sizes logged on the records that point at it. */
function UsageBar({ used, capacity, records }: { used: number; capacity: number | null; records: number }) {
  const gb = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} TB` : `${Math.round(n)} GB`)
  const pct = capacity ? Math.min(100, Math.round((used / capacity) * 100)) : null
  return (
    <div className="flex min-w-[9rem] flex-col gap-1">
      <span className="text-xs text-muted-foreground tabular-nums">
        {gb(used)}
        {capacity ? ` of ${gb(capacity)}` : ''} · {records} record{records === 1 ? '' : 's'}
      </span>
      {pct != null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-label={`${pct}% full`}>
          <div className={pct >= 90 ? 'h-full bg-destructive' : pct >= 75 ? 'h-full bg-warning' : 'h-full bg-primary'} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

function LocationEditor({ id, onDone }: { id: string; onDone: () => void }) {
  const { data: locations } = useStorageLocations()
  const update = useUpdateStorageLocation()
  const loc = locations?.find((l) => l.id === id)
  const [capacity, setCapacity] = useState(loc?.capacity_gb != null ? String(loc.capacity_gb) : '')
  const [owner, setOwner] = useState(loc?.owner ?? '')
  const [notes, setNotes] = useState(loc?.notes ?? '')
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(`storage-location:${id}`, { capacity, owner, notes }, (v) => {
    setCapacity(v.capacity)
    setOwner(v.owner)
    setNotes(v.notes)
  })

  async function onSave(e: FormEvent) {
    e.preventDefault()
    await update.mutateAsync({
      id,
      patch: {
        capacity_gb: capacity.trim() ? Number(capacity) : null,
        owner: owner.trim() || null,
        notes: notes.trim() || null,
      },
    })
    draft.clear()
    onDone()
  }

  return (
    <form onSubmit={(e) => void onSave(e)} className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/20 p-2">
      <div className="flex flex-col gap-1">
        <Label>Capacity (GB)</Label>
        <Input inputMode="decimal" value={capacity} onChange={(e) => setCapacity(e.target.value)} className="w-28" placeholder="2000" />
      </div>
      <div className="flex flex-col gap-1">
        <Label>Holder</Label>
        <Input value={owner} onChange={(e) => setOwner(e.target.value)} className="w-40" placeholder="Office / editor name" />
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <Label>Notes</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Shelf, login, anything useful" />
      </div>
      <Button size="sm" type="submit" disabled={update.isPending}>Save</Button>
    </form>
  )
}
/** The named drives/NAS/cloud destinations a card's primary or backup copy points to. */
function ManageLocationsDialog() {
  const { data: locations, isLoading } = useStorageLocations()
  const create = useCreateStorageLocation()
  const update = useUpdateStorageLocation()
  const del = useDeleteStorageLocation()
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<string>('drive')
  const [capacity, setCapacity] = useState('')
  const [owner, setOwner] = useState('')
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(open ? 'storage-location:new' : null, { name, kind, capacity, owner }, (v) => {
    setName(v.name)
    setKind(v.kind)
    setCapacity(v.capacity)
    setOwner(v.owner)
  })

  async function onAdd(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    await create.mutateAsync({
      name: name.trim(),
      kind: kindFields(kind).kind,
      ...(kindFields(kind).location_type ? { location_type: kindFields(kind).location_type! } : {}),
      ...(capacity.trim() ? { capacity_gb: Number(capacity) } : {}),
      ...(owner.trim() ? { owner: owner.trim() } : {}),
    })
    draft.clear()
    setName('')
    setKind('drive')
    setCapacity('')
    setOwner('')
  }

  async function onDelete(id: string, label: string) {
    const yes = await confirm({
      title: 'Remove this location?',
      description: `${label}. Records pointing at it will show no location instead.`,
      destructive: true,
      confirmLabel: 'Remove',
    })
    if (yes) del.mutate(id)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Settings2 /> Locations
        </Button>
      </DialogTrigger>
      <DialogContent title="Storage locations" description="The drives, NAS shares and cloud destinations your copies live on.">
        <div className="flex flex-col gap-3">
          <form onSubmit={onAdd} className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-44 flex-1 flex-col gap-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="NAS 2, Drive B, Google Drive…" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Kind</Label>
              <LocationKindSelect value={kind} onChange={setKind} className="w-44" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Capacity (GB)</Label>
              <Input inputMode="decimal" value={capacity} onChange={(e) => setCapacity(e.target.value)} className="w-28" placeholder="2000" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Holder</Label>
              <Input value={owner} onChange={(e) => setOwner(e.target.value)} className="w-40" placeholder="Office / editor" />
            </div>
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              <Plus /> Add
            </Button>
          </form>

          {isLoading ? (
            <SkeletonList rows={3} columns={2} />
          ) : !locations || locations.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No locations yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {locations.map((loc) => (
                <div key={loc.id} className="flex items-center gap-2 rounded-md border border-border p-2">
                  <Input
                    defaultValue={loc.name}
                    className="flex-1"
                    onBlur={(e) => {
                      const value = e.target.value.trim()
                      if (value && value !== loc.name) update.mutate({ id: loc.id, patch: { name: value } })
                    }}
                  />
                  <LocationKindSelect
                    value={kindValueOf(loc)}
                    onChange={(v) => update.mutate({ id: loc.id, patch: kindFields(v) })}
                    className="w-44"
                  />
                  <Button size="sm" variant="ghost" title="Remove" onClick={() => void onDelete(loc.id, loc.name)}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="mt-2 flex justify-end">
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AddRecordDialog({
  record,
  trigger,
  open: openProp,
  onOpenChange,
}: { record?: DataRecord; trigger?: React.ReactNode; open?: boolean; onOpenChange?: (v: boolean) => void } = {}) {
  const isEdit = !!record
  const create = useCreateDataRecord()
  const update = useUpdateDataRecord()
  const { data: projects } = useProjects()
  const { session } = useAuth()
  const [openSelf, setOpenSelf] = useState(false)
  // Opened from a board card, the page holds it open; otherwise its own button does.
  const open = openProp ?? openSelf
  const setOpen = (v: boolean) => (onOpenChange ? onOpenChange(v) : setOpenSelf(v))
  const [label, setLabel] = useState(record?.data_label ?? '')
  const [dataType, setDataType] = useState(record?.data_type ?? '')
  const [cards, setCards] = useState(String(record?.card_count ?? 1))
  const [size, setSize] = useState(String(record?.size_gb ?? ''))
  const [projectId, setProjectId] = useState(record?.project_id ?? '')
  const [shootId, setShootId] = useState(record?.shoot_id ?? '')
  const [primaryLocationId, setPrimaryLocationId] = useState(record?.primary_location_id ?? '')
  const [backupLocationId, setBackupLocationId] = useState(record?.backup_location_id ?? '')
  const [error, setError] = useState<string | null>(null)
  const { data: locations } = useStorageLocations()
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(
    open ? `data-card:${record?.id ?? 'new'}` : null,
    { label, dataType, cards, size, projectId, shootId, primaryLocationId, backupLocationId },
    (v) => {
      setLabel(v.label)
      setDataType(v.dataType)
      setCards(v.cards)
      setSize(v.size)
      setProjectId(v.projectId)
      setShootId(v.shootId)
      setPrimaryLocationId(v.primaryLocationId)
      setBackupLocationId(v.backupLocationId)
    },
  )

  const shoots = useQuery({
    queryKey: ['shoots', 'by-project', projectId],
    queryFn: () => callApi(`/shoots?project_id=${projectId}`, { responseSchema: shootsList }),
    enabled: !!session && !!projectId,
  })

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const shared = {
        shoot_id: shootId || null,
        project_id: projectId || null,
        data_label: label.trim(),
        card_count: cards.trim() ? Number(cards) : 0,
        size_gb: size.trim() ? Number(size) : 0,
        primary_location_id: primaryLocationId || null,
        backup_location_id: backupLocationId || null,
      }
      if (isEdit) {
        // Resend data_type explicitly (null clears it) instead of a falsy
        // value silently dropping the key from the patch.
        await update.mutateAsync({ id: record.id, patch: { ...shared, data_type: dataType || null } })
      } else {
        const body: CreateDataRecordRequest = { ...shared, ...(dataType ? { data_type: dataType } : {}) }
        await create.mutateAsync(body)
      }
      draft.clear()
      setOpen(false)
      if (!isEdit) {
        setLabel('')
        setDataType('')
        setCards('1')
        setSize('')
        setProjectId('')
        setShootId('')
        setPrimaryLocationId('')
        setBackupLocationId('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${isEdit ? 'update' : 'log'} the card.`)
    }
  }

  const busy = create.isPending || update.isPending

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {openProp === undefined && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button>
              <Plus /> Log other data
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent title={isEdit ? 'Edit card' : 'Log a card'} description="Record footage as it comes off a shoot.">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="CF Card A (Cam 1)" required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Project</Label>
              <Select
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value)
                  setShootId('')
                }}
              >
                <option value="">Not linked</option>
                {(projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Shoot</Label>
              <Select value={shootId} onChange={(e) => setShootId(e.target.value)} disabled={!projectId}>
                <option value="">{projectId ? 'Whole project' : 'Pick a project first'}</option>
                {(shoots.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Data type</Label>
            <LookupSelect
              category="data_type"
              aria-label="Data type"
              value={dataType}
              onChange={setDataType}
              defaults={DATA_TYPES}
              placeholder="Unspecified"
              addLabel="Add a type…"
              inputPlaceholder="e.g. Reels, 360° video"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Cards</Label>
              <Input inputMode="numeric" value={cards} onChange={(e) => setCards(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Size (GB)</Label>
              <Input inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Primary location</Label>
              <Select value={primaryLocationId} onChange={(e) => setPrimaryLocationId(e.target.value)}>
                <option value="">Not set</option>
                {(locations ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Backup location</Label>
              <Select value={backupLocationId} onChange={(e) => setBackupLocationId(e.target.value)}>
                <option value="">Not set</option>
                {(locations ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {error && (
            <p id="form-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Log card'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
