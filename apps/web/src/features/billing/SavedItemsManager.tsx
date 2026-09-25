import { useState } from 'react'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import type { GstSlab } from '@ipc/domain'
import type { InvoiceItemPreset, UpsertInvoiceItemPresetRequest } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { formatINR } from '@/shared/ui/format'
import { useConfirm } from '@/shared/ui/confirm'
import { useAccess } from '@/shared/auth/useAccess'
import { useDeleteInvoiceItem, useInvoiceItems, useSaveInvoiceItem } from './api'
import { GST_SLABS } from './InvoiceForm'
import { HsnSearchDialog } from './HsnSearchDialog'

const blank = (): UpsertInvoiceItemPresetRequest => ({ name: '', description: '', rate: 0, hsn_sac: '', gst_rate: 18, kind: 'service' })

/**
 * The studio's catalogue: what it bills again and again, each with its rate,
 * HSN/SAC and GST, so a line on an invoice is one pick, not four fields typed
 * from memory.
 */
export function SavedItemsManager() {
  const { data, isLoading } = useInvoiceItems()
  const save = useSaveInvoiceItem()
  const del = useDeleteInvoiceItem()
  const confirm = useConfirm()
  const access = useAccess()
  const [editing, setEditing] = useState<{ id?: string; body: UpsertInvoiceItemPresetRequest } | null>(null)
  const [rateText, setRateText] = useState('')
  const [hsnOpen, setHsnOpen] = useState(false)
  const [q, setQ] = useState('')
  const items = (data ?? []).filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()))

  function open(p?: InvoiceItemPreset) {
    const body = p
      ? { name: p.name, description: p.description ?? '', rate: p.rate, hsn_sac: p.hsn_sac ?? '', gst_rate: p.gst_rate as GstSlab, kind: p.kind }
      : blank()
    setEditing(p ? { id: p.id, body } : { body })
    setRateText(p?.rate ? String(p.rate) : '')
  }

  async function onSave() {
    if (!editing) return
    await save.mutateAsync({ id: editing.id, body: { ...editing.body, rate: Number(rateText) || 0 } })
    setEditing(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Items you bill often. Pick one into an invoice line and its rate, HSN/SAC and tax come with it.</p>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items" className="w-48 pl-9" aria-label="Search items" />
          </div>
          {access.hasAction('billing', 'create') && (
            <Button size="sm" onClick={() => open()}>
              <Plus /> New item
            </Button>
          )}
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-semibold">Item</th>
              <th className="px-3 py-2 font-semibold">HSN / SAC</th>
              <th className="px-3 py-2 font-semibold">GST</th>
              <th className="px-3 py-2 text-right font-semibold">Rate</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Loading…</td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  No saved items yet. Add one here, or tap “Save as a reusable item” under a line on any invoice.
                </td>
              </tr>
            ) : (
              items.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <p className="font-medium">{p.name}</p>
                    {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{p.hsn_sac ? `${p.kind === 'goods' ? 'HSN' : 'SAC'} ${p.hsn_sac}` : '—'}</td>
                  <td className="px-3 py-2">{p.gst_rate ? `${p.gst_rate}%` : 'Nil'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.rate ? formatINR(p.rate) : '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-0.5">
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => open(p)} aria-label={`Edit ${p.name}`}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive"
                        aria-label={`Delete ${p.name}`}
                        onClick={async () => {
                          if (await confirm({ title: `Delete “${p.name}”?`, description: 'Invoices already made keep their lines.', destructive: true, confirmLabel: 'Delete' })) del.mutate(p.id)
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent title={editing?.id ? 'Edit item' : 'New item'} className="max-w-lg">
          {editing && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="item-name">Name</Label>
                <Input id="item-name" value={editing.body.name} onChange={(e) => setEditing({ ...editing, body: { ...editing.body, name: e.target.value } })} placeholder="Candid photography, per day" autoFocus />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="item-desc">Line under it (optional)</Label>
                <Input id="item-desc" value={editing.body.description ?? ''} onChange={(e) => setEditing({ ...editing, body: { ...editing.body, description: e.target.value } })} placeholder="Two photographers, all events" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="item-rate">Rate ₹</Label>
                  <Input id="item-rate" inputMode="decimal" value={rateText} onChange={(e) => setRateText(e.target.value)} placeholder="0" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="item-kind">Type</Label>
                  <Select id="item-kind" value={editing.body.kind} onChange={(e) => setEditing({ ...editing, body: { ...editing.body, kind: e.target.value as 'service' | 'goods' } })}>
                    <option value="service">Service (SAC)</option>
                    <option value="goods">Goods (HSN)</option>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="item-hsn">{editing.body.kind === 'goods' ? 'HSN code' : 'SAC code'}</Label>
                  <div className="flex gap-1">
                    <Input
                      id="item-hsn"
                      inputMode="numeric"
                      value={editing.body.hsn_sac ?? ''}
                      onChange={(e) => setEditing({ ...editing, body: { ...editing.body, hsn_sac: e.target.value.replace(/\D/g, '').slice(0, 8) } })}
                      placeholder={editing.body.kind === 'goods' ? '4911' : '998387'}
                    />
                    <Button type="button" variant="outline" size="icon" onClick={() => setHsnOpen(true)} aria-label="Search codes">
                      <Search className="size-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="item-gst">GST</Label>
                  <Select id="item-gst" value={editing.body.gst_rate} onChange={(e) => setEditing({ ...editing, body: { ...editing.body, gst_rate: Number(e.target.value) as GstSlab } })}>
                    {GST_SLABS.map((g) => (
                      <option key={g} value={g}>
                        {g === 0 ? 'Nil / exempt' : `${g}%`}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="mt-2 flex justify-end gap-2">
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button onClick={() => void onSave()} disabled={!editing.body.name.trim() || save.isPending}>
                  {save.isPending ? 'Saving…' : 'Save item'}
                </Button>
              </div>
              <HsnSearchDialog
                open={hsnOpen}
                onOpenChange={setHsnOpen}
                initialQuery={editing.body.hsn_sac ?? ''}
                onPick={(p) =>
                  setEditing({
                    ...editing,
                    body: {
                      ...editing.body,
                      hsn_sac: p.code,
                      kind: p.code.startsWith('99') ? 'service' : 'goods',
                      ...(p.gstRate && (GST_SLABS as number[]).includes(p.gstRate) ? { gst_rate: p.gstRate as GstSlab } : {}),
                    },
                  })
                }
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
