import { Navigate, useParams } from '@tanstack/react-router'
import { useShoot } from '@/features/shoots/api'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { SkeletonList } from '@/shared/ui/skeleton'

/**
 * The old read-only shoot page sent people back to where the work is done.
 * A shoot is seen and changed on its project's Shoots tab, so an old link
 * (a bookmark, a notification) goes straight there. It asks for the one
 * shoot (GET /shoots/:id), never every shoot to find it.
 */
export function ShootDetailPage() {
  return (
    <AuthedPage module="projects" studioWork="/shoots/my">
      <ToProject />
    </AuthedPage>
  )
}

function ToProject() {
  const { shootId } = useParams({ from: '/authed/shoots/$shootId' })
  const shoot = useShoot(shootId)
  if (shoot.isLoading) return <SkeletonList rows={4} columns={2} />
  if (!shoot.data) return <Navigate to="/team-allocation" replace />
  return <Navigate to="/projects/$id" params={{ id: shoot.data.project_id }} search={{ tab: 'shoots' } as never} replace />
}
