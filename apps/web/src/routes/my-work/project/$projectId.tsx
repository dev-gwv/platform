import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { SkeletonList } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { humanize } from '@/shared/ui/format'
import { useMyProjectTasks } from '@/features/tasks/api'
import { useMyProjectWorkSubmissions } from '@/features/work/api'

/**
 * One project's slice of my work: my tasks and my submissions on it -- only
 * mine, even for a manager (it listed everyone's, labelled as mine).
 */
export function MyWorkProjectPage() {
  return (
    <AuthedPage module="projects">
      <ProjectWork />
    </AuthedPage>
  )
}

function ProjectWork() {
  const { projectId } = useParams({ from: '/authed/my-work/project/$projectId' })
  const navigate = useNavigate()
  const tasks = useMyProjectTasks(projectId)
  const subs = useMyProjectWorkSubmissions(projectId)

  const myTasks = (tasks.data ?? []).slice(0, 50)

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/my-work' })}>
          <ArrowLeft className="mr-1 size-4" /> My work
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/projects/$id" params={{ id: projectId }}>Project</Link>
        </Button>
      </div>

      {tasks.isLoading || subs.isLoading ? (
        <SkeletonList rows={5} columns={3} />
      ) : tasks.isError ? (
        <ErrorState onRetry={() => void tasks.refetch()} />
      ) : myTasks.length === 0 && (subs.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-4">
            <EmptyState title="No work on this project" description="Nothing assigned or submitted here yet." />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground">Tasks ({myTasks.length})</h2>
            {myTasks.map((t) => (
              <Card key={t.id}>
                <CardContent className="flex flex-wrap items-center gap-2 p-3 text-sm">
                  <span className="font-medium">{t.title}</span>
                  <StatusBadge className="ml-auto" tone={t.status === 'completed' ? 'success' : 'neutral'}>
                    {humanize(t.status)}
                  </StatusBadge>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground">
              Submissions ({(subs.data ?? []).length})
            </h2>
            {(subs.data ?? []).map((s) => (
              <Card key={s.id}>
                <CardContent className="flex flex-wrap items-center gap-2 p-3 text-sm">
                  <a href={s.submission_link ?? '#'} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                    {s.notes ?? s.submission_link ?? 'Submission'}
                  </a>
                  <StatusBadge className="ml-auto" tone={s.status === 'approved' ? 'success' : s.status === 'rejected' ? 'danger' : 'info'}>
                    {s.status}
                  </StatusBadge>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
