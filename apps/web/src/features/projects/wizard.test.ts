import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  BUILT_IN_SETS,
  EMPTY_DRAFT,
  QUICK_DELIVERABLES,
  SHOOT_PRESET,
  SHOOT_TYPES,
  bucketOf,
  canSubmit,
  deliverablesIn,
  draftTotals,
  estimatedDateFor,
  internalWorkFor,
  internalWorkSuggestions,
  isDirty,
  matchShootTypes,
  newInternalWork,
  newAddOn,
  newClientDeliverable,
  newDeliverable,
  newPayment,
  newShoot,
  removeShootAt,
  shootIssues,
  learnedDeliverables,
  quickDeliverables,
  rememberDeliverables,
  shootStartAt,
  nextStep,
  prevStep,
  recallDueDays,
  rememberDueDays,
  stepErrors,
  toProjectRequest,
  toShootRequests,
  shootDeliverables,
  withDeliverables,
  withShoots,
  type ProjectDraft,
  type ShootDraft,
} from './wizard'

const draft = (over: Partial<ProjectDraft> = {}): ProjectDraft => ({
  ...EMPTY_DRAFT,
  ...over,
})

const named = (over: Partial<ProjectDraft> = {}) =>
  draft({ name: 'Sharma Wedding', client_id: 'client-1', ...over })

describe('stepErrors', () => {
  it('requires a name and a client, and nothing else', () => {
    expect(stepErrors(EMPTY_DRAFT).client).toBe('Give the project a name.')
    expect(stepErrors(draft({ name: 'Sharma Wedding' })).client).toBe('Pick or add a client.')
    // A studio that just wants the project on the board should not have to
    // invent shoots or line items to get past step 2.
    expect(stepErrors(named())).toEqual({})
    expect(canSubmit(named())).toBe(true)
  })

  it('accepts a new client typed in place of a picked one', () => {
    expect(
      stepErrors(draft({ name: 'X', new_client_name: 'Verma Family', new_client_phone: '9876543210' })).client,
    ).toBeUndefined()
  })

  it('requires a phone number for a new client', () => {
    expect(stepErrors(draft({ name: 'X', new_client_name: 'Verma Family' })).client).toBe(
      'New client needs a phone number.',
    )
    expect(
      stepErrors(draft({ name: 'X', new_client_name: 'Verma Family', new_client_phone: '123' })).client,
    ).toBe('That phone number looks too short.')
  })

  it('catches half-filled rows in each section', () => {
    expect(stepErrors(named({ shoots: [newShoot()] })).shoots).toBe('Every shoot needs a name.')
    expect(stepErrors(named({ deliverables: [newDeliverable()] })).deliverables).toBe(
      'Every deliverable needs a title.',
    )
    expect(stepErrors(named({ payments: [newPayment()] })).billing).toBe(
      'Every payment needs an amount.',
    )
  })

  it('will not let a chargeable deliverable ship without a price', () => {
    const d = { ...newDeliverable(), title: 'Album', is_additional_charge: true }
    expect(stepErrors(named({ deliverables: [d] })).deliverables).toBe(
      'A chargeable deliverable needs an amount.',
    )
    expect(
      stepErrors(named({ deliverables: [{ ...d, additional_charge_amount: '15000' }] })).deliverables,
    ).toBeUndefined()
  })

  it('refuses to record more money than the project is worth', () => {
    const over = named({ package_cost: '50000', payments: [{ ...newPayment(), amount: '60000' }] })
    expect(stepErrors(over).billing).toBe('Payments received exceed the project total.')
    // With no price set yet there is nothing to exceed — that is step 4's job.
    expect(stepErrors(named({ payments: [{ ...newPayment(), amount: '60000' }] })).billing).toBeUndefined()
  })

  it('blocks submit on a problem in any step, not just the visible one', () => {
    expect(canSubmit(named({ shoots: [newShoot()] }))).toBe(false)
  })
})

