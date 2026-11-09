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
import {
  useCreateDesign,
  useDeleteDesign,
  useDesignTemplates,
  useDesigns,
  useDuplicateDesign,
} from '@/features/designer/api'
import { fillDesign } from '@/features/designer/fill'
import { templateFor } from '@/features/designer/templates'
import {
  STARTERS,
  keepStudioPages,
  pourProject,
  starterDoc,
  starterFor,
} from '@/features/designer/starters'
import { Thumb } from '@/features/designer/Thumb'
import { loadDesignerFonts } from '@/features/designer/fonts'

export function AiDesignerPage() {
  // From a project's quotation page (Premium design): the New dialog opens on that project.
  const [fromProject, setFromProject] = useUrlParam('project')
  const [tab, setTab] = useUrlParam('tab')
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
      <div className="mb-4 flex gap-2" role="tablist">
        {(
          [
            ['', 'Designs'],
            ['templates', 'Your templates'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              'rounded-full border px-4 py-1.5 text-sm font-medium',
              tab === k
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card hover:bg-muted',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <Designs onNew={() => setMaking(true)} templates={tab === 'templates'} />
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

const when = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
})

function Designs({ onNew, templates }: { onNew: () => void; templates: boolean }) {
  const all = useDesigns()
  const mine = useDesignTemplates()
  const q = templates ? mine : all
  const navigate = useNavigate()
  const dup = useDuplicateDesign()
  const del = useDeleteDesign()
  const confirm = useConfirm()
  if (q.isPending) return <SkeletonList rows={3} />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (q.data.length === 0 && templates)
    return (
      <EmptyState
        title="No templates yet"
        description="Open any design and press Save as template. It shows here, and in New design."
      />
    )
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
                  onSelect: () =>
                    dup.mutate(d.id, {
                      onSuccess: (r) =>
                        void navigate({ to: '/ai/designer/$id', params: { id: r.id } }),
                    }),
                },
                {
                  label: 'Delete',
                  icon: <Trash2 className="size-4" />,
                  danger: true,
                  divider: true,
                  onSelect: async () => {
                    if (
                      await confirm({
                        title: `Delete “${d.title}”?`,
                        description:
                          'The design and its pages go for good. Your photos stay in your uploads.',
                        destructive: true,
                        confirmLabel: 'Delete',
                      })
                    )
                      del.mutate(d.id)
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
        <div
          className="relative flex aspect-[4/3] items-center justify-center overflow-hidden"
          style={{ background: theme.background }}
        >
          {d.cover_url ? (
            <img src={d.cover_url} alt="" className="size-full object-cover" />
          ) : (
            <span
              className="line-clamp-3 px-5 text-center"
              style={{
                fontFamily: `'${theme.heading}', cursive`,
                color: theme.accent,
                fontSize: 30,
                lineHeight: 1.2,
              }}
            >
              {d.title}
            </span>
          )}
        </div>
      </Link>
      <CardContent className="flex items-start gap-2 p-3">
        <Link to="/ai/designer/$id" params={{ id: d.id }} className="min-w-0 flex-1">
          <p className="truncate font-medium">{d.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[
              d.project_name,
              `${d.pages} pages`,
              templateFor(d.template).name,
              `edited ${when.format(new Date(d.updated_at))}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </Link>
        {menu}
      </CardContent>
    </Card>
  )
}

/** Pick a project (or none) and a look; the pages are filled before the editor opens. */
type Choice = { kind: 'starter'; key: string } | { kind: 'saved'; id: string; name: string }

function NewDesignDialog({
  projectId: startOn,
  onClose,
}: {
  projectId: string
  onClose: () => void
}) {
  const navigate = useNavigate()
  const company = useCompanyProfile()
  const designs = useDesigns()
  const saved = useDesignTemplates()
  const create = useCreateDesign()
  const [projectId, setProjectId] = useState(startOn)
  const started = useProject(startOn)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [choice, setChoice] = useState<Choice>({ kind: 'starter', key: STARTERS[0]!.key })
  const [filling, setFilling] = useState(false)
  const studio = company.data?.display_name || company.data?.name || 'Your Studio'

  async function make() {
    setFilling(true)
    try {
      const last = designs.data?.[0]
      const [project, shoots, billing, previous, layoutSaved] = await Promise.all([
        projectId ? callApi(`/projects/${projectId}`, { responseSchema: projectDetail }) : null,
        projectId
          ? callApi(`/shoots?project_id=${projectId}`, { responseSchema: shootListItem.array() })
          : [],
        projectId
          ? callApi(`/projects/${projectId}/billing`, { responseSchema: projectBilling }).catch(
              () => null,
            )
          : null,
        last && choice.kind === 'starter'
          ? callApi(`/designs/${last.id}`, { responseSchema: designDetail }).catch(() => null)
          : null,
        choice.kind === 'saved'
          ? callApi(`/designs/${choice.id}`, { responseSchema: designDetail })
          : null,
      ])
      // A saved template is the studio's own already; a ready-made one takes the studio's story from its last design.
      const look =
        layoutSaved?.template ?? (choice.kind === 'starter' ? starterFor(choice.key).look : 'ivory')
      const layout = layoutSaved
        ? structuredClone(layoutSaved.doc)
        : keepStudioPages(
            starterDoc(choice.kind === 'starter' ? choice.key : 'classic', studio),
            previous?.doc,
          )
      const doc = project
        ? pourProject(
            layout,
            fillDesign({
              template: look,
              studio,
              project,
              shoots: [...shoots].sort((a, b) =>
                (a.shoot_date ?? '9').localeCompare(b.shoot_date ?? '9'),
              ),
              instalments: billing?.plan?.instalments ?? [],
            }),
          )
        : layout
      const title = project ? `${project.name} – Quotation` : 'New quotation'
      const r = await create.mutateAsync({
        title: title.slice(0, 160),
        template: look,
        project_id: projectId || null,
        doc,
      })
      void navigate({ to: '/ai/designer/$id', params: { id: r.id } })
    } catch {
      // The mutation's own toast says why (a plan limit offers Upgrade).
    } finally {
      setFilling(false)
    }
  }

  const isOn = (c: Choice) =>
    c.kind === 'starter'
      ? choice.kind === 'starter' && choice.key === c.key
      : choice.kind === 'saved' && choice.id === c.id
  const tile = (c: Choice, label: string, sub: string, picture: React.ReactNode) => (
    <button
      key={c.kind === 'starter' ? c.key : c.id}
      type="button"
      onClick={() => setChoice(c)}
      aria-pressed={isOn(c)}
      className={cn(
        'flex flex-col gap-1.5 rounded-xl border-2 p-2 text-left transition',
        isOn(c)
          ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
          : 'border-border hover:border-primary/50',
      )}
    >
      <span className="flex justify-center rounded-md bg-muted/60 p-1.5">{picture}</span>
      <span className="text-xs font-semibold leading-tight">{label}</span>
      <span className="text-[11px] leading-tight text-muted-foreground">{sub}</span>
    </button>
  )

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
            <Label>Template</Label>
            <div className="grid max-h-[46vh] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
              {STARTERS.map((st) => {
                const d = starterDoc(st.key, studio)
                return tile(
                  { kind: 'starter', key: st.key },
                  st.name,
                  `${d.pages.length} pages · ${st.blurb}`,
                  <Thumb page={d.pages[0]!} theme={d.theme} width={110} />,
                )
              })}
              {(saved.data ?? []).map((t) =>
                tile(
                  { kind: 'saved', id: t.id, name: t.title },
                  t.title,
                  `Your template · ${t.pages} pages`,
                  t.cover_url ? (
                    <img
                      src={t.cover_url}
                      alt=""
                      className="aspect-[794/1123] w-[110px] rounded-sm object-cover"
                    />
                  ) : (
                    <span className="flex aspect-[794/1123] w-[110px] items-center justify-center rounded-sm bg-muted text-xs text-muted-foreground">
                      Your template
                    </span>
                  ),
                ),
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              With a project, its events, deliverables and price fill the template.
            </p>
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
