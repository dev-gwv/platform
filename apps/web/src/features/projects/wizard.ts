import {
  deliverableDueDate,
  deliverableRuleForTitle,
  computeProjectTotals,
  internalLeadDaysForTitle,
  type DeliverableForTotal,
  type DueBasis,
} from '@ipc/domain'
import type { CreateProjectRequest, CreateShootRequest, DeliverableInput } from '@ipc/contracts'

/**
 * Create Project, as data.
 *
 * A studio sets up a project once and then lives with it for a year, so the
 * flow asks for the whole picture — client, shoots, deliverables, money — one
 * section at a time, and keeps a draft so a phone call in the middle doesn't
 * cost them the work.
 *
 * Everything here is pure: the route renders it, the tests exercise it, and
 * nothing reaches the network until Review.
 */
export const WIZARD_STEPS = ['client', 'shoots', 'deliverables', 'billing', 'review'] as const
export type WizardStep = (typeof WIZARD_STEPS)[number]

export const STEP_LABELS: Record<WizardStep, string> = {
  client: 'Project & Client',
  shoots: 'Shoots',
  deliverables: 'Deliverables',
  billing: 'Billing',
  review: 'Review',
}

export const STEP_HINTS: Record<WizardStep, string> = {
  client: 'Name the project and say who it is for.',
  shoots: 'The days you are shooting. Deliverable dates follow these.',
  deliverables: 'What the client receives, and what costs extra.',
  billing: 'The package price and anything already paid.',
  review: 'Confirm everything before creating the project.',
}

export interface ShootRequirementDraft {
  name: string
  /** Kept as text so a half-typed "1" never becomes NaN mid-keystroke. */
  quantity: string
}

export interface ShootDraft {
  name: string
  shoot_date: string
  /** "HH:MM" as the browser time input gives it; blank when the day is loose. */
  start_time: string
  /** City / Venue as it should print — the map link is a separate field. */
  location: string
  map_link: string
  status: 'planned' | 'confirmed'
  requirements: ShootRequirementDraft[]
}

export interface DeliverableDraft {
  title: string
  /** The brief for whoever picks the work up. Never printed for the client. */
  description: string
  /**
   * The client-facing promise: this many days after the basis below. Separate
   * from `lead_days`, which is production's clock — "45 days after the wedding"
   * and "7 days after the footage lands" are different sentences, and a studio
   * says both.
   */
  due_days: string
  due_basis: DueBasis
  /** Only read when the basis is 'custom'. */
  custom_date: string
  is_additional_charge: boolean
  additional_charge_amount: string
  visibility_scope: 'client' | 'internal'
  show_on_quotation: boolean
  start_rule: 'this_shoot' | 'whole_project' | 'specific_shoots' | 'no_data'
  /** Which shoot it hangs off, for `this_shoot`. Index into the draft's shoots. */
  shoot_index: number | null
  /** Lead time in days; blank means "no schedule yet". */
  lead_days: string
}

export interface PaymentDraft {
  amount: string
  paid_on: string
  mode: string
  reference: string
  // Lovable parity: status/description/GST (all optional, additive).
  status: 'paid' | 'pending'
  description: string
  is_gst: boolean
  gst_number: string
  notes: string
}

export interface ProjectDraft {
  name: string
  show_quotation: boolean
  /** Existing client id, or '' when adding a new one. */
  client_id: string
  new_client_name: string
  new_client_phone: string
  new_client_email: string
  new_client_address: string
  new_client_notes: string
  new_client_relation: string
  package_cost: string
  shoots: ShootDraft[]
  deliverables: DeliverableDraft[]
  payments: PaymentDraft[]
}

export const EMPTY_DRAFT: ProjectDraft = {
  name: '',
  show_quotation: true,
  client_id: '',
  new_client_name: '',
  new_client_phone: '',
  new_client_email: '',
  new_client_address: '',
  new_client_notes: '',
  new_client_relation: '',
  package_cost: '',
  shoots: [],
  deliverables: [],
  payments: [],
}