describe('draftTotals', () => {
  const chargeable = (amount: string, over = {}) => ({
    ...newDeliverable(),
    title: 'Album',
    is_additional_charge: true,
    additional_charge_amount: amount,
    ...over,
  })

  it('adds up package, add-ons, received and balance', () => {
    const d = named({
      package_cost: '100000',
      deliverables: [chargeable('15000')],
      payments: [{ ...newPayment(), amount: '40000' }],
    })
    expect(draftTotals(d)).toEqual({
      packageCost: 100000,
      addOns: 15000,
      total: 115000,
      received: 40000,
      balance: 75000,
    })
  })

  it('follows the domain rule: internal and unquoted extras never add to price', () => {
    const internal = chargeable('9000', { visibility_scope: 'internal' })
    const unquoted = chargeable('9000', { show_on_quotation: false })
    expect(draftTotals(named({ deliverables: [internal, unquoted] })).addOns).toBe(0)
  })

  it('treats blank money fields as zero rather than NaN', () => {
    const totals = draftTotals(named({ package_cost: '', payments: [newPayment()] }))
    expect(totals.total).toBe(0)
    expect(totals.received).toBe(0)
  })

  it('never shows a negative balance', () => {
    const d = named({ package_cost: '1000', payments: [{ ...newPayment(), amount: '5000' }] })
    expect(draftTotals(d).balance).toBe(0)
  })
})

describe('estimatedDateFor', () => {
  const twoShoots = named({
    shoots: [
      { ...newShoot(), name: 'Haldi', shoot_date: '2026-11-20' },
      { ...newShoot(), name: 'Wedding', shoot_date: '2026-11-22' },
    ],
  })

  it('dates a deliverable from the last shoot', () => {
    const d = { ...newDeliverable(), title: 'Album', due_basis: 'after_last_shoot' as const, due_days: '45' }
    expect(estimatedDateFor(twoShoots, d)).toBe('2027-01-06')
  })

  it('dates one promised off the wedding from the wedding, not the last day', () => {
    const d = { ...newDeliverable(), title: 'Teaser', due_days: '7' }
    expect(estimatedDateFor(twoShoots, d)).toBe('2026-11-29')
  })

  // The production clock is a separate field, and moving it must not move what
  // the client was told.
  it('ignores the internal lead time', () => {
    const d = { ...newDeliverable(), title: 'Album', due_days: '45', lead_days: '3' }
    expect(estimatedDateFor(twoShoots, d)).toBe('2027-01-06')
  })

  it('stays unknown without shoots or without a day count', () => {
    const d = { ...newDeliverable(), title: 'Album', due_days: '45' }
    expect(estimatedDateFor(named(), d)).toBeNull()
    expect(estimatedDateFor(twoShoots, { ...d, due_days: '' })).toBeNull()
  })
})

