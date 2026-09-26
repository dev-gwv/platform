import { useState } from 'react'
import { SettingsTabs } from '@/features/settings/SettingsTabs'
import { useNavigate } from '@tanstack/react-router'
import { useConfirm } from '@/shared/ui/confirm'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { SectionTabs } from '@/shared/layout/section-tabs'
import { Button } from '@/shared/ui/button'
import { Input, Select } from '@/shared/ui/input'
import { useClients } from '@/features/clients/api'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { DraftRestoredBanner, useFormDraft } from '@/shared/hooks/use-form-draft'
import {
  useProjectTemplates,
  useSaveProjectTemplate,
  useDeleteProjectTemplate,
  useApplyProjectTemplate,
} from '@/features/project-templates/api'
import {
  useShootTypes,
  useCreateShootType,
} from '@/features/projects/api'
import { PresetsTab } from '@/features/project-templates/PresetsTab'
import { DeliverableTypesTab } from '@/features/project-templates/DeliverableTypesTab'
import { type CreateProjectTemplateRequest } from '@ipc/contracts'
import { Plus, Trash2, Pencil, Package, Camera, ListChecks, Calendar, ArrowRight } from 'lucide-react'

type Tab = 'templates' | 'shoot-presets' | 'work-presets' | 'deliverable-types'

const TABS: { value: Tab; label: string }[] = [
  { value: 'templates', label: 'Project templates' },
  { value: 'shoot-presets', label: 'Shoot presets' },
  { value: 'work-presets', label: 'Work presets' },
  { value: 'deliverable-types', label: 'Deliverable types' },
]

/** The tab lives in the address (?tab=), so a link or a refresh lands on it. */
function useTab(): [Tab, (t: Tab) => void] {
  const [tab, setTabState] = useState<Tab>(() => {
    const v = new URLSearchParams(window.location.search).get('tab')
    return TABS.some((t) => t.value === v) ? (v as Tab) : 'templates'
  })
  const setTab = (t: Tab) => {
    setTabState(t)
    const url = new URL(window.location.href)
    if (t === 'templates') url.searchParams.delete('tab')
    else url.searchParams.set('tab', t)
    window.history.replaceState(window.history.state, '', url)
  }
  return [tab, setTab]
}

