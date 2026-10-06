import { describe, expect, it } from 'vitest'
import { CHAPTERS, PARTS, chaptersOf, nextChapter, stepParts } from './guide'
import { SHIPPED, SHIPPED_HI, TUTORIALS } from './tutorials'

describe('the step-by-step guide', () => {
  it('plays only videos that ship, in English and in Hindi', () => {
    for (const c of CHAPTERS) {
      for (const key of [c.video, ...(c.clips ?? [])].filter(Boolean) as string[]) {
        expect(TUTORIALS.some((t) => t.key === key), `${c.key}: ${key}`).toBe(true)
        expect(SHIPPED, key).toContain(key)
        expect(SHIPPED_HI, key).toContain(key)
      }
    }
  })

  it('says the same steps in both languages, with every button name closed', () => {
    for (const c of CHAPTERS) {
      expect(c.steps.hi.length, c.key).toBe(c.steps.en.length)
      expect(c.steps.en.length, c.key).toBeGreaterThan(0)
      for (const s of [...c.steps.en, ...c.steps.hi]) expect(s.split('**').length % 2, s).toBe(1)
      expect(c.title.hi, c.key).not.toBe('')
      if (c.to) expect(c.to.startsWith('/'), c.key).toBe(true)
    }
    expect(new Set(CHAPTERS.map((c) => c.key)).size).toBe(CHAPTERS.length)
  })

  it('keeps each part to at most four chapters, studio first then team', () => {
    PARTS.forEach((_, i) => {
      const n = CHAPTERS.filter((c) => c.part === i).length
      expect(n, PARTS[i]!.title.en).toBeGreaterThan(0)
      expect(n, PARTS[i]!.title.en).toBeLessThanOrEqual(4)
    })
    expect(chaptersOf('studio')[0]?.key).toBe('team')
    expect(chaptersOf('team')[0]?.key).toBe('team-home')
  })

  it('opens on the first chapter not done, and marks button names', () => {
    expect(nextChapter('studio', new Set())?.key).toBe('team')
    expect(nextChapter('studio', new Set(['team', 'client']))?.key).toBe('project')
    expect(nextChapter('team', new Set(chaptersOf('team').map((c) => c.key)))).toBeNull()
    expect(stepParts('Press **Save client** now.')).toEqual([
      { text: 'Press ', strong: false },
      { text: 'Save client', strong: true },
      { text: ' now.', strong: false },
    ])
  })
})
