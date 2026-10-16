import { Link } from '@tanstack/react-router'
import { Images, KeyRound } from 'lucide-react'
import type { GalleryListItem } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { daysUntil } from '@/shared/ui/days-left'
import { SkeletonList } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { SupportButtons } from '@/features/help/HelpPanel'
import { useGalleries } from '@/features/gallery/api'

export function GalleriesPage() {
  return (
    <AuthedPage module="projects" studioWork="/dashboard">
      <PageHeader title="Galleries" />
      <Galleries />
    </AuthedPage>
  )
}

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * Every project with a Frameline gallery (0261, 0264): photos, visits, the
 * PINs and when it closes, so the studio sees them all without opening each
 * project. A row opens the project's Gallery tab.
 */
function Galleries() {
  const q = useGalleries()
  if (q.isPending) return <SkeletonList rows={4} />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const { connected, fresh, items } = q.data

  if (!connected && items.length === 0) {
    return (
      <Card className="max-w-3xl">
        <CardContent className="flex flex-col gap-3 p-4">
          <p className="text-sm text-muted-foreground">The gallery add-on is not switched on for your studio yet.</p>
          <SupportButtons compact />
        </CardContent>
      </Card>
    )
  }
  if (items.length === 0) {
    return <EmptyState title="No galleries yet" description="Open a project, go to Post-Production → Gallery and press Create gallery." />
  }

  const closing = items.filter((g) => g.expires_at && daysUntil(g.expires_at.slice(0, 10)) <= 30).length
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {items.length} {items.length === 1 ? 'gallery' : 'galleries'} · {items.reduce((n, g) => n + g.photo_count, 0).toLocaleString('en-IN')} photos
        {closing > 0 && <span className="text-warning"> · {closing} closing within 30 days</span>}
        {!fresh && connected && ' · Frameline did not answer just now, so these are the last known figures'}
      </p>
      <div className="grid gap-2">
        {items.map((g) => (
          <GalleryRow key={g.project_id} g={g} />
        ))}
      </div>
    </div>
  )
}

function GalleryRow({ g }: { g: GalleryListItem }) {
  const days = g.expires_at ? daysUntil(g.expires_at.slice(0, 10)) : null
  const empty = g.photo_count === 0
  return (
    <Link to="/projects/$id" params={{ id: g.project_id }} search={{ tab: 'gallery' } as never} className="block">
      <Card className={cn('transition-colors hover:bg-muted/40', empty ? 'border-warning/50' : 'border-success/30')}>
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3">
          <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', empty ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success')}>
            <Images className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{g.project_name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {g.client_name ?? 'No client'} · {empty ? 'No photos yet' : `${g.photo_count.toLocaleString('en-IN')} photos`}
              {g.visits > 0 && ` · ${g.visits.toLocaleString('en-IN')} visits`}
            </p>
          </div>
          {g.pin && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <KeyRound className="size-3.5" aria-hidden /> <span className="font-mono tracking-widest text-foreground">{g.pin}</span>
              {g.full_access_pin && <span className="font-mono tracking-widest"> · {g.full_access_pin}</span>}
            </span>
          )}
          {days !== null && (
            <span className={cn('text-xs', days < 0 ? 'text-destructive' : days <= 30 ? 'text-warning' : 'text-muted-foreground')}>
              {days < 0 ? 'Closed' : days <= 30 ? `Closes in ${days} ${days === 1 ? 'day' : 'days'}` : `Open till ${dateFmt.format(new Date(g.expires_at!))}`}
            </span>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}
