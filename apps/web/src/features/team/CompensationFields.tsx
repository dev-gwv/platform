import { useState } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import type { PayComponent, PaymentStatus } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Input, Label, Select } from '@/shared/ui/input'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { useActiveLookups, useCreateCustomLookup } from '@/features/settings/api'
import { useCanAddLookup } from '@/features/settings/useCanAddLookup'

/**
 * "How is this person paid?" as two questions instead of one enum.
 *
 * Payment Type is the top-level classification (Monthly Salaried, Freelancer,
 * a studio-defined type…), and Pay components is which financial pieces
 * actually apply — ticked freely, because a base salary with a commission on
 * top, or a per-shoot rate with a commission on top, are both normal
 * arrangements a single payout_type enum could never represent. Picking a
 * built-in type ticks its usual components as a starting point; a custom
 * type leaves whatever was already ticked alone.
 */
export const PAY_COMPONENTS: Array<{ key: PayComponent; label: string; hint: string }> = [
  { key: 'monthly_salary', label: 'Monthly salary / retainer', hint: 'Fixed amount every month' },
  { key: 'freelancer_rate', label: 'Per shoot / day rate', hint: 'Paid per assignment' },
  { key: 'commission', label: 'Commission %', hint: 'Share of revenue, payment or profit' },
  { key: 'stipend', label: 'Stipend', hint: 'Trainee or intern allowance' },
]

export const BUILT_IN_TYPES: Array<{ value: string; label: string; components: PayComponent[] }> = [
  { value: 'salaried', label: 'Monthly Salaried', components: ['monthly_salary'] },
  { value: 'freelancer', label: 'Freelancer', components: ['freelancer_rate'] },
  { value: 'commission', label: 'Commission Based', components: ['commission'] },
  { value: 'intern', label: 'Intern / Trainee', components: ['stipend'] },
  { value: 'contractor', label: 'Contractor / Other', components: ['monthly_salary'] },
]

/** Its own lookup category so it never mixes with the *payment mode* (UPI/Cash/…) list. */
const LOOKUP_CATEGORY = 'compensation_type'

export interface CompensationDraft {
  payment_type: string
  pay_components: PayComponent[]
  payment_status: PaymentStatus
  /** Monthly salary / retainer — only for the monthly_salary component. */
  salary: string
  /** Per-shoot/day rate — only for the freelancer_rate component (split from salary). */
  freelancer_rate: string
  /** Whether this person gets dashboard login access (maps to create_login/login_enabled). */
  has_login_access: boolean
  payout_type: '' | 'salary' | 'per_shoot' | 'per_day' | 'per_project' | 'custom'
  commission_pct: string
  commission_basis: '' | 'revenue' | 'payment' | 'profit' | 'manual'
  stipend_amount: string
  pay_effective_from: string
  pay_effective_to: string
  compensation_notes: string
}

/**
 * Port of the Lovable compensation validation: every ticked component needs
 * a valid non-negative figure, commission stays 0–100, and the pay window
 * must make sense. Returns the first problem, or null when valid.
 */
export function validateCompensation(
  v: Pick<
    CompensationDraft,
    | 'payment_type'
    | 'pay_components'
    | 'salary'
    | 'freelancer_rate'
    | 'commission_pct'
    | 'stipend_amount'
    | 'pay_effective_from'
    | 'pay_effective_to'
  >,
  opts?: { effectiveFromRequired?: boolean },
): string | null {
  if (!v.payment_type) return 'Payment type is required.'
  if (v.pay_components.length === 0) return 'Select at least one pay component.'
  const amounts: Array<[string, string]> = [
    [v.salary, 'Monthly salary'],
    [v.freelancer_rate, 'Rate'],
    [v.stipend_amount, 'Stipend'],
  ]
  for (const [raw, label] of amounts) {
    if (raw.trim() !== '' && (!Number.isFinite(Number(raw)) || Number(raw) < 0))
      return `${label} must be a non-negative number.`
  }
  if (v.commission_pct.trim() !== '') {
    const n = Number(v.commission_pct)
    if (!Number.isFinite(n) || n < 0 || n > 100)
      return 'Commission percentage must be between 0 and 100.'
  }
  if (opts?.effectiveFromRequired !== false && v.payment_type && !v.pay_effective_from)
    return 'Effective from date is required.'
  if (v.pay_effective_to && v.pay_effective_from && v.pay_effective_to < v.pay_effective_from)
    return 'Effective to must be on or after effective from.'
  return null
}

