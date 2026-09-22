import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CalendarDays, Camera, MapPin } from 'lucide-react'
import { shootListItem } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { SkeletonList } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { humanize } from '@/shared/ui/format'
import { useSlots } from '@/features/allocation/api'

const list = shootListItem.array()

/**
 * Shoot detail stub (Lovable parity with _app.shoots.$shootId): header,
 * requirements, and the crew booked against it. Full editing stays on the
 * shoots list and the project page.
 */
export function ShootDetailPage() {
  return (
    <AuthedPage module="projects">
      <ShootDetail />
    </AuthedPage>
  )
}

function ShootDetail() {
  const { shootId } = useParams({ from: '/authed/shoots/$shootId' })
  const { session } = useAuth()
  const access = useAccess()
  const navigate = useNavigate()

  const shoots = useQuery({
    queryKey: ['shoots'],
    queryFn: () => callApi('/shoots', { responseSchema: list }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 30_000,
  })
  const slots = useSlots()

  const shoot = (shoots.data ?? []).find((s) => s.id === shootId)
  const crew = (slots.data ?? []).filter((s) => s.shoot_id === shootId && s.status === 'booked')

  if (shoots.isLoading) return <SkeletonList rows={4} columns={2} />
  if (shoots.isError) return <ErrorState onRetry={() => void shoots.refetch()} />
  if (!shoot) {
    return (
      <Card className="mt-6">
        <CardContent className="py-4">
          <EmptyState
            title="Shoot not found"
            description="It may have been deleted, or this link is for another studio."
            action={
              <Button variant="outline" onClick={() => navigate({ to: '/shoots' })}>
                Back to shoots
              </Button>
            }
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/shoots' })}>
          <ArrowLeft className="mr-1 size-4" /> Shoots
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/shoots/my">My shoots</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-semibold">
                <Camera className="size-5 text-muted-foreground" /> {shoot.name}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {shoot.project_name ?? 'No project'}
                {shoot.client_name ? ` · ${shoot.client_name}` : ''}
              </p>
            </div>
            <StatusBadge tone={shoot.status === 'completed' ? 'success' : shoot.status === 'cancelled' ? 'danger' : 'info'}>
              {humanize(shoot.status)}
            </StatusBadge>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <CalendarDays className="size-4" /> {shoot.shoot_date ?? 'Unscheduled'}
            </span>
            {shoot.location && (
              <span className="flex items-center gap-1">
                <MapPin className="size-4" /> {shoot.location}
              </span>
            )}
          </div>
          {shoot.requirements.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {shoot.requirements.map((r) => (
                <span key={r.service_id} className="rounded-full border border-border px-2.5 py-1 text-xs">
                  {r.name} × {r.quantity}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h3 className="mb-3 font-medium">Booked crew ({crew.length})</h3>
          {crew.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nobody booked yet. Assign crew from Team Booking.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {crew.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-sm">
                  <span className="font-medium">{s.user_name ?? 'Member'}</span>
                  {s.service_name && <span className="text-muted-foreground">· {s.service_name}</span>}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(s.start_at).toLocaleString()} – {new Date(s.end_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <Button variant="outline" size="sm" asChild>
              <Link to="/team-allocation">Open Team Booking</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
