import type { DetailsEvent } from '@ipc/contracts'
import { MONTHS } from './OccasionForm'

/** A client's event as the body of a new shoot day: India time, start + hours. */
export function eventToShoot(e: DetailsEvent): { name: string; shoot_date?: string; start_at?: string; end_at?: string; location?: string } {
  const out: { name: string; shoot_date?: string; start_at?: string; end_at?: string; location?: string } = { name: e.name.trim() }
  if (e.date) out.shoot_date = e.date
  if (e.venue?.trim()) out.location = e.venue.trim()
  if (e.date && e.start_time && /^\d{1,2}:\d{2}$/.test(e.start_time)) {
    const start = new Date(`${e.date}T${e.start_time.padStart(5, '0')}:00+05:30`)
    if (!Number.isNaN(start.getTime())) {
      out.start_at = start.toISOString()
      if (e.hours) out.end_at = new Date(start.getTime() + e.hours * 3_600_000).toISOString()
    }
  }
  return out
}

/** "Reception · 13 Dec", or just the name. */
export function eventLabel(e: DetailsEvent): string {
  if (!e.date) return e.name
  const [, m, d] = e.date.split('-').map(Number)
  return m && d ? `${e.name} · ${d} ${MONTHS[m - 1]}` : e.name
}
