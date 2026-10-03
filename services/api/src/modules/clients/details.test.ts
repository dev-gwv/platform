import { describe, expect, it } from 'vitest'
import { waitingEvents } from './details'

describe('the client’s events still to add', () => {
  it('skips what is on the project already and lists each event once, newest send first', () => {
    const latest = [{ name: 'Haldi', date: '2026-12-11' }, { name: 'Reception', date: '2026-12-13' }]
    const older = [{ name: 'reception ', date: '2026-12-13' }, { name: 'Sangeet', date: null }]
    expect(waitingEvents([latest, older], [{ name: 'Haldi', date: '2026-12-11' }])).toEqual([
      { name: 'Reception', date: '2026-12-13' },
      { name: 'Sangeet', date: null },
    ])
  })

  it('treats the same name on another day as another event', () => {
    expect(waitingEvents([[{ name: 'Wedding', date: '2026-12-14' }]], [{ name: 'Wedding', date: '2026-12-12' }])).toHaveLength(1)
  })
})