export const newShoot = (): ShootDraft => ({
  name: '',
  shoot_date: '',
  start_time: '',
  location: '',
  map_link: '',
  status: 'planned',
  requirements: [],
})

export const newRequirement = (): ShootRequirementDraft => ({ name: '', quantity: '1' })

/**
 * Every shoot day a studio books, alphabetical so a 17-row list can be
 * skimmed rather than read. This is the searchable list behind "Add shoot";
 * anything not on it is still typed by hand, and nothing here is enforced —
 * a shoot's name is free text all the way to the API.
 */
export const SHOOT_TYPES = [
  'Birthday',
  'Cocktail',
  'Couple Shoot',
  'Engagement',
  'Haldi',
  'Haldi Bride',
  'Haldi Groom',
  'Kirtan',
  'Mahuratam',
  'Mehendi',
  'Pre-Wedding Shoot',
  'Reception',
  'Ring Ceremony',
  'Roka',
  'Sangeet',
  'Tilak',
  'Wedding Day',
] as const

/**
 * The six that earn a chip beside the button. The full list lives one click
 * away — a row of seventeen chips is a wall, not a shortcut.
 */
export const QUICK_SHOOTS = [
  'Engagement',
  'Haldi',
  'Mehendi',
  'Wedding Day',
  'Reception',
  'Couple Shoot',
] as const

/** What "Apply preset" lays down — the spine of a standard wedding booking. */
export const SHOOT_PRESET = ['Haldi', 'Mehendi', 'Wedding Day', 'Reception'] as const

/**
 * Filter the type list for the search box: case-insensitive, matches anywhere
 * in the name so "haldi" finds all three Haldis and "shoot" finds the couple
 * and pre-wedding ones.
 *
 * `extra` is this studio's own saved shoot names — a "Pool Party" or
 * "Baby Shower" they've booked before but that never earns a spot on the
 * common list. Merged ahead of the search, deduped case-insensitively so a
 * studio's own "Haldi" preset does not double the built-in one.
 */
export function matchShootTypes(query: string, extra: readonly string[] = []): string[] {
  const seen = new Set<string>()
  const all: string[] = []
  for (const name of [...SHOOT_TYPES, ...extra]) {
    const key = name.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    all.push(name)
  }
  const q = query.trim().toLowerCase()
  if (!q) return all
  return all.filter((t) => t.toLowerCase().includes(q))
}

/**
 * Append named shoots, skipping any name already on the list.
 *
 * The skip is what makes the preset safe to press twice. It compares trimmed
 * and case-folded: a day typed by hand as "haldi" is the day the chip would
 * otherwise add again.
 */
export function withShoots(existing: ShootDraft[], names: readonly string[]): ShootDraft[] {
  const taken = new Set(existing.map((s) => s.name.trim().toLowerCase()))
  const added: ShootDraft[] = []
  for (const name of names) {
    const key = name.trim().toLowerCase()
    if (!key || taken.has(key)) continue
    taken.add(key)
    added.push({ ...newShoot(), name })
  }
  return added.length ? [...existing, ...added] : existing
}

export const newDeliverable = (): DeliverableDraft => ({
  title: '',
  description: '',
  due_days: '',
  due_basis: 'after_wedding_day',
  custom_date: '',
  is_additional_charge: false,
  additional_charge_amount: '',
  visibility_scope: 'client',
  show_on_quotation: true,
  start_rule: 'whole_project',
  shoot_index: null,
  lead_days: '',
})

export const newPayment = (): PaymentDraft => ({ amount: '', paid_on: '', mode: '', reference: '', status: 'paid', description: '', is_gst: false, gst_number: '', notes: '' })

/** '' → 0, so a blank money field never becomes NaN in a total. */
export const money = (v: string): number => {
  const n = Number(v)
  return v.trim() === '' || Number.isNaN(n) ? 0 : n
}

