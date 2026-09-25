import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { StatCard } from '@/shared/ui/stat-card'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Select } from '@/shared/ui/select'
import {
  type ReminderFilters,
  useReminders,
  useSaveReminder,
  useUpdateReminderStatus,
  useDeleteReminder,
} from '@/features/reminders/api'
import { useLeads } from '@/features/crm/api'
import { useProjects } from '@/features/projects/api'
import { useClients } from '@/features/clients/api'
import { useInvoices } from '@/features/billing/api'
import { useEnquiries } from '@/features/enquiries/api'
import { useTasks } from '@/features/tasks/api'
import { useMembers } from '@/features/allocation/api'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useQuery } from '@tanstack/react-query'
import { shootListItem, type CreateReminderRequest, type ReminderEntityType } from '@ipc/contracts'
import { Plus, Trash2, CheckCircle, Clock, AlertTriangle, Bell, Link2 } from 'lucide-react'

const shootsList = shootListItem.array()

/** No dedicated hook exists outside the shoots route — a plain picker query is enough here. */
function useShootsPicker(enabled: boolean) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['shoots'],
    queryFn: () => callApi('/shoots', { responseSchema: shootsList }),
    enabled: !!session && enabled,
    staleTime: 30_000,
  })
}

const ENTITY_LINK: Partial<
  Record<ReminderEntityType, (id: string) => { to: string; params: Record<string, string>; search?: Record<string, string> }>
> = {
  project: (id) => ({ to: '/projects/$id', params: { id } }),
  lead: (id) => ({ to: '/follow-ups', params: {}, search: { lead: id } }),
}

/** Which entity is picked determines which list is fetched — no point loading all four. */
function EntityPicker({
  entityType,
  entityId,
  onChangeId,
}: {
  entityType: ReminderEntityType | null | undefined
  entityId: string | null | undefined
  onChangeId: (id: string | null) => void
}) {
  const leads = useLeads()
  const projects = useProjects()
  const clients = useClients()
  const invoices = useInvoices()
  const enquiries = useEnquiries({})
  const tasks = useTasks()
  const shoots = useShootsPicker(entityType === 'shoot')

  // A deliverable is linked from its own card ("Remind me"), not picked from
  // a list here; that link is kept as it is. Anything without a list of its
  // own used to fall through to the shoots list below.
  if (!entityType || entityType === 'custom' || entityType === 'general' || entityType === 'deliverable') return null

  const options =
    entityType === 'lead'
      ? (leads.data ?? []).map((l) => ({ id: l.id, label: l.name ?? l.phone ?? 'Unnamed deal' }))
      : entityType === 'project'
        ? (projects.data ?? []).map((p) => ({ id: p.id, label: p.name }))
        : entityType === 'client'
          ? (Array.isArray(clients.data) ? clients.data : []).map((c) => ({ id: c.id, label: c.name }))
          : entityType === 'invoice'
            ? (invoices.data?.items ?? []).map((i) => ({ id: i.id, label: i.invoice_number }))
            : entityType === 'enquiry'
              ? (enquiries.data?.pages.flatMap((p) => p.items) ?? []).map((e) => ({ id: e.id, label: e.name }))
              : entityType === 'task'
                ? (tasks.data ?? []).map((t) => ({ id: t.id, label: t.title }))
                : (shoots.data ?? []).map((s) => ({ id: s.id, label: s.name }))

  return (
    <div>
      <label className="text-sm font-medium">Linked {entityType}</label>
      <Select value={entityId ?? ''} onChange={(e) => onChangeId(e.target.value || null)}>
        <option value="">Select…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  )
}

