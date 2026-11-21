import { describe, expect, it } from 'vitest'
import { callCounts, crewState, homeWeekEnd, weekShootCounts } from '@ipc/domain'
import { leadsLine, leadsTileLine, shootsLine, shootsTile, shootsWeekEnd } from './tiles'

/**
 * Home's tiles now read two counts from GET /dashboard/summary instead of the
 * lists behind them. The numbers must be the ones the tiles worked out from
 * the lists before, so a studio sees no change.
 */

const today = '2026-10-02'

const shoots = [
  // needs two shooters, has one: short
  { id: 's1', shoot_date: '2026-10-02', status: 'planned', requirements: [{ name: 'Shooter', quantity: 2 }] },
  // full
  { id: 's2', shoot_date: '2026-10-05', status: 'confirmed', requirements: [{ name: 'Drone', quantity: 1 }] },
  // nobody booked: short
  { id: 's3', shoot_date: '2026-10-08', status: 'planned', requirements: [{ name: 'Candid', quantity: 1 }] },
  // nothing asked for yet: not short
  { id: 's4', shoot_date: '2026-10-06', status: 'planned', requirements: [] },
  // outside the week, cancelled, undated
  { id: 's5', shoot_date: '2026-10-09', status: 'planned', requirements: [{ name: 'Shooter', quantity: 1 }] },
  { id: 's6', shoot_date: '2026-10-04', status: 'cancelled', requirements: [{ name: 'Shooter', quantity: 1 }] },
  { id: 's7', shoot_date: null, status: 'planned', requirements: [{ name: 'Shooter', quantity: 1 }] },
]
const slots = [
  { shoot_id: 's1', service_name: 'shooter ', status: 'booked' },
  { shoot_id: 's2', service_name: 'Drone', status: 'booked' },
  { shoot_id: 's3', service_name: 'Candid', status: 'released' },
]

describe('the summary counts match the tiles', () => {
  it('shoots this week and how many still need people', () => {
    const booked = slots.filter((x) => x.status === 'booked')
    const before = shootsTile(
      shoots,
      (id) => {
        const s = shoots.find((x) => x.id === id)
        const state = s ? crewState(id, s.requirements, booked) : 'unplanned'
        return state === 'unassigned' || state === 'partial'
      },
      today,
    )
    const now = weekShootCounts(shoots, slots, today)
    expect(now).toEqual({ count: before.count, short: before.short })
    expect(now).toEqual({ count: 4, short: 2 })
    expect(shootsLine(now.count, now.short)).toBe(before.line)
    expect(homeWeekEnd(today)).toBe(shootsWeekEnd(today))
  })

  it('leads to call today and how many were never rung', () => {
    const queue = [{ last_contacted_at: null }, { last_contacted_at: '2026-10-01T10:00:00.000Z' }, { last_contacted_at: null }]
    const c = callCounts(queue)
    expect(c).toEqual({ to_call: 3, not_contacted: 2 })
    expect(leadsLine(c.to_call, c.not_contacted)).toBe(leadsTileLine(queue))
    expect(leadsLine(0, 0)).toBe(leadsTileLine([]))
    expect(shootsLine(0, 0)).toBe('No shoots this week')
  })
})