const days = (v: string): number | undefined => {
  const n = Number(v)
  return v.trim() === '' || Number.isNaN(n) ? undefined : Math.max(0, Math.trunc(n))
}

/** Today as "YYYY-MM-DD", for a basis counted from the project itself. */
const todayISO = (): string => {
  const at = new Date()
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}

/**
 * The date a deliverable lands on. Null = unknown.
 *
 * Read off the client promise, not the production clock: this is the date that
 * goes on the quotation, so it has to be the one the studio said out loud.
 */
export function estimatedDateFor(draft: ProjectDraft, d: DeliverableDraft): string | null {
  return deliverableDueDate(
    d.due_basis,
    draft.shoots.map((s) => ({ name: s.name, shoot_date: s.shoot_date || null })),
    days(d.due_days),
    d.custom_date || null,
    todayISO(),
  )
}

const forTotal = (d: DeliverableDraft): DeliverableForTotal => ({
  visibility_scope: d.visibility_scope,
  show_on_quotation: d.show_on_quotation,
  is_additional_charge: d.is_additional_charge,
  additional_charge_amount: money(d.additional_charge_amount),
})

export interface DraftTotals {
  packageCost: number
  addOns: number
  total: number
  /** Money that came in. A "promised" payment is not here. */
  received: number
  /** Payments the client promised but has not paid yet. */
  promised: number
  balance: number
}

/**
 * The running total, shown on every step. Add-ons follow the domain rule (only
 * client-visible, quoted, chargeable deliverables count), so the footer can
 * never disagree with what the server computes after save.
 */
export function draftTotals(draft: ProjectDraft): DraftTotals {
  const packageCost = money(draft.package_cost)
  const { additional_deliverables_cost, total_cost } = computeProjectTotals(
    packageCost,
    draft.deliverables.map(forTotal),
  )
  const received = draft.payments.filter((p) => p.status !== 'pending').reduce((sum, p) => sum + money(p.amount), 0)
  const promised = draft.payments.filter((p) => p.status === 'pending').reduce((sum, p) => sum + money(p.amount), 0)
  return {
    packageCost,
    addOns: additional_deliverables_cost,
    total: total_cost,
    received,
    promised,
    balance: Math.max(0, total_cost - received),
  }
}

export type StepErrors = Partial<Record<WizardStep, string>>

/**
 * What still blocks each step. Only the client step is ever truly required —
 * a studio that just wants the project on the board should not have to invent
 * shoots or line items to get past step 2.
 *
 * Lovable parity: new-client phone is required + validated (min 7 digits),
 * email/address/notes/relation travel with the inline create.
 */
export function stepErrors(draft: ProjectDraft): StepErrors {
  const errors: StepErrors = {}

  if (!draft.name.trim()) errors.client = 'Give the project a name.'
  else if (!draft.client_id && !draft.new_client_name.trim()) errors.client = 'Pick or add a client.'
  else if (!draft.client_id) {
    const phoneDigits = draft.new_client_phone.replace(/\D/g, '')
    if (!phoneDigits) errors.client = 'New client needs a phone number.'
    else if (phoneDigits.length < 7) errors.client = 'That phone number looks too short.'
    if (!errors.client && draft.new_client_email.trim()) {
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.new_client_email.trim())
      if (!emailOk) errors.client = 'That email address does not look right.'
    }
  }

  if (draft.shoots.some((s) => !s.name.trim())) errors.shoots = 'Every shoot needs a name.'

  if (draft.deliverables.some((d) => !d.title.trim())) {
    errors.deliverables = 'Every deliverable needs a title.'
  } else if (
    draft.deliverables.some((d) => d.is_additional_charge && money(d.additional_charge_amount) <= 0)
  ) {
    errors.deliverables = 'A chargeable deliverable needs an amount.'
  }

  const totals = draftTotals(draft)
  if (draft.payments.some((p) => money(p.amount) <= 0)) errors.billing = 'Every payment needs an amount.'
  else if (totals.received + totals.promised > totals.total && totals.total > 0) {
    errors.billing = 'The payments add up to more than the project total.'
  }

  return errors
}

