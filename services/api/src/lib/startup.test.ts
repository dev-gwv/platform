import { describe, expect, it } from 'vitest'
import { missingRequiredEnv } from './startup'

describe('missingRequiredEnv', () => {
  it('requires nothing outside production', () => {
    expect(missingRequiredEnv({ ENVIRONMENT: 'test' })).toEqual([])
    expect(missingRequiredEnv({})).toEqual([])
  })

  it('names each missing or blank secret in production', () => {
    expect(missingRequiredEnv({ ENVIRONMENT: 'production', DATABASE_URL: 'postgres://x', JWT_SECRET: '  ' })).toEqual([
      'JWT_SECRET',
      'CRON_SECRET',
    ])
    expect(
      missingRequiredEnv({ ENVIRONMENT: 'production', DATABASE_URL: 'postgres://x', JWT_SECRET: 's', CRON_SECRET: 'c' }),
    ).toEqual([])
  })
})
