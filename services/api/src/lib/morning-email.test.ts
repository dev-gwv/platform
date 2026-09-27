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

  it('carries a stop link that only works for this person', async () => {
    const m = await morningMail(env, facts({ tasks: 2 }))
    const t = await morningStopToken(env, USER)
    expect(m.html).toContain(`https://app.test/stop-emails?m=${USER}&amp;t=${t}`)
    expect(await morningStopTokenValid(env, USER, t)).toBe(true)
    expect(await morningStopTokenValid(env, '33333333-3333-4333-8333-333333333333', t)).toBe(false)
  })
})
