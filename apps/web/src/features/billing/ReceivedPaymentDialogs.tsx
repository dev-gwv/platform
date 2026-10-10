import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent } from '@/shared/ui/dialog'
import { useDeleteReceivedPayment, type ReceivedPayment } from './api'

// Recording or changing a payment is RecordPaymentDialog, the one payment
// form, wherever it is opened. Only the delete confirm lives here.

export function DeleteReceivedPaymentDialog({
  payment,
  onOpenChange,
  onDeleted,
}: {
  payment: Pick<ReceivedPayment, 'id'> | null
  onOpenChange: (open: boolean) => void
  onDeleted?: () => void
}) {
  const del = useDeleteReceivedPayment()

  async function onConfirm() {
    if (!payment) return
    try {
      await del.mutateAsync(payment.id)
      onOpenChange(false)
      onDeleted?.()
    } catch {
      toast.error('Could not delete the payment.')
    }
  }

  return (
    <Dialog open={!!payment} onOpenChange={onOpenChange}>
      <DialogContent title="Delete payment?" description="This permanently removes the payment record. Project totals refresh automatically.">
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={() => void onConfirm()} disabled={del.isPending}>
            {del.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