describe('toProjectRequest', () => {
  it('drops blank rows instead of sending empties', () => {
    const d = named({
      shoots: [newShoot()],
      deliverables: [newDeliverable(), { ...newDeliverable(), title: 'Album' }],
      payments: [newPayment(), { ...newPayment(), amount: '20000' }],
    })
    const body = toProjectRequest(d, 'client-1')
    expect(body.deliverables).toHaveLength(1)
    expect(body.payments).toHaveLength(1)
    expect(toShootRequests(d, 'p1')).toHaveLength(0)
  })

  it('zeroes the amount on a deliverable that is not chargeable', () => {
    const d = named({
      deliverables: [
        { ...newDeliverable(), title: 'Reel', additional_charge_amount: '5000', is_additional_charge: false },
      ],
    })
    expect(toProjectRequest(d, 'c1').deliverables[0]!.additional_charge_amount).toBe(0)
  })

  it('carries the computed delivery date onto the payload', () => {
    const d = named({
      shoots: [{ ...newShoot(), name: 'Wedding', shoot_date: '2026-11-22' }],
      deliverables: [{ ...newDeliverable(), title: 'Album', due_days: '45', lead_days: '7' }],
    })
    const sent = toProjectRequest(d, 'c1').deliverables[0]!
    expect(sent.estimated_date).toBe('2027-01-06')
    expect(sent.delivery_days_after_start).toBe(7)
  })

  it('holds back a shoot’s team work to add once that shoot exists', () => {
    const d = named({
      shoots: [newShoot(), { ...newShoot(), name: 'Wedding' }],
      deliverables: [
        { ...newDeliverable(), title: 'Album' },
        { ...newInternalWork(1, 'Culling'), show_on_quotation: true },
        // Its shoot has no name, so it will not be created: keep it with the project.
        newInternalWork(0, 'Backup'),
      ],
    })
    expect(toProjectRequest(d, 'c1').deliverables.map((x) => x.title)).toEqual(['Album', 'Backup'])
    const held = shootDeliverables(d)
    expect([...held.keys()]).toEqual([1])
    expect(held.get(1)!.map((x) => [x.title, x.show_on_quotation])).toEqual([['Culling', false]])
    expect(toShootRequests(d, 'p1').map((x) => x.draftIndex)).toEqual([1])
  })

  it('omits optional fields rather than sending blanks', () => {
    const d = named({ deliverables: [{ ...newDeliverable(), title: 'Album' }] })
    const sent = toProjectRequest(d, 'c1').deliverables[0]!
    expect('estimated_date' in sent).toBe(false)
    expect('delivery_days_after_start' in sent).toBe(false)
  })

  it('builds one shoot request per named shoot, pinned to the project', () => {
    const d = named({
      shoots: [
        {
          ...newShoot(),
          name: 'Wedding',
          shoot_date: '2026-11-22',
          start_time: '09:30',
          location: 'Taj',
          map_link: 'https://maps.google.com/?q=taj',
          status: 'confirmed',
          requirements: [
            { name: ' Photographer ', quantity: '2' },
            { name: '', quantity: '1' },
          ],
        },
      ],
    })
    expect(toShootRequests(d, 'proj-9')).toEqual([
      {
        draftIndex: 0,
        project_id: 'proj-9',
        name: 'Wedding',
        status: 'confirmed',
        shoot_date: '2026-11-22',
        start_at: new Date('2026-11-22T09:30').toISOString(),
        location: 'Taj',
        map_link: 'https://maps.google.com/?q=taj',
        requirements: [{ name: 'Photographer', quantity: 2 }],
      },
    ])
  })
})

describe('draft housekeeping', () => {
  it('knows an untouched draft is not worth restoring', () => {
    expect(isDirty(EMPTY_DRAFT)).toBe(false)
    expect(isDirty(draft({ name: 'x' }))).toBe(true)
    expect(isDirty(draft({ shoots: [newShoot()] }))).toBe(true)
    // The default toggle being on is not "work in progress".
    expect(isDirty(draft({ show_quotation: false }))).toBe(false)
  })

  it('walks the steps without falling off either end', () => {
    expect(prevStep('client')).toBe('client')
    expect(nextStep('review')).toBe('review')
    expect(nextStep('client')).toBe('shoots')
    expect(prevStep('billing')).toBe('deliverables')
  })
})

describe('quick-add shoots', () => {
  const named = (...names: string[]) => names.map((name) => ({ ...newShoot(), name }))

  it('appends the names it was given, in order', () => {
    expect(withShoots([], SHOOT_PRESET).map((s) => s.name)).toEqual([
      'Haldi',
      'Mehendi',
      'Wedding Day',
      'Reception',
    ])
  })

  it('skips a day already on the schedule, however it was typed', () => {
    const existing = named('  haldi ', 'Sangeet')
    const after = withShoots(existing, SHOOT_PRESET)
    expect(after.map((s) => s.name)).toEqual([
      '  haldi ',
      'Sangeet',
      'Mehendi',
      'Wedding Day',
      'Reception',
    ])
  })

  // The preset button reads this: nothing to add means nothing to press.
  it('returns the same array when every name is taken', () => {
    const existing = named(...SHOOT_PRESET)
    expect(withShoots(existing, SHOOT_PRESET)).toBe(existing)
  })

  it('leaves the blank rows the Add shoot button makes alone', () => {
    const blank = [newShoot()]
    expect(withShoots(blank, ['Haldi']).map((s) => s.name)).toEqual(['', 'Haldi'])
  })
})