function ProjectTemplatesContent() {
  const [tab, setTab] = useTab()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [applyDialogOpen, setApplyDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [applyingTemplateId, setApplyingTemplateId] = useState<string | null>(null)
  const [applyForm, setApplyForm] = useState({ name: '', client_id: '', start_date: '' })
  const [form, setForm] = useState<CreateProjectTemplateRequest>({
    name: '',
    description: null,
    deliverables_json: [],
    shoots_json: [],
    tasks_json: [],
  })
  // What was typed survives a refresh or a closed tab until it is saved.
  const templateDraft = useFormDraft(dialogOpen ? `project-template:${editingId ?? 'new'}` : null, form, setForm)
  const applyDraft = useFormDraft(
    applyDialogOpen && applyingTemplateId ? `project-template-apply:${applyingTemplateId}` : null,
    applyForm,
    setApplyForm,
  )

  const { data, isLoading, isError, refetch } = useProjectTemplates()
  const saveTemplate = useSaveProjectTemplate()
  const deleteTemplate = useDeleteProjectTemplate()
  const applyTemplate = useApplyProjectTemplate()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { data: clientsData } = useClients()
  const clients = Array.isArray(clientsData) ? clientsData : (clientsData?.items ?? [])

  const templates = data?.items ?? []

  function openCreate() {
    setEditingId(null)
    setForm({ name: '', description: null, deliverables_json: [], shoots_json: [], tasks_json: [] })
    setDialogOpen(true)
  }

  function openEdit(template: (typeof templates)[0]) {
    setEditingId(template.id)
    setForm({
      name: template.name,
      description: template.description,
      deliverables_json: template.deliverables_json ?? [],
      shoots_json: template.shoots_json ?? [],
      tasks_json: template.tasks_json ?? [],
    })
    setDialogOpen(true)
  }

  function openApply(templateId: string) {
    setApplyingTemplateId(templateId)
    setApplyForm({ name: '', client_id: '', start_date: '' })
    setApplyDialogOpen(true)
  }

  function handleApply() {
    if (!applyingTemplateId || !applyForm.name.trim() || !applyForm.client_id) return
    applyTemplate.mutate(
      { templateId: applyingTemplateId, body: { name: applyForm.name, client_id: applyForm.client_id || undefined, start_date: applyForm.start_date || undefined } },
      {
        // Straight into the new project: that is where its price, dates and
        // team get filled in.
        onSuccess: (r) => {
          applyDraft.clear()
          setApplyDialogOpen(false)
          void navigate({ to: '/projects/$id', params: { id: r.project_id } })
        },
      },
    )
  }

  function addDeliverable() {
    setForm({
      ...form,
      deliverables_json: [...form.deliverables_json, { name: '', description: null, quantity: 1 }],
    })
  }

  function addShoot() {
    setForm({
      ...form,
      shoots_json: [...form.shoots_json, { name: '', kind: null, duration_hours: null }],
    })
  }

  function addTask() {
    setForm({
      ...form,
      tasks_json: [...form.tasks_json, { title: '', priority: 'medium', sort_order: form.tasks_json.length }],
    })
  }

  function handleSubmit() {
    if (form.name.trim().length < 2) return
    // Rows left empty are simply dropped, rather than failing the whole save.
    const body: CreateProjectTemplateRequest = {
      ...form,
      name: form.name.trim(),
      deliverables_json: form.deliverables_json.filter((d) => d.name.trim()),
      shoots_json: form.shoots_json.filter((x) => x.name.trim()),
      tasks_json: form.tasks_json.filter((t) => t.title.trim()),
    }
    saveTemplate.mutate(
      { id: editingId ?? undefined, body },
      {
        onSuccess: () => {
          templateDraft.clear()
          setDialogOpen(false)
        },
      },
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Project Templates"
        description="Your usual packages, presets and deliverables — ready for every new project."
        actions={
          tab === 'templates' ? (
            <Button onClick={openCreate} size="sm">
              <Plus className="mr-1 h-4 w-4" /> New template
            </Button>
          ) : undefined
        }
      />
      <SettingsTabs />

      {/* Wraps rather than scrolls: on a phone all four stay in sight, two by two. */}
      <SectionTabs<Tab> label="Templates and presets" tabs={TABS} value={tab} onChange={setTab} className="flex-wrap" />

      {tab === 'shoot-presets' ? (
        <PresetsTab kind="shoot" />
      ) : tab === 'work-presets' ? (
        <PresetsTab kind="internal_work" />
      ) : tab === 'deliverable-types' ? (
        <DeliverableTypesTab />
      ) : isLoading ? (
        <SkeletonCards count={3} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => (
          <Card key={template.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{template.name}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {template.description && (
                <p className="mb-3 text-sm text-muted-foreground">{template.description}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">
                  <Package className="mr-1 h-3 w-3" /> {(template.deliverables_json ?? []).length} deliverables
                </Badge>
                <Badge variant="secondary">
                  <Camera className="mr-1 h-3 w-3" /> {(template.shoots_json ?? []).length} shoots
                </Badge>
                <Badge variant="secondary">
                  <ListChecks className="mr-1 h-3 w-3" /> {(template.tasks_json ?? []).length} tasks
                </Badge>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => openApply(template.id)}>
                  Use for a new project <ArrowRight />
                </Button>
                <Button size="sm" variant="outline" onClick={() => openEdit(template)}>
                  <Pencil /> Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={async () => {
                    if (await confirm({ title: `Delete “${template.name}”?`, description: 'Projects already made from it stay as they are.', confirmLabel: 'Delete', destructive: true }))
                      deleteTemplate.mutate(template.id)
                  }}
                >
                  <Trash2 /> Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {templates.length === 0 && (
          <div className="col-span-full">
            <EmptyState
              title="No templates yet"
              description="Save your usual package once — e.g. “Wedding: Haldi, Mehendi, Wedding, Reception · Album, Film, Reel” — and start every similar project from it."
              action={
                <Button onClick={openCreate}>
                  <Plus /> New template
                </Button>
              }
            />
          </div>
        )}
      </div>
      )}

      {tab === 'templates' && <CatalogManagers />}

      {/* Create/Edit Template Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" title={editingId ? 'Edit Template' : 'New Template'}>
          <div className="space-y-4">
            <DraftRestoredBanner
              at={templateDraft.restoredAt}
              onDismiss={templateDraft.dismissRestored}
              onDiscard={() => {
                templateDraft.clear()
                const t = templates.find((x) => x.id === editingId)
                if (t) openEdit(t)
                else openCreate()
              }}
            />
            <div>
              <label className="text-sm font-medium">Template name</label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Wedding Photography Package"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Input
                value={form.description ?? ''}
                onChange={(e) => setForm({ ...form, description: e.target.value || null })}
                placeholder="Optional description"
              />
            </div>

            {/* Deliverables */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">Deliverables</label>
                <Button variant="outline" size="sm" onClick={addDeliverable}>
                  <Plus className="mr-1 h-3 w-3" /> Add
                </Button>
              </div>
              {form.deliverables_json.map((d, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <Input
                    placeholder="Deliverable name"
                    value={d.name}
                    onChange={(e) => {
                      const deliverables = [...form.deliverables_json]
                      deliverables[i] = { ...d, name: e.target.value }
                      setForm({ ...form, deliverables_json: deliverables })
                    }}
                  />
                  <Input
                    inputMode="numeric"
                    placeholder="Qty"
                    className="w-20"
                    value={d.quantity}
                    onChange={(e) => {
                      const deliverables = [...form.deliverables_json]
                      deliverables[i] = { ...d, quantity: Number(e.target.value) || 1 }
                      setForm({ ...form, deliverables_json: deliverables })
                    }}
                  />
                  <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => {
                    setForm({ ...form, deliverables_json: form.deliverables_json.filter((_, j) => j !== i) })
                  }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Shoots */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">Shoots</label>
                <Button variant="outline" size="sm" onClick={addShoot}>
                  <Plus className="mr-1 h-3 w-3" /> Add
                </Button>
              </div>
              {form.shoots_json.map((s, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <Input
                    placeholder="Shoot name"
                    value={s.name}
                    onChange={(e) => {
                      const shoots = [...form.shoots_json]
                      shoots[i] = { ...shoots[i], name: e.target.value }
                      setForm({ ...form, shoots_json: shoots })
                    }}
                  />
                  <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => {
                    setForm({ ...form, shoots_json: form.shoots_json.filter((_, j) => j !== i) })
                  }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Tasks */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">Tasks</label>
                <Button variant="outline" size="sm" onClick={addTask}>
                  <Plus className="mr-1 h-3 w-3" /> Add
                </Button>
              </div>
              {form.tasks_json.map((t, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <Input
                    placeholder="Task title"
                    value={t.title}
                    onChange={(e) => {
                      const tasks = [...form.tasks_json]
                      tasks[i] = { ...t, title: e.target.value }
                      setForm({ ...form, tasks_json: tasks })
                    }}
                  />
                  <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => {
                    setForm({ ...form, tasks_json: form.tasks_json.filter((_, j) => j !== i) })
                  }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={form.name.trim().length < 2 || saveTemplate.isPending}>
              {saveTemplate.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Apply Template Dialog */}
      <Dialog open={applyDialogOpen} onOpenChange={setApplyDialogOpen}>
        <DialogContent title="Start a project from this template" description="Its shoots, deliverables and to-dos are added. You set the price and dates on the project.">
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Project Name</label>
              <Input
                value={applyForm.name}
                onChange={(e) => setApplyForm({ ...applyForm, name: e.target.value })}
                placeholder="e.g. Sharma Wedding"
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="apply-client">Client</label>
              {/* Every project belongs to a client; without one the project could not be created. */}
              <Select
                id="apply-client"
                value={applyForm.client_id}
                onChange={(e) => setApplyForm({ ...applyForm, client_id: e.target.value })}
              >
                <option value="">Pick a client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Start Date (optional)</label>
              <Input
                type="date"
                value={applyForm.start_date}
                onChange={(e) => setApplyForm({ ...applyForm, start_date: e.target.value })}
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setApplyDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleApply} disabled={!applyForm.name.trim() || !applyForm.client_id || applyTemplate.isPending}>
              {applyTemplate.isPending ? 'Creating...' : 'Create Project'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Shoot types, offered when adding a shoot. (Deliverable templates and
 * workflow presets used to sit here too; nothing ever read them.)
 */
function CatalogManagers() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ShootTypeManager />
    </div>
  )
}

function ShootTypeManager() {
  const { data } = useShootTypes()
  const create = useCreateShootType()
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const items = (data ?? []).filter((t) => !t.is_archived)

  async function onAdd() {
    if (!name.trim()) return
    await create.mutateAsync({ name: name.trim(), ...(category.trim() ? { category: category.trim() } : {}) })
    setName('')
    setCategory('')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Calendar className="h-4 w-4 text-primary" /> Shoot names
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">Offered when you add a shoot in Create Project.</p>
        <div className="mt-2 flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Haldi" aria-label="Shoot type name" />
          <Button size="sm" onClick={() => void onAdd()} disabled={!name.trim() || create.isPending}>
            <Plus /> Add
          </Button>
        </div>
        <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category (optional)" aria-label="Shoot type category" className="mt-2" />
        <ul className="mt-2 flex max-h-44 flex-col gap-1 overflow-y-auto">
          {items.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5 text-sm">
              <span className="min-w-0 truncate">{t.name}{t.category && <span className="ml-1.5 text-xs text-muted-foreground">{t.category}</span>}</span>
              {t.usage_count > 0 && <Badge variant="secondary">used {t.usage_count}×</Badge>}
            </li>
          ))}
          {items.length === 0 && <li className="py-3 text-center text-xs text-muted-foreground">No shoot types yet.</li>}
        </ul>
      </CardContent>
    </Card>
  )
}

export function ProjectTemplatesPage() {
  return (
    <AuthedPage module="projects">
      <ProjectTemplatesContent />
    </AuthedPage>
  )
}
