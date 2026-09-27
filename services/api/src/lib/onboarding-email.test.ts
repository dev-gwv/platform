import { describe, expect, it } from 'vitest'
import type { Env } from '../context'
import { nudgeMail, stopToken, stopTokenValid, welcomeMail } from './onboarding-email'

const env = { APP_URL: 'https://app.test/', JWT_SECRET: 'secret-for-tests' } as Env
const COMPANY = '11111111-1111-4111-8111-111111111111'

describe('welcome email', () => {
  it('greets by first name and shows all three steps with both buttons', async () => {
    const m = await welcomeMail(env, { companyId: COMPANY, name: 'Asha Rao' })
    expect(m.subject).toMatch(/Welcome to Studio AutoPilot/)
    expect(m.html).toContain('Welcome aboard, Asha!')
    for (const k of ['team', 'client', 'project']) {
      expect(m.html).toContain(`https://app.test/help/setup#${k}`)
      expect(m.html).toContain(`https://app.test/email/${k}.png`)
    }
    expect(m.html).toContain('https://app.test/employees?add=choose&amp;from=setup')
  })

  it('shows the call button only when a booking link is set', async () => {
    const without = await welcomeMail(env, { companyId: COMPANY, name: null })
    expect(without.html).not.toContain('Book an onboarding call')
    expect(without.html).toContain('Just reply to this email')
    const withCall = await welcomeMail({ ...env, ONBOARDING_CALL_URL: 'https://cal.test/me' }, { companyId: COMPANY, name: null })
    expect(withCall.html).toContain('Book an onboarding call')
    expect(withCall.html).toContain('https://cal.test/me')
  })

  it('escapes a name that carries markup', async () => {
    const m = await welcomeMail(env, { companyId: COMPANY, name: '<b>Evil</b>' })
    expect(m.html).not.toContain('<b>Evil')
  })
})

describe('nudge email', () => {
  it('ticks the finished steps and offers only the next one', async () => {
    const m = await nudgeMail(env, { companyId: COMPANY, name: 'Asha', step: 2 })
    expect(m.subject).toBe('Next: add your first client')
    expect(m.html).toContain('&#10003; Done')
    expect(m.html).toContain('/help/setup#client')
    expect(m.html).not.toContain('/help/setup#team')
    expect(m.html).not.toContain('Create your first project')
  })
})

describe('stop link', () => {
  it('is signed for one studio only', async () => {
    const t = await stopToken(env, COMPANY)
    expect(await stopTokenValid(env, COMPANY, t)).toBe(true)
    expect(await stopTokenValid(env, '22222222-2222-4222-8222-222222222222', t)).toBe(false)
    expect(await stopTokenValid({ ...env, JWT_SECRET: 'other' }, COMPANY, t)).toBe(false)
    const m = await welcomeMail(env, { companyId: COMPANY, name: null })
    expect(m.html).toContain(`https://app.test/stop-emails?c=${COMPANY}&amp;t=${t}`)
  })
})
