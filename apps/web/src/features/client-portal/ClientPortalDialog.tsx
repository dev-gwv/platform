import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { ClientPortalCard } from './ClientPortalCard'

/**
 * The client's private page, opened from the project's More menu. It used to
 * be a card on the overview; the owner asked for the overview to carry only
 * the money and the work, so the same card now opens on demand.
 */
export function ClientPortalDialog({
  projectId,
  projectName,
  clientName,
  clientPhone,
  onClose,
}: {
  projectId: string
  projectName: string
  clientName: string | null
  clientPhone: string | null
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg" title="Share with client">
        <ClientPortalCard projectId={projectId} projectName={projectName} clientName={clientName} clientPhone={clientPhone} />
      </DialogContent>
    </Dialog>
  )
}
