import { describe, expect, it } from 'vitest'
import { TUTORIALS } from '@/features/help/tutorials'
import { showTeamVideos, teamVideos, watchedLine } from './team-videos'

const now = new Date('2026-11-12T10:00:00Z')

describe('teamVideos', () => {
  it('leaves attendance out while the studio has it off', () => {
    expect(teamVideos(false).map((v) => v.key)).toEqual(['team-day', 'hand-in', 'ask-leave'])
    expect(teamVideos(true).map((v) => v.key)).toEqual(['team-day', 'hand-in', 'check-in', 'ask-leave'])
  })
  it('plays only videos that exist', () => {
    for (const v of teamVideos(true)) expect(TUTORIALS.some((t) => t.key === v.key)).toBe(true)
  })
})

describe('showTeamVideos', () => {
  const list = teamVideos(false)
  it('shows for a new login until every video is watched', () => {
    expect(showTeamVideos(list, ['team-day'], false, '2026-11-11T00:00:00Z', now)).toBe(true)
    expect(showTeamVideos(list, ['team-day', 'hand-in', 'ask-leave'], false, '2026-11-11T00:00:00Z', now)).toBe(false)
  })
  it('steps back when closed or for an older login', () => {
    expect(showTeamVideos(list, [], true, '2026-11-11T00:00:00Z', now)).toBe(false)
    expect(showTeamVideos(list, [], false, '2026-08-01T00:00:00Z', now)).toBe(false)
  })
  it('counts what is watched', () => {
    expect(watchedLine(list, ['hand-in', 'gone'], 'en')).toBe('1 of 3 watched')
  })
})
