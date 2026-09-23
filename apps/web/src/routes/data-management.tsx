import { useMemo, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HardDrive, Plus, Check, Pencil, Trash2, Download, Settings2, AlertTriangle } from 'lucide-react'
import { shootListItem, type CreateDataRecordRequest, type DataRecord, type DataStage, type StorageLocationKind } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { StatCard } from '@/shared/ui/stat-card'
import { SkeletonList } from '@/shared/ui/skeleton'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { humanize } from '@/shared/ui/format'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { HowToUse } from '@/shared/ui/how-to-use'
import { toCsv, downloadCsv } from '@/shared/ui/csv'
import {
  useDataRecords,
  useVerifyData,
  useCreateDataRecord,
  useUpdateDataRecord,
  useDeleteDataRecord,
  useStorageLocations,
  useCreateStorageLocation,
  useUpdateStorageLocation,
  useDeleteStorageLocation,
} from '@/features/data/api'
import { STAGE_LABEL, STAGE_TONE, TRACK_LABEL, TRACK_TONE } from '@/features/data/stage'
import { useProjects } from '@/features/projects/api'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const DATA_TYPES = ['Photos (RAW)', 'Photos (JPEG)', 'Video', 'Audio', 'Mixed']
const shootsList = shootListItem.array()

// Labels and tones for a record's stage and each copy's status live with the
// rules that derive them (features/data/stage.ts), so this page, the shoot
// card and the database never describe the same record differently.
const DATA_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  (['with_shooter', 'received', 'copied', 'backed_up', 'verified', 'issue', 'not_required'] as const).map((s) => [
    s,
    STAGE_LABEL[s],
  ]),
)

function dataStatusLabel(s: DataStage): string {
  return STAGE_LABEL[s]
}

type DmTab = 'records' | 'locations'

type StatusFilter = 'all' | 'missing' | 'primary_pending' | 'backup_pending' | 'ready' | 'at_risk'

/** Only one track verified while the other has no copy at all — a single point of failure. */
function isAtRisk(r: DataRecord): boolean {
  return (r.primary_status === 'verified' && r.backup_status === 'pending') ||
    (r.backup_status === 'verified' && r.primary_status === 'pending')
}

export function DataManagementPage({ initialTab }: { initialTab?: DmTab } = {}) {
  return (
    <AuthedPage module="projects">
      <DataBoard initialTab={initialTab} />
    </AuthedPage>
  )
}

