import { useState } from 'react'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'
import { formatINR } from '@/shared/ui/format'
import { PayToCard } from '@/features/team/PayToCard'
import { PaymentModePicker } from '@/features/settings/PaymentModePicker'
import { usePaySlot } from './pay'

/**
 * Pay one person for one booking: what the booking pays (changeable), what
 * goes out now (the balance to start with), when and how. Their UPI or bank
 * details sit at the top, so the transfer can be made from the same screen.
 */
export function PayDialog({
  slotId,
  userId,
  name,
  amount,
  paid,
  onClose,
}: {
  slotId: string
  userId: string | null
  name: string
  amount: number
  paid: number
  onClose: () => void
}) {
  const pay = usePaySlot()
  const [total, setTotal] = useState(amount > 0 ? String(amount) : '')
  const totalN = Number(total) || 0
  const [now, setNow] = useState(String(Math.max(0, amount - paid)))
  const [paidOn, setPaidOn] = useState(() => new Date().toLocaleDateString('en-CA'))
  const [mode, setMode] = useState('')
  const [reference, setReference] = useState('')
  const nowN = Number(now) || 0
  const left = Math.max(0, totalN - paid - nowN)
  const over = paid + nowN > totalN + 0.001

  function save() {
    pay.mutate(
      {
        slotId,
        body: {
          ...(Math.abs(totalN - amount) > 0.001 ? { amount: totalN } : {}),
          paid_now: nowN,
          paid_date: paidOn,
          payment_mode: mode || null,
          payment_reference: reference.trim() || null,
        },
      },
      { onSuccess: onClose },
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Pay ${name}`} description={paid > 0 ? `${formatINR(paid)} paid so far.` : undefined} className="max-w-md">
        <div className="flex flex-col gap-3">
          <PayToCard userId={userId} />
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-total">This booking pays</Label>
              <Input id="pay-total" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="₹" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-now">Paying now</Label>
              <Input id="pay-now" inputMode="decimal" value={now} onChange={(e) => setNow(e.target.value)} placeholder="₹" autoFocus />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-date">Paid on</Label>
              <Input id="pay-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
            <PaymentModePicker value={mode} onChange={setMode} id="pay-mode" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pay-ref">Reference</Label>
            <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR or UPI reference (optional)" />
          </div>
          <p className={over ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
            {over
              ? `That is more than this booking pays. Raise "This booking pays" first.`
              : nowN <= 0
                ? 'Nothing is paid now; only the amount is saved.'
                : left > 0
                  ? `${formatINR(left)} will still be owed after this.`
                  : `${name} will be paid in full.`}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pay.isPending || over || (nowN <= 0 && Math.abs(totalN - amount) <= 0.001)}>
            {pay.isPending ? 'Saving…' : nowN > 0 ? `Pay ${formatINR(nowN)}` : 'Save amount'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
