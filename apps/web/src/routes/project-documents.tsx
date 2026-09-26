import { useMemo, useState } from 'react'
import { SettingsTabs } from '@/features/settings/SettingsTabs'
import { Link } from '@tanstack/react-router'
import { ArrowRight, CheckCircle2, CircleDashed, Clock, Eye, Hourglass, Search } from 'lucide-react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { SkeletonList } from '@/shared/ui/skeleton'
import { cn } from '@/shared/ui/cn'
import { useTermsDocuments, type TermsDocument } from '@/features/terms/api'
import { useProjects } from '@/features/projects/api'
import { TermsDocumentViewer } from '@/features/terms/TermsDocumentViewer'

const when = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

type State = 'agreed' | 'waiting' | 'closed' | 'not_sent'

const LOOK: Record<State, { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger'; icon: typeof CheckCircle2 }> = {
  agreed: { label: 'Agreed', tone: 'success', icon: CheckCircle2 },
  waiting: { label: 'Waiting', tone: 'warning', icon: Hourglass },
  closed: { label: 'Link closed', tone: 'danger', icon: Clock },
  not_sent: { label: 'Not sent yet', tone: 'neutral', icon: CircleDashed },
}

interface Row {
  key: string
  projectId: string | null
  project: string
  client: string | null
  state: State
  doc: TermsDocument | null
}

function stateOf(d: TermsDocument): State {
  if (d.acknowledged_at) return 'agreed'
  return d.has_active_link ? 'waiting' : 'closed'
}

export function ProjectDocumentsPage() {
  return (
    <AuthedPage module="projects">
      <ProjectDocuments />
    </AuthedPage>
  )
}

/**
 * Terms for every project, on one page: who has agreed, who we are waiting
 * on, whose link has closed, and which projects have not been sent terms at
 * all. Writing and sending happen on the project's own Terms tab -- every row
 * opens there -- so there is one way to send terms, and sharing a link never
 * cancels the one the client already has.
 */
function ProjectDocuments() {
  const docs = useTermsDocuments()
  const projects = useProjects()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | State>('all')
  const [viewing, setViewing] = useState<string | null>(null)

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = (docs.data ?? []).map((d) => ({
      key: d.id,
      projectId: d.project_id,
      project: d.project_name ?? 'Terms & conditions',
      client: d.client_name,
      state: stateOf(d),
      doc: d,
    }))
    // Live projects that have never been sent terms: the list someone
    // actually needs to work through.
    const withTerms = new Set(out.map((r) => r.projectId).filter(Boolean))
    for (const p of projects.data ?? []) {
      if (withTerms.has(p.id) || p.status === 'cancelled' || p.status === 'completed') continue
      out.push({ key: `p-${p.id}`, projectId: p.id, project: p.name, client: p.client_name, state: 'not_sent', doc: null })
    }
    return out
  }, [docs.data, projects.data])

  const count = (s: State) => rows.filter((r) => r.state === s).length
  const q = search.trim().toLowerCase()
  const shown = rows.filter(
    (r) => (filter === 'all' || r.state === filter) && (!q || `${r.project} ${r.client ?? ''}`.toLowerCase().includes(q)),
  )

  return (
    <>
      <PageHeader title="Documents" description="Terms & conditions for every project — who has agreed, and who hasn't." />
      <SettingsTabs />

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(['agreed', 'waiting', 'closed', 'not_sent'] as const).map((s) => {
          const Icon = LOOK[s].icon
          return (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(filter === s ? 'all' : s)}
              aria-pressed={filter === s}
              className={cn(
                'rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/40',
                filter === s ? 'border-primary ring-1 ring-primary' : 'border-border',
              )}
            >
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon className="size-4" aria-hidden /> {LOOK[s].label}
              </span>
              <span className="mt-1 block text-2xl font-semibold tabular-nums">{count(s)}</span>
            </button>
          )
        })}
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <FilterTabs
          tabs={[
            { value: 'all', label: 'All', count: rows.length },
            { value: 'agreed', label: 'Agreed' },
            { value: 'waiting', label: 'Waiting' },
            { value: 'closed', label: 'Link closed' },
            { value: 'not_sent', label: 'Not sent' },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <label className="relative sm:ml-auto sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search project or client…" aria-label="Search" className="pl-9" />
        </label>
      </div>

      <div className="mt-4">
        {docs.isLoading || projects.isLoading ? (
          <SkeletonList rows={5} columns={4} />
        ) : docs.isError ? (
          <ErrorState onRetry={() => void docs.refetch()} />
        ) : shown.length === 0 ? (
          <EmptyState
            title={rows.length === 0 ? 'No projects yet' : 'Nothing here'}
            description={rows.length === 0 ? 'Terms are sent from a project’s Terms tab.' : 'Try another filter or search.'}
          />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {shown.map((r) => (
              <li key={r.key}>
                <Card>
                  <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
                    <div className="min-w-[12rem] flex-1">
                      <p className="font-medium">{r.project}</p>
                      <p className="text-xs text-muted-foreground">{[r.client, sub(r)].filter(Boolean).join(' · ')}</p>
                    </div>
                    <StatusBadge tone={LOOK[r.state].tone}>{LOOK[r.state].label}</StatusBadge>
                    <div className="flex gap-1.5">
                      {r.doc && (
                        <Button size="sm" variant="ghost" onClick={() => setViewing(r.doc!.id)}>
                          <Eye /> View
                        </Button>
                      )}
                      {r.projectId && (
                        <Button size="sm" variant={r.state === 'agreed' || r.state === 'waiting' ? 'outline' : 'default'} asChild>
                          <Link to="/projects/$id" params={{ id: r.projectId }} search={{ tab: 'terms' }}>
                            {r.state === 'not_sent' ? 'Send terms' : r.state === 'closed' ? 'Send again' : 'Open'} <ArrowRight />
                          </Link>
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <TermsDocumentViewer documentId={viewing} onClose={() => setViewing(null)} />
    </>
  )
}

/** The one fact that matters for each state. */
function sub(r: Row): string | null {
  const d = r.doc
  if (!d) return null
  if (r.state === 'agreed') return `Agreed${d.acknowledged_by_name ? ` by ${d.acknowledged_by_name}` : ''} on ${when.format(new Date(d.acknowledged_at!))}`
  if (r.state === 'waiting')
    return `Sent ${when.format(new Date(d.created_at))}${d.link_expires_at ? ` · link works till ${when.format(new Date(d.link_expires_at))}` : ''}`
  return `Sent ${when.format(new Date(d.created_at))} · not agreed`
}