export const canLeave = (step: WizardStep, draft: ProjectDraft): boolean => !stepErrors(draft)[step]

/** Ready to create: every step clean, not just the one on screen. */
export const canSubmit = (draft: ProjectDraft): boolean =>
  Object.keys(stepErrors(draft)).length === 0

export const stepIndex = (step: WizardStep): number => WIZARD_STEPS.indexOf(step)

export function nextStep(step: WizardStep): WizardStep {
  return WIZARD_STEPS[Math.min(stepIndex(step) + 1, WIZARD_STEPS.length - 1)]!
}

export function prevStep(step: WizardStep): WizardStep {
  return WIZARD_STEPS[Math.max(stepIndex(step) - 1, 0)]!
}

/** Draft → the create payload. Blank rows are dropped, not sent as empties. */
/** One wizard row as the API takes it. */
function toDeliverableInput(draft: ProjectDraft, d: DeliverableDraft): DeliverableInput {
  const estimated = estimatedDateFor(draft, d)
  const lead = days(d.lead_days)
  return {
    title: d.title.trim(),
    list_key: 'primary',
    ...(d.description.trim() ? { description: d.description.trim() } : {}),
    is_additional_charge: d.is_additional_charge,
    additional_charge_amount: d.is_additional_charge ? money(d.additional_charge_amount) : 0,
    visibility_scope: d.visibility_scope,
    // Team work is never on the quotation, whatever the row's switch says.
    show_on_quotation: d.visibility_scope === 'client' && d.show_on_quotation,
    start_rule: d.start_rule,
    ...(lead !== undefined ? { delivery_days_after_start: lead } : {}),
    ...(estimated ? { estimated_date: estimated } : {}),
  }
}

/** Is this row tied to a shoot that will actually be created? */
const onRealShoot = (draft: ProjectDraft, d: DeliverableDraft) =>
  d.shoot_index !== null && !!draft.shoots[d.shoot_index]?.name.trim()

/**
 * Deliverables tied to a shoot, keyed by the shoot's position in the draft.
 * They can only be saved once that shoot exists, so the wizard adds them
 * right after creating it -- sending them with the project lost the link.
 */
export function shootDeliverables(draft: ProjectDraft): Map<number, DeliverableInput[]> {
  const out = new Map<number, DeliverableInput[]>()
  for (const d of draft.deliverables) {
    if (!d.title.trim() || !onRealShoot(draft, d)) continue
    const list = out.get(d.shoot_index!) ?? []
    list.push(toDeliverableInput(draft, d))
    out.set(d.shoot_index!, list)
  }
  return out
}

export function toProjectRequest(draft: ProjectDraft, clientId: string): CreateProjectRequest {
  const deliverables: DeliverableInput[] = draft.deliverables
    .filter((d) => d.title.trim() && !onRealShoot(draft, d))
    .map((d) => toDeliverableInput(draft, d))

  return {
    client_id: clientId,
    name: draft.name.trim(),
    package_cost: money(draft.package_cost),
    status: 'active',
    show_quotation: draft.show_quotation,
    deliverables,
    payments: draft.payments
      .filter((p) => money(p.amount) > 0)
      .map((p) => ({
        amount: money(p.amount),
        ...(p.paid_on ? { paid_on: p.paid_on } : {}),
        ...(p.mode.trim() ? { mode: p.mode.trim() } : {}),
        ...(p.reference.trim() ? { reference: p.reference.trim() } : {}),
        ...(p.status && p.status !== 'paid' ? { status: p.status } : {}),
        ...((p.description.trim() || p.notes.trim()) ? { description: (p.description.trim() || p.notes.trim()) } : {}),
        ...(p.notes.trim() ? { notes: p.notes.trim() } : {}),
        ...(p.is_gst ? { is_gst: true } : {}),
        ...(p.gst_number.trim() ? { gst_number: p.gst_number.trim() } : {}),
      })),
  }
}

