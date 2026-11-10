import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SHIPPED, SHIPPED_HI, TUTORIALS } from '@/features/help/tutorials'
import { SETUP_VIDEOS, setupLength } from './setup-videos'

const PUBLIC = join(__dirname, '../../../public')

describe('the setup videos page', () => {
  it('keeps the anchors the setup emails link to', () => {
    const keys = SETUP_VIDEOS.map((s) => s.key)
    for (const k of ['team', 'client', 'project']) expect(keys).toContain(k)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys[0]).toBe('account')
  })

  it('has every video, and its Hindi twin, on disk and in the tutorial list', () => {
    for (const s of SETUP_VIDEOS) {
      for (const v of [s.video, ...(s.parts ?? [])]) {
        expect(TUTORIALS.some((t) => t.key === v), v).toBe(true)
        expect(SHIPPED, v).toContain(v)
        expect(SHIPPED_HI, v).toContain(v)
        for (const f of [`help/${v}.mp4`, `help/${v}.jpg`, `help/hi/${v}.mp4`, `help/hi/${v}.jpg`]) expect(existsSync(join(PUBLIC, f)), f).toBe(true)
      }
    }
  })

  it('says every step in both languages, the same number of lines', () => {
    for (const s of SETUP_VIDEOS) {
      expect(s.title.en && s.title.hi && s.why.en && s.why.hi, s.key).toBeTruthy()
      expect(s.steps.en.length, s.key).toBeGreaterThanOrEqual(4)
      expect(s.steps.hi.length, s.key).toBe(s.steps.en.length)
      expect(s.action.label.en && s.action.label.hi, s.key).toBeTruthy()
    }
  })

  it('rounds the total to whole minutes', () => {
    expect(setupLength([52, 42, 27, 63, 48, 56])).toBe(5)
    expect(setupLength([10])).toBe(1)
  })
})
