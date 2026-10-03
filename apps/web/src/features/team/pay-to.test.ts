import { describe, expect, it } from 'vitest'
import { missingPayToText } from './pay-to'

describe('missingPayToText', () => {
  it('promises reminders only to someone with a login', () => {
    expect(missingPayToText('Rahul', true)).toContain('reminded every day')
    const noLogin = missingPayToText('Rahul', false)
    expect(noLogin).not.toContain('reminded')
    expect(noLogin).toContain('Rahul has no login')
  })
})