function RemindersContent() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CreateReminderRequest>({
    title: '',
    description: null,
    priority: 'medium',
    entity_type: null,
    entity_id: null,
    due_at: null,
    assigned_to: null,
  })

  const { session } = useAuth()
  // The board listed everything, always. The API has taken a status,
  // priority, entity, due range and overdue-only filter since 0107.
  const [filters, setFilters] = useState<ReminderFilters>({})
  const { data } = useReminders(filters)
  const setFilter = (patch: Partial<ReminderFilters>) => setFilters((f) => ({ ...f, ...patch }))
  const anyFilter =
    !!filters.status || !!filters.priority || !!filters.entity_type || !!filters.due_from || !!filters.due_to || !!filters.overdue
  const saveReminder = useSaveReminder()
  const updateStatus = useUpdateReminderStatus()
  const deleteReminder = useDeleteReminder()
  const members = useMembers()
  const memberName = (id: string | null) => members.data?.find((m) => m.user_id === id)?.name ?? null

  const items = data?.items ?? []
  const summary = data?.summary

  function openCreate() {
    setEditingId(null)
    setForm({ title: '', description: null, priority: 'medium', entity_type: null, entity_id: null, due_at: null, assigned_to: null })
    setDialogOpen(true)
  }

  function openEdit(reminder: (typeof items)[0]) {
    setEditingId(reminder.id)
    setForm({
      title: reminder.title,
      description: reminder.description,
      priority: reminder.priority as CreateReminderRequest['priority'],
      entity_type: reminder.entity_type as CreateReminderRequest['entity_type'],
      entity_id: reminder.entity_id,
      due_at: reminder.due_at,
      // Prefill with the current owner so re-saving doesn't silently reassign it to whoever opened the dialog.
      assigned_to: reminder.user_id,
    })
    setDialogOpen(true)
  }

  function handleSubmit() {
    if (!form.title.trim()) return
    saveReminder.mutate(
      { id: editingId ?? undefined, body: form },
      { onSuccess: () => setDialogOpen(false) },
    )
  }

  const priorityTone: Record<string, 'neutral' | 'info' | 'warning' | 'danger'> = {
    low: 'neutral',
    medium: 'info',
    high: 'warning',
    urgent: 'danger',
  }

  const priorityIcons = {
    low: <Clock className="h-3 w-3" />,
    medium: <Bell className="h-3 w-3" />,
    high: <AlertTriangle className="h-3 w-3" />,
    urgent: <AlertTriangle className="h-3 w-3" />,
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reminders"
        description="Manage your reminders and tasks"
        actions={
          <Button onClick={openCreate} size="sm">
            <Plus className="mr-1 h-4 w-4" /> New Reminder
          </Button>
        }
      />

      {/* Narrow the board down to the ones being asked about. */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="rf-status">
            Status
          </label>
          <Select
            id="rf-status"
            value={filters.status ?? ''}
            onChange={(e) => setFilter({ status: e.target.value || undefined })}
            className="w-36"
          >
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="dismissed">Dismissed</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="rf-priority">
            Priority
          </label>
          <Select
            id="rf-priority"
            value={filters.priority ?? ''}
            onChange={(e) => setFilter({ priority: e.target.value || undefined })}
            className="w-36"
          >
            <option value="">Any priority</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="rf-entity">
            Linked to
          </label>
          <Select
            id="rf-entity"
            value={filters.entity_type ?? ''}
            onChange={(e) => setFilter({ entity_type: e.target.value || undefined })}
            className="w-36"
          >
            <option value="">Any entity</option>
            <option value="lead">Lead</option>
            <option value="project">Project</option>
            <option value="client">Client</option>
            <option value="invoice">Invoice</option>
            <option value="enquiry">Enquiry</option>
            <option value="task">Task</option>
            <option value="shoot">Shoot</option>
            <option value="deliverable">Deliverable</option>
            <option value="custom">Not linked</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="rf-from">
            Due from
          </label>
          <Input
            id="rf-from"
            type="date"
            className="w-40"
            value={(filters.due_from ?? '').slice(0, 10)}
            onChange={(e) => setFilter({ due_from: e.target.value || undefined })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="rf-to">
            Due to
          </label>
          <Input
            id="rf-to"
            type="date"
            className="w-40"
            value={(filters.due_to ?? '').slice(0, 10)}
            onChange={(e) => setFilter({ due_to: e.target.value || undefined })}
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={filters.overdue ?? false}
            onChange={(e) => setFilter({ overdue: e.target.checked || undefined })}
          />
          Overdue only
        </label>
        {anyFilter && (
          <Button variant="ghost" size="sm" className="mb-1" onClick={() => setFilters({})}>
            Clear
          </Button>
        )}
      </div>

      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total" value={summary.total_count} icon={Bell} />
          <StatCard label="Active" value={summary.active_count} icon={Clock} />
          <StatCard label="Overdue" value={summary.overdue_count} icon={AlertTriangle} />
          <StatCard label="Due Today" value={summary.due_today_count} icon={CheckCircle} />
        </div>
      )}

      <div className="space-y-2">
        {items.map((reminder) => (
          <div
            key={reminder.id}
            className="flex items-center justify-between rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <StatusBadge tone={priorityTone[reminder.priority] ?? 'neutral'} className="gap-1">
                  {priorityIcons[reminder.priority]}
                  {reminder.priority}
                </StatusBadge>
                <span className="font-medium">{reminder.title}</span>
                {reminder.user_id !== session?.user_id && (
                  <StatusBadge tone="info">for {memberName(reminder.user_id) ?? 'someone else'}</StatusBadge>
                )}
              </div>
              {reminder.description && (
                <p className="mt-1 truncate text-sm text-muted-foreground">{reminder.description}</p>
              )}
              {reminder.due_at && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Due: {new Date(reminder.due_at).toLocaleDateString()}
                </p>
              )}
              {reminder.entity_type && reminder.entity_name && (
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Link2 className="h-3 w-3" />
                  {(() => {
                    const link = reminder.entity_id && ENTITY_LINK[reminder.entity_type]?.(reminder.entity_id)
                    return link ? (
                      <Link to={link.to} params={link.params} search={link.search as never} className="hover:underline">
                        {reminder.entity_name}
                      </Link>
                    ) : (
                      <span>{reminder.entity_name}</span>
                    )
                  })()}
                  <span>({reminder.entity_type})</span>
                </p>
              )}
            </div>
            <div className="flex items-center gap-1">
              {reminder.status === 'active' && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-green-600"
                  onClick={() => updateStatus.mutate({ id: reminder.id, status: 'completed' })}
                >
                  <CheckCircle className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(reminder)}>
                <Clock className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive"
                onClick={() => { if (confirm('Delete this reminder?')) deleteReminder.mutate(reminder.id) }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">No reminders yet.</div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent title={editingId ? 'Edit Reminder' : 'New Reminder'}>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Title</label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="What do you need to remember?"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Input
                value={form.description ?? ''}
                onChange={(e) => setForm({ ...form, description: e.target.value || null })}
                placeholder="Optional details"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Priority</label>
              <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as CreateReminderRequest['priority'] })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Due Date</label>
              <Input
                type="datetime-local"
                value={form.due_at ? new Date(form.due_at).toISOString().slice(0, 16) : ''}
                onChange={(e) => setForm({ ...form, due_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Assign to</label>
              <Select
                value={form.assigned_to ?? ''}
                onChange={(e) => setForm({ ...form, assigned_to: e.target.value || null })}
              >
                <option value="">Myself</option>
                {(members.data ?? []).map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Link to (optional)</label>
              <Select
                value={form.entity_type ?? ''}
                onChange={(e) => {
                  const next = (e.target.value || null) as ReminderEntityType | null
                  setForm({ ...form, entity_type: next, entity_id: null })
                }}
              >
                <option value="">Nothing — just a note</option>
                <option value="lead">A deal</option>
                <option value="project">A project</option>
                <option value="client">A client</option>
                <option value="invoice">An invoice</option>
                <option value="enquiry">An enquiry</option>
                <option value="task">A task</option>
                <option value="shoot">A shoot</option>
                {/* Only ever set from a deliverable's own card, so only shown
                    when editing one — otherwise the box would read "Nothing". */}
                {form.entity_type === 'deliverable' && <option value="deliverable">A deliverable</option>}
              </Select>
            </div>
            <EntityPicker
              entityType={form.entity_type}
              entityId={form.entity_id}
              onChangeId={(id) => setForm({ ...form, entity_id: id })}
            />
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={!form.title.trim() || saveReminder.isPending}>
              {saveReminder.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function RemindersPage() {
  return (
    <AuthedPage module="dashboard">
      <RemindersContent />
    </AuthedPage>
  )
}
