import { describe, expect, it } from 'vitest'
import { inviteMessage, legacyDaysLeft, legacyState, parseLegacyCsv } from './legacy'

const EXPORT = [
  '﻿Studio Name,Owner Name,Email,Phone,Created Date,Status,Expiry Date,Days Left,Plan,Company ID,Owner UID',
  'ARK PICTURES,AHMED RAZA,ArkPicturesIndia@gmail.com,8586903738,2026-09-28,Active,2026-10-28,28,monthly,c-1,u-1',
  '"S c star, photography",Shrivesh,scstar@gmail.com,7498929767,2026-09-27,Expired,2025-01-01,0,,c-2,u-2',
  ',,,,,,,,,,',
  'No id studio,X,x@y.z,1,2026-01-01,Active,2026-12-01,1,,,u-3',
].join('\n')

describe('old app Studio Access export', () => {
  it('reads every studio, lower-cases the email and keeps quoted commas', () => {
    const r = parseLegacyCsv(EXPORT)!
    expect(r.rows).toHaveLength(2)
    expect(r.skipped).toBe(1)
    expect(r.rows[0]).toMatchObject({ old_company_id: 'c-1', studio_name: 'ARK PICTURES', email: 'arkpicturesindia@gmail.com', expires_at: '2026-10-28', plan: 'monthly' })
    expect(r.rows[1]).toMatchObject({ studio_name: 'S c star, photography', plan: null, expires_at: '2025-01-01' })
  })

  it('refuses a file that is not that export', () => {
    expect(parseLegacyCsv('Name,Phone\nA,1')).toBeNull()
  })

  it('says active, expiring soon or expired like the old board', () => {
    expect(legacyState('2026-10-28', '2026-09-30')).toBe('active')
    expect(legacyState('2026-10-05', '2026-09-30')).toBe('soon')
    expect(legacyState('2026-09-29', '2026-09-30')).toBe('expired')
    expect(legacyState(null)).toBe('unknown')
    expect(legacyDaysLeft('2026-10-28', '2026-09-30')).toBe(28)
  })

  it('invites them with their email and the time that carries over', () => {
    const m = inviteMessage({ owner_name: 'AHMED RAZA', studio_name: 'ARK PICTURES', email: 'ark@x.com', expires_at: '2999-01-01' })
    expect(m).toContain('Hi AHMED')
    expect(m).toContain('with ark@x.com')
    expect(m).toContain('carries over')
  })
})