describe('shoot type search', () => {
  it('offers the whole list until something is typed', () => {
    expect(matchShootTypes('')).toHaveLength(SHOOT_TYPES.length)
    expect(matchShootTypes('   ')).toEqual([...SHOOT_TYPES])
  })

  it('matches anywhere in the name, ignoring case', () => {
    expect(matchShootTypes('haldi')).toEqual(['Haldi', 'Haldi Bride', 'Haldi Groom'])
    expect(matchShootTypes('SHOOT')).toEqual(['Couple Shoot', 'Pre-Wedding Shoot'])
    expect(matchShootTypes('cere')).toEqual(['Ring Ceremony'])
  })

  // The menu shows its "add it yourself" footer off the back of this.
  it('comes back empty for a type nobody listed', () => {
    expect(matchShootTypes('drone')).toEqual([])
  })

  it('folds in a studio\'s own saved shoot names, deduped against the common list', () => {
    expect(matchShootTypes('pool', ['Pool Party'])).toEqual(['Pool Party'])
    // Their own "Haldi" preset does not show up twice next to the built-in one.
    expect(matchShootTypes('haldi', ['Haldi', 'Pool Party'])).toEqual(['Haldi', 'Haldi Bride', 'Haldi Groom'])
    expect(matchShootTypes('', ['Pool Party'])).toHaveLength(SHOOT_TYPES.length + 1)
  })
})

describe('the shoot card', () => {
  const shoot = (over: Partial<ShootDraft> = {}): ShootDraft => ({ ...newShoot(), ...over })

  it('names what a shoot is still missing', () => {
    expect(shootIssues(shoot())).toEqual(['Title & date needed', 'Time needed', 'No requirements'])
    expect(shootIssues(shoot({ name: 'Haldi' }))).toEqual(['Title & date needed', 'Time needed', 'No requirements'])
    expect(
      shootIssues(shoot({ name: 'Haldi', shoot_date: '2026-11-20' })),
    ).toEqual(['Time needed', 'No requirements'])
    expect(
      shootIssues(shoot({ name: 'Haldi', shoot_date: '2026-11-20', start_time: '17:30' })),
    ).toEqual(['No requirements'])
    expect(
      shootIssues(
        shoot({
          name: 'Haldi',
          shoot_date: '2026-11-20',
          start_time: '17:30',
          requirements: [{ name: 'Photographer', quantity: '2' }],
        }),
      ),
    ).toEqual([])
  })

  // A row the studio started typing and left blank is not a requirement.
  it('does not count an empty requirement row', () => {
    const s = shoot({ name: 'Haldi', shoot_date: '2026-11-20', start_time: '17:30', requirements: [{ name: '  ', quantity: '1' }] })
    expect(shootIssues(s)).toEqual(['No requirements'])
  })

  it('suggests edit-room work off the shoot name', () => {
    expect(internalWorkSuggestions('Birthday')).toEqual([
      'Birthday Edited Photos',
      'Birthday Reel',
      'Data Sorting',
    ])
    expect(internalWorkSuggestions('  ')).toEqual(['Edited Photos', 'Reel', 'Data Sorting'])
  })

  it('gives a wedding shoot the fuller suggestion set, case-insensitively', () => {
    expect(internalWorkSuggestions('Wedding Day')).toEqual([
      'Wedding Day Raw Photos',
      'Wedding Day Edited Photos',
      'Wedding Day Highlight Film',
      'Full Wedding Film',
      'Wedding Day Reel',
      'Wedding Day Teaser',
      'Full Ceremony Video',
      'Data Sorting',
      'Quality Check',
    ])
    expect(internalWorkSuggestions('WEDDING')).toHaveLength(9)
  })

  it('makes internal work that stays off the quotation and follows its shoot', () => {
    const item = newInternalWork(2, 'Data Sorting')
    expect(item).toMatchObject({
      title: 'Data Sorting',
      visibility_scope: 'internal',
      show_on_quotation: false,
      start_rule: 'this_shoot',
      shoot_index: 2,
    })
  })

  it('finds the internal work belonging to one shoot', () => {
    const d = draft({
      deliverables: [
        newInternalWork(0, 'Haldi Reel'),
        { ...newDeliverable(), title: 'Album', shoot_index: 0, start_rule: 'this_shoot' },
        newInternalWork(1, 'Mehendi Reel'),
      ],
    })
    expect(internalWorkFor(d, 0).map((w) => w.item.title)).toEqual(['Haldi Reel'])
    expect(internalWorkFor(d, 0)[0]?.at).toBe(0)
    expect(internalWorkFor(d, 1).map((w) => w.item.title)).toEqual(['Mehendi Reel'])
  })
})

