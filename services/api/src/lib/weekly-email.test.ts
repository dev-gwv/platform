import { describe, expect, it } from 'vitest'
import type { Env } from '../context'
import { weeklyBlocks, weeklyMail, weeklyStopToken, weeklyStopTokenValid, type WeeklyFacts } from './weekly-email'
import { morningStopToken } from './morning-email'

const env = { APP_URL: 'https://app.test/', JWT_SECRET: 'secret-for-tests' } as Env
const USER = '22222222-2222-4222-8222-222222222222'

const facts = (over: Partial<WeeklyFacts> = {}): WeeklyFacts => ({
  userId: USER,
  name: 'Asha Rao',
  studio: 'Asha Studio',
  week: '2026-10-05',
  received: 0,
  receivedCount: 0,
  overdueAmount: 0,
  overdueCount: 0,
  dueWeekAmount: 0,
  dueWeekCount: 0,
  shootsWeek: 0,
  shootsUnstaffed: 0,
  editsLate: 0,
  editsDueWeek: 0,
  leadsNew: 0,
  leadsBooked: 0,
  ...over,
})

describe('the Monday email', () => {
  it('says the week in sentences, with only the blocks that have something', async () => {
    const m = await weeklyMail(env, facts({ received: 120000, receivedCount: 2, overdueAmount: 40000, overdueCount: 1, shootsWeek: 3, shootsUnstaffed: 1 }))
    expect(m.subject).toBe('This week: ₹1,20,000 in · ₹40,000 overdue · 3 shoots')
    expect(m.html).toContain('Your week, Asha')
    expect(m.html).toContain('₹1,20,000</strong> came in last week (2 payments).')
    expect(m.html).toContain('3 shoot days this week. 1 has nobody booked yet.')
    expect(m.html).toContain('Book the crew')
    expect(m.html).not.toContain('>Editing<')
    expect(m.html).not.toContain('>Leads<')
  })

  it('reads a fully staffed week and a fully empty one in plain words', () => {
    const staffed = weeklyBlocks('https://app.test', facts({ shootsWeek: 2 })).blocks.join('')
    expect(staffed).toContain('Every one has its crew.')
    const empty = weeklyBlocks('https://app.test', facts({ shootsWeek: 2, shootsUnstaffed: 2 })).blocks.join('')
    expect(empty).toContain('They have nobody booked yet.')
  })

  it('names late edits first and new leads with what was booked', () => {
    const { blocks, summary } = weeklyBlocks('https://app.test', facts({ editsLate: 2, editsDueWeek: 1, leadsNew: 5, leadsBooked: 1 }))
    const html = blocks.join('')
    expect(html).toContain('2 edits are late.')
    expect(html).toContain('1 edit is due this week.')
    expect(html).toContain('5 new leads last week, and <strong>1 booked</strong>.')
    expect(summary).toEqual(['2 late', '5 new leads'])
  })

  it('has its own stop link, which the morning email\'s does not open', async () => {
    const m = await weeklyMail(env, facts({ leadsNew: 1 }))
    const t = await weeklyStopToken(env, USER)
    expect(m.html).toContain(`https://app.test/stop-emails?w=${USER}&amp;t=${t}`)
    expect(await weeklyStopTokenValid(env, USER, t)).toBe(true)
    expect(await weeklyStopTokenValid(env, USER, await morningStopToken(env, USER))).toBe(false)
  })
})
