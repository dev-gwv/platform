import { describe, expect, it } from 'vitest'
import {
  addDays,
  anchorShootDate,
  computeProjectTotals,
  DEFAULT_DELIVERABLE_RULE,
  deliverableDueDate,
  deliverableEstimatedDate,
  deliverableRuleForTitle,
  deliverableTimings,
  findStudioType,
  findWeddingShoot,
  internalLeadDaysForTitle,
  qualifiesForCharge,
  type DeliverableForTotal,
  type StudioDeliverableType,
} from './projects'

const d = (over: Partial<DeliverableForTotal> = {}): DeliverableForTotal => ({
  visibility_scope: 'client',
  show_on_quotation: true,
  is_additional_charge: true,
  additional_charge_amount: 1000,
  ...over,
})

describe('qualifiesForCharge — all three flags required', () => {
  it('qualifies when client-visible + on quotation + additional charge', () => {
    expect(qualifiesForCharge(d())).toBe(true)
  })
  it('internal deliverables never qualify', () => {
    expect(qualifiesForCharge(d({ visibility_scope: 'internal' }))).toBe(false)
  })
  it('off-quotation never qualifies', () => {
    expect(qualifiesForCharge(d({ show_on_quotation: false }))).toBe(false)
  })
  it('non-charge deliverables never qualify', () => {
    expect(qualifiesForCharge(d({ is_additional_charge: false }))).toBe(false)
  })
})

describe('computeProjectTotals', () => {
  it('total = package with no qualifying deliverables', () => {
    const t = computeProjectTotals(50000, [d({ is_additional_charge: false })])
    expect(t.additional_deliverables_cost).toBe(0)
    expect(t.total_cost).toBe(50000)
  })

  it('sums only qualifying deliverables into additional + total', () => {
    const t = computeProjectTotals(50000, [
      d({ additional_charge_amount: 5000 }), // qualifies
      d({ additional_charge_amount: 3000 }), // qualifies
      d({ visibility_scope: 'internal', additional_charge_amount: 9999 }), // no
      d({ show_on_quotation: false, additional_charge_amount: 9999 }), // no
      d({ is_additional_charge: false, additional_charge_amount: 9999 }), // no
    ])
    expect(t.additional_deliverables_cost).toBe(8000)
    expect(t.total_cost).toBe(58000)
  })

  it('rounds to the paisa', () => {
    const t = computeProjectTotals(0, [
      d({ additional_charge_amount: 33.333 }),
      d({ additional_charge_amount: 33.333 }),
    ])
    expect(t.total_cost).toBe(66.67)
  })
})

const shoot = (shoot_date: string | null) => ({ shoot_date })

describe('anchorShootDate', () => {
  const shoots = [shoot('2026-11-20'), shoot('2026-11-22'), shoot('2026-11-18')]

  it('anchors a whole-project deliverable to the LAST shoot', () => {
    // Editing cannot start until everything is shot, so the latest date wins —
    // not the first, and not the order they were typed in.
    expect(anchorShootDate('whole_project', shoots)).toBe('2026-11-22')
    expect(anchorShootDate('specific_shoots', shoots)).toBe('2026-11-22')
  })

  it('anchors a pinned deliverable to its own shoot', () => {
    expect(anchorShootDate('this_shoot', shoots, 0)).toBe('2026-11-20')
    expect(anchorShootDate('this_shoot', shoots, 2)).toBe('2026-11-18')
  })

  it('has no anchor when the shoot it points at is gone or undated', () => {
    expect(anchorShootDate('this_shoot', shoots, 9)).toBeNull()
    expect(anchorShootDate('this_shoot', shoots)).toBeNull()
    expect(anchorShootDate('this_shoot', [shoot(null)], 0)).toBeNull()
  })

  it('ignores undated shoots rather than treating them as today', () => {
    expect(anchorShootDate('whole_project', [shoot(null), shoot('2026-01-05')])).toBe('2026-01-05')
    expect(anchorShootDate('whole_project', [shoot(null)])).toBeNull()
    expect(anchorShootDate('whole_project', [])).toBeNull()
  })

  it('never anchors a no_data deliverable', () => {
    expect(anchorShootDate('no_data', shoots, 0)).toBeNull()
  })
})

