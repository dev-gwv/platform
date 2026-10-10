import type { IcsEvent } from '@ipc/domain'

/** One of a person's own bookings, as the feed reads it. */
export interface MineRow {
  slot_id: string
  start_at: Date | string
  end_at: Date | string
  service_name: string | null
  shoot_name: string | null
  location: string | null
  map_link: string | null
  project_name: string | null
  client_name: string | null
  response: string | null
}

/** One shoot of the studio's, with the crew booked on it. */
export interface StudioRow {
  shoot_id: string
  shoot_name: string | null
  shoot_date: string | null
  start_at: Date | string | null
  end_at: Date | string | null
  location: string | null
  map_link: string | null
  project_name: string | null
  client_name: string | null
  crew: string | null
}

const when = (v: Date | string) => (v instanceof Date ? v : new Date(v))
const lines = (...xs: (string | null | false | undefined)[]) => xs.filter(Boolean).join('\n') || undefined

/**
 * A person's bookings as calendar events: "Haldi · Mehta Wedding", the role,
 * the client, the venue and its map. Never pay, never a phone number: the
 * link is a secret anyone holding it can read. Time blocked outside a shoot
 * reads "Blocked".
 */
export function mineEvents(rows: readonly MineRow[], studio: string): IcsEvent[] {
  return rows.map((r) => ({
    uid: `slot-${r.slot_id}@studioautopilot`,
    title: r.project_name ? `${r.shoot_name ?? r.service_name ?? 'Shoot'} · ${r.project_name}` : (r.service_name ?? 'Blocked'),
    start: when(r.start_at),
    end: when(r.end_at),
    location: r.location ?? undefined,
    description: lines(
      r.service_name && r.project_name && `Your role: ${r.service_name}`,
      r.client_name && `Client: ${r.client_name}`,
      r.map_link && `Map: ${r.map_link}`,
      r.response === 'pending' && 'Not confirmed yet. Open Studio AutoPilot to confirm.',
      `${studio} · Studio AutoPilot`,
    ),
  }))
}

/**
 * The studio's shoots, one event each, with who is on it: what an owner or
 * manager plans the week from. A shoot with no hours yet is the whole day.
 */
export function studioEvents(rows: readonly StudioRow[], studio: string): IcsEvent[] {
  return rows.flatMap((r) => {
    const timed = r.start_at && r.end_at
    if (!timed && !r.shoot_date) return []
    const start = timed ? when(r.start_at!) : new Date(`${r.shoot_date}T00:00:00Z`)
    return [
      {
        uid: `shoot-${r.shoot_id}@studioautopilot`,
        title: `${r.shoot_name ?? 'Shoot'}${r.project_name ? ` · ${r.project_name}` : ''}`,
        start,
        end: timed ? when(r.end_at!) : start,
        ...(timed ? {} : { allDay: r.shoot_date! }),
        location: r.location ?? undefined,
        description: lines(
          r.crew ? `Crew: ${r.crew}` : 'No crew booked yet',
          r.client_name && `Client: ${r.client_name}`,
          r.map_link && `Map: ${r.map_link}`,
          `${studio} · Studio AutoPilot`,
        ),
      },
    ]
  })
}
