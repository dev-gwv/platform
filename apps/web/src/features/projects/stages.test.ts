import { describe, expect, it } from 'vitest'
import type { DeliverableStage } from '@ipc/contracts'
import { actionLabel, forwardPath, movedLabel, nextPoint, stageName, stageTone, toneOf, wantsLinkAt } from './stages'

const st = (code: string, label: string, stage: DeliverableStage['stage'], sort: number, color = 'slate', team = true): DeliverableStage => ({
  id: `00000000-0000-4000-8000-${String(sort).padStart(12, '0')}`,
  code,
  label,
  stage,
  color,
  team_allowed: team,
  sort_order: sort,
})

const DEFAULTS = [
  st('changes_requested', 'Changes requested', 'in_progress', 10, 'rose'),
  st('with_manager', 'With manager', 'review', 10, 'violet'),
  st('approved', 'Approved', 'review', 20, 'teal', false),
  st('with_client', 'With client', 'review', 30, 'amber'),
  st('client_approved', 'Client approved', 'review', 40, 'green', false),
]

describe('stage names and colours', () => {
  it('names the stage, or the step when there is none', () => {
    expect(stageName({ status: 'review', custom_status_code: 'with_client' }, DEFAULTS)).toBe('With client')
    expect(stageName({ status: 'review' }, DEFAULTS)).toBe('Review')
    expect(stageName({ status: 'in_progress', custom_status_code: 'gone' }, DEFAULTS)).toBe('Editing')
    expect(stageName({ status: 'cancelled' }, DEFAULTS)).toBe('Dropped')
  })

  it('colours by the named stage, else the step', () => {
    expect(stageTone({ status: 'review', custom_status_code: 'approved' }, DEFAULTS)).toBe('teal')
    expect(stageTone({ status: 'in_progress' }, DEFAULTS)).toBe('blue')
    expect(toneOf('emerald')).toBe('green')
    expect(toneOf('nonsense', 'amber')).toBe('amber')
  })

  it('reads old and new timeline events', () => {
    expect(movedLabel('moved:review:with_manager', DEFAULTS)).toBe('With manager')
    expect(movedLabel('moved:review', DEFAULTS)).toBe('Review')
    expect(movedLabel('moved:completed', DEFAULTS)).toBe('Delivered')
  })
})

describe('the one-tap road forward', () => {
  it('walks To do, Editing, each review stage, then Delivered -- never into "sent back"', () => {
    expect(forwardPath(DEFAULTS).map((p) => p.code ?? p.status)).toEqual([
      'pending',
      'in_progress',
      'with_manager',
      'approved',
      'with_client',
      'client_approved',
      'completed',
    ])
  })

  it('is the plain four steps for a studio with no named stages', () => {
    expect(forwardPath([]).map((p) => p.status)).toEqual(['pending', 'in_progress', 'review', 'completed'])
    expect(nextPoint({ status: 'in_progress' }, [])).toMatchObject({ status: 'review', code: null })
  })

  it('goes from wherever it is to the next stop, sent-back work included', () => {
    expect(nextPoint({ status: 'pending' }, DEFAULTS)).toMatchObject({ status: 'in_progress', code: null })
    expect(nextPoint({ status: 'in_progress' }, DEFAULTS)).toMatchObject({ status: 'review', code: 'with_manager' })
    expect(nextPoint({ status: 'in_progress', custom_status_code: 'changes_requested' }, DEFAULTS)).toMatchObject({ code: 'with_manager' })
    expect(nextPoint({ status: 'review', custom_status_code: 'with_manager' }, DEFAULTS)).toMatchObject({ code: 'approved', team_allowed: false })
    expect(nextPoint({ status: 'review', custom_status_code: 'client_approved' }, DEFAULTS)).toMatchObject({ status: 'completed' })
    // Review with no named stage (from before) carries on from the last review stop.
    expect(nextPoint({ status: 'review' }, DEFAULTS)).toMatchObject({ status: 'completed' })
    expect(nextPoint({ status: 'completed' }, DEFAULTS)).toBeNull()
    expect(nextPoint({ status: 'cancelled' }, DEFAULTS)).toBeNull()
  })

  it('says what the button does, and asks for the link when work goes out', () => {
    const path = forwardPath(DEFAULTS)
    expect(path.slice(1).map(actionLabel)).toEqual([
      'Start editing',
      'Send for review',
      'Approve',
      'Sent to client',
      'Client approved',
      'Mark delivered',
    ])
    expect(path.map(wantsLinkAt)).toEqual([false, false, true, false, true, false, true])
    const custom = forwardPath([st('grading', 'Colour grading', 'in_progress', 5, 'violet')])
    expect(custom.map((p) => p.code ?? p.status)).toEqual(['pending', 'in_progress', 'grading', 'review', 'completed'])
    expect(actionLabel(custom[2]!)).toBe('Colour grading')
  })
})