describe('addDays', () => {
  it('crosses months and years', () => {
    expect(addDays('2026-11-22', 45)).toBe('2027-01-06')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
  })

  it('handles a leap day and a zero-day lead', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-06-01', 0)).toBe('2026-06-01')
  })

  it('leaves an unparseable date alone', () => {
    expect(addDays('not-a-date', 5)).toBe('not-a-date')
  })
})

describe('deliverableEstimatedDate', () => {
  const shoots = [shoot('2026-11-20'), shoot('2026-11-22')]

  it('is the anchor plus the lead time', () => {
    expect(deliverableEstimatedDate('whole_project', shoots, 45)).toBe('2027-01-06')
    expect(deliverableEstimatedDate('this_shoot', shoots, 7, 0)).toBe('2026-11-27')
  })

  it('stays unknown when either half is missing', () => {
    // A guessed delivery date is worse than none — the client is quoted from it.
    expect(deliverableEstimatedDate('whole_project', shoots, undefined)).toBeNull()
    expect(deliverableEstimatedDate('whole_project', [], 45)).toBeNull()
    expect(deliverableEstimatedDate('no_data', shoots, 45)).toBeNull()
  })
})

describe('due basis — what the client was promised', () => {
  const shoots = [
    { name: 'Haldi', shoot_date: '2026-11-20' },
    { name: 'Wedding Day', shoot_date: '2026-11-22' },
    { name: 'Reception', shoot_date: '2026-11-23' },
  ]

  it('anchors on the wedding day, not the last shoot', () => {
    expect(deliverableDueDate('after_wedding_day', shoots, 45, null, '2026-09-07')).toBe(
      '2027-01-06',
    )
    expect(deliverableDueDate('after_last_shoot', shoots, 45, null, '2026-09-07')).toBe(
      '2027-01-07',
    )
  })

  it('falls back to any wedding-ish shoot when none is named "Wedding Day"', () => {
    const loose = [{ name: 'Wedding Reception', shoot_date: '2026-11-23' }]
    expect(findWeddingShoot(loose)?.shoot_date).toBe('2026-11-23')
    expect(findWeddingShoot([{ name: 'Haldi', shoot_date: '2026-11-20' }])).toBeNull()
  })

  it('counts from today when the basis is the project itself', () => {
    expect(deliverableDueDate('after_project_created', [], 10, null, '2026-09-07')).toBe(
      '2026-09-17',
    )
  })

  it('takes a custom date verbatim and ignores the day count', () => {
    expect(deliverableDueDate('custom', shoots, 45, '2027-02-01', '2026-09-07')).toBe('2027-02-01')
    expect(deliverableDueDate('custom', shoots, 45, '', '2026-09-07')).toBeNull()
  })

  it('counts the day count from a custom date, unlike plain "custom"', () => {
    expect(deliverableDueDate('custom_after', shoots, 45, '2027-02-01', '2026-09-07')).toBe('2027-03-18')
    expect(deliverableDueDate('custom_after', shoots, undefined, '2027-02-01', '2026-09-07')).toBeNull()
    expect(deliverableDueDate('custom_after', shoots, 45, '', '2026-09-07')).toBeNull()
  })

  it('has no answer when the anchor day is unknown', () => {
    const undated = [{ name: 'Wedding Day', shoot_date: null }]
    expect(deliverableDueDate('after_wedding_day', undated, 45, null, '2026-09-07')).toBeNull()
    expect(deliverableDueDate('after_wedding_day', shoots, undefined, null, '2026-09-07')).toBeNull()
  })
})

