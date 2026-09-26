import { describe, it, expect } from 'vitest'
import {
  buildJourney,
  isSetupAudience,
  JOURNEY_STEPS,
  nextStep,
  setupLanding,
  stepForPath,
  type StudioSignals,
} from './journey'

const EMPTY: StudioSignals = { teammates: 0, clients: 0, projects: 0 }
const ALL: StudioSignals = { teammates: 2, clients: 3, projects: 1 }

const state = (s: StudioSignals, key: string) =>
  buildJourney(s).steps.find((x) => x.key === key)?.state

describe('buildJourney', () => {
  it('has exactly three steps: team, client, project', () => {
    expect(JOURNEY_STEPS.map((s) => s.key)).toEqual(['team', 'client', 'project'])
  })

  it('starts a fresh studio at 0 of 3 with the team step current', () => {
    const j = buildJourney(EMPTY)
    expect(j.completed).toBe(0)
    expect(j.total).toBe(3)
    expect(j.allDone).toBe(false)
    expect(j.current?.key).toBe('team')
    expect(j.steps.map((s) => s.state)).toEqual(['current', 'upcoming', 'upcoming'])
  })

  it('does not count the owner as a teammate', () => {
    expect(state(EMPTY, 'team')).toBe('current')
    expect(state({ ...EMPTY, teammates: 1 }, 'team')).toBe('done')
  })

  it('walks team -> client -> project -> done', () => {
    expect(buildJourney({ ...EMPTY, teammates: 1 }).current?.key).toBe('client')
    expect(buildJourney({ ...EMPTY, teammates: 1, clients: 1 }).current?.key).toBe('project')
    const done = buildJourney(ALL)
    expect(done.current).toBeNull()
    expect(done.allDone).toBe(true)
    expect(done.completed).toBe(3)
  })

  it('points current at the FIRST outstanding step, not the one after the last done', () => {
    const s = { ...EMPTY, clients: 1, projects: 1 }
    expect(state(s, 'team')).toBe('current')
    expect(state(s, 'client')).toBe('done')
    expect(buildJourney(s).completed).toBe(2)
  })

  it('has exactly one current step while any remain', () => {
    for (const s of [EMPTY, { ...EMPTY, teammates: 5 }, { ...ALL, clients: 0 }]) {
      expect(buildJourney(s).steps.filter((x) => x.state === 'current')).toHaveLength(1)
    }
  })

  it('numbers steps from 1 in order', () => {
    expect(buildJourney(EMPTY).steps.map((s) => s.step)).toEqual([1, 2, 3])
  })

  it('hides steps whose module the user cannot reach, and renumbers', () => {
    const j = buildJourney(EMPTY, (m) => m !== 'clients')
    expect(j.steps.map((s) => s.key)).toEqual(['team', 'project'])
    expect(j.steps.map((s) => s.step)).toEqual([1, 2])
  })

  it('marks every step as opened from setup', () => {
    for (const s of JOURNEY_STEPS) {
      expect(s.action.to.startsWith('/')).toBe(true)
      expect(s.action.search.from).toBe('setup')
    }
  })
})

describe('stepForPath / nextStep', () => {
  it('finds the step a page belongs to', () => {
    expect(stepForPath('/employees')?.step).toBe(1)
    expect(stepForPath('/clients/')?.step).toBe(2)
    expect(stepForPath('/projects/new')?.key).toBe('project')
    expect(stepForPath('/billing/invoices')).toBeNull()
  })

  it('goes to the next step, and nowhere after the last', () => {
    expect(nextStep('team')?.key).toBe('client')
    expect(nextStep('team')?.step).toBe(2)
    expect(nextStep('client')?.action.to).toBe('/projects/new')
    expect(nextStep('project')).toBeNull()
  })
})

describe('setupLanding', () => {
  const owner = { is_owner: true, role: 'super_admin', setup_done: false, setup_step: 1 }

  it('lands a new owner on the current step page', () => {
    expect(setupLanding(owner)).toEqual({ to: '/employees', search: { add: 'choose', from: 'setup' } })
    expect(setupLanding({ ...owner, setup_step: 2 })?.to).toBe('/clients')
    expect(setupLanding({ ...owner, setup_step: 3 })?.to).toBe('/projects/new')
  })

  it('lands on the dashboard once setup is done or skipped', () => {
    expect(setupLanding({ ...owner, setup_done: true })).toBeNull()
    expect(setupLanding({ ...owner, setup_step: null })).toBeNull()
    expect(setupLanding(null)).toBeNull()
  })

  it('never walks an employee or manager through setup', () => {
    expect(setupLanding({ ...owner, is_owner: false, role: 'employee' })).toBeNull()
    expect(setupLanding({ ...owner, is_owner: false, role: 'manager' })).toBeNull()
    expect(isSetupAudience({ is_owner: false, role: 'admin' })).toBe(true)
  })
})