/** Inline new-client payload (email/address/notes/relation travel with the create). */
export function toNewClientRequest(draft: ProjectDraft): {
  name: string
  phone: string
  email?: string
  address?: string
  notes?: string
  relation?: string
} {
  return {
    name: draft.new_client_name.trim(),
    phone: draft.new_client_phone.trim(),
    ...(draft.new_client_email.trim() ? { email: draft.new_client_email.trim() } : {}),
    ...(draft.new_client_address.trim() ? { address: draft.new_client_address.trim() } : {}),
    ...(draft.new_client_notes.trim() ? { notes: draft.new_client_notes.trim() } : {}),
    ...(draft.new_client_relation.trim() ? { relation: draft.new_client_relation.trim() } : {}),
  }
}

/** Shoots are created after the project, so they need its id. */
export function toShootRequests(draft: ProjectDraft, projectId: string): (CreateShootRequest & { draftIndex: number })[] {
  return draft.shoots
    .map((s, draftIndex) => ({ s, draftIndex }))
    .filter(({ s }) => s.name.trim())
    .map(({ s, draftIndex }) => {
      const startAt = shootStartAt(s)
      return {
        draftIndex,
        project_id: projectId,
        name: s.name.trim(),
        status: s.status,
        ...(s.shoot_date ? { shoot_date: s.shoot_date } : {}),
        ...(startAt ? { start_at: startAt } : {}),
        ...(s.location.trim() ? { location: s.location.trim() } : {}),
        ...(s.map_link.trim() ? { map_link: s.map_link.trim() } : {}),
        requirements: s.requirements
          .filter((r) => r.name.trim())
          .map((r) => ({ name: r.name.trim(), quantity: Math.max(1, Number(r.quantity) || 1) })),
      }
    })
}

/**
 * What is still missing from a shoot, as the card's chips read it.
 *
 * Deliberately not errors: a studio can save a project with a shoot that has
 * no date and no crew yet — the chips are the reminder, `stepErrors` is the
 * gate, and only a missing title actually blocks.
 */
export function shootIssues(shoot: ShootDraft): string[] {
  const issues: string[] = []
  if (!shoot.name.trim() || !shoot.shoot_date) issues.push('Title & date needed')
  // The crew needs a call time as much as a date; a shoot without one is not
  // ready to book people onto, even if nothing stops the project saving.
  if (!shoot.start_time) issues.push('Time needed')
  if (shoot.requirements.filter((r) => r.name.trim()).length === 0) issues.push('No requirements')
  return issues
}

/**
 * The edit-room items this kind of day usually needs, offered as chips.
 *
 * Derived from the shoot's own name rather than a lookup table, so a studio
 * that types "Roka Night" gets "Roka Night Edited Photos" without anyone
 * having listed that ceremony anywhere. The one exception is "wedding" itself
 * — common enough, and specific enough in what a studio actually delivers for
 * it (a highlight film is not the same line item as a same-day teaser), that
 * a richer fixed list earns its keep without giving up on the generic
 * fallback for every other ceremony name.
 */
export function internalWorkSuggestions(shootName: string): string[] {
  const name = shootName.trim()
  if (!name) return ['Edited Photos', 'Reel', 'Data Sorting']
  if (/wedding/i.test(name)) {
    return [
      `${name} Raw Photos`,
      `${name} Edited Photos`,
      `${name} Highlight Film`,
      'Full Wedding Film',
      `${name} Reel`,
      `${name} Teaser`,
      'Full Ceremony Video',
      'Data Sorting',
      'Quality Check',
    ]
  }
  return [`${name} Edited Photos`, `${name} Reel`, 'Data Sorting']
}

