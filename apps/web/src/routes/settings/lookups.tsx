import { useMemo, useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { Switch } from '@/shared/ui/switch'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { cn } from '@/shared/ui/cn'
import { TONES, TONE_BG, toneVar, type ToneName } from '@/shared/ui/tones'
import { useCustomLookups, useCreateCustomLookup, useUpdateCustomLookup, useDeleteCustomLookup } from '@/features/settings/api'
import { prettyWord } from '@/features/crm/fields'
import { sourceLabel } from '@/features/reports/csv'

/**
 * A stored word in the words a studio uses: "google_form" reads "Google Form"
 * and "csv_import" "Imported", the way Leads and Reports name them; a word the
 * studio typed stays as typed.
 */
function wordLabel(category: string, value: string): string {
  if (category.endsWith('_source') && /^[a-z0-9_]+$/.test(value)) return sourceLabel(value)
  return prettyWord(value)
}

// Every list a studio can grow. Invoice lines and currencies were only on the
// System tab's old "Custom Lookups" card; they live here now, with the rest.
const CATEGORIES = [
  { value: 'lead_source', label: 'Lead sources' },
  { value: 'lead_quality', label: 'Lead quality' },
  { value: 'follow_up_type', label: 'Follow-up types' },
  { value: 'follow_up_priority', label: 'Follow-up priorities' },
  { value: 'enquiry_source', label: 'Enquiry sources' },
  { value: 'enquiry_status', label: 'Enquiry statuses' },
  { value: 'payment_type', label: 'Payment types' },
  { value: 'expense_category', label: 'Expense categories' },
  { value: 'project_type', label: 'Project types' },
  { value: 'invoice_line_preset', label: 'Invoice lines' },
  { value: 'currency', label: 'Currencies' },
] as const

const SEEDS: Record<string, string[]> = {
  lead_source: ['Instagram', 'Referral', 'Walk-in', 'Google', 'Facebook'],
  lead_quality: ['hot', 'warm', 'cold'],
  follow_up_type: ['Call', 'WhatsApp', 'Meeting', 'Site visit'],
  follow_up_priority: ['High', 'Normal', 'Low'],
  enquiry_source: ['Instagram', 'Website', 'Referral', 'Walk-in'],
  enquiry_status: ['New', 'Contacted', 'Booked', 'Lost'],
  payment_type: ['UPI', 'Cash', 'Bank Transfer', 'Card'],
  expense_category: ['Travel', 'Food', 'Equipment', 'Salary'],
  project_type: ['Wedding', 'Pre-wedding', 'Maternity', 'Event'],
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
  const isMobile = useIsMobile()
  const [form, setForm] = useState<{ id: string | null; label: string; color: ToneName | null; sort: number; active: boolean } | null>(null)

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
    toast.success(made > 0 ? `Added ${made} usual word${made === 1 ? '' : 's'}.` : 'The usual words are already on this list.')
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
      description: 'Old records that use it may lose it. To keep them, press Hide instead. This cannot be undone.',
      confirmLabel: 'Delete permanently',
      destructive: true,
    })
    if (yes) del.mutate(id)
  }

  async function submit() {
    if (!form || !form.label.trim()) {
      toast.error('Type a name first.')
      return
    }
    try {
      if (form.id) {
        await update.mutateAsync({
          id: form.id,
          patch: { value: form.label.trim(), sort_order: form.sort, is_active: form.active, color: form.color },
        })
      } else {
        await create.mutateAsync({ category, value: form.label.trim(), sort_order: form.sort, color: form.color })
      }
      setForm(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save.')
    }
  }

  return (
    <>
      <PageHeader
        title="Lists"
        actions={
          <Button size="sm" onClick={() => setForm({ id: null, label: '', color: null, sort: rows.length, active: true })}>
            <Plus /> Add
          </Button>
        }
      />
      {/* Eleven lists: a wrapping row of chips on a wide screen, one picker on
          a phone (the strip that scrolled sideways hid most of them). */}
      {isMobile ? (
        <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Which list" className="mb-4 w-full">
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      ) : (
        <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Which list">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              role="tab"
              aria-selected={category === c.value}
              onClick={() => setCategory(c.value)}
              className={cn(
                'whitespace-nowrap rounded-full border px-3 py-1 text-sm transition-colors',
                category === c.value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {q.isLoading ? (
        <SkeletonCards count={3} />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-4">
            <EmptyState title="Nothing on this list yet" description="Start with the usual words, or press Add for your own." />
            {(SEEDS[category]?.length ?? 0) > 0 && (
              <div className="mt-3 flex justify-center">
                <Button size="sm" variant="outline" onClick={() => void seed()}>Add the usual words</Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4">
            <ul className="flex flex-col gap-2">
              {rows.map((r) => (
                <li key={r.id} className={`flex items-center gap-3 rounded-lg border border-border p-3 ${r.is_active ? '' : 'opacity-60'}`}>
                  <span className="h-3 w-3 shrink-0 rounded-full border border-border" style={{ background: r.color ? toneVar(r.color as ToneName) : 'var(--muted)' }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{wordLabel(category, r.value)}</p>
                      {!r.is_active && <StatusBadge tone="neutral">Hidden</StatusBadge>}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" aria-label={`Edit ${wordLabel(category, r.value)}`} title="Edit" onClick={() => setForm({ id: r.id, label: r.value, color: (TONES as readonly string[]).includes(r.color ?? '') ? (r.color as ToneName) : null, sort: r.sort_order, active: r.is_active })}>
                    <Pencil />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => toggleActive(r.id, r.is_active, r.value)} title={r.is_active ? 'Hide it from new pickers; old records keep it' : 'Show it in pickers again'}>
                    {r.is_active ? 'Hide' : 'Show'}
                  </Button>
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" aria-label={`Delete ${wordLabel(category, r.value)}`} title="Delete" onClick={() => void hardDelete(r.id, wordLabel(category, r.value))}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {form && (
        <Dialog open onOpenChange={(o) => { if (!o) setForm(null) }}>
          <DialogContent title={form.id ? 'Edit' : `Add to ${CATEGORIES.find((c) => c.value === category)?.label.toLowerCase() ?? 'this list'}`}>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Name</Label>
                <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Walk-in" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Colour</Label>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
                    {TONES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        role="radio"
                        aria-checked={form.color === t}
                        aria-label={t}
                        title={t}
                        onClick={() => setForm({ ...form, color: form.color === t ? null : t })}
                        className={cn(
                          'size-6 rounded-full border-2',
                          TONE_BG[t],
                          form.color === t ? 'border-foreground ring-2 ring-ring/40' : 'border-card',
                        )}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Place in the list</Label>
                  <Input type="number" value={form.sort} onChange={(e) => setForm({ ...form, sort: Number(e.target.value) || 0 })} />
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <Switch checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Show in pickers" description="Off hides it from new picks; old records keep it." />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
                <Button onClick={() => void submit()} disabled={create.isPending || update.isPending}>
                  {form.id ? 'Save' : 'Add'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
