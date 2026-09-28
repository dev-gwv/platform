import { describe, expect, it } from 'vitest'
import { shootNextStep } from './next-step'

const base = { shoot_date: '2026-11-07', location: 'Taj, Jaipur', roles: 2, assigned: 0, required: 3 }

describe('shootNextStep', () => {
  it('walks date → venue → roles → assign → ready', () => {
    expect(shootNextStep({ ...base, shoot_date: null }).key).toBe('date')
    expect(shootNextStep({ ...base, dateIsPlaceholder: true }).key).toBe('date')
    expect(shootNextStep({ ...base, location: null }).key).toBe('venue')
    expect(shootNextStep({ ...base, roles: 0 }).key).toBe('roles')
    expect(shootNextStep(base)).toMatchObject({ key: 'assign', label: 'Assign your team · 0 of 3 done', tone: 'amber' })
    expect(shootNextStep({ ...base, assigned: 3 })).toMatchObject({ key: 'ready', tone: 'green' })
  })
})