function DataBoard({ initialTab }: { initialTab?: DmTab | undefined }) {
  const { data, isLoading, isError, refetch } = useDataRecords()
  const { data: projects } = useProjects()
  const verify = useVerifyData()
  const updateRecord = useUpdateDataRecord()
  const del = useDeleteDataRecord()
  const confirm = useConfirm()
  const [tab, setTab] = useState<DmTab>(initialTab ?? 'records')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [projectId, setProjectId] = useState('')
  const [dataType, setDataType] = useState('')
  /**
   * The chips answer "is this card safe yet". These three answer the other
   * questions a studio actually asks the screen: where is it in the eight-stage
   * journey, is the second copy done, and what came off the shoots that week.
   */
  const [dataStatus, setDataStatus] = useState('')
  const [backupStatus, setBackupStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const counts = useMemo(() => {
    const rows = data ?? []
    return {
      missing: rows.filter((r) => r.primary_status === 'pending' && r.backup_status === 'pending').length,
      primaryPending: rows.filter((r) => r.primary_status !== 'verified').length,
      backupPending: rows.filter((r) => r.backup_status !== 'verified').length,
      ready: rows.filter((r) => r.primary_status === 'verified' && r.backup_status === 'verified').length,
      atRisk: rows.filter(isAtRisk).length,
    }
  }, [data])

  const filtered = useMemo(() => {
    return (data ?? [])
      .filter((r) => {
        if (status === 'missing') return r.primary_status === 'pending' && r.backup_status === 'pending'
        if (status === 'primary_pending') return r.primary_status !== 'verified'
        if (status === 'backup_pending') return r.backup_status !== 'verified'
        if (status === 'ready') return r.primary_status === 'verified' && r.backup_status === 'verified'
        if (status === 'at_risk') return isAtRisk(r)
        return true
      })
      .filter((r) => !projectId || r.project_id === projectId)
      .filter((r) => !dataType || r.data_type === dataType)
      .filter((r) => !dataStatus || r.data_status === dataStatus)
      .filter((r) => !backupStatus || r.backup_status === backupStatus)
      .filter((r) => {
        // Date received is the date a studio means; a card logged before it
        // came back has none yet, so fall back to when it was logged.
        if (!from && !to) return true
        const d = (r.date_received ?? r.created_at).slice(0, 10)
        return (!from || d >= from) && (!to || d <= to)
      })
      .filter((r) => {
        if (!search.trim()) return true
        const q = search.trim().toLowerCase()
        return r.data_label.toLowerCase().includes(q) || (r.project_name ?? '').toLowerCase().includes(q)
      })
  }, [data, status, projectId, dataType, dataStatus, backupStatus, from, to, search])

  function onExport() {
    downloadCsv(
      'data-records.csv',
      toCsv(
        ['Card / drive', 'Type', 'Project', 'Size (GB)', 'Cards', 'Primary status', 'Primary location', 'Backup status', 'Backup location', 'Verified at'],
        filtered.map((r) => [
          r.data_label,
          r.data_type ?? '',
          r.project_name ?? '',
          r.size_gb,
          r.card_count,
          r.primary_status,
          r.primary_location_name ?? '',
          r.backup_status,
          r.backup_location_name ?? '',
          r.verified_at ?? '',
        ]),
      ),
    )
  }

  async function onDelete(r: DataRecord) {
    const yes = await confirm({
      title: 'Delete this record?',
      description: `${r.data_label}. This cannot be undone.`,
      destructive: true,
      confirmLabel: 'Delete',
    })
    if (yes) del.mutate(r.id)
  }

  function markReceived(r: DataRecord) {
    updateRecord.mutate({
      id: r.id,
      // The stage follows from the date (0160); "received" is not set directly.
      patch: { date_received: new Date().toISOString().slice(0, 10) },
    })
  }

  return (
    <>
      <PageHeader
        title="Data management"
        description="Track every card from shoot to primary and backup copy."
        actions={
          <div className="flex gap-2">
            <ManageLocationsDialog />
            <Button variant="outline" onClick={onExport} disabled={filtered.length === 0}>
              <Download /> Export CSV
            </Button>
            <AddRecordDialog />
          </div>
        }
      />
      {isLoading ? (
        <SkeletonList rows={5} columns={6} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : (
        <>
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-xs" role="tablist" aria-label="Data views">
            {(['records', 'locations'] as DmTab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={t === tab ? 'rounded-md bg-primary px-3 py-1.5 font-medium capitalize text-primary-foreground' : 'rounded-md px-3 py-1.5 font-medium capitalize text-muted-foreground hover:text-foreground'}
              >
                {t === 'records' ? `Records (${(data ?? []).length})` : 'Locations'}
              </button>
            ))}
          </div>

          <HowToUse
            title="Track your shoot data"
            description="Know exactly where every shoot's photos, video and drone footage live."
            steps={[
              'Log each card or drive as it comes off a shoot.',
              'Set who is holding it and which disk the primary copy is on.',
              'Mark the backup done once it is copied somewhere else.',
            ]}
          />

          {tab === 'locations' ? (
            <LocationsTab />
          ) : !data || data.length === 0 ? (
            <EmptyState title="No data logged" description="Log memory cards as they come off a shoot." action={<AddRecordDialog />} />
          ) : (
            <RecordsView />
          )}
        </>
      )}
    </>
  )

  function RecordsView() {
    return (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Missing" value={String(counts.missing)} icon={HardDrive} />
            <StatCard label="Primary pending" value={String(counts.primaryPending)} icon={HardDrive} />
            <StatCard label="Backup pending" value={String(counts.backupPending)} icon={HardDrive} />
            <StatCard label="Ready" value={String(counts.ready)} icon={Check} />
            <StatCard label="At risk" value={String(counts.atRisk)} icon={AlertTriangle} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <FilterTabs
              tabs={[
                { value: 'all', label: 'All', count: (data ?? []).length },
                { value: 'missing', label: 'Missing', count: counts.missing },
                { value: 'primary_pending', label: 'Primary pending', count: counts.primaryPending },
                { value: 'backup_pending', label: 'Backup pending', count: counts.backupPending },
                { value: 'ready', label: 'Ready', count: counts.ready },
                { value: 'at_risk', label: 'At risk', count: counts.atRisk },
              ]}
              value={status}
              onChange={setStatus}
            />
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-44" aria-label="Filter by project">
              <option value="">All projects</option>
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Select value={dataType} onChange={(e) => setDataType(e.target.value)} className="w-40" aria-label="Filter by type">
              <option value="">All types</option>
              {DATA_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            <Select
              value={dataStatus}
              onChange={(e) => setDataStatus(e.target.value)}
              className="w-44"
              aria-label="Filter by data status"
            >
              <option value="">All data statuses</option>
              {Object.entries(DATA_STATUS_LABELS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
            <Select
              value={backupStatus}
              onChange={(e) => setBackupStatus(e.target.value)}
              className="w-44"
              aria-label="Filter by backup status"
            >
              <option value="">All backup statuses</option>
              {(['pending', 'copied', 'verified'] as const).map((v) => (
                <option key={v} value={v}>
                  {humanize(v)}
                </option>
              ))}
            </Select>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-40"
              aria-label="Received from"
            />
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-40"
              aria-label="Received up to"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search card or project…"
              className="w-56"
              aria-label="Search data records"
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyState title="No records match" description="Try a different filter." />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Card / drive</th>
                    <th className="px-4 py-2 font-medium">Project</th>
                    <th className="px-4 py-2 font-medium">Size</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Primary</th>
                    <th className="px-4 py-2 font-medium">Backup</th>
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="px-4 py-2">
                        <span className="flex items-center gap-2 font-medium">
                          <HardDrive className="size-4 text-muted-foreground" />
                          {r.data_label}
                        </span>
                        {r.data_type && <span className="ml-6 text-xs text-muted-foreground">{r.data_type}</span>}
                        {(r.user_name ?? r.team_member_name) && (
                          <span className="ml-6 block text-xs text-muted-foreground">
                            {r.user_name ?? r.team_member_name}
                            {r.requirement_name ? ` · ${r.requirement_name}` : ''}
                            {r.shoot_name ? ` · ${r.shoot_name}` : ''}
                            {r.shoot_date ? ` · ${r.shoot_date}` : ''}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{r.project_name ?? '—'}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {r.size_gb} GB · {r.card_count} card(s)
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge tone={STAGE_TONE[r.data_status]}>{dataStatusLabel(r.data_status)}</StatusBadge>
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge tone={TRACK_TONE[r.primary_status]}>{TRACK_LABEL[r.primary_status]}</StatusBadge>
                        {r.primary_location_name && (
                          <span className="ml-1.5 text-xs text-muted-foreground">{r.primary_location_name}</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge tone={TRACK_TONE[r.backup_status]}>{TRACK_LABEL[r.backup_status]}</StatusBadge>
                        {r.backup_location_name && (
                          <span className="ml-1.5 text-xs text-muted-foreground">{r.backup_location_name}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          {r.data_status === 'with_shooter' && (
                            <Button size="sm" variant="outline" disabled={updateRecord.isPending} onClick={() => markReceived(r)}>
                              Mark Received
                            </Button>
                          )}
                          {r.backup_status !== 'verified' && r.backup_status !== 'not_required' && (
                            <Button size="sm" variant="outline" onClick={() => verify.mutate({ id: r.id, track: 'backup' })}>
                              <Check /> Backup Done
                            </Button>
                          )}
                          <AddRecordDialog
                            record={r}
                            trigger={
                              <Button size="sm" variant="ghost" title="Edit">
                                <Pencil />
                              </Button>
                            }
                          />
                          {r.primary_status === 'pending' && r.backup_status === 'pending' && (
                            <Button size="sm" variant="ghost" title="Delete" onClick={() => void onDelete(r)}>
                              <Trash2 />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
    )
  }
}

const LOCATION_KINDS: { value: StorageLocationKind; label: string }[] = [
  { value: 'drive', label: 'Drive' },
  { value: 'nas', label: 'NAS' },
  { value: 'cloud', label: 'Cloud' },
  { value: 'other', label: 'Other' },
]

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
      description: 'Records pointing at it will show no location instead.',
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
            <th className="px-4 py-2 font-medium">Capacity</th>
            <th className="px-4 py-2 font-medium">Holder</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {locations.map((loc) => (
            <tr key={loc.id} className="border-t border-border">
              <td className="px-4 py-2 font-medium">{loc.name}</td>
              <td className="px-4 py-2 text-muted-foreground">{humanize(loc.kind)}</td>
              <td className="px-4 py-2 text-muted-foreground">{loc.capacity_gb != null ? `${loc.capacity_gb} GB` : '—'}</td>
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

function LocationEditor({ id, onDone }: { id: string; onDone: () => void }) {
  const { data: locations } = useStorageLocations()
  const update = useUpdateStorageLocation()
  const loc = locations?.find((l) => l.id === id)
  const [capacity, setCapacity] = useState(loc?.capacity_gb != null ? String(loc.capacity_gb) : '')
  const [owner, setOwner] = useState(loc?.owner ?? '')
  const [notes, setNotes] = useState(loc?.notes ?? '')

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
  const [kind, setKind] = useState<StorageLocationKind>('drive')
  const [capacity, setCapacity] = useState('')
  const [owner, setOwner] = useState('')

  async function onAdd(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    await create.mutateAsync({
      name: name.trim(),
      kind,
      ...(capacity.trim() ? { capacity_gb: Number(capacity) } : {}),
      ...(owner.trim() ? { owner: owner.trim() } : {}),
    })
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
              <Select value={kind} onChange={(e) => setKind(e.target.value as StorageLocationKind)} className="w-28">
                {LOCATION_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
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
                  <Select
                    value={loc.kind}
                    onChange={(e) => update.mutate({ id: loc.id, patch: { kind: e.target.value as StorageLocationKind } })}
                    className="w-28"
                  >
                    {LOCATION_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </Select>
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

function AddRecordDialog({ record, trigger }: { record?: DataRecord; trigger?: React.ReactNode } = {}) {
  const isEdit = !!record
  const create = useCreateDataRecord()
  const update = useUpdateDataRecord()
  const { data: projects } = useProjects()
  const { session } = useAuth()
  const [open, setOpen] = useState(false)
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
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus /> Log card
          </Button>
        )}
      </DialogTrigger>
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
            <Select value={dataType} onChange={(e) => setDataType(e.target.value)}>
              <option value="">Unspecified</option>
              {DATA_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
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
