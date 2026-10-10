import { Navigate, useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { shootListItem } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { SkeletonList } from '@/shared/ui/skeleton'

const list = shootListItem.array()

/**
 * The old read-only shoot page sent people back to where the work is done.
 * A shoot is seen and changed on its project's Shoots tab, so an old link
 * (a bookmark, a notification) goes straight there.
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
  const shoots = useQuery({
    queryKey: ['shoots'],
    queryFn: () => callApi('/shoots', { responseSchema: list }),
    staleTime: 30_000,
  })
  if (shoots.isLoading) return <SkeletonList rows={4} columns={2} />
  const shoot = (shoots.data ?? []).find((s) => s.id === shootId)
  if (!shoot) return <Navigate to="/team-allocation" replace />
  return <Navigate to="/projects/$id" params={{ id: shoot.project_id }} search={{ tab: 'shoots' } as never} replace />
}
