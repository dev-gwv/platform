import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useUrlParam } from '@/shared/hooks/use-url-param'
import { toast } from 'sonner'
import { Copy, FileImage, Loader2, PencilLine, Plus, Search, TextCursorInput, Trash2, type LucideIcon } from 'lucide-react'
import type { DesignSummary } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'
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
  useDeleteTemplate,
  useDuplicateDesign,
  useRenameDesign,
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
  const [making, setMaking] = useState<{ starter?: string; saved?: { id: string; name: string } } | null>(
    fromProject ? {} : null,
  )
  useEffect(() => {
    loadDesignerFonts()
  }, [])
  const designs = useDesigns()
  const mine = useDesignTemplates()
  return (
    <AuthedPage module="projects" studioWork="/dashboard">
      <PageHeader
        title="Quotation Designer"
        actions={
          <Button onClick={() => setMaking({})}>
            <Plus /> New design
          </Button>
        }
      />
      <div className="mb-4 inline-flex rounded-lg border border-border bg-muted/50 p-1" role="tablist">
        {(
          [
            ['', 'Designs', designs.data?.length],
            ['templates', 'Templates', STARTERS.length + (mine.data?.length ?? 0)],
          ] as const
        ).map(([k, label, n]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
              tab === k ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
            {n !== undefined && <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{n}</span>}
          </button>
        ))}
      </div>
      {tab === 'templates' ? (
        <Templates onUse={(c) => setMaking(c)} />
      ) : (
        <Designs onNew={() => setMaking({})} />
      )}
      {making && (
        <NewDesignDialog
          projectId={fromProject}
          starter={making.starter}
          saved={making.saved}
          onClose={() => {
            setMaking(null)
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

/**
 * The studio's designs (owner audit, 10 Nov: "no option of deleting ... I do
 * not see any editing rights"): every card carries Open, Rename, Make a copy
 * and Delete in plain sight, cards can be ticked and deleted together, and a
 * search finds one by its name or project.
 */
function Designs({ onNew }: { onNew: () => void }) {
  const q = useDesigns()
  const navigate = useNavigate()
  const dup = useDuplicateDesign()
  const del = useDeleteDesign()
  const confirm = useConfirm()
  const [find, setFind] = useState('')
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<DesignSummary | null>(null)
  if (q.isPending) return <SkeletonList rows={3} />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (q.data.length === 0)
    return (
      <EmptyState
        title="No designs yet"
        description="Pick a project and a template: its events, team, deliverables and price fill in by themselves. Add your photos and send it."
        action={
          <Button onClick={onNew}>
            <Plus /> New design
          </Button>
        }
      />
    )
  const needle = find.trim().toLowerCase()
  const shown = needle
    ? q.data.filter((d) => [d.title, d.project_name].filter(Boolean).some((v) => v!.toLowerCase().includes(needle)))
    : q.data
  const tick = (id: string) =>
    setTicked((t) => {
      const n = new Set(t)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  async function remove(list: DesignSummary[]) {
    const ok = await confirm({
      title: list.length === 1 ? `Delete “${list[0]!.title}”?` : `Delete ${list.length} designs?`,
      description: 'The pages go for good, and a link sent to a client stops opening. Your photos stay in your uploads.',
      destructive: true,
      confirmLabel: 'Delete',
    })
    if (!ok) return
    await Promise.all(list.map((d) => del.mutateAsync(d.id).catch(() => null)))
    setTicked(new Set())
    toast.success(list.length === 1 ? 'Design deleted' : `${list.length} designs deleted`)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a design or project…" aria-label="Find a design" className="pl-8" />
        </span>
        {ticked.size > 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5 text-sm">
            <span className="font-medium">{ticked.size} chosen</span>
            <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10" onClick={() => void remove(q.data.filter((d) => ticked.has(d.id)))}>
              <Trash2 /> Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setTicked(new Set())}>
              Clear
            </Button>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">
            {q.data.length} design{q.data.length === 1 ? '' : 's'} · tick a card to delete several
          </span>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No design matches “{find}”.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {shown.map((d) => (
            <DesignCard
              key={d.id}
              d={d}
              ticked={ticked.has(d.id)}
              anyTicked={ticked.size > 0}
              onTick={() => tick(d.id)}
              actions={[
                { label: 'Rename', icon: TextCursorInput, onClick: () => setRenaming(d) },
                {
                  label: 'Make a copy',
                  icon: Copy,
                  onClick: () =>
                    dup.mutate(d.id, { onSuccess: (r) => void navigate({ to: '/ai/designer/$id', params: { id: r.id } }) }),
                },
                { label: 'Delete', icon: Trash2, danger: true, onClick: () => void remove([d]) },
              ]}
            />
          ))}
        </div>
      )}
      {renaming && <RenameDialog d={renaming} onClose={() => setRenaming(null)} />}
    </div>
  )
}

interface CardAction {
  label: string
  icon: LucideIcon
  onClick: () => void
  danger?: boolean
}

function DesignCard({
  d,
  actions,
  ticked,
  anyTicked,
  onTick,
  openLabel = 'Edit',
  onOpen,
}: {
  d: DesignSummary
  actions: CardAction[]
  ticked?: boolean
  anyTicked?: boolean
  onTick?: () => void
  openLabel?: string
  /** Instead of opening the editor (a template is used to start a design). */
  onOpen?: () => void
}) {
  const theme = templateFor(d.template).theme
  const picture = (
    <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden" style={{ background: theme.background }}>
      {d.cover_url ? (
        <img src={d.cover_url} alt="" className="size-full object-cover transition duration-300 group-hover:scale-[1.03]" />
      ) : (
        <span
          className="line-clamp-3 px-5 text-center"
          style={{ fontFamily: `'${theme.heading}', cursive`, color: theme.accent, fontSize: 30, lineHeight: 1.2 }}
        >
          {d.title}
        </span>
      )}
      <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100">
        <span className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-slate-900 shadow">{openLabel}</span>
      </span>
      <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white">
        {d.pages} pages · {templateFor(d.template).name}
      </span>
    </div>
  )
  return (
    <Card className={cn('group overflow-hidden transition-shadow hover:shadow-md', ticked && 'ring-2 ring-primary')}>
      <div className="relative">
        {onOpen ? (
          <button type="button" onClick={onOpen} className="block w-full text-left">
            {picture}
          </button>
        ) : (
          <Link to="/ai/designer/$id" params={{ id: d.id }} className="block">
            {picture}
          </Link>
        )}
        {onTick && (
          <label
            className={cn(
              'absolute left-2 top-2 flex size-7 cursor-pointer items-center justify-center rounded-md border border-white/70 bg-black/40 shadow transition',
              ticked || anyTicked ? 'opacity-100' : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100',
            )}
          >
            <input type="checkbox" checked={!!ticked} onChange={onTick} className="size-4 accent-primary" aria-label={`Choose ${d.title}`} />
          </label>
        )}
      </div>
      <CardContent className="flex flex-col gap-2 p-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{d.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {d.project_name ?? 'No project'} · edited {when.format(new Date(d.updated_at))}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {onOpen ? (
            <Button size="sm" className="flex-1" onClick={onOpen}>
              {openLabel}
            </Button>
          ) : (
            <Button size="sm" className="flex-1" asChild>
              <Link to="/ai/designer/$id" params={{ id: d.id }}>
                <PencilLine /> {openLabel}
              </Link>
            </Button>
          )}
          {actions.map((a) => (
            <Button
              key={a.label}
              size="sm"
              variant="outline"
              shape="square"
              title={a.label}
              aria-label={`${a.label}: ${d.title}`}
              onClick={a.onClick}
              className={cn(a.danger && 'hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive')}
            >
              <a.icon />
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function RenameDialog({ d, onClose }: { d: DesignSummary; onClose: () => void }) {
  const rename = useRenameDesign()
  const [title, setTitle] = useState(d.title)
  const save = () => {
    if (!title.trim()) return
    rename.mutate({ id: d.id, title: title.trim() }, { onSuccess: () => { toast.success('Renamed'); onClose() } })
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Rename">
        <Input
          autoFocus
          value={title}
          maxLength={160}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          aria-label="Name"
          className={cn(!title.trim() && 'border-amber-400 bg-amber-50/60')}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!title.trim() || rename.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Templates: the six ready-made ones and the studio's own, each one tap from
 * a new design; the studio's own can be renamed, opened to change and deleted.
 */
function Templates({ onUse }: { onUse: (c: { starter?: string; saved?: { id: string; name: string } }) => void }) {
  const company = useCompanyProfile()
  const mine = useDesignTemplates()
  const del = useDeleteTemplate()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [renaming, setRenaming] = useState<DesignSummary | null>(null)
  const studio = company.data?.display_name || company.data?.name || 'Your Studio'
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">
          Your templates{' '}
          <span className="font-normal text-muted-foreground">· open any design and press Save as template</span>
        </h2>
        {mine.isPending ? (
          <SkeletonList rows={1} />
        ) : (mine.data ?? []).length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            None yet. A design you are happy with becomes one with <strong>Save as template</strong> in its top bar.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {(mine.data ?? []).map((t) => (
              <DesignCard
                key={t.id}
                d={t}
                openLabel="Use"
                onOpen={() => onUse({ saved: { id: t.id, name: t.title } })}
                actions={[
                  { label: 'Change the template', icon: PencilLine, onClick: () => void navigate({ to: '/ai/designer/$id', params: { id: t.id } }) },
                  { label: 'Rename', icon: TextCursorInput, onClick: () => setRenaming(t) },
                  {
                    label: 'Delete',
                    icon: Trash2,
                    danger: true,
                    onClick: async () => {
                      if (
                        await confirm({
                          title: `Delete the template “${t.title}”?`,
                          description: 'Designs already made from it stay as they are.',
                          destructive: true,
                          confirmLabel: 'Delete',
                        })
                      )
                        del.mutate(t.id)
                    },
                  },
                ]}
              />
            ))}
          </div>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Ready-made</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {STARTERS.map((st) => {
            const doc = starterDoc(st.key, studio)
            return (
              <button
                key={st.key}
                type="button"
                onClick={() => onUse({ starter: st.key })}
                className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-2.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
              >
                <span className="relative flex justify-center overflow-hidden rounded-lg bg-muted/60 p-2">
                  <Thumb page={doc.pages[0]!} theme={doc.theme} width={150} />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-900 shadow">Use this</span>
                  </span>
                </span>
                <span className="text-sm font-semibold leading-tight">{st.name}</span>
                <span className="text-xs leading-tight text-muted-foreground">
                  {doc.pages.length} pages · {st.blurb}
                </span>
              </button>
            )
          })}
        </div>
      </section>
      {renaming && <RenameDialog d={renaming} onClose={() => setRenaming(null)} />}
    </div>
  )
}

/** Pick a project (or none) and a look; the pages are filled before the editor opens. */
type Choice = { kind: 'starter'; key: string } | { kind: 'saved'; id: string; name: string }

function NewDesignDialog({
  projectId: startOn,
  starter,
  saved: savedStart,
  onClose,
}: {
  projectId: string
  starter?: string | undefined
  saved?: { id: string; name: string } | undefined
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
  const [choice, setChoice] = useState<Choice>(
    savedStart ? { kind: 'saved', ...savedStart } : { kind: 'starter', key: starter ?? STARTERS[0]!.key },
  )
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
