import { useMemo } from 'react'
import { Copy, Download, ExternalLink, Images, KeyRound, Link2, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { cn } from '@/shared/ui/cn'
import { downloadQrPng, qrSvg } from '@/shared/ui/qr-download'
import { BookCallButton } from '@/features/help/BookCall'
import { SupportButtons } from '@/features/help/HelpPanel'
import { daysUntil } from '@/shared/ui/days-left'
import { ApiError } from '@/shared/api/client'
import type { ProjectGallery } from '@ipc/contracts'
import { useCreateGallery, useOpenGallery, useProjectGallery } from './api'
import { clientWhatsapp, galleryDate, galleryFigures } from './gallery-text'

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

  const { connected, gallery, live, client, trouble, plan_ended_on: planEnded } = q.data

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
    // 502: Frameline refused us in a way only we can fix (the add-on is not linked properly).
    const mislinked = create.error instanceof ApiError && create.error.status === 502
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
          {mislinked && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-muted-foreground">The gallery add-on isn’t linked properly.</p>
              <BookCallButton size="sm" />
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <GalleryReady
      projectName={projectName}
      gallery={gallery}
      live={live}
      trouble={trouble}
      planEnded={planEnded}
      client={client}
      onOpen={() => open.mutate()}
      opening={open.isPending}
    />
  )
}

function GalleryReady({
  projectName,
  gallery,
  live,
  trouble,
  planEnded,
  client,
  onOpen,
  opening,
}: {
  projectName: string
  gallery: NonNullable<ProjectGallery['gallery']>
  live: ProjectGallery['live']
  trouble: ProjectGallery['trouble']
  planEnded: string | null
  client: ProjectGallery['client']
  onOpen: () => void
  opening: boolean
}) {
  const svg = useMemo(() => qrSvg(gallery.gallery_url), [gallery.gallery_url])
  // What Frameline says now, else what it said last time.
  const photos = live?.photo_count ?? gallery.photo_count
  const figures = galleryFigures(gallery)
  // Green once there are photos to see; amber while the next thing is uploading them.
  const done = photos > 0

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${what} copied`)
    } catch {
      toast.error('Could not copy. Select it and copy by hand.')
    }
  }

  const message = `Your photos from ${projectName} are here: ${gallery.gallery_url}${gallery.pin ? `\nPIN: ${gallery.pin}` : ''}`
  const clientWa = client ? clientWhatsapp(client, projectName, gallery) : null

  return (
    <div className="mt-4 flex flex-col gap-4">
      <Card className={cn(done ? 'border-success/40 bg-success/[0.04]' : 'border-warning/50')}>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="flex items-center gap-2 text-sm">
            <Images className={cn('size-4', done ? 'text-success' : 'text-warning')} aria-hidden />
            {done ? (
              <span>
                <b>{photos}</b> {photos === 1 ? 'photo' : 'photos'} in the gallery
                {figures && <span className="text-muted-foreground"> · {figures}</span>}
              </span>
            ) : (
              <span>No photos yet. Open the gallery to upload them.</span>
            )}
          </p>
          <Button onClick={onOpen} disabled={opening} className={done ? undefined : 'ipc-nudge'}>
            <ExternalLink /> {opening ? 'Opening…' : done ? 'Open gallery' : 'Open gallery to upload'}
          </Button>
          {trouble === 'unreachable' && (
            <p className="w-full text-xs text-muted-foreground">The gallery app did not answer just now; the link below still works.</p>
          )}
          {trouble === 'misconfigured' && (
            <div className="flex w-full flex-wrap items-center gap-2">
              <p className="text-sm text-muted-foreground">The gallery add-on isn’t linked properly.</p>
              <BookCallButton size="sm" />
            </div>
          )}
          {planEnded && (
            <p className="w-full text-sm text-warning">Your Frameline plan ended on {galleryDate(planEnded)}. Renew it in Frameline.</p>
          )}
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
            {gallery.full_access_pin && (
              <Field icon={KeyRound} label="Couple's PIN · shows every photo">
                <span className="font-mono text-base font-semibold tracking-widest">{gallery.full_access_pin}</span>
                <Button variant="outline" size="sm" onClick={() => void copy(gallery.full_access_pin!, 'PIN')}>
                  <Copy /> Copy
                </Button>
              </Field>
            )}
            <ExpiryLine expiresAt={gallery.expires_at} onRenew={onOpen} />
            {done ? (
              <div className="flex flex-wrap gap-2">
                {clientWa && (
                  <Button size="sm" asChild>
                    <a href={clientWa.href} target="_blank" rel="noreferrer noopener">
                      <MessageCircle /> Send to {clientWa.firstName}
                    </a>
                  </Button>
                )}
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
            ) : (
              <p className="text-xs text-muted-foreground">Share once the photos are up.</p>
            )}
          </div>
          {done && (
            <span
              role="img"
              aria-label="QR code for the guests' link"
              className="size-32 shrink-0 self-center rounded-md border border-border bg-white p-1"
              // The generator's own SVG of our link: not user input.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/** "Open till 12 Oct 2027"; amber with Renew in the last 30 days, red once it has closed. */
function ExpiryLine({ expiresAt, onRenew }: { expiresAt: string | null; onRenew: () => void }) {
  if (!expiresAt) return null
  const days = daysUntil(expiresAt.slice(0, 10))
  const date = galleryDate(expiresAt)
  if (days > 30) return <p className="text-xs text-muted-foreground">Open till {date}</p>
  return (
    <p className={cn('flex flex-wrap items-center gap-2 text-sm', days < 0 ? 'text-destructive' : 'text-warning')}>
      {days < 0 ? `Closed on ${date}: guests can't open it.` : `Closes on ${date} (${days === 0 ? 'today' : `${days} ${days === 1 ? 'day' : 'days'}`}).`}
      <Button variant="outline" size="sm" onClick={onRenew}>
        Renew in Frameline
      </Button>
    </p>
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
