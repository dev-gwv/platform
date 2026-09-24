import { useState } from 'react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Input, Select } from '@/shared/ui/input'
import { useClients } from '@/features/clients/api'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'
import { ErrorState } from '@/shared/ui/states'
import {
  useProjectTemplates,
  useSaveProjectTemplate,
  useDeleteProjectTemplate,
  useApplyProjectTemplate,
} from '@/features/project-templates/api'
import {
  useShootTypes,
  useCreateShootType,
  useDeliverableTemplates,
  useCreateDeliverableTemplate,
  useWorkflowPresets,
  useCreateWorkflowPreset,
} from '@/features/projects/api'
import { type CreateProjectTemplateRequest } from '@ipc/contracts'
import { Plus, Trash2, Copy, Package, Camera, ListChecks, Calendar, Sparkles } from 'lucide-react'

function ProjectTemplatesContent() {
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

  const { data, isLoading, isError, refetch } = useProjectTemplates()
  const saveTemplate = useSaveProjectTemplate()
  const deleteTemplate = useDeleteProjectTemplate()
  const applyTemplate = useApplyProjectTemplate()
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
      { onSuccess: () => setApplyDialogOpen(false) },
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
    if (!form.name.trim()) return
    saveTemplate.mutate(
      { id: editingId ?? undefined, body: form },
      { onSuccess: () => setDialogOpen(false) },
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Project Templates"
        description="Create reusable project configurations"
        actions={
          <Button onClick={openCreate} size="sm">
            <Plus className="mr-1 h-4 w-4" /> New Template
          </Button>
        }
      />

      <CatalogManagers />

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">Loading…</div>
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => (
          <Card key={template.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{template.name}</CardTitle>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openApply(template.id)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(template)}>
                    <Package className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteTemplate.mutate(template.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
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
            </CardContent>
          </Card>
        ))}
        {templates.length === 0 && (
          <div className="col-span-full py-12 text-center text-muted-foreground">
            No templates yet. Create one to speed up project setup.
          </div>
        )}
      </div>
      )}

      {/* Create/Edit Template Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" title={editingId ? 'Edit Template' : 'New Template'}>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Template Name</label>
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
                  <Input
                    placeholder="Kind (e.g. wedding)"
                    className="w-32"
                    value={s.kind ?? ''}
                    onChange={(e) => {
                      const shoots = [...form.shoots_json]
                      shoots[i] = { ...s, kind: e.target.value || null }
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
            <Button onClick={handleSubmit} disabled={!form.name.trim() || saveTemplate.isPending}>
              {saveTemplate.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Apply Template Dialog */}
      <Dialog open={applyDialogOpen} onOpenChange={setApplyDialogOpen}>
        <DialogContent title="Create Project from Template">
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

/** Granular catalog: shoot types, deliverable templates and workflow presets. */
function CatalogManagers() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ShootTypeManager />
      <DeliverableTemplateManager />
      <WorkflowPresetManager />
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
          <Calendar className="h-4 w-4 text-primary" /> Shoot types
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">Reusable shoot names for the create-project wizard.</p>
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

function DeliverableTemplateManager() {
  const { data } = useDeliverableTemplates()
  const create = useCreateDeliverableTemplate()
  const [title, setTitle] = useState('')
  const [shootType, setShootType] = useState('')
  const items = (data ?? []).filter((t) => !t.is_archived)

  async function onAdd() {
    if (!title.trim()) return
    await create.mutateAsync({ title: title.trim(), ...(shootType.trim() ? { shoot_type: shootType.trim() } : {}) })
    setTitle('')
    setShootType('')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Package className="h-4 w-4 text-primary" /> Deliverable templates
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">Suggestions offered when planning deliverables.</p>
        <div className="mt-2 flex gap-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Wedding Teaser" aria-label="Deliverable title" />
          <Button size="sm" onClick={() => void onAdd()} disabled={!title.trim() || create.isPending}>
            <Plus /> Add
          </Button>
        </div>
        <Input value={shootType} onChange={(e) => setShootType(e.target.value)} placeholder="Shoot type (optional)" aria-label="Deliverable shoot type" className="mt-2" />
        <ul className="mt-2 flex max-h-44 flex-col gap-1 overflow-y-auto">
          {items.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5 text-sm">
              <span className="min-w-0 truncate">{t.title}{t.shoot_type && <span className="ml-1.5 text-xs text-muted-foreground">{t.shoot_type}</span>}</span>
              {t.is_combined && <Badge variant="secondary">Combined</Badge>}
            </li>
          ))}
          {items.length === 0 && <li className="py-3 text-center text-xs text-muted-foreground">No deliverable templates yet.</li>}
        </ul>
      </CardContent>
    </Card>
  )
}

function WorkflowPresetManager() {
  const { data } = useWorkflowPresets()
  const create = useCreateWorkflowPreset()
  const [name, setName] = useState('')
  const [shootType, setShootType] = useState('')
  const items = (data ?? []).filter((t) => !t.is_archived)

  async function onAdd() {
    if (!name.trim() || !shootType.trim()) return
    await create.mutateAsync({ name: name.trim(), shoot_type: shootType.trim() })
    setName('')
    setShootType('')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" /> Workflow presets
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">One-click shoot setups: requirements and deliverables together.</p>
        <div className="mt-2 flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Haldi Complete" aria-label="Preset name" />
          <Button size="sm" onClick={() => void onAdd()} disabled={!name.trim() || !shootType.trim() || create.isPending}>
            <Plus /> Add
          </Button>
        </div>
        <Input value={shootType} onChange={(e) => setShootType(e.target.value)} placeholder="Shoot type" aria-label="Preset shoot type" className="mt-2" />
        <ul className="mt-2 flex max-h-44 flex-col gap-1 overflow-y-auto">
          {items.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5 text-sm">
              <span className="min-w-0 truncate">{t.name}<span className="ml-1.5 text-xs text-muted-foreground">{t.shoot_type}</span></span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{t.requirements.length + t.deliverables.length} items</span>
            </li>
          ))}
          {items.length === 0 && <li className="py-3 text-center text-xs text-muted-foreground">No presets yet.</li>}
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
