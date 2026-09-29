import { describe, expect, it } from 'vitest'
import { accessEmail, accessEmailCopy } from './access-email'
import type { Env } from '../context'

const env = { APP_URL: 'https://studioautopilot.in/' } as unknown as Env
const endsAt = '2026-10-28T10:00:00Z'

describe('trial and plan reminder emails', () => {
  it('says trial or plan, and the date, in plain words', () => {
    expect(accessEmailCopy({ kind: 'd7', isTrial: true, endsAt, name: 'Asha Rao' })).toMatchObject({
      subject: 'Your Studio AutoPilot free trial ends in 7 days',
      heading: 'Hi Asha, 7 days left',
    })
    expect(accessEmailCopy({ kind: 'd7', isTrial: true, endsAt, name: null }).line).toContain('28 October 2026')
    expect(accessEmailCopy({ kind: 'd1', isTrial: false, endsAt, name: null }).subject).toBe('Your Studio AutoPilot plan ends tomorrow')
    expect(accessEmailCopy({ kind: 'ended', isTrial: true, endsAt, name: null }).line).toContain('Your data is safe')
  })

  it('links to the plans and escapes the name', () => {
    const m = accessEmail(env, { kind: 'd1', isTrial: true, endsAt, name: '<b>Evil</b>' })
    expect(m.html).toContain('href="https://studioautopilot.in/settings/subscription"')
    expect(m.html).not.toContain('<b>Evil</b>')
    expect(m.html).toContain('AutoPilot</span>')
  })
})
