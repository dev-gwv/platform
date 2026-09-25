import { buildIcs } from '@ipc/domain'
import type { TeamSlot } from '@ipc/contracts'
import { bookingMessage } from './booking-model'

/** A calendar file for one booking, so it lands in the phone's own calendar. */
export function icsForSlot(slot: TeamSlot): string {
  return buildIcs({
    uid: `booking-${slot.id}@ipcstudios`,
    title: [slot.shoot_name ?? 'Shoot', slot.service_name].filter(Boolean).join(' · '),
    start: new Date(slot.start_at),
    end: new Date(slot.end_at),
    description: [slot.project_name, slot.client_name, slot.map_link].filter(Boolean).join('\n') || undefined,
    location: slot.location ?? undefined,
  })
}

export function downloadIcs(slot: TeamSlot) {
  const blob = new Blob([icsForSlot(slot)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(slot.shoot_name ?? 'shoot').replace(/[^\w-]+/g, '-').toLowerCase()}.ics`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Open WhatsApp with the booking details, to the person's number when known. */
export function shareOnWhatsApp(slot: TeamSlot, phone?: string | null) {
  const digits = (phone ?? '').replace(/\D/g, '')
  const to = digits.length === 10 ? `91${digits}` : digits
  const text = encodeURIComponent(bookingMessage(slot))
  window.open(to ? `https://wa.me/${to}?text=${text}` : `https://wa.me/?text=${text}`, '_blank', 'noopener')
}
