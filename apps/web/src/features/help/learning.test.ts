import { describe, expect, it } from 'vitest'
import { isRetired, remember, watchedEnough } from './learning'
import { IDLE_MS, startStuck, stuckReason, stuckStep } from './stuck-rules'

const NOW = Date.parse('2026-10-05T10:00:00Z')
const fresh = { teammates: 0, clients: 0, projects: 0, since: '2026-10-04T10:00:00Z' }
const none = { watched: [], closed: [] }

describe('how-to cards step back by themselves', () => {
  it('show while the job is new, and go once it is done twice', () => {
    expect(isRetired('team', fresh, none, NOW)).toBe(false)
    expect(isRetired('team', { ...fresh, teammates: 1 }, none, NOW)).toBe(false)
    expect(isRetired('team-bulk', { ...fresh, teammates: 2 }, none, NOW)).toBe(true)
    expect(isRetired('client', { ...fresh, clients: 2 }, none, NOW)).toBe(true)
    expect(isRetired('project-shoots', { ...fresh, projects: 1 }, none, NOW)).toBe(false)
    expect(isRetired('project-shoots', { ...fresh, projects: 2 }, none, NOW)).toBe(true)
  })

  it('go when watched to the end or closed, and all go after 3 projects or 14 days', () => {
    expect(isRetired('client', fresh, { watched: ['client'], closed: [] }, NOW)).toBe(true)
    expect(isRetired('client', fresh, { watched: [], closed: ['client'] }, NOW)).toBe(true)
    expect(isRetired('team', { ...fresh, projects: 3 }, none, NOW)).toBe(true)
    expect(isRetired('team', { ...fresh, since: '2026-09-20T10:00:00Z' }, none, NOW)).toBe(true)
    expect(isRetired('team', { ...fresh, since: '2026-09-22T10:00:00Z' }, none, NOW)).toBe(false)
  })

  it('counts a video watched once 90% has played, and remembers each key once', () => {
    expect(watchedEnough(27, 30)).toBe(true)
    expect(watchedEnough(20, 30)).toBe(false)
    expect(watchedEnough(5, 0)).toBe(false)
    const a = remember(undefined, 'watched', 'team')
    expect(remember(a, 'watched', 'team')).toEqual({ watched: ['team'], closed: [] })
    expect(remember(a, 'closed', 'client')).toEqual({ watched: ['team'], closed: ['client'] })
  })
})

describe('noticing someone is stuck', () => {
  const t0 = NOW
  it('offers after 45 s with nothing moving, and typing keeps the clock back', () => {
    let s = startStuck(t0)
    expect(stuckReason(s, t0 + IDLE_MS - 1)).toBeNull()
    expect(stuckReason(s, t0 + IDLE_MS)).toBe('idle')
    s = stuckStep(s, { type: 'activity', at: t0 + 30_000 })
    expect(stuckReason(s, t0 + IDLE_MS)).toBeNull()
  })

  it('offers after two refused tries or two closes, once only, and a step forward starts again', () => {
    let s = startStuck(t0)
    s = stuckStep(s, { type: 'refused', at: t0 + 1 })
    expect(stuckReason(s, t0 + 2)).toBeNull()
    s = stuckStep(s, { type: 'refused', at: t0 + 2 })
    expect(stuckReason(s, t0 + 3)).toBe('refused')
    s = stuckStep(s, { type: 'offered' })
    expect(stuckReason(s, t0 + IDLE_MS * 3)).toBeNull()

    let d = startStuck(t0)
    d = stuckStep(d, { type: 'dismissed', at: t0 + 1 })
    d = stuckStep(d, { type: 'progress', at: t0 + 2 })
    d = stuckStep(d, { type: 'dismissed', at: t0 + 3 })
    expect(stuckReason(d, t0 + 4)).toBeNull()
    d = stuckStep(d, { type: 'dismissed', at: t0 + 5 })
    expect(stuckReason(d, t0 + 6)).toBe('dismissed')
  })
})
