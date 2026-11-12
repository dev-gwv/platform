import { useEffect } from 'react'
import { toast } from 'sonner'
import type { CrmLead, CrmLeadCard } from '@ipc/contracts'
import { PanelBoundary } from '@/shared/layout/RouteError'
import { useLead } from './api'
import { LeadDrawer } from './LeadDrawer'

/**
 * The lead drawer for a lead known only by its id (a card on the board, a
 * ?lead= link from the bell). The list carries slim cards, so the whole lead --
 * notes, the QR's answers, what it was booked as -- is read here, by id. A
 * card already in hand stands in until it lands, so the drawer opens at once.
 */
export function LeadDrawerById({
  id,
  card,
  onClose,
}: {
  id: string
  card?: CrmLeadCard | CrmLead | null | undefined
  onClose: () => void
}) {
  const lead = useLead(id, card ?? null)
  const missing = lead.isError && !lead.data
  useEffect(() => {
    if (!missing) return
    toast.error('That lead was not found. It may have been deleted.')
    onClose()
  }, [missing, onClose])
  if (!lead.data) return null
  return (
    <PanelBoundary resetKey={id} label="this lead">
      <LeadDrawer lead={lead.data} onClose={onClose} />
    </PanelBoundary>
  )
}
