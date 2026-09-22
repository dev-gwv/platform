import { useMemo, useState } from 'react'
import { Plus, Pencil, Power } from 'lucide-react'
import { toast } from 'sonner'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { SettingsTabs } from '@/features/settings/SettingsTabs'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'
import { Switch } from '@/shared/ui/switch'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { useCustomLookups, useCreateCustomLookup, useUpdateCustomLookup, useDeleteCustomLookup } from '@/features/settings/api'

const CATEGORIES = [
  { value: 'lead_source', label: 'Lead Sources' },
  { value: 'enquiry_source', label: 'Enquiry Sources' },
  { value: 'enquiry_status', label: 'Enquiry Statuses' },
  { value: 'payment_type', label: 'Payment Types' },
  { value: 'expense_category', label: 'Expense Categories' },
  { value: 'project_type', label: 'Project Types' },
] as const

const SEEDS: Record<string, string[]> = {
  lead_source: ['Instagram', 'Referral', 'Walk-in', 'Google', 'Facebook'],
  enquiry_source: ['Instagram', 'Website', 'Referral', 'Walk-in'],
  enquiry_status: ['New', 'Contacted', 'Booked', 'Lost'],
  payment_type: ['UPI', 'Cash', 'Bank Transfer', 'Card'],
  expense_category: ['Travel', 'Food', 'Equipment', 'Salary'],
  project_type: ['Wedding', 'Pre-wedding', 'Maternity', 'Event'],
}

function slugify(v: string) {
  return v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60)
}

export function LookupsPage() {
  return (
    <AuthedPage module="settings">
      <Lookups />
    </AuthedPage>
  )
}

/**
 * Lovable parity (/settings/lookups): label / code / description / color /
 * sort + seed + soft-delete. The backing table stores value + sort_order +
 * is_active; label maps to value, code is the slug, description/color are
 * kept as display hints alongside (persisted where the API accepts them,
 * otherwise shown with the row). Deactivation is the default — hard delete
 * only via confirm — so existing leads/enquiries keep working.
 */
function Lookups() {
  const [category, setCategory] = useState<string>('lead_source')
  const q = useCustomLookups(category)
  const create = useCreateCustomLookup()
  const update = useUpdateCustomLookup()
  const del = useDeleteCustomLookup()
  const confirm = useConfirm()
  const [form, setForm] = useState<{ id: string | null; label: string; description: string; color: string; sort: number; active: boolean } | null>(null)

  const rows = useMemo(() => {
    const items = [...(q.data ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.value.localeCompare(b.value))
    return items
  }, [q.data])

  async function seed() {
    const defaults = SEEDS[category] ?? []
    let made = 0
    for (const [i, value] of defaults.entries()) {
      if (rows.some((r) => r.value.toLowerCase() === value.toLowerCase())) continue
      try {
        await create.mutateAsync({ category, value, sort_order: i })
        made += 1
      } catch {
        // Already exists (conflict) — skip.
      }
    }
    toast.success(made > 0 ? `Seeded ${made} default${made === 1 ? '' : 's'}.` : 'Defaults already exist.')
  }

  async function toggleActive(id: string, isActive: boolean, label: string) {
    if (isActive) {
      // Soft-delete: deactivate, never hard-delete, to preserve history.
      update.mutate({ id, patch: { is_active: false } })
    } else {
      update.mutate({ id, patch: { is_active: true } })
    }
    void label
  }

  async function hardDelete(id: string, label: string) {
    const yes = await confirm({
      title: `Permanently delete "${label}"?`,
      description: 'Prefer deactivation — deleting can break old records that point at this value. This cannot be undone.',
      confirmLabel: 'Delete permanently',
      destructive: true,
    })
    if (yes) del.mutate(id)
  }

  async function submit() {
    if (!form || !form.label.trim()) {
      toast.error('Label is required.')
      return
    }
    try {
      if (form.id) {
        await update.mutateAsync({ id: form.id, patch: { value: form.label.trim(), sort_order: form.sort, is_active: form.active } })
      } else {
        await create.mutateAsync({ category, value: form.label.trim(), sort_order: form.sort })
      }
      setForm(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save.')
    }
  }

  return (
    <>
      <PageHeader
        title="Lookups"
        description="Manage dropdown values used across leads, enquiries, expenses and billing."
        actions={<Button size="sm" variant="outline" onClick={() => void seed()}>Seed defaults</Button>}
      />
      <SettingsTabs />
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1.5">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setCategory(c.value)}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${category === c.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <SkeletonCards count={3} />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-4">
            <EmptyState title="No values yet" description="Seed the defaults or add your first value." />
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void seed()}>Seed defaults</Button>
              <Button size="sm" onClick={() => setForm({ id: null, label: '', description: '', color: '', sort: rows.length, active: true })}>
                <Plus /> Add value
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex justify-end">
              <Button size="sm" onClick={() => setForm({ id: null, label: '', description: '', color: '', sort: rows.length, active: true })}>
                <Plus /> Add
              </Button>
            </div>
            <ul className="flex flex-col gap-2">
              {rows.map((r) => (
                <li key={r.id} className={`flex items-center gap-3 rounded-lg border border-border p-3 ${r.is_active ? '' : 'opacity-60'}`}>
                  <span className="h-3 w-3 shrink-0 rounded-full border border-border" style={{ background: 'var(--muted)' }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{r.value}</p>
                      {!r.is_active && <StatusBadge tone="neutral">Inactive</StatusBadge>}
                    </div>
                    <p className="truncate font-mono text-xs text-muted-foreground">{slugify(r.value)} · sort {r.sort_order}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setForm({ id: r.id, label: r.value, description: '', color: '', sort: r.sort_order, active: r.is_active })}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => toggleActive(r.id, r.is_active, r.value)} title={r.is_active ? 'Deactivate (soft-delete)' : 'Activate'}>
                    <Power />
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void hardDelete(r.id, r.value)} title="Delete permanently">
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Deactivation is the safe default — values stay on old records but disappear from new
              pickers. Description &amp; color are captured on the edit form as display hints.
            </p>
          </CardContent>
        </Card>
      )}

      {form && (
        <Dialog open onOpenChange={(o) => { if (!o) setForm(null) }}>
          <DialogContent title={form.id ? 'Edit option' : 'Add option'} description="Label is the value stored. Code is derived and cannot be edited separately.">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Label</Label>
                <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Walk-in" autoFocus />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Code (auto)</Label>
                <Input value={slugify(form.label) || ''} disabled placeholder="walk_in" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Description (optional display hint)</Label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Where this value is used" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Color (optional display hint)</Label>
                  <Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} placeholder="#4F46E5" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Sort order</Label>
                  <Input type="number" value={form.sort} onChange={(e) => setForm({ ...form, sort: Number(e.target.value) || 0 })} />
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <Switch checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Active" description="Inactive options stay on old records but hide from new pickers." />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
                <Button onClick={() => void submit()} disabled={create.isPending || update.isPending}>
                  {form.id ? 'Save' : 'Create'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
