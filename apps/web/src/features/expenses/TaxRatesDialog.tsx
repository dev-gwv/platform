import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { expenseTaxRate, type ExpenseTaxRate } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input } from '@/shared/ui/input'
import { useExpenseTaxRates } from '@/features/financials/api'

/**
 * The studio's own tax rates, changeable where they are picked (owner, 26
 * Oct: whatever is made can be changed). Rename, change the rate, or put one
 * away; a rate put away stays on the expenses that used it.
 */
export function TaxRatesDialog({ onClose }: { onClose: () => void }) {
  const rates = useExpenseTaxRates()
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Your tax rates" description="Change a name or a rate, or put one away. Expenses already saved keep theirs.">
        <ul className="flex flex-col gap-2">
          {(rates.data ?? []).map((r) => (
            <RateRow key={r.id} rate={r} />
          ))}
          {(rates.data ?? []).length === 0 && <li className="text-sm text-muted-foreground">No tax rates of your own yet.</li>}
        </ul>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function RateRow({ rate }: { rate: ExpenseTaxRate }) {
  const qc = useQueryClient()
  const [name, setName] = useState(rate.name)
  const [value, setValue] = useState(String(rate.rate))
  const save = useMutation({
    mutationFn: (patch: Partial<{ name: string; rate: number; is_active: boolean }>) =>
      callApi(`/financials/tax-rates/${rate.id}`, { method: 'PATCH', body: patch, responseSchema: expenseTaxRate }),
    onSuccess: () => {
      toast.success('Tax rate saved')
      void qc.invalidateQueries({ queryKey: ['financials', 'tax-rates'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const changed = name.trim() !== rate.name || Number(value) !== rate.rate
  const valid = name.trim().length > 0 && Number(value) >= 0 && Number(value) <= 100
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
      <Input aria-label="Tax name" className="h-9 min-w-0 flex-1" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      <Input aria-label="Rate %" className="h-9 w-20" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
      <span className="text-sm text-muted-foreground">%</span>
      {changed && (
        <Button size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate({ name: name.trim(), rate: Number(value) })}>
          Save
        </Button>
      )}
      <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate({ is_active: !rate.is_active })}>
        {rate.is_active ? 'Put away' : 'Bring back'}
      </Button>
    </li>
  )
}
