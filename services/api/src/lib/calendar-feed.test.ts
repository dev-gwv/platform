import { describe, expect, it } from 'vitest'
import { mineEvents, studioEvents } from './calendar-feed'

const slot = {
  slot_id: 's1',
  start_at: '2026-10-31T04:30:00Z',
  end_at: '2026-10-31T09:30:00Z',
  service_name: 'Candid photographer',
  shoot_name: 'Haldi',
  location: 'Leela, Udaipur',
  map_link: 'https://maps.app.goo.gl/x',
  project_name: 'Mehta Wedding',
  client_name: 'Priya Mehta',
  response: 'confirmed',
}

describe('the calendar link', () => {
  it('names a booking by its shoot and project, with the role, client and map', () => {
    const [e] = mineEvents([slot], 'Sharma Films')
    expect(e!.title).toBe('Haldi · Mehta Wedding')
    expect(e!.uid).toBe('slot-s1@studioautopilot')
    expect(e!.description).toContain('Your role: Candid photographer')
    expect(e!.description).toContain('Client: Priya Mehta')
    expect(e!.description).toContain('Map: https://maps.app.goo.gl/x')
    expect(e!.description).not.toContain('confirm')
  })

  it('asks for a confirmation still owed, and reads blocked time as Blocked', () => {
    expect(mineEvents([{ ...slot, response: 'pending' }], 'S')[0]!.description).toContain('Not confirmed yet')
    const blocked = mineEvents([{ ...slot, project_name: null, shoot_name: null, service_name: null, client_name: null }], 'S')[0]!
    expect(blocked.title).toBe('Blocked')
  })

  it('gives the studio one event a shoot, with its crew, and a whole day when hours are not set', () => {
    const [timed, day] = studioEvents(
      [
        { shoot_id: 'a', shoot_name: 'Haldi', shoot_date: '2026-10-31', start_at: '2026-10-31T04:30:00Z', end_at: '2026-10-31T09:30:00Z', location: null, map_link: null, project_name: 'Mehta Wedding', client_name: null, crew: 'Rahul (Candid), Nitin (Video)' },
        { shoot_id: 'b', shoot_name: 'Wedding', shoot_date: '2026-11-01', start_at: null, end_at: null, location: null, map_link: null, project_name: 'Mehta Wedding', client_name: null, crew: null },
      ],
      'Sharma Films',
    )
    expect(timed!.description).toContain('Crew: Rahul (Candid), Nitin (Video)')
    expect(day!.allDay).toBe('2026-11-01')
    expect(day!.description).toContain('No crew booked yet')
  })

  it('leaves out a shoot with no date at all', () => {
    expect(studioEvents([{ shoot_id: 'c', shoot_name: 'Pre-wedding', shoot_date: null, start_at: null, end_at: null, location: null, map_link: null, project_name: null, client_name: null, crew: null }], 'S')).toEqual([])
  })
})
