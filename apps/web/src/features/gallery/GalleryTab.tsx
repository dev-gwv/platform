import { useMemo } from 'react'
import { Copy, Download, ExternalLink, Images, KeyRound, Link2, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { cn } from '@/shared/ui/cn'
import { downloadQrPng, qrSvg } from '@/shared/ui/qr-download'
import { SupportButtons } from '@/features/help/HelpPanel'
import { useCreateGallery, useOpenGallery, useProjectGallery } from './api'

/**
 * The project's photo gallery, in Frameline (0261). Frameline is its own app
 * and add-on: the photos are uploaded there, and guests open them with the
 * PIN. Here the studio makes the gallery once, hands the guests' link and
 * PIN on, and presses Open gallery to upload -- signed in as themselves.
 */
export function GalleryTab({ projectId, projectName }: { projectId: string; projectName: string }) {
  const q = useProjectGallery(projectId)
  const create = useCreateGallery(projectId)
  const open = useOpenGallery(projectId)

  if (q.isPending) return <SkeletonList rows={2} className="mt-4" />
  if (q.isError) {
    return (
      <div className="mt-4">
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </div>
    )
  }

  const { connected, gallery, live } = q.data

  if (!connected) {
    return (
      <Card className="mt-4">
        <CardContent className="flex flex-col gap-3 p-5">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Images className="size-4 text-tone-violet" aria-hidden /> Photo gallery
          </p>
          <p className="text-sm text-muted-foreground">The gallery add-on is not switched on for your studio yet.</p>
          <SupportButtons compact />
        </CardContent>
      </Card>
    )
  }

  if (!gallery) {
    return (
      <Card className="mt-4 border-warning/50">
        <CardContent className="flex flex-col items-start gap-3 p-5">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Images className="size-4 text-tone-violet" aria-hidden /> Photo gallery
          </p>
          <p className="text-sm text-muted-foreground">
            One link for {projectName}: guests open it, type the PIN, and see and download the photos.
          </p>
          <Button className="ipc-nudge" onClick={() => create.mutate()} disabled={create.isPending}>
            <Images /> {create.isPending ? 'Making the gallery…' : 'Create gallery'}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return <GalleryReady projectName={projectName} gallery={gallery} live={live} onOpen={() => open.mutate()} opening={open.isPending} />
}

function GalleryReady({
  projectName,
  gallery,
  live,
  onOpen,
  opening,
}: {
  projectName: string
  gallery: { gallery_url: string; short_id: string; pin: string | null }
  live: { photo_count: number; status: string } | null
  onOpen: () => void
  opening: boolean
}) {
  const svg = useMemo(() => qrSvg(gallery.gallery_url), [gallery.gallery_url])
  const photos = live?.photo_count ?? null
  // Green once there are photos to see; amber while the next thing is uploading them.
  const done = photos !== null && photos > 0

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${what} copied`)
    } catch {
      toast.error('Could not copy. Select it and copy by hand.')
    }
  }

  const message = `Your photos from ${projectName} are here: ${gallery.gallery_url}${gallery.pin ? `\nPIN: ${gallery.pin}` : ''}`

  return (
    <div className="mt-4 flex flex-col gap-4">
      <Card className={cn(done ? 'border-success/40 bg-success/[0.04]' : 'border-warning/50')}>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="flex items-center gap-2 text-sm">
            <Images className={cn('size-4', done ? 'text-success' : 'text-warning')} aria-hidden />
            {photos === null ? (
              <span className="text-muted-foreground">The gallery app did not answer just now; the link below still works.</span>
            ) : done ? (
              <span>
                <b>{photos}</b> {photos === 1 ? 'photo' : 'photos'} in the gallery
              </span>
            ) : (
              <span>No photos yet. Open the gallery to upload them.</span>
            )}
          </p>
          <Button onClick={onOpen} disabled={opening} className={done ? undefined : 'ipc-nudge'}>
            <ExternalLink /> {opening ? 'Opening…' : 'Open gallery'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Field icon={Link2} label="Guests' link">
              <span className="truncate font-mono text-sm">{gallery.gallery_url}</span>
              <Button variant="outline" size="sm" onClick={() => void copy(gallery.gallery_url, 'Link')}>
                <Copy /> Copy
              </Button>
            </Field>
            {gallery.pin && (
              <Field icon={KeyRound} label="PIN">
                <span className="font-mono text-base font-semibold tracking-widest">{gallery.pin}</span>
                <Button variant="outline" size="sm" onClick={() => void copy(gallery.pin!, 'PIN')}>
                  <Copy /> Copy
                </Button>
              </Field>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer noopener">
                  <MessageCircle /> Send on WhatsApp
                </a>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void downloadQrPng(gallery.gallery_url, `${projectName} gallery`, projectName, gallery.pin ? `Scan for your photos · PIN ${gallery.pin}` : 'Scan for your photos').catch(() =>
                    toast.error('Could not make the QR image.'),
                  )
                }
              >
                <Download /> Download QR
              </Button>
            </div>
          </div>
          <span
            role="img"
            aria-label="QR code for the guests' link"
            className="size-32 shrink-0 self-center rounded-md border border-border bg-white p-1"
            // The generator's own SVG of our link: not user input.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function Field({ icon: Icon, label, children }: { icon: typeof Link2; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden /> {label}
      </span>
      <div className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-1.5">{children}</div>
    </div>
  )
}
