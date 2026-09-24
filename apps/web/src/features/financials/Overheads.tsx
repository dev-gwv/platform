import { useMemo, useState } from 'react'
import { Building2, Pencil, Plus, Trash2 } from 'lucide-react'
import type { FixedOverhead } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { useConfirm } from '@/shared/ui/confirm'
import { formatINR } from '@/shared/ui/format'
import { useCreateFixedOverhead, useDeleteFixedOverhead, useFixedOverheads, useUpdateFixedOverhead } from './api'

const CATS = ['rent', 'salaries', 'utilities', 'internet', 'software', 'insurance', 'maintenance', 'marketing', 'other'] as const
type Cat = (typeof CATS)[number]
const CAT_LABEL: Record<Cat, string> = {
  rent: 'Rent',
  salaries: 'Salaries (not on payroll)',
  utilities: 'Electricity & water',
  internet: 'Internet & phone',
  software: 'Software',
  insurance: 'Insurance',
  maintenance: 'Maintenance',
  marketing: 'Marketing',
  other: 'Other',
}

const firstOfMonth = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`

/**
 * The studio's fixed monthly costs -- rent, internet, software -- entered per
 * month. They are the "Fixed overheads" line of the Profit & Loss. "Copy last
 * month" saves retyping the same rent every month.
 */
export function OverheadsCard() {
  const months = useMemo(() => {
    const now = new Date()
    return Array.from({ length: 15 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + 2 - i, 1)
      return { value: firstOfMonth(d), label: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) }
    })
  }, [])
  const [month, setMonth] = useState(firstOfMonth())
  const prevMonth = useMemo(() => {
    const d = new Date(`${month}T00:00:00`)
    return firstOfMonth(new Date(d.getFullYear(), d.getMonth() - 1, 1))
  }, [month])
  const list = useFixedOverheads(month)
  const last = useFixedOverheads(prevMonth)
  const create = useCreateFixedOverhead()
  const [editing, setEditing] = useState<FixedOverhead | 'new' | null>(null)
  const rows = list.data ?? []
  const total = rows.filter((r) => r.is_active).reduce((s, r) => s + r.amount, 0)

  async function copyLast() {
    for (const r of last.data ?? []) {
      await create.mutateAsync({ category: r.category as Cat, label: r.label, amount: r.amount, alloc_basis: 'equal', month })
    }
  }

  return (
    <Card id="overheads">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Building2 className="size-4 text-tone-violet" aria-hidden /> Fixed overheads
          </p>
          <Select aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44">
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Rent, internet, software — what the studio pays every month whatever the work.</p>

        <ul className="mt-3 divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.label || CAT_LABEL[r.category as Cat] || r.category}</span>
                {r.label && <span className="block text-xs text-muted-foreground">{CAT_LABEL[r.category as Cat] ?? r.category}</span>}
              </span>
              <span className="tabular-nums">{formatINR(r.amount)}</span>
              <Button size="icon" variant="ghost" className="size-8" aria-label={`Edit ${r.label || r.category}`} onClick={() => setEditing(r)}>
                <Pencil />
              </Button>
              <DeleteOverhead r={r} />
            </li>
          ))}
        </ul>
        {rows.length === 0 && !list.isLoading && (
          <p className="mt-2 rounded-lg border border-dashed border-border px-3 py-3 text-center text-sm text-muted-foreground">
            Nothing for this month yet.
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <span className="text-sm">
            Total <span className="font-semibold tabular-nums">{formatINR(total)}</span>
          </span>
          <span className="flex gap-2">
            {rows.length === 0 && (last.data?.length ?? 0) > 0 && (
              <Button size="sm" variant="outline" disabled={create.isPending} onClick={() => void copyLast()}>
                Copy last month ({formatINR((last.data ?? []).reduce((s, r) => s + r.amount, 0))})
              </Button>
            )}
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus /> Add
            </Button>
          </span>
        </div>
      </CardContent>
      {editing && <OverheadDialog month={month} editing={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
    </Card>
  )
}

function DeleteOverhead({ r }: { r: FixedOverhead }) {
  const del = useDeleteFixedOverhead()
  const confirm = useConfirm()
  return (
    <Button
      size="icon"
      variant="ghost"
      className="size-8 text-muted-foreground hover:text-destructive"
      aria-label={`Delete ${r.label || r.category}`}
      disabled={del.isPending}
      onClick={async () => {
        if (await confirm({ title: `Delete "${r.label || r.category}"?`, destructive: true, confirmLabel: 'Delete' })) del.mutate(r.id)
      }}
    >
      <Trash2 />
    </Button>
  )
}

function OverheadDialog({ month, editing, onDone }: { month: string; editing: FixedOverhead | null; onDone: () => void }) {
  const create = useCreateFixedOverhead()
  const update = useUpdateFixedOverhead()
  const [category, setCategory] = useState<Cat>((editing?.category as Cat) ?? 'rent')
  const [label, setLabel] = useState(editing?.label ?? '')
  const [amount, setAmount] = useState(editing ? String(editing.amount) : '')
  const busy = create.isPending || update.isPending
  const n = Number(amount)

  function save() {
    if (!(n > 0)) return
    const body = { category, label: label.trim() || null, amount: n, alloc_basis: 'equal' as const, month }
    if (editing) update.mutate({ id: editing.id, patch: body }, { onSuccess: onDone })
    else create.mutate(body, { onSuccess: onDone })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onDone()}>
      <DialogContent title={editing ? 'Edit overhead' : 'Add a monthly overhead'} className="max-w-sm">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <label className="flex flex-col gap-1.5">
            <Label>What for</Label>
            <Select value={category} onChange={(e) => setCategory(e.target.value as Cat)}>
              {CATS.map((c) => (
                <option key={c} value={c}>
                  {CAT_LABEL[c]}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <Label>Name (optional)</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Studio rent, Adobe" />
          </label>
          <label className="flex flex-col gap-1.5">
            <Label>Amount this month</Label>
            <Input type="number" min={1} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="₹" autoFocus />
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !(n > 0)}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
