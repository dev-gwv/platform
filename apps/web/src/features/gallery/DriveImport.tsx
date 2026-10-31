import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Folder, ImageIcon, Square } from 'lucide-react'
import { toast } from 'sonner'
import type { DriveExpand, ProjectGallery } from '@ipc/contracts'
import { useAuth } from '@/shared/auth/AuthProvider'
import { MOCK_ENABLED } from '@/shared/dev/mock-flag'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input } from '@/shared/ui/input'
import { Segmented } from '@/shared/ui/segmented'
import { cn } from '@/shared/ui/cn'
import { expandDrive, readDrivePicker, useDriveImports, useOpenFramelineHome, useStartDriveImport, useStopDriveImport } from './api'
import { albumGroups, finishedLine, importLine, importRequest, importShare, leftOut, LOOSE, photosLabel } from './drive-import'
import { pickFromDrive } from './drive-picker'
import { GoogleDriveIcon } from './GoogleDriveIcon'

type Quality = 'web' | 'original'

/**
 * Import from Google Drive, here on the Gallery tab (owner, 31 Oct: "users can
 * import images directly from gdrive into the app"). Google's picker opens on
 * this page; the studio checks what will come in (each folder an album, named
 * as they like) and presses Import; Frameline copies the photos into the
 * gallery in the background. Connecting Drive stays Frameline's: the owner's
 * press opens Frameline's Google Drive settings, anyone else is told to ask them.
 */
