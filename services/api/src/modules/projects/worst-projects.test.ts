import { describe, expect, it } from 'vitest'
import { worstProjects } from './routes-list'

/**
 * Home's Needs attention lists three projects; `/projects/tracking?worst=3`
 * picks them on the server exactly as Home picked them from the whole list
 * (speed check, 22 Nov: 426 KB for three rows).
 */
const p = (id: string, score: number) => ({ id, health: { score } })

describe('worstProjects', () => {
  it('keeps only projects scoring above nothing, highest first, the newest first on a tie', () => {
    const rows = [p('new-ok', 0), p('new-bad', 4), p('mid', 9), p('old-bad', 4), p('negative', -1), p('worst', 12)]
    expect(worstProjects(rows, 3).map((r) => r.id)).toEqual(['worst', 'mid', 'new-bad'])
    expect(worstProjects(rows, 10).map((r) => r.id)).toEqual(['worst', 'mid', 'new-bad', 'old-bad'])
  })

  it('is the same as sorting the whole list and taking the top', () => {
    const rows = Array.from({ length: 40 }, (_, i) => p(`p${i}`, (i * 7) % 5))
    const home = [...rows].filter((r) => r.health.score > 0).sort((a, b) => b.health.score - a.health.score).slice(0, 3)
    expect(worstProjects(rows, 3)).toEqual(home)
  })

  it('does not reorder what it was given', () => {
    const rows = [p('a', 1), p('b', 2)]
    worstProjects(rows, 1)
    expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
  })
})