describe('removing a shoot', () => {
  const three = () =>
    draft({
      shoots: [
        { ...newShoot(), name: 'Haldi' },
        { ...newShoot(), name: 'Mehendi' },
        { ...newShoot(), name: 'Wedding' },
      ],
      deliverables: [
        newInternalWork(0, 'Haldi Reel'),
        newInternalWork(2, 'Wedding Reel'),
        { ...newDeliverable(), title: 'Album', start_rule: 'this_shoot', shoot_index: 0 },
        { ...newDeliverable(), title: 'Teaser', start_rule: 'this_shoot', shoot_index: 2 },
      ],
    })

  it('takes the shoot and its internal work together', () => {
    const after = removeShootAt(three(), 0)
    expect(after.shoots?.map((s) => s.name)).toEqual(['Mehendi', 'Wedding'])
    expect(after.deliverables?.map((d) => d.title)).toEqual(['Wedding Reel', 'Album', 'Teaser'])
  })

  // The client's line item is their money — it survives, unpinned.
  it('keeps a client deliverable and lets go of the day it pointed at', () => {
    const album = removeShootAt(three(), 0).deliverables?.find((d) => d.title === 'Album')
    expect(album).toMatchObject({ start_rule: 'whole_project', shoot_index: null })
  })

  // Without this, everything below the removed shoot silently re-aims one day up.
  it('re-indexes what pointed past the removed shoot', () => {
    const after = removeShootAt(three(), 0)
    expect(after.deliverables?.find((d) => d.title === 'Wedding Reel')?.shoot_index).toBe(1)
    expect(after.deliverables?.find((d) => d.title === 'Teaser')?.shoot_index).toBe(1)
  })
})

describe('shootStartAt', () => {
  it('resolves the studio’s wall clock to an instant', () => {
    const at = shootStartAt({ ...newShoot(), shoot_date: '2026-11-22', start_time: '09:30' })
    expect(at).toBe(new Date('2026-11-22T09:30').toISOString())
  })

  it('sends nothing when either half is missing', () => {
    expect(shootStartAt({ ...newShoot(), shoot_date: '2026-11-22' })).toBeNull()
    expect(shootStartAt({ ...newShoot(), start_time: '09:30' })).toBeNull()
  })
})

