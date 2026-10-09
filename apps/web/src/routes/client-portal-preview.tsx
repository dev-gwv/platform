import { Link, useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Eye } from 'lucide-react'
import { publicClientPortal } from '@ipc/contracts'
import { ApiError, callApi } from '@/shared/api/client'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { EmptyState } from '@/shared/ui/states'
import { PortalView } from '@/routes/client-portal'

/**
 * "See it as the client": the page the project's client link shows, read
 * through the studio's own session so it never counts as a client visit
 * (GET /client-portal/projects/:id/preview, 0252). Nothing on it can be pressed.
 */
export function ClientPortalPreviewPage() {
  return (
    <AuthedPage module="projects" studioWork="/my-work">
      <Preview />
    </AuthedPage>
  )
}

function Preview() {
  const { id: projectId } = useParams({ from: '/authed/projects/$id/client-view' })
  const { data, error, isLoading } = useQuery({
    queryKey: ['client-portal', projectId, 'preview'],
    queryFn: () => callApi(`/client-portal/projects/${projectId}/preview`, { responseSchema: publicClientPortal }),
    retry: false,
  })
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
        <Eye className="size-4 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1">This is what your client sees. Opening it here isn’t counted as a client view.</span>
        <Button size="sm" variant="outline" asChild>
          <Link to="/projects/$id" params={{ id: projectId }}>
            <ArrowLeft /> Back to the project
          </Link>
        </Button>
      </div>
      {isLoading ? (
        <SkeletonCards count={3} />
      ) : error || !data ? (
        <EmptyState title="Nothing to show yet" description={error instanceof ApiError ? error.message : 'Make the client link first.'} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <PortalView data={data} token={null} />
        </div>
      )}
    </div>
  )
}
