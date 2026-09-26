import { describe, expect, it } from 'vitest'
import type { CrmLead } from '@ipc/contracts'
import { allDone, remaining, startSteps } from './getting-started'
import { ALL_GROUPS, NO_GROUP, groupsOf, inGroup } from './FilterBar'

const lead = (over: Partial<CrmLead> = {}): CrmLead =>
  ({
    id: `id-${Math.random()}`,
    name: 'Aanya',
    phone: '9876543210',
    email: null,
    source: 'enquiry',
    status: 'new',
    assigned_to: null,
    assignee_name: null,
    notes: null,
    follow_up_at: null,
    last_contacted_at: null,
    converted_at: null,
    is_hot: false,
    quality: null,
    contacted_status: 'uncontacted',
    is_archived: false,
    merged_into: null,
    converted_project_id: null,
    converted_client_id: null,
    deal_value: null,
    probability: null,
    lost_reason: null,
    lost_competitor: null,
    sla_due_at: null,
    pipeline_id: null,
    stage_id: null,
    stage_name: null,
    contact_id: null,
    crm_company_id: null,
    crm_company_name: null,
    title: null,
    close_date: null,
    event_type: null,
    event_date: null,
    event_location: null,
    alternate_phone: null,
    city: null,
    currency: 'INR',
    score: 0,
    group_name: null,
    date_status: 'unknown',
    date_wanted_by: 0,
    created_at: '2026-09-01T00:00:00.000Z',
    ...over,
  }) as CrmLead

const EMPTY = { leads: [], sourceCount: 0, templateCount: 0, rotaCount: 0 }

describe('startSteps', () => {
  it('is all outstanding for a brand new studio', () => {
    const steps = startSteps(EMPTY)
    expect(steps).toHaveLength(5)
    expect(remaining(steps)).toBe(5)
    expect(allDone(steps)).toBe(false)
  })

  // Every step reads from data the page already has, so a checklist cannot
  // sit there telling a studio to do something it did last month.
  it('marks each step done from real data, not a stored flag', () => {
    const steps = startSteps({
      leads: [lead({ follow_up_at: '2026-10-01T10:00:00.000Z' })],
      sourceCount: 1,
      templateCount: 2,
      rotaCount: 3,
    })
    expect(allDone(steps)).toBe(true)
    expect(remaining(steps)).toBe(0)
  })

  it('counts a lead without a promised call-back as still owing that step', () => {
    const steps = startSteps({ ...EMPTY, leads: [lead()] })
    const byKey = Object.fromEntries(steps.map((s) => [s.key, s.done]))
    expect(byKey['lead']).toBe(true)
    expect(byKey['followup']).toBe(false)
  })

  it('sends each step where the work actually happens', () => {
    const byKey = Object.fromEntries(startSteps(EMPTY).map((s) => [s.key, s]))
    expect(byKey['source']!.to).toBe('/lead-sources')
    expect(byKey['template']!.to).toBe('/follow-ups/setup')
    expect(byKey['template']!.search).toEqual({ section: 'templates' })
    expect(byKey['rota']!.search).toEqual({ section: 'distribution' })
  })
})

describe('groups', () => {
  const leads = [
    lead({ group_name: 'Wedding 2027' }),
    lead({ group_name: 'Corporate' }),
    lead({ group_name: 'Wedding 2027' }),
    lead({ group_name: null }),
    lead({ group_name: '   ' }),
  ]

  it('lists each group once, in reading order', () => {
    expect(groupsOf(leads)).toEqual(['Corporate', 'Wedding 2027'])
  })

  it('treats a group of only spaces as no group at all', () => {
    expect(groupsOf([lead({ group_name: '  ' })])).toEqual([])
    expect(inGroup(leads, NO_GROUP)).toHaveLength(2)
  })

  it('narrows to one group, and All returns everything', () => {
    expect(inGroup(leads, 'Wedding 2027')).toHaveLength(2)
    expect(inGroup(leads, 'Corporate')).toHaveLength(1)
    expect(inGroup(leads, ALL_GROUPS)).toHaveLength(5)
  })

  it('matches on the trimmed name, because a typed field collects spaces', () => {
    expect(inGroup([lead({ group_name: ' Corporate ' })], 'Corporate')).toHaveLength(1)
  })

  it('returns a copy for All, so a caller cannot sort the source list', () => {
    const source = [lead()]
    expect(inGroup(source, ALL_GROUPS)).not.toBe(source)
  })
})
