import { describe, expect, it } from 'vitest'
import type { FlowStop } from '@ipc/contracts'
import { finishRate, flowLabel, rankStops, stuckAdvice } from './stuck'

const row = (o: Partial<FlowStop>): FlowStop => ({ flow: 'project-shoots', opened: 10, done: 9, left: 1, refused: 0, stuck: 0, videos: 0, studios: 4, ...o })

describe('where people stop', () => {
  it('reads a finish rate only once there are visits enough to mean something', () => {
    expect(finishRate(row({ opened: 2, done: 0 }))).toBeNull()
    expect(finishRate(row({ opened: 8, done: 6 }))).toBe(75)
    expect(finishRate(row({ opened: 4, done: 5 }))).toBe(100)
  })

  it('says the worst first: leaving, then refusals, then the video', () => {
    expect(stuckAdvice(row({ opened: 10, done: 3, left: 7 }))).toMatch(/^70% of visits to Create project: event days leave without finishing\./)
    expect(stuckAdvice(row({ refused: 6 }))).toMatch(/refused often on Create project: event days \(6 times\)/)
    expect(stuckAdvice(row({ stuck: 4 }))).toMatch(/offered itself 4 times/)
    expect(stuckAdvice(row({}))).toBeNull()
    expect(stuckAdvice(row({ opened: 2, done: 0 }))).toBeNull()
  })

  it('ranks by visits lost, and names an unknown screen by its key', () => {
    const ranked = rankStops([row({ flow: 'client', left: 1 }), row({ flow: 'team', left: 5 }), row({ flow: 'x', left: 5, refused: 2 })])
    expect(ranked.map((r) => r.flow)).toEqual(['x', 'team', 'client'])
    expect(flowLabel('x')).toBe('x')
    expect(flowLabel('team')).toBe('Add one person')
  })
})