/**
 * An internal deliverable belonging to one shoot: the team's own list, pinned
 * to that day so its dates follow the shoot, and off the quotation because a
 * client is not buying "data sorting" — they are buying the album it feeds.
 */
export function newInternalWork(shootIndex: number, title = ''): DeliverableDraft {
  const rule = deliverableRuleForTitle(title)
  return {
    ...newDeliverable(),
    title,
    ...(title.trim()
      ? { due_days: String(rule.due_days), due_basis: rule.due_basis }
      : {}),
    lead_days: title.trim() ? String(internalLeadDaysForTitle(title)) : '',
    visibility_scope: 'internal',
    show_on_quotation: false,
    start_rule: 'this_shoot',
    shoot_index: shootIndex,
  }
}

/** The internal work pinned to one shoot, with its index in draft.deliverables. */
export function internalWorkFor(
  draft: ProjectDraft,
  shootIndex: number,
): { at: number; item: DeliverableDraft }[] {
  const out: { at: number; item: DeliverableDraft }[] = []
  draft.deliverables.forEach((item, at) => {
    if (item.visibility_scope === 'internal' && item.shoot_index === shootIndex) out.push({ at, item })
  })
  return out
}

/**
 * Drop a shoot without leaving its deliverables pointing at the wrong day.
 *
 * `shoot_index` is positional, so removing shoot 0 silently re-aims everything
 * below it — a teaser dated off the Haldi would start counting from the
 * Mehendi. Internal work belonged to the shoot and goes with it; anything
 * client-visible is kept and unpinned, because that is someone's line item and
 * their money, not ours to delete.
 */
export function removeShootAt(draft: ProjectDraft, index: number): Partial<ProjectDraft> {
  const deliverables: DeliverableDraft[] = []
  for (const d of draft.deliverables) {
    if (d.shoot_index === index) {
      if (d.visibility_scope === 'internal') continue
      deliverables.push({ ...d, start_rule: 'whole_project', shoot_index: null })
      continue
    }
    deliverables.push(
      d.shoot_index !== null && d.shoot_index > index ? { ...d, shoot_index: d.shoot_index - 1 } : d,
    )
  }
  return { shoots: draft.shoots.filter((_, i) => i !== index), deliverables }
}

/**
 * Date + time as one instant, for `start_at`.
 *
 * The studio types a local wall-clock time; the column is a timestamptz, so
 * the offset has to be resolved here rather than sent as a naive string the
 * server would have to guess about. No date, or a time the browser cannot
 * make sense of, means no instant to send.
 */
export function shootStartAt(shoot: ShootDraft): string | null {
  if (!shoot.shoot_date || !shoot.start_time) return null
  const at = new Date(`${shoot.shoot_date}T${shoot.start_time}`)
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}

/**
 * The line items a wedding studio actually sells, as chips.
 *
 * Ordered the way a quotation reads — film first, then photographs, then the
 * physical album — rather than alphabetically, because this list is scanned
 * while talking to a client, not searched.
 */
export const QUICK_DELIVERABLES = [
  'Wedding Teaser',
  'Full Wedding Film',
  'Highlight Film',
  'Instagram Reels Pack',
  'Wedding Film',
  'Traditional Video',
  'Candid Photos',
  'Edited Photos',
  'Raw Photos',
  'Photo Album',
  'Teaser',
  'Reel / Short Video',
  'Drone Shots',
  'Full Ceremony Video',
] as const

/**
 * The three packages nearly every studio starts from, so "Load set" is useful
 * on day one — before anyone has saved a set of their own. A studio's own sets
 * come from the server and sit beside these.
 */