export function DriveImportButton({ projectId, projectName, drive }: { projectId: string; projectName: string; drive: ProjectGallery['drive'] }) {
  const { session } = useAuth()
  const owner = !!session?.is_owner
  const connect = useOpenFramelineHome()
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<DriveExpand | null>(null)

  if (!drive?.import_available) return null
  const ready = drive.connected && !drive.needs_reconnect

  const choose = async () => {
    setPicked(null)
    setBusy(true)
    try {
      // Asked for at the press: the token lasts an hour at most.
      const cfg = await readDrivePicker(projectId)
      // The UI preview has no Google: it picks a sample folder.
      const ids = MOCK_ENABLED ? ['sampleFolder01'] : await pickFromDrive(cfg)
      if (ids.length) setPicked(await expandDrive(projectId, ids))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Google Drive didn’t open. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const press = () => {
    if (ready) return void choose()
    if (!owner) return void toast.info('Ask the studio owner to connect Google Drive, in Settings → Gallery.')
    connect.mutate('drive', { onSuccess: () => toast.info('Connect Google Drive in the tab that opened, then come back and press Import from Google Drive.') })
  }

  return (
    <>
      <Button variant="outline" onClick={press} disabled={busy || connect.isPending}>
        <GoogleDriveIcon />
        {busy ? 'Opening Google Drive…' : ready || !owner ? 'Import from Google Drive' : drive.needs_reconnect ? 'Reconnect Google Drive' : 'Connect Google Drive'}
      </Button>
      {picked && (
        <ReviewDialog projectId={projectId} projectName={projectName} picked={picked} onPickAgain={() => void choose()} onClose={() => setPicked(null)} />
      )}
    </>
  )
}

/** What will come in: one album per folder (renamed in place), what is left out, the quality, Import. */
function ReviewDialog({
  projectId,
  projectName,
  picked,
  onPickAgain,
  onClose,
}: {
  projectId: string
  projectName: string
  picked: DriveExpand
  onPickAgain: () => void
  onClose: () => void
}) {
  const start = useStartDriveImport(projectId)
  const [names, setNames] = useState<Record<string, string>>({})
  const [quality, setQuality] = useState<Quality>('web')
  const groups = useMemo(() => albumGroups(picked.items, names), [picked, names])
  const count = groups.reduce((n, g) => n + g.count, 0)
  const out = leftOut(picked.items)

  const begin = () =>
    start.mutate(importRequest(picked.items, groups, quality), {
      onSuccess: () => {
        toast.success(`Importing ${photosLabel(count)}. It keeps going if you leave this page.`)
        onClose()
      },
    })

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg" title="Import from Google Drive" description={`Into ${projectName}’s gallery. Each folder becomes an album.`}>
        {groups.length === 0 ? (
          <p className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm">Nothing in what you picked is a photo the gallery can take.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {groups.map((g) => (
              <li key={g.key} className="flex flex-col gap-1">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {g.key === LOOSE ? <ImageIcon className="size-3.5" aria-hidden /> : <Folder className="size-3.5" aria-hidden />}
                  <span className="truncate">{g.label}</span>
                  <span className="ml-auto tabular-nums">{photosLabel(g.count)}</span>
                </span>
                <Input
                  aria-label={`Album for ${g.label}`}
                  value={names[g.key] ?? g.album}
                  maxLength={120}
                  onChange={(e) => setNames((n) => ({ ...n, [g.key]: e.target.value }))}
                />
              </li>
            ))}
          </ul>
        )}
        {picked.closed_folders.length > 0 && (
          <p className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm">
            Google didn’t let us look inside {picked.closed_folders.map((f) => `“${f.name}”`).join(', ')}. Press Pick again, open the folder and select the
            photos in it (Ctrl+A selects them all).
          </p>
        )}
        {out && <p className="text-xs text-muted-foreground">Left out: {out}.</p>}
        <div className="flex flex-col gap-1.5">
          <Segmented<Quality>
            label="Quality"
            value={quality}
            onChange={setQuality}
            options={[
              { value: 'web', label: 'Standard' },
              { value: 'original', label: 'Original files' },
            ]}
            className="self-start"
          />
          <p className="text-xs text-muted-foreground">
            {quality === 'web' ? 'Sharp on any screen. Counts as 1 photo each in your gallery plan.' : 'Full quality to download. Counts as 2 photos each.'} Photos
            already in the gallery are skipped.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onPickAgain}>
            Pick again
          </Button>
          <Button onClick={begin} disabled={count === 0 || start.isPending} className={count > 0 ? 'ipc-nudge' : undefined}>
            <GoogleDriveIcon /> {start.isPending ? 'Starting…' : `Import ${photosLabel(count)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Imports running for this gallery, one line each with a bar and Stop; read
 * every few seconds while any runs. When one finishes it says so once and the
 * gallery's photo count is read again.
 */
export function DriveImportProgress({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  const qc = useQueryClient()
  const q = useDriveImports(projectId, enabled)
  const stop = useStopDriveImport(projectId)
  const items = useMemo(() => q.data?.items ?? [], [q.data])
  const running = items.filter((i) => i.status === 'running')
  // Ids seen running on this page, so a finish is told once, and never for an import that ended before.
  const seen = useRef(new Set<string>())

  useEffect(() => {
    let finished = false
    for (const i of items) {
      if (i.status === 'running') seen.current.add(i.id)
      else if (seen.current.delete(i.id)) {
        finished = true
        if (i.status === 'done') toast.success(finishedLine(i))
        else toast.info(finishedLine(i))
      }
    }
    if (finished) void qc.invalidateQueries({ queryKey: ['projects', projectId, 'gallery'], exact: true })
  }, [items, projectId, qc])

  if (!running.length) return null
  return (
    <div className="flex w-full flex-col gap-2">
      {running.map((i) => (
        <div key={i.id} className="flex flex-col gap-1.5 rounded-md border border-border bg-card px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-1.5">
              <GoogleDriveIcon className="size-3.5" />
              <span className="truncate">
                Importing <b>{i.name}</b>
              </span>
              <span className="text-muted-foreground tabular-nums">· {importLine(i)}</span>
            </span>
            <Button variant="outline" size="sm" onClick={() => stop.mutate(i.id)} disabled={stop.isPending && stop.variables === i.id}>
              <Square /> Stop
            </Button>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(importShare(i) * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className={cn('h-full rounded-full bg-primary transition-[width] duration-500')} style={{ width: `${Math.max(3, importShare(i) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}