describe('deliverableRuleForTitle', () => {
  it('matches the longer name first', () => {
    expect(deliverableRuleForTitle('Full Wedding Film').due_days).toBe(60)
    expect(deliverableRuleForTitle('Highlight Film').due_days).toBe(30)
    expect(deliverableRuleForTitle('Reel').due_days).toBe(7)
  })

  it('reads a title that merely contains a known kind', () => {
    const rule = deliverableRuleForTitle('Haldi Teaser')
    expect(rule).toEqual({ due_days: 7, due_basis: 'after_wedding_day' })
  })

  it('photo work counts from the last shoot, film work from the wedding', () => {
    expect(deliverableRuleForTitle('Edited Photos').due_basis).toBe('after_last_shoot')
    expect(deliverableRuleForTitle('Cinematic Film').due_basis).toBe('after_wedding_day')
  })

  it('falls back to thirty days for anything unrecognised', () => {
    expect(deliverableRuleForTitle('Mandap Drone Timelapse')).toEqual(DEFAULT_DELIVERABLE_RULE)
    expect(deliverableRuleForTitle('  ')).toEqual(DEFAULT_DELIVERABLE_RULE)
  })
})

describe('internalLeadDaysForTitle', () => {
  it('turns raw work around fast and films slowly', () => {
    expect(internalLeadDaysForTitle('Data Sorting')).toBe(1)
    expect(internalLeadDaysForTitle('Raw Photos')).toBe(2)
    expect(internalLeadDaysForTitle('Wedding Film')).toBe(30)
    expect(internalLeadDaysForTitle('Edited Photos')).toBe(7)
  })
})

describe('deliverableTimings', () => {
  const type = (over: Partial<StudioDeliverableType> = {}): StudioDeliverableType => ({
    title: 'Photo Album',
    due_days: 120,
    due_basis: 'after_last_shoot',
    work_days: 20,
    ...over,
  })

  it('takes the studio’s own numbers for a name it has set', () => {
    expect(deliverableTimings('Photo Album', [type()])).toMatchObject({
      due_days: 120,
      due_basis: 'after_last_shoot',
      work_days: 20,
    })
  })

  it('matches the whole name, ignoring case and spaces at the ends', () => {
    expect(findStudioType([type()], '  photo ALBUM ')?.title).toBe('Photo Album')
    // "Photo Album Cover" is a different thing, whatever the built-in rules think.
    expect(findStudioType([type()], 'Photo Album Cover')).toBeNull()
    expect(findStudioType([type()], '   ')).toBeNull()
  })

  it('falls back to the built-in numbers for anything the type leaves unset', () => {
    const t = deliverableTimings('Photo Album', [type({ due_days: null, due_basis: null, work_days: null })])
    expect(t.own).not.toBeNull()
    expect(t).toMatchObject({
      due_days: deliverableRuleForTitle('Photo Album').due_days,
      due_basis: deliverableRuleForTitle('Photo Album').due_basis,
      work_days: internalLeadDaysForTitle('Photo Album'),
    })
  })

  it('keeps zero as zero rather than reading it as unset', () => {
    expect(deliverableTimings('Photo Album', [type({ work_days: 0, due_days: 0 })])).toMatchObject({
      due_days: 0,
      work_days: 0,
    })
  })

  it('ignores an archived type and a basis a type cannot have', () => {
    expect(deliverableTimings('Photo Album', [type({ is_archived: true })]).own).toBeNull()
    expect(deliverableTimings('Photo Album', [type({ due_basis: 'custom' })]).due_basis).toBe(
      deliverableRuleForTitle('Photo Album').due_basis,
    )
  })

  it('is the built-in rule when the studio has no type of that name', () => {
    expect(deliverableTimings('Cinematic Film', [type()])).toEqual({
      due_days: 60,
      due_basis: 'after_wedding_day',
      work_days: 30,
      own: null,
    })
    expect(deliverableTimings('Cinematic Film')).toEqual(deliverableTimings('Cinematic Film', [type()]))
  })
})
