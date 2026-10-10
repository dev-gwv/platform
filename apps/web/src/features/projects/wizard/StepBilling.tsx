import { Wallet } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { Input, Select } from '@/shared/ui/input'
import { useINR } from '@/shared/money/MoneyMask'
import { PaymentModePicker } from '@/features/settings/PaymentModePicker'
import {
  money,
  newPayment,
  type draftTotals,
  type PaymentDraft,
  type ProjectDraft,
} from '@/features/projects/wizard'
import type { Patch } from './wizard-state'
import { Field } from './wizard-ui'

export function BillingStep({
  draft,
  patch,
  totals,
}: {
  draft: ProjectDraft
  patch: Patch
  totals: ReturnType<typeof draftTotals>
}) {
  const inr = useINR()
  const patchPayment = (p: PaymentDraft) => patch({ payments: [p] })

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Package cost (₹)" hint="The headline price, before any chargeable extras.">
          <Input
            inputMode="numeric"
            value={draft.package_cost}
            onChange={(e) => patch({ package_cost: e.target.value })}
            placeholder="150000"
          />
        </Field>
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Chargeable deliverables</span>
            <span className="tabular-nums font-medium">{inr(totals.addOns)}</span>
          </div>
          <div className="mt-2 flex justify-between border-t border-border pt-2">
            <span className="font-medium">Project total</span>
            <span className="tabular-nums text-base font-semibold">{inr(totals.total)}</span>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium">Advance from client</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Has the client already paid something? Add it here so the balance is right from day one.
        </p>
        {/* One advance per project -- the owner: "advance payment collection
            happens only once" -- so one card, no add button, no delete. */}
        {(() => {
          const p = draft.payments[0] ?? newPayment()
          const set = (patch: Partial<PaymentDraft>) => patchPayment({ ...p, ...patch })
          const filled = money(p.amount) > 0
          return (
            <div className={cn('rounded-lg border p-4 transition-colors', filled ? 'border-success/40 bg-success/[0.04]' : 'border-border')}>
              <div className="mb-3 flex items-center gap-2">
                <Wallet className={cn('size-4', filled ? 'text-success' : 'text-muted-foreground')} />
                <span className="text-sm font-medium">Advance received</span>
                <span className="text-xs text-muted-foreground">(optional)</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Amount (₹)">
                  <Input
                    inputMode="numeric"
                    value={p.amount}
                    onChange={(e) => set({ amount: e.target.value })}
                    placeholder="50000"
                    className={cn(!filled && 'border-warning/60 bg-warning/10')}
                  />
                </Field>
                <Field label="Received on">
                  <Input type="date" value={p.paid_on} onChange={(e) => set({ paid_on: e.target.value })} />
                </Field>
                <PaymentModePicker value={p.mode} onChange={(v) => set({ mode: v })} />
                <Field label="Reference">
                  <Input value={p.reference} onChange={(e) => set({ reference: e.target.value })} placeholder="UTR / cheque no." />
                </Field>
                <Field label="Status">
                  <Select value={p.status} onChange={(e) => set({ status: e.target.value as 'paid' | 'pending' })}>
                    <option value="paid">Paid</option>
                    <option value="pending">Pending</option>
                  </Select>
                </Field>
                <Field label="Description">
                  <Input value={p.description} onChange={(e) => set({ description: e.target.value })} placeholder="Advance / booking amount" />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={p.is_gst} onChange={(e) => set({ is_gst: e.target.checked })} />
                  GST receipt
                </label>
                {p.is_gst && (
                  <Field label="GST number">
                    <Input value={p.gst_number} onChange={(e) => set({ gst_number: e.target.value })} placeholder="GSTIN" />
                  </Field>
                )}
              </div>
              <div className="mt-3">
                <Field label="Notes">
                  <Input value={p.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Optional note" />
                </Field>
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
