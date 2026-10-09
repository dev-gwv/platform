import { describe, expect, it } from 'vitest'
import { absolutePortalUrl, expectedLine, openedAgo, trackerSteps } from './format'

describe('openedAgo', () => {
  const now = new Date('2026-09-25T12:00:00Z')
  it('says it in plain words', () => {
    expect(openedAgo('2026-09-25T11:59:30Z', now)).toBe('just now')
    expect(openedAgo('2026-09-25T11:59:00Z', now)).toBe('1 minute ago')
    expect(openedAgo('2026-09-25T09:00:00Z', now)).toBe('3 hours ago')
    expect(openedAgo('2026-09-24T10:00:00Z', now)).toBe('yesterday')
    expect(openedAgo('2026-09-23T10:00:00Z', now)).toBe('2 days ago')
    expect(openedAgo('2026-09-04T10:00:00Z', now)).toBe('3 weeks ago')
    expect(openedAgo('2026-05-01T10:00:00Z', now)).toBe('4 months ago')
  })
})

describe('absolutePortalUrl', () => {
  it('keeps a full link and completes a bare path', () => {
    expect(absolutePortalUrl('https://app.x.in/p/abc', 'https://other')).toBe('https://app.x.in/p/abc')
    expect(absolutePortalUrl('/p/abc', 'https://app.x.in/')).toBe('https://app.x.in/p/abc')
  })
})

const shoot = (name: string, shoot_date: string | null) =>
  ({ id: name, name, shoot_date, start_at: null, end_at: null, location: null, map_link: null, guests: null, status: 'planned', team: [] })
const work = (title: string, status: 'not_started' | 'in_progress' | 'final_checks' | 'ready' | 'delivered') =>
  ({ id: title, title, description: null, status, expected_date: null, delivered_at: null, delivery_link: null, shoot_name: null, feedback: null })

describe('trackerSteps', () => {
  const base = {
    booked: { quotation_accepted_at: '2026-08-01T10:00:00Z', terms_agreed_at: null },
    footage: { tracks: true, shot: 2, safe: 1 },
    shoots: [shoot('Haldi', '2026-10-10'), shoot('Wedding', '2026-10-12'), shoot('Sangeet', '2026-10-23')],
    deliverables: [work('Teaser', 'not_started'), work('Album', 'not_started')],
  }

  it('says where the couple is, in one line per step', () => {
    const steps = trackerSteps(base, '2026-10-15')
    expect(steps.map((s) => [s.key, s.state])).toEqual([
      ['booked', 'done'], ['shoots', 'now'], ['footage', 'todo'], ['editing', 'todo'], ['ready', 'todo'], ['delivered', 'todo'],
    ])
    expect(steps[0]!.line).toBe('Quotation accepted')
    expect(steps[1]!.line).toBe('2 of 3 done · next: Sangeet, Fri, 23 Oct')
    expect(steps[2]!.line).toBe('1 of 2 days backed up')
  })

  it('leaves Footage safe out for a studio that keeps no data records', () => {
    expect(trackerSteps({ ...base, footage: { tracks: false, shot: 0, safe: 0 } }, '2026-10-15').map((s) => s.key)).not.toContain('footage')
  })

  it('moves on to editing, then counts what is delivered', () => {
    const later = {
      ...base,
      footage: { tracks: true, shot: 3, safe: 3 },
      deliverables: [work('Teaser', 'delivered'), work('Wedding film', 'in_progress')],
    }
    const steps = trackerSteps(later, '2026-11-01')
    expect(steps.find((s) => s.state === 'now')).toMatchObject({ key: 'editing', line: 'Wedding film being edited' })
    expect(steps.at(-1)!.line).toBe('1 of 2 delivered')
  })
})

describe('expectedLine', () => {
  const fmt = (d: string) => d
  it('shows the date only while it is ahead, never "late"', () => {
    expect(expectedLine('2026-11-05', '2026-10-15', fmt)).toBe('Expected by 2026-11-05')
    expect(expectedLine('2026-10-01', '2026-10-15', fmt)).toBe('Coming soon')
    expect(expectedLine(null, '2026-10-15', fmt)).toBe('We will share a date soon')
  })
})