export const BUILT_IN_SETS: { name: string; titles: string[] }[] = [
  {
    name: 'Basic Wedding Package',
    titles: ['Edited Photos', 'Wedding Teaser', 'Photo Album'],
  },
  {
    name: 'Premium Wedding Package',
    titles: ['Edited Photos', 'Candid Photos', 'Wedding Teaser', 'Highlight Film', 'Photo Album'],
  },
  {
    name: 'Luxury Wedding Package',
    titles: [
      'Edited Photos',
      'Candid Photos',
      'Raw Photos',
      'Wedding Teaser',
      'Highlight Film',
      'Full Wedding Film',
      'Instagram Reels Pack',
      'Drone Shots',
      'Photo Album',
    ],
  },
]

/**
 * Which of the three lists on the Deliverables step a row belongs to.
 *
 * Not a stored field: the bucket falls out of the two switches the row already
 * has, so moving an item between lists is done by the same toggles that decide
 * what it costs and who sees it — there is no third source of truth to drift.
 */
export type DeliverableBucket = 'client' | 'add_on' | 'internal'

export function bucketOf(d: DeliverableDraft): DeliverableBucket {
  if (d.visibility_scope === 'internal') return 'internal'
  return d.is_additional_charge ? 'add_on' : 'client'
}

/** The rows in one bucket, each with its index in draft.deliverables. */
export function deliverablesIn(
  draft: ProjectDraft,
  bucket: DeliverableBucket,
): { at: number; item: DeliverableDraft }[] {
  const out: { at: number; item: DeliverableDraft }[] = []
  draft.deliverables.forEach((item, at) => {
    if (bucketOf(item) === bucket) out.push({ at, item })
  })
  return out
}

const LEAD_KEY = 'ipc.project.leadDays'

/**
 * How long "Photo Album" takes, remembered from the last time this studio
 * quoted one.
 *
 * Per-device on purpose: it is a typing shortcut, not a policy. Two people at
 * the same studio may work to different turnarounds, and neither should
 * silently rewrite the other's — which is why sets go to the server and this
 * stays in the browser. Told to the user in as many words on the step.
 */
