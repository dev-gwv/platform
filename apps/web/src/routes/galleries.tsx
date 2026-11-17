import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AppWindow, Copy, ExternalLink, Images, KeyRound, Loader2, Lock, MessageCircle, Plus, QrCode, Share2 } from 'lucide-react'
import { projectGallery, type GalleryListItem } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { useAuth } from '@/shared/auth/AuthProvider'
import { callApi } from '@/shared/api/client'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { cn } from '@/shared/ui/cn'
import { daysUntil } from '@/shared/ui/days-left'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { downloadQrPng } from '@/shared/ui/qr-download'
import { SupportButtons } from '@/features/help/HelpPanel'
import { GalleryGuide } from '@/features/gallery/GalleryGuide'
import { GoogleDriveIcon } from '@/features/gallery/GoogleDriveIcon'
import { useFramelineAccount, useGalleries, useOpenFramelineHome, useOpenGallery } from '@/features/gallery/api'
import { ProjectPicker } from '@/features/projects/ProjectPicker'
import { DriveCard } from '@/routes/settings/gallery'
import { useCountPhotoSharingVisit, useMarkPhotoSharingUsed } from '@/shared/ui/new-badge'

export function GalleriesPage() {
  return (
    <AuthedPage module="projects" studioWork="/dashboard">
      <PhotoSharingApp />
    </AuthedPage>
  )
}

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const n = (v: number) => v.toLocaleString('en-IN')

/**
 * The Photo sharing app (owner, 11 Nov: "that gallery option should come up
 * as a photo sharing app on the left sidebar ... the entire gallery can come
 * up over there, and it should be connected with Google Drive"). Every
 * project's Frameline gallery with its link, PIN, QR and WhatsApp share;
 * Create a gallery for any project; Google Drive's state; and the studio app.
 * Import from Google Drive stays Pro and above (0292), the rest on every plan.
 */
