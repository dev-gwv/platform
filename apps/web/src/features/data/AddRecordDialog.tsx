import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { shootListItem, type CreateDataRecordRequest, type DataRecord } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { useCreateDataRecord, useUpdateDataRecord, useStorageLocations } from '@/features/data/api'
import { DATA_TYPES } from '@/features/data/stage'
import { LookupSelect } from '@/features/settings/LookupSelect'
import { ProjectPicker } from '@/features/projects/ProjectPicker'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useFormDraft } from '@/shared/hooks/use-form-draft'

const shootsList = shootListItem.array()

/**
 * A card logged without a booking ("Log other data"), and the same dialog to
 * edit one: the Data & Backup page and a project's Data tab both open it, so a
 * loose record can be changed wherever it is seen.
 */
export function AddRecordDialog({
  record,
  trigger,
  open: openProp,
  onOpenChange,
}: { record?: DataRecord; trigger?: React.ReactNode; open?: boolean; onOpenChange?: (v: boolean) => void } = {}) {
  const isEdit = !!record
  const create = useCreateDataRecord()
  const update = useUpdateDataRecord()
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
              <ProjectPicker
                value={projectId}
                onChange={(id) => {
                  setProjectId(id)
                  setShootId('')
                }}
                label={projectId === record?.project_id ? record?.project_name : undefined}
                noneLabel="Not linked"
                aria-label="Project"
              />
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