type Setter = <K extends keyof CompensationDraft>(key: K, value: CompensationDraft[K]) => void

export function CompensationFields({
  value,
  onChange,
  effectiveFromRequired = true,
  showLoginToggle = false,
  errors = {},
}: {
  value: CompensationDraft
  onChange: Setter
  /** The add wizard requires it once a type is picked; a plain edit does not. */
  effectiveFromRequired?: boolean
  /** Show the "create login / account access" switch (Lovable parity). */
  showLoginToggle?: boolean
  errors?: Partial<Record<keyof CompensationDraft, string>>
}) {
  const { data: customTypes } = useActiveLookups(LOOKUP_CATEGORY)
  const createLookup = useCreateCustomLookup()
  const canAddType = useCanAddLookup(LOOKUP_CATEGORY)
  const [addOpen, setAddOpen] = useState(false)
  const [newLabel, setNewLabel] = useState('')

  const has = (c: PayComponent) => value.pay_components.includes(c)
  const toggle = (c: PayComponent, on: boolean) => {
    onChange('pay_components', on ? [...value.pay_components, c] : value.pay_components.filter((x) => x !== c))
  }

  function onTypeChange(next: string) {
    onChange('payment_type', next)
    const preset = BUILT_IN_TYPES.find((t) => t.value === next)
    if (preset) onChange('pay_components', preset.components)
  }

  async function addCustomType() {
    const label = newLabel.trim()
    if (!label) return
    try {
      await createLookup.mutateAsync({ category: LOOKUP_CATEGORY, value: label })
      onTypeChange(label)
      setNewLabel('')
      setAddOpen(false)
      toast.success('Payment type added.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unable to add payment type.')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-medium">Payment &amp; Work Type</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          How is this team member paid? Combine multiple pay components if needed. Only admins can see or edit this
          section.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>
            Payment Type<span className="ml-0.5 text-destructive">*</span>
          </Label>
          <div className="flex gap-2">
            <Select className="flex-1" value={value.payment_type} onChange={(e) => onTypeChange(e.target.value)}>
              <option value="">Select…</option>
              {BUILT_IN_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
              {(customTypes ?? []).map((o) => (
                <option key={o.id} value={o.value}>
                  {o.value}
                </option>
              ))}
            </Select>
            {canAddType && (
              <Button type="button" variant="outline" onClick={() => setAddOpen(true)}>
                <Plus className="size-4" aria-hidden />
                <span className="hidden sm:inline">Add new</span>
              </Button>
            )}
          </div>
          {errors.payment_type && <p className="text-xs text-destructive">{errors.payment_type}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Payment Status</Label>
          <Select
            value={value.payment_status}
            onChange={(e) => onChange('payment_status', e.target.value as PaymentStatus)}
          >
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="ended">Ended</option>
          </Select>
        </div>
      </div>

      {showLoginToggle && (
        <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-muted/30 p-3">
          <div className="min-w-0">
            <Label className="text-sm">Create login / account access for this person</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Freelancers can also be given login access to view assigned shoots, tasks, and data upload.
            </p>
          </div>
          <input
            type="checkbox"
            aria-label="Create login access"
            checked={value.has_login_access}
            onChange={(e) => onChange('has_login_access', e.target.checked)}
            className="mt-1 size-4"
          />
        </div>
      )}

      {value.payment_type && (
        <div className="rounded-lg border border-border p-3">
          <p className="text-sm font-medium">Pay components</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Tick every component that applies — e.g. salary + commission, or per-shoot rate + commission.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {PAY_COMPONENTS.map((c) => (
              <label
                key={c.key}
                className="flex min-h-10 cursor-pointer items-start gap-3 rounded-md border border-border bg-card p-2.5"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={has(c.key)}
                  onChange={(e) => toggle(c.key, e.target.checked)}
                />
                <span className="min-w-0">
                  <span className="block text-sm">{c.label}</span>
                  <span className="block text-xs text-muted-foreground">{c.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {has('monthly_salary') && (
        <div className="flex flex-col gap-1.5">
          <Label>Monthly Salary / Retainer (₹)</Label>
          <Input inputMode="numeric" value={value.salary} onChange={(e) => onChange('salary', e.target.value)} placeholder="0" />
          {errors.salary && <p className="text-xs text-destructive">{errors.salary}</p>}
        </div>
      )}

      {has('freelancer_rate') && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>Rate (₹)</Label>
            <Input inputMode="numeric" value={value.freelancer_rate} onChange={(e) => onChange('freelancer_rate', e.target.value)} placeholder="0" />
            {errors.freelancer_rate && <p className="text-xs text-destructive">{errors.freelancer_rate}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Payout type</Label>
            <Select value={value.payout_type} onChange={(e) => onChange('payout_type', e.target.value as CompensationDraft['payout_type'])}>
              <option value="">Select…</option>
              <option value="per_shoot">Per shoot</option>
              <option value="per_day">Per day</option>
              <option value="per_project">Per project</option>
              <option value="custom">Custom</option>
            </Select>
          </div>
        </div>
      )}

      {has('commission') && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>Commission %</Label>
            <Input
              inputMode="numeric"
              value={value.commission_pct}
              onChange={(e) => onChange('commission_pct', e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Commission basis</Label>
            <Select
              value={value.commission_basis}
              onChange={(e) => onChange('commission_basis', e.target.value as CompensationDraft['commission_basis'])}
            >
              <option value="">—</option>
              <option value="revenue">On project revenue</option>
              <option value="payment">On payment received</option>
              <option value="profit">On profit</option>
              <option value="manual">Manual</option>
            </Select>
          </div>
        </div>
      )}

      {has('stipend') && (
        <div className="flex flex-col gap-1.5">
          <Label>Stipend Amount (₹)</Label>
          <Input
            inputMode="numeric"
            value={value.stipend_amount}
            onChange={(e) => onChange('stipend_amount', e.target.value)}
            placeholder="0"
          />
        </div>
      )}

      {value.payment_type && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>
              Effective From
              {effectiveFromRequired && <span className="ml-0.5 text-destructive">*</span>}
            </Label>
            <Input type="date" value={value.pay_effective_from} onChange={(e) => onChange('pay_effective_from', e.target.value)} />
            {errors.pay_effective_from && <p className="text-xs text-destructive">{errors.pay_effective_from}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Effective To (optional)</Label>
            <Input type="date" value={value.pay_effective_to} onChange={(e) => onChange('pay_effective_to', e.target.value)} />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label>Notes</Label>
        <textarea
          rows={2}
          value={value.compensation_notes}
          onChange={(e) => onChange('compensation_notes', e.target.value)}
          placeholder="Optional context about this compensation"
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm"
        />
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent title="Add custom payment type">
          <div className="flex flex-col gap-2">
            <Label>Name</Label>
            <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. Retainer + Commission" autoFocus />
            <p className="text-xs text-muted-foreground">Saved for your studio and available for every team member.</p>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void addCustomType()} disabled={!newLabel.trim() || createLookup.isPending}>
              {createLookup.isPending ? 'Adding…' : 'Add type'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