function PhotoSharingApp() {
  const q = useGalleries()
  // Each open counts towards this person's "New" going (five, or once they use a gallery).
  useCountPhotoSharingVisit()
  const [creating, setCreating] = useState(false)
  const items = q.data?.items ?? []
  const photos = items.reduce((s, g) => s + g.photo_count, 0)
  const visits = items.reduce((s, g) => s + g.visits, 0)

  return (
    <div className="flex flex-col gap-5">
      <header className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-900 to-teal-700 p-6 text-white shadow-md sm:p-8">
        <div className="pointer-events-none absolute -right-14 -top-16 size-64 rounded-full bg-teal-300/20 blur-3xl" aria-hidden />
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-white/70">
          <Images className="size-3.5" aria-hidden /> Photo sharing app
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Share every wedding's photos</h1>
        <p className="mt-1 max-w-xl text-sm text-white/80">
          One link, a PIN and a QR for guests. Bring the photos straight from Google Drive.
        </p>
        {items.length > 0 && (
          <p className="mt-3 text-sm font-medium text-white/90">
            {n(items.length)} {items.length === 1 ? 'gallery' : 'galleries'} · {n(photos)} photos · {n(visits)} visits
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={() => setCreating(true)} className="bg-white text-slate-900 hover:bg-white/90">
            <Plus /> Create a gallery
          </Button>
          <span className="[&_button]:border-white/40 [&_button]:bg-white/10 [&_button]:text-white">
            <GalleryGuide />
          </span>
        </div>
      </header>

      {q.isPending ? (
        <SkeletonList rows={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data.connected && items.length === 0 ? (
        <Card className="max-w-3xl">
          <CardContent className="flex flex-col gap-3 p-4">
            <p className="text-sm text-muted-foreground">The photo sharing add-on is not switched on for your studio yet.</p>
            <SupportButtons compact />
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card className="border-dashed border-teal-500/50 bg-teal-500/5">
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <p className="text-base font-semibold">Make your first gallery</p>
            <p className="max-w-lg text-sm text-muted-foreground">
              Pick a project, upload the photos or bring them from Google Drive, then send guests the link and PIN on WhatsApp.
            </p>
            <Button onClick={() => setCreating(true)} className="ipc-nudge">
              <Plus /> Create a gallery
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {!q.data.fresh && q.data.connected && (
            <p className="text-xs text-muted-foreground">Frameline did not answer just now, so these are the last known figures.</p>
          )}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((g) => (
              <GalleryCard key={g.project_id} g={g} />
            ))}
          </div>
        </div>
      )}

      <section aria-label="Google Drive" className="flex flex-col gap-2">
        <DriveTab driveImport={q.data?.drive_import ?? true} />
      </section>

      {creating && <CreateGalleryDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

function shareText(g: GalleryListItem) {
  return [`Photos from ${g.project_name} are ready!`, g.gallery_url, g.pin ? `PIN: ${g.pin}` : ''].filter(Boolean).join('\n')
}

function GalleryCard({ g }: { g: GalleryListItem }) {
  const open = useOpenGallery(g.project_id)
  const days = g.expires_at ? daysUntil(g.expires_at.slice(0, 10)) : null
  const empty = g.photo_count === 0
  const used = useMarkPhotoSharingUsed()
  async function copy() {
    used()
    try {
      await navigator.clipboard.writeText(shareText(g))
      toast.success('Link and PIN copied.')
    } catch {
      toast.error('Could not copy. Open the gallery and copy its link there.')
    }
  }
  return (
    <Card className={cn('flex flex-col', empty ? 'border-warning/50' : 'border-success/30')}>
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', empty ? 'bg-warning/10 text-warning' : 'bg-teal-500/10 text-teal-700 dark:text-teal-300')}>
            <Images className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <Link to="/projects/$id" params={{ id: g.project_id }} search={{ tab: 'gallery' } as never} className="block truncate font-semibold hover:underline">
              {g.project_name}
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              {g.client_name ?? 'No client'} · {empty ? 'No photos yet' : `${n(g.photo_count)} photos`}
              {g.visits > 0 && ` · ${n(g.visits)} visits`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {g.pin && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <KeyRound className="size-3.5" aria-hidden /> PIN <span className="font-mono tracking-widest text-foreground">{g.pin}</span>
            </span>
          )}
          {days !== null && (
            <span className={cn(days < 0 ? 'text-destructive' : days <= 30 ? 'text-warning' : 'text-muted-foreground')}>
              {days < 0 ? 'Closed' : days <= 30 ? `Closes in ${days} ${days === 1 ? 'day' : 'days'}` : `Open till ${dateFmt.format(new Date(g.expires_at!))}`}
            </span>
          )}
        </div>
        <div className="mt-auto flex flex-wrap gap-1.5 border-t border-border pt-3">
          <Button size="sm" onClick={() => open.mutate('gallery')} disabled={open.isPending}>
            {open.isPending ? <Loader2 className="animate-spin" /> : <ExternalLink />} Open gallery
          </Button>
          <Button size="sm" className="bg-[#25D366] text-white hover:bg-[#1ebe5b]" asChild>
            <a href={`https://wa.me/?text=${encodeURIComponent(shareText(g))}`} target="_blank" rel="noopener noreferrer" onClick={() => void used()}>
              <MessageCircle /> WhatsApp
            </a>
          </Button>
          <Button size="sm" variant="outline" onClick={() => void copy()} aria-label={`Copy link and PIN for ${g.project_name}`}>
            <Copy />
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label={`Download QR for ${g.project_name}`}
            onClick={() => {
              used()
              void downloadQrPng(g.gallery_url, `${g.project_name} gallery QR`, g.project_name, g.pin ? `PIN ${g.pin}` : 'Scan to see the photos')
            }}
          >
            <QrCode />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/** Create a gallery for any project, from here (owner, 11 Nov). */
function CreateGalleryDialog({ onClose }: { onClose: () => void }) {
  const [projectId, setProjectId] = useState('')
  const [name, setName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const used = useMarkPhotoSharingUsed()
  async function create() {
    if (!projectId) return
    setBusy(true)
    try {
      await callApi(`/projects/${projectId}/gallery`, { method: 'POST', body: {}, responseSchema: projectGallery })
      void qc.invalidateQueries({ queryKey: ['galleries'] })
      void qc.invalidateQueries({ queryKey: ['galleries-exists'] })
      used()
      toast.success(`Gallery ready for ${name ?? 'the project'}. Upload the photos or bring them from Google Drive.`)
      onClose()
      void navigate({ to: '/projects/$id', params: { id: projectId }, search: { tab: 'gallery' } as never })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'We could not make the gallery.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md" title="Create a gallery" description="Which wedding is it for?">
        <div className="flex flex-col gap-4">
          <ProjectPicker
            value={projectId}
            label={name}
            onChange={(id, label) => {
              setProjectId(id)
              setName(label)
            }}
            placeholder="Pick the project"
            aria-label="Project for the gallery"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void create()} disabled={!projectId || busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Share2 />} Create gallery
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Google Drive: the owner connects it; everyone sees whether it is, and Starter sees the import lock. */
function DriveTab({ driveImport }: { driveImport: boolean }) {
  const { session } = useAuth()
  const owner = !!session?.is_owner
  const account = useFramelineAccount()
  const open = useOpenFramelineHome()
  const navigate = useNavigate()
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      {!driveImport && (
        <Card className="border-amber-400/60 bg-amber-50/60 dark:bg-amber-950/20">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <Lock className="size-5 text-amber-600" aria-hidden />
            <p className="min-w-0 flex-1 text-sm">
              <b>Import from Google Drive</b> is on Pro and Diamond Pro and above. Your galleries, link, PIN and QR work on every plan.
            </p>
            <Button onClick={() => void navigate({ to: '/settings/subscription' })}>Upgrade</Button>
          </CardContent>
        </Card>
      )}
      {owner ? (
        account.isPending ? (
          <SkeletonList rows={1} />
        ) : account.data?.drive ? (
          <DriveCard drive={account.data.drive} onOpen={() => open.mutate('drive')} opening={open.isPending} />
        ) : (
          <Card>
            <CardContent className="flex flex-col gap-3 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <GoogleDriveIcon /> Google Drive
              </p>
              <p className="text-sm text-muted-foreground">Open the studio app once to set up your gallery account, then connect Google Drive here.</p>
              <div>
                <Button asChild variant="outline">
                  <Link to="/galleries/app">
                    <AppWindow /> Open the studio app
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      ) : (
        <Card>
          <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <GoogleDriveIcon /> Your studio owner connects Google Drive. Once it is connected, Import from Google Drive opens on each gallery.
          </CardContent>
        </Card>
      )}
    </div>
  )
}