describe('deliverable buckets', () => {
  it('reads the bucket off the switches the row already has', () => {
    expect(bucketOf(newClientDeliverable('Photo Album'))).toBe('client')
    expect(bucketOf(newAddOn('Drone Shots'))).toBe('add_on')
    expect(bucketOf(newInternalWork(0, 'Data Sorting'))).toBe('internal')
    // Charged on top but hidden from the client is still internal work.
    expect(bucketOf({ ...newAddOn('X'), visibility_scope: 'internal' })).toBe('internal')
  })

  it('splits the list three ways, keeping each row’s index', () => {
    const d = draft({
      deliverables: [
        newClientDeliverable('Photo Album'),
        newInternalWork(0, 'Data Sorting'),
        newAddOn('Drone Shots'),
      ],
    })
    expect(deliverablesIn(d, 'client').map((r) => r.at)).toEqual([0])
    expect(deliverablesIn(d, 'internal').map((r) => r.at)).toEqual([1])
    expect(deliverablesIn(d, 'add_on').map((r) => r.item.title)).toEqual(['Drone Shots'])
  })
})

describe('adding deliverables', () => {
  it('adds what is missing and skips what is there', () => {
    const existing = [newClientDeliverable('Photo Album')]
    const after = withDeliverables(existing, [
      { title: 'photo album' },
      { title: 'Wedding Teaser' },
    ])
    expect(after.map((d) => d.title)).toEqual(['Photo Album', 'Wedding Teaser'])
  })

  it('returns the same array when a set adds nothing new', () => {
    const existing = [newClientDeliverable('Photo Album')]
    expect(withDeliverables(existing, [{ title: 'Photo Album' }])).toBe(existing)
  })

  it('carries a set’s pricing decisions onto the row', () => {
    const [row] = withDeliverables([], [
      { title: 'Drone Shots', is_additional_charge: true, additional_charge_amount: 15000, show_on_quotation: false },
    ])
    expect(row).toMatchObject({
      title: 'Drone Shots',
      is_additional_charge: true,
      additional_charge_amount: '15000',
      show_on_quotation: false,
    })
  })

  // Every built-in package should be made of chips the studio can also add by hand.
  it('builds its packages out of the quick-add list', () => {
    const known = new Set<string>(QUICK_DELIVERABLES)
    for (const set of BUILT_IN_SETS) {
      for (const title of set.titles) expect(known.has(title)).toBe(true)
    }
  })
})

// The wizard reads storage through globalThis and copes with it missing; the
// node test env has none, so the memory tests bring their own.
describe('lead-time memory', () => {
  const store = new Map<string, string>()
  beforeAll(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    })
  })
  beforeEach(() => store.clear())

  it('recalls the days last used for a title, however it was cased', () => {
    rememberDueDays('Photo Album', '45')
    expect(recallDueDays('photo album')).toBe('45')
    expect(newClientDeliverable('Photo Album').due_days).toBe('45')
  })

  it('has nothing to say about a title it has not seen', () => {
    expect(recallDueDays('Drone Shots')).toBe('')
    // Falls back to what the trade does for drone work, not to blank.
    expect(newClientDeliverable('Drone Shots').due_days).toBe('14')
  })

  it('ignores a blank on either side rather than storing it', () => {
    rememberDueDays('  ', '45')
    rememberDueDays('Teaser', '  ')
    expect(recallDueDays('Teaser')).toBe('')
  })
})

describe('learned deliverables', () => {
  it('puts what the studio used first, newest first, and skips repeats of the built-in list', () => {
    globalThis.localStorage?.removeItem('ipc.project.learnedDeliverables')
    rememberDeliverables(['Coffee Table Book', 'highlight film'])
    rememberDeliverables(['Save the Date Film', 'Coffee table book'])
    expect(learnedDeliverables()).toEqual(['Save the Date Film', 'Coffee table book', 'highlight film'])
    const row = quickDeliverables(learnedDeliverables())
    expect(row.slice(0, 3).every((r) => r.learned)).toBe(true)
    expect(row.filter((r) => r.title.toLowerCase() === 'highlight film')).toHaveLength(1)
  })
})
