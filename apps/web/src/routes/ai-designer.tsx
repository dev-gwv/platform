import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useUrlParam } from '@/shared/hooks/use-url-param'
import { Copy, FileImage, Loader2, Plus, Trash2 } from 'lucide-react'
import type { DesignSummary } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Label } from '@/shared/ui/input'
import { RowMenu } from '@/shared/ui/row-menu'
import { SkeletonList } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { callApi } from '@/shared/api/client'
import { designDetail, projectBilling, projectDetail, shootListItem } from '@ipc/contracts'
import { ProjectPicker } from '@/features/projects/ProjectPicker'
import { useProject } from '@/features/projects/api'
import { useCompanyProfile } from '@/features/settings/api'
import { useCreateDesign, useDeleteDesign, useDesigns, useDuplicateDesign } from '@/features/designer/api'
import { fillDesign } from '@/features/designer/fill'
import { TEMPLATES, templateFor } from '@/features/designer/templates'
import { loadDesignerFonts } from '@/features/designer/fonts'

export function AiDesignerPage() {
  // From a project's quotation page (Premium design): the New dialog opens on that project.
  const [fromProject, setFromProject] = useUrlParam('project')
  const [making, setMaking] = useState(!!fromProject)
  useEffect(() => {
    loadDesignerFonts()
  }, [])
  return (
    <AuthedPage module="projects" studioWork="/dashboard">
      <PageHeader
        title="Quotation Designer"
        actions={
          <Button onClick={() => setMaking(true)}>
            <Plus /> New design
          </Button>
        }
      />
      <Designs onNew={() => setMaking(true)} />
      {making && (
        <NewDesignDialog
          projectId={fromProject}
          onClose={() => {
            setMaking(false)
            if (fromProject) setFromProject('')
          }}
        />
      )}
    </AuthedPage>
  )
}

const when = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

function Designs({ onNew }: { onNew: () => void }) {
  const q = useDesigns()
  const navigate = useNavigate()
  const dup = useDuplicateDesign()
  const del = useDeleteDesign()
  const confirm = useConfirm()
  if (q.isPending) return <SkeletonList rows={3} />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (q.data.length === 0)
    return (
      <EmptyState
        title="No designs yet"
        description="Pick a project and a look: its events, team, deliverables and price fill in by themselves. Add your photos and send it."
        action={
          <Button onClick={onNew}>
            <Plus /> New design
          </Button>
        }
      />
    )
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {q.data.map((d) => (
        <DesignCard
          key={d.id}
          d={d}
          menu={
            <RowMenu
              label={`More for ${d.title}`}
              items={[
                {
                  label: 'Make a copy',
                  icon: <Copy className="size-4" />,
                  onSelect: () => dup.mutate(d.id, { onSuccess: (r) => void navigate({ to: '/ai/designer/$id', params: { id: r.id } }) }),
                },
                {
                  label: 'Delete',
                  icon: <Trash2 className="size-4" />,
                  danger: true,
                  divider: true,
                  onSelect: async () => {
                    if (await confirm({ title: `Delete “${d.title}”?`, description: 'The design and its pages go for good. Your photos stay in your uploads.', destructive: true, confirmLabel: 'Delete' })) del.mutate(d.id)
                  },
                },
              ]}
            />
          }
        />
      ))}
    </div>
  )
}

function DesignCard({ d, menu }: { d: DesignSummary; menu: React.ReactNode }) {
  const theme = templateFor(d.template).theme
  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-md">
      <Link to="/ai/designer/$id" params={{ id: d.id }} className="block">
        <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden" style={{ background: theme.background }}>
          {d.cover_url ? (
            <img src={d.cover_url} alt="" className="size-full object-cover" />
          ) : (
            <span className="line-clamp-3 px-5 text-center" style={{ fontFamily: `'${theme.heading}', cursive`, color: theme.accent, fontSize: 30, lineHeight: 1.2 }}>{d.title}</span>
          )}
        </div>
      </Link>
      <CardContent className="flex items-start gap-2 p-3">
        <Link to="/ai/designer/$id" params={{ id: d.id }} className="min-w-0 flex-1">
          <p className="truncate font-medium">{d.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[d.project_name, `${d.pages} pages`, templateFor(d.template).name, `edited ${when.format(new Date(d.updated_at))}`].filter(Boolean).join(' · ')}
          </p>
        </Link>
        {menu}
      </CardContent>
    </Card>
  )
}

/** Pick a project (or none) and a look; the pages are filled before the editor opens. */
function NewDesignDialog({ projectId: startOn, onClose }: { projectId: string; onClose: () => void }) {
  const navigate = useNavigate()
  const company = useCompanyProfile()
  const designs = useDesigns()
  const create = useCreateDesign()
  const [projectId, setProjectId] = useState(startOn)
  const started = useProject(startOn)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [template, setTemplate] = useState(TEMPLATES[0]!.key)
  const [filling, setFilling] = useState(false)

  async function make() {
    setFilling(true)
    try {
      const studio = company.data?.display_name || company.data?.name || 'Your Studio'
      const last = designs.data?.[0]
      const [project, shoots, billing, previous] = await Promise.all([
        projectId ? callApi(`/projects/${projectId}`, { responseSchema: projectDetail }) : null,
        projectId ? callApi(`/shoots?project_id=${projectId}`, { responseSchema: shootListItem.array() }) : [],
        projectId ? callApi(`/projects/${projectId}/billing`, { responseSchema: projectBilling }).catch(() => null) : null,
        last ? callApi(`/designs/${last.id}`, { responseSchema: designDetail }).catch(() => null) : null,
      ])
      const doc = fillDesign({
        template,
        studio,
        project,
        shoots: [...shoots].sort((a, b) => (a.shoot_date ?? '9').localeCompare(b.shoot_date ?? '9')),
        instalments: billing?.plan?.instalments ?? [],
        // A new look was asked for: keep the last design's words and photos, not its colours.
        previous: previous ? { ...previous.doc, theme: templateFor(template).theme } : null,
      })
      const title = project ? `${project.name} – Quotation` : 'New quotation'
      const r = await create.mutateAsync({ title: title.slice(0, 160), template, project_id: projectId || null, doc })
      void navigate({ to: '/ai/designer/$id', params: { id: r.id } })
    } catch {
      // The mutation's own toast says why (a plan limit offers Upgrade).
    } finally {
      setFilling(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="New quotation design" className="sm:max-w-2xl">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Project</Label>
            <ProjectPicker
              value={projectId}
              label={projectName ?? (projectId === startOn ? (started.data?.name ?? null) : null)}
              noneLabel="No project (start blank)"
              onChange={(id, name) => {
                setProjectId(id)
                setProjectName(name)
              }}
              className={cn(!projectId && 'border-dashed border-warning/70 bg-warning/5')}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Look</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TEMPLATES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTemplate(t.key)}
                  aria-pressed={template === t.key}
                  className={cn('overflow-hidden rounded-xl border-2 text-left transition', template === t.key ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/50')}
                >
                  <div className="flex h-20 flex-col items-center justify-center" style={{ background: t.theme.background }}>
                    <span style={{ fontFamily: `'${t.theme.heading}', cursive`, color: t.theme.accent, fontSize: 26, lineHeight: 1 }}>Aa</span>
                    <span className="mt-1 h-1 w-10 rounded" style={{ background: t.theme.accent }} />
                  </div>
                  <p className="px-2 py-1.5 text-xs font-medium">{t.name}</p>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{templateFor(template).blurb}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void make()} disabled={filling}>
            {filling ? <Loader2 className="animate-spin" /> : <FileImage />} Make the design
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
