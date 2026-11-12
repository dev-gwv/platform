import { describe, expect, it } from 'vitest'
import { nextSetupStep, setupCountLine, setupProgress, setupStepTarget, showSetupProgress } from './setup-progress'

const none = { teammates: 0, clients: 0, projects: 0, quotation: false, logo: false }
const now = new Date('2026-11-12T10:00:00Z')

describe('setupProgress', () => {
  it('ticks the account at once and nothing else in a new studio', () => {
    const s = setupProgress(none)
    expect(s.map((x) => x.step.key)).toEqual(['account', 'team', 'client', 'project', 'quotation', 'studio'])
    expect(s.filter((x) => x.done).map((x) => x.step.key)).toEqual(['account'])
    expect(nextSetupStep(s)?.step.key).toBe('team')
    expect(setupCountLine(s)).toBe('1 of 6 done')
  })
  it('ticks each step from the data, in any order', () => {
    const s = setupProgress({ ...none, clients: 1, quotation: true })
    expect(nextSetupStep(s)?.step.key).toBe('team')
    expect(s.find((x) => x.step.key === 'client')?.done).toBe(true)
    expect(setupCountLine(s)).toBe('3 of 6 done')
  })
  it('offers the optional step only once the required ones are done', () => {
    const s = setupProgress({ teammates: 2, clients: 1, projects: 1, quotation: true, logo: false })
    expect(nextSetupStep(s)?.step.key).toBe('studio')
  })
})

describe('showSetupProgress', () => {
  const fresh = setupProgress(none)
  it('shows for a new studio', () => {
    expect(showSetupProgress(fresh, '2026-11-10T00:00:00Z', false, now)).toBe(true)
  })
  it('steps back when closed, after 60 days, or once the required steps are done', () => {
    expect(showSetupProgress(fresh, '2026-11-10T00:00:00Z', true, now)).toBe(false)
    expect(showSetupProgress(fresh, '2026-08-01T00:00:00Z', false, now)).toBe(false)
    const done = setupProgress({ teammates: 1, clients: 1, projects: 1, quotation: true, logo: false })
    expect(showSetupProgress(done, '2026-11-10T00:00:00Z', false, now)).toBe(false)
  })
})

describe('setupStepTarget', () => {
  const team = setupProgress(none)[1]!.step
  it('goes the way setup goes while setup is open', () => {
    expect(setupStepTarget(team, true)).toEqual({ to: '/employees', search: { add: 'choose', from: 'setup' } })
  })
  it('goes straight to the job once setup is closed', () => {
    expect(setupStepTarget(team, false)).toEqual({ to: '/employees', search: { add: 'bulk' } })
    const quotation = setupProgress(none)[4]!.step
    expect(setupStepTarget(quotation, true)).toEqual({ to: '/projects' })
  })
})
