import { describe, expect, it } from 'vitest'
import type { Env } from '../context'
import { morningMail, morningStopToken, morningStopTokenValid, type MorningFacts } from './morning-email'

const env = { APP_URL: 'https://app.test/', JWT_SECRET: 'secret-for-tests' } as Env
const USER = '22222222-2222-4222-8222-222222222222'

const facts = (over: Partial<MorningFacts> = {}): MorningFacts => ({
  userId: USER,
  name: 'Asha Rao',
  studio: 'Asha Studio',
  day: '2026-10-05',
  shoots: [],
  newLeads: 0,
  followUps: 0,
  tasks: 0,
  overdueCount: 0,
  overdueAmount: 0,
  ...over,
})

describe('morning email', () => {
  it('shows only the blocks with something in them, and says so in the subject', async () => {
    const m = await morningMail(env, facts({ shoots: [{ name: 'Haldi', time: '11:00 am', place: 'Jaipur' }], overdueCount: 2, overdueAmount: 45000 }))
    expect(m.subject).toBe('Today: 1 shoot · ₹45,000 overdue')
    expect(m.html).toContain('Good morning, Asha')
    expect(m.html).toContain('Haldi')
    expect(m.html).toContain('https://app.test/billing/invoices?status=overdue')
    expect(m.html).not.toContain('>Leads<')
    expect(m.html).not.toContain('>Tasks<')
  })

  it('counts leads and tasks in plain words', async () => {
    const m = await morningMail(env, facts({ newLeads: 3, followUps: 1, tasks: 1 }))
    expect(m.html).toContain('3 new leads since yesterday')
    expect(m.html).toContain('1 follow-up due today')
    expect(m.html).toContain('1 task is due or late')
  })

  it('says which leads are going cold and what each caller did yesterday', async () => {
    const m = await morningMail(env, facts({ coldUncalled: 2, coldOldestDays: 4, coldQuietQuotes: 1, coldStuck: 0, yesterday: [{ name: 'Ravi Kumar', calls: 5, answered: 2, quotes: 1, booked: 1 }] }))
    expect(m.subject).toBe('Today: 3 going cold')
    expect(m.html).toContain('2 leads nobody has called yet (the oldest 4 days ago)')
    expect(m.html).toContain('1 quotation quiet for 3 days or more')
    expect(m.html).not.toContain('stuck in the same stage')
    expect(m.html).toContain('https://app.test/follow-ups/queue')
    expect(m.html).toContain('<strong>Ravi</strong> · 5 calls (2 answered) · 1 quotation · <strong>1 booked</strong>')
  })

  it('carries a stop link that only works for this person', async () => {
    const m = await morningMail(env, facts({ tasks: 2 }))
    const t = await morningStopToken(env, USER)
    expect(m.html).toContain(`https://app.test/stop-emails?m=${USER}&amp;t=${t}`)
    expect(await morningStopTokenValid(env, USER, t)).toBe(true)
    expect(await morningStopTokenValid(env, '33333333-3333-4333-8333-333333333333', t)).toBe(false)
  })
})