function readLeadMemory(): Record<string, string> {
  try {
    const raw = globalThis.localStorage?.getItem(LEAD_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export function recallDueDays(title: string): string {
  const key = title.trim().toLowerCase()
  return key ? (readLeadMemory()[key] ?? '') : ''
}

export function rememberDueDays(title: string, dueDays: string): void {
  const key = title.trim().toLowerCase()
  const value = dueDays.trim()
  if (!key || !value) return
  try {
    globalThis.localStorage?.setItem(LEAD_KEY, JSON.stringify({ ...readLeadMemory(), [key]: value }))
  } catch {
    // A blocked localStorage costs the shortcut, not the deliverable.
  }
}

const LEARNED_KEY = 'ipc.project.learnedDeliverables'
const LEARNED_MAX = 12

/**
 * Deliverables this studio has actually promised, newest first, offered back
 * as quick-add chips.
 *
 * The built-in chips are a generic wedding list. A studio that sells a
 * "Coffee Table Book" or a "Save the Date Film" typed it by hand on every
 * project, because the chips never learned. Per-device, like the lead-time
 * memory above and for the same reason: it is a typing shortcut.
 */
export function learnedDeliverables(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(LEARNED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

/** Record titles just used; most recent first, no case-duplicates, capped. */
export function rememberDeliverables(titles: readonly string[]): void {
  const fresh = titles.map((t) => t.trim()).filter(Boolean)
  if (fresh.length === 0) return
  const seen = new Set<string>()
  const next = [...fresh, ...learnedDeliverables()].filter((t) => {
    const k = t.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  try {
    globalThis.localStorage?.setItem(LEARNED_KEY, JSON.stringify(next.slice(0, LEARNED_MAX)))
  } catch {
    // A blocked localStorage costs the shortcut, not the project.
  }
}

/**
 * The quick-add row: what this studio has used first, then the built-in list,
 * without repeating a title that is in both.
 */
export function quickDeliverables(learned: readonly string[]): { title: string; learned: boolean }[] {
  const out = learned.map((title) => ({ title, learned: true }))
  const have = new Set(learned.map((t) => t.toLowerCase()))
  for (const title of QUICK_DELIVERABLES) {
    if (!have.has(title.toLowerCase())) out.push({ title, learned: false })
  }
  return out
}

/**
 * A client line item, timed the way this studio times that thing: what they
 * used last, else what the trade generally does.
 */
export function newClientDeliverable(title = ''): DeliverableDraft {
  const rule = deliverableRuleForTitle(title)
  const remembered = recallDueDays(title)
  return {
    ...newDeliverable(),
    title,
    due_days: remembered || (title.trim() ? String(rule.due_days) : ''),
    due_basis: rule.due_basis,
  }
}

/** An extra billed on top of the package. */
export function newAddOn(title = ''): DeliverableDraft {
  return {
    ...newClientDeliverable(title),
    is_additional_charge: true,
  }
}

/**
 * Add titles that are not on the list already, so a chip pressed twice and a
 * set loaded over a half-filled list both do the obvious thing.
 */
export function withDeliverables(
  existing: DeliverableDraft[],
  items: { title: string; is_additional_charge?: boolean; additional_charge_amount?: number; show_on_quotation?: boolean }[],
): DeliverableDraft[] {
  const taken = new Set(existing.map((d) => d.title.trim().toLowerCase()))
  const added: DeliverableDraft[] = []
  for (const item of items) {
    const key = item.title.trim().toLowerCase()
    if (!key || taken.has(key)) continue
    taken.add(key)
    added.push({
      ...newClientDeliverable(item.title.trim()),
      ...(item.is_additional_charge ? { is_additional_charge: true } : {}),
      ...(item.additional_charge_amount
        ? { additional_charge_amount: String(item.additional_charge_amount) }
        : {}),
      ...(item.show_on_quotation === false ? { show_on_quotation: false } : {}),
    })
  }
  return added.length ? [...existing, ...added] : existing
}

/** A draft worth restoring — anything typed beyond the defaults. */
export function isDirty(draft: ProjectDraft): boolean {
  return (
    draft.name.trim() !== '' ||
    draft.client_id !== '' ||
    draft.new_client_name.trim() !== '' ||
    draft.package_cost.trim() !== '' ||
    draft.shoots.length > 0 ||
    draft.deliverables.length > 0 ||
    draft.payments.length > 0
  )
}

export const DRAFT_KEY = 'ipc.project.draft'

interface StoredDraft {
  draft: ProjectDraft
  savedAt: string
}

/**
 * Drafts live in this browser only. A half-typed project is not something to
 * sync across devices — it is a safety net for the tab you are in.
 */
export function saveDraft(draft: ProjectDraft, now: string): void {
  try {
    if (!isDirty(draft)) {
      localStorage.removeItem(DRAFT_KEY)
      return
    }
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ draft, savedAt: now } satisfies StoredDraft))
  } catch {
    // A full or blocked localStorage must never take the form down with it.
  }
}

export function loadDraft(): StoredDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredDraft>
    if (!parsed?.draft || typeof parsed.savedAt !== 'string') return null
    // Merge over the defaults: a draft written before a field existed must not
    // come back missing that field.
    // Shoots are nested, so the same merge has to reach one level down: a
    // draft written before requirements existed comes back without them, and
    // the card would map over undefined.
    const draft = { ...EMPTY_DRAFT, ...parsed.draft }
    return {
      draft: {
        ...draft,
        shoots: draft.shoots.map((s) => ({ ...newShoot(), ...s })),
        deliverables: draft.deliverables.map((d) => ({ ...newDeliverable(), ...d })),
        payments: (draft.payments ?? []).map((p) => ({ ...newPayment(), ...p })),
      },
      savedAt: parsed.savedAt,
    }
  } catch {
    return null
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    // Nothing to do — the draft simply outlives this attempt.
  }
}
