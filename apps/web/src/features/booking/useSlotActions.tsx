import { useState, type ReactNode } from 'react'
import { CalendarPlus, IndianRupee, MessageCircle, Pencil, RotateCcw, UserRoundPen, XCircle } from 'lucide-react'
import type { TeamMember, TeamSlot } from '@ipc/contracts'
import type { RowMenuItem } from '@/shared/ui/row-menu'
import { useConfirm } from '@/shared/ui/confirm'
import { useSetSlotStatus } from '@/features/allocation/api'
import { SlotCostDialog, SlotEditDialog } from './SlotDialogs'
import { downloadIcs, shareOnWhatsApp } from './share'

type Open = { slot: TeamSlot; kind: 'person' | 'hours' | 'cost' } | null

/**
 * Everything that can be done to one booking, in one place, so a person on a
 * role card, a chip in the month grid and a conflict all offer the same
 * actions in the same words. Render `dialogs` once on the page.
 */
export function useSlotActions({ canPlan, members }: { canPlan: boolean; members: readonly TeamMember[] }) {
  const confirm = useConfirm()
  const setStatus = useSetSlotStatus()
  const [open, setOpen] = useState<Open>(null)

  const phoneOf = (userId: string) => members.find((m) => m.user_id === userId)?.phone ?? null

  async function release(s: TeamSlot) {
    const yes = await confirm({
      title: `Release ${s.user_name ?? 'this person'}?`,
      description: `${[s.shoot_name, s.service_name].filter(Boolean).join(' · ') || 'This booking'}. The seat opens again and their time is free; the booking stays in the history.`,
      confirmLabel: 'Release',
    })
    if (yes) setStatus.mutate({ id: s.id, status: 'released' })
  }

  async function cancel(s: TeamSlot) {
    const yes = await confirm({
      title: `Cancel ${s.user_name ?? 'this'}'s booking?`,
      description: 'Cancelled bookings drop out of counts and payouts. Use Release if they were booked and then let go.',
      confirmLabel: 'Cancel booking',
      destructive: true,
    })
    if (yes) setStatus.mutate({ id: s.id, status: 'cancelled' })
  }

  function menuFor(s: TeamSlot): RowMenuItem[] {
    const items: RowMenuItem[] = []
    if (canPlan && s.status === 'booked') {
      items.push({ label: 'Change person', icon: <UserRoundPen className="size-4" />, onSelect: () => setOpen({ slot: s, kind: 'person' }) })
      items.push({ label: 'Edit hours or role', icon: <Pencil className="size-4" />, onSelect: () => setOpen({ slot: s, kind: 'hours' }) })
    }
    if (canPlan && s.status !== 'cancelled') {
      items.push({ label: 'Payout…', icon: <IndianRupee className="size-4" />, onSelect: () => setOpen({ slot: s, kind: 'cost' }) })
    }
    if (s.status === 'booked') {
      if (canPlan) {
        items.push({ label: 'Send details on WhatsApp', icon: <MessageCircle className="size-4" />, onSelect: () => shareOnWhatsApp(s, phoneOf(s.user_id)) })
      }
      items.push({ label: 'Add to calendar', icon: <CalendarPlus className="size-4" />, onSelect: () => downloadIcs(s) })
    }
    if (canPlan && s.status === 'booked') {
      items.push({ label: 'Release', icon: <RotateCcw className="size-4" />, onSelect: () => void release(s) })
      items.push({ label: 'Cancel booking', icon: <XCircle className="size-4" />, onSelect: () => void cancel(s) })
    }
    if (canPlan && s.status === 'released') {
      items.push({ label: 'Book again', icon: <RotateCcw className="size-4" />, onSelect: () => setStatus.mutate({ id: s.id, status: 'booked' }) })
    }
    return items
  }

  const dialogs: ReactNode = open ? (
    open.kind === 'cost' ? (
      <SlotCostDialog key={`cost-${open.slot.id}`} slot={open.slot} onClose={() => setOpen(null)} />
    ) : (
      <SlotEditDialog key={`edit-${open.slot.id}`} slot={open.slot} focus={open.kind} onClose={() => setOpen(null)} />
    )
  ) : null

  return { menuFor, dialogs, edit: (slot: TeamSlot) => setOpen({ slot, kind: 'hours' }), release, cancel }
}
