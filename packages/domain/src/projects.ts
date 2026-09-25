import { roundINR, sumINR } from './money'

/**
 * A deliverable's price-affecting shape. Only the three flags + the amount
 * matter for totals; everything else is display/workflow.
 */
export interface DeliverableForTotal {
  visibility_scope: 'client' | 'internal'
  show_on_quotation: boolean
  is_additional_charge: boolean
  additional_charge_amount: number
}

/**
 * THE rule (from the modelling notes): a deliverable adds to the project's
 * additional cost ONLY when it is client-visible AND shown on the quotation
 * AND flagged as an additional charge. Internal deliverables never affect
 * price. This is the single source of truth the DB trigger mirrors and the
 * create-project wizard previews.
 */
export function qualifiesForCharge(d: DeliverableForTotal): boolean {
  return d.visibility_scope === 'client' && d.show_on_quotation && d.is_additional_charge
}

export interface ProjectTotals {
  additional_deliverables_cost: number
  total_cost: number
}

export function computeProjectTotals(
  packageCost: number,
  deliverables: ReadonlyArray<DeliverableForTotal>,
): ProjectTotals {
  const additional = sumINR(
    deliverables.filter(qualifiesForCharge).map((d) => d.additional_charge_amount),
  )
  return {
    additional_deliverables_cost: additional,
    total_cost: roundINR(packageCost + additional),
  }
}

/**
 * When a deliverable is due, given the shoots it hangs off.
 *
 * A studio thinks in "album, 45 days after the wedding day" — not in calendar
 * dates. The rule picks the anchor shoot, adds the lead time, and the wizard
 * shows the result so nobody is typing dates that the schedule already implies:
 *
 *   this_shoot      → the one shoot it was pinned to
 *   specific_shoots → the LAST of the chosen shoots (everything must be shot
 *                     before the edit can start)
 *   whole_project   → the last shoot of the project, same reason
 *   no_data         → nothing to anchor to; the date stays whatever was typed
 *
 * Returns null when there is no anchor yet — an undated shoot, or no shoots at
 * all. Null means "unknown", never "today".
 */
export type DeliverableStartRule = 'this_shoot' | 'whole_project' | 'specific_shoots' | 'no_data'

export interface ShootDate {
  /** "YYYY-MM-DD", or null while the shoot is still unscheduled. */
  shoot_date: string | null
}

export function anchorShootDate(
  rule: DeliverableStartRule,
  shoots: ReadonlyArray<ShootDate>,
  pinnedIndex?: number,
): string | null {
  if (rule === 'no_data') return null
  if (rule === 'this_shoot') {
    const pinned = pinnedIndex === undefined ? undefined : shoots[pinnedIndex]
    return pinned?.shoot_date ?? null
  }
  const dated = shoots.map((s) => s.shoot_date).filter((d): d is string => !!d)
  if (dated.length === 0) return null
  // ISO dates sort lexicographically, so the max is the last shoot.
  return dated.reduce((latest, d) => (d > latest ? d : latest))
}

/** Add whole days to a "YYYY-MM-DD" date, staying in UTC to dodge DST drift. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return isoDate
  const at = new Date(Date.UTC(y, m - 1, d))
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}

/**
 * The estimated delivery date for one deliverable: its anchor shoot plus the
 * agreed lead time. Null when either half is unknown — a guessed delivery date
 * is worse than none, because the client is quoted from it.
 */
export function deliverableEstimatedDate(
  rule: DeliverableStartRule,
  shoots: ReadonlyArray<ShootDate>,
  leadDays: number | undefined,
  pinnedIndex?: number,
): string | null {
  const anchor = anchorShootDate(rule, shoots, pinnedIndex)
  if (anchor === null || leadDays === undefined) return null
  return addDays(anchor, leadDays)
}

/**
 * The other half of the schedule: what a client was promised.
 *
 * `start_rule` above answers "when can the edit start" — a production
 * question, measured from when footage lands. This answers "what did we say
 * on the quotation", and a studio says it against a milestone: forty-five days
 * after the wedding day, thirty after the last shoot. The two disagree often
 * and legitimately, which is why the deliverable carries both.
 */
export type DueBasis =
  | 'after_wedding_day'
  | 'after_last_shoot'
  | 'after_project_created'
  | 'custom'
  | 'custom_after'

export const DUE_BASIS_OPTIONS: ReadonlyArray<{ value: DueBasis; label: string }> = [
  { value: 'after_wedding_day', label: 'After Wedding Day' },
  { value: 'after_last_shoot', label: 'After Last Shoot' },
  { value: 'after_project_created', label: 'After Project Created' },
  { value: 'custom', label: 'Custom Date' },
  { value: 'custom_after', label: 'Days After a Custom Date' },
]

export interface NamedShootDate extends ShootDate {
  name: string
}

/**
 * The wedding day among the shoots, by name.
 *
 * "Wedding Day" exactly first, then anything wedding-ish, because a studio
 * that typed "Wedding Reception" and nothing else still means that day when
 * it says "after the wedding".
 */
export function findWeddingShoot(
  shoots: ReadonlyArray<NamedShootDate>,
): NamedShootDate | null {
  return (
    shoots.find((s) => /wedding\s*day/i.test(s.name)) ??
    shoots.find((s) => /wedding/i.test(s.name)) ??
    null
  )
}

/** The day the promised clock starts. Null when that day is not known yet. */
export function dueBasisAnchor(
  basis: DueBasis,
  shoots: ReadonlyArray<NamedShootDate>,
  today: string,
): string | null {
  if (basis === 'custom' || basis === 'custom_after') return null
  if (basis === 'after_project_created') return today
  if (basis === 'after_wedding_day') return findWeddingShoot(shoots)?.shoot_date ?? null
  const dated = shoots.map((s) => s.shoot_date).filter((d): d is string => !!d)
  if (dated.length === 0) return null
  return dated.reduce((latest, d) => (d > latest ? d : latest))
}

/**
 * The promised date. Null when the anchor is unknown — an undated wedding
 * gives no answer, and a guess would go on a quotation.
 */
export function deliverableDueDate(
  basis: DueBasis,
  shoots: ReadonlyArray<NamedShootDate>,
  dueDays: number | undefined,
  customDate: string | null,
  today: string,
): string | null {
  if (basis === 'custom') return customDate?.trim() ? customDate : null
  if (basis === 'custom_after') {
    if (!customDate?.trim() || dueDays === undefined) return null
    return addDays(customDate, dueDays)
  }
  const anchor = dueBasisAnchor(basis, shoots, today)
  if (anchor === null || dueDays === undefined) return null
  return addDays(anchor, dueDays)
}

export interface DeliverableRule {
  due_days: number
  due_basis: DueBasis
}

/**
 * How long this kind of thing usually takes, by its name.
 *
 * A reel is a week and an album is a quarter, and every studio knows it — so
 * typing the title fills the days rather than making someone look them up.
 * Longest match first, so "Full Wedding Film" is not read as "wedding film"
 * and then, worse, as "film".
 */
const DELIVERABLE_RULES: ReadonlyArray<readonly [string, DeliverableRule]> = [
  ['instagram reels pack', { due_days: 14, due_basis: 'after_wedding_day' }],
  ['full ceremony video', { due_days: 45, due_basis: 'after_wedding_day' }],
  ['reel / short video', { due_days: 7, due_basis: 'after_wedding_day' }],
  ['full wedding film', { due_days: 60, due_basis: 'after_wedding_day' }],
  ['traditional video', { due_days: 60, due_basis: 'after_wedding_day' }],
  ['cinematic film', { due_days: 60, due_basis: 'after_wedding_day' }],
  ['highlight film', { due_days: 30, due_basis: 'after_wedding_day' }],
  ['wedding film', { due_days: 60, due_basis: 'after_wedding_day' }],
  ['edited photos', { due_days: 30, due_basis: 'after_last_shoot' }],
  ['candid photos', { due_days: 30, due_basis: 'after_last_shoot' }],
  ['photo album', { due_days: 90, due_basis: 'after_wedding_day' }],
  ['drone shots', { due_days: 14, due_basis: 'after_last_shoot' }],
  ['raw photos', { due_days: 7, due_basis: 'after_last_shoot' }],
  ['teaser', { due_days: 7, due_basis: 'after_wedding_day' }],
  ['reel', { due_days: 7, due_basis: 'after_wedding_day' }],
]

export const DEFAULT_DELIVERABLE_RULE: DeliverableRule = {
  due_days: 30,
  due_basis: 'after_wedding_day',
}

export function deliverableRuleForTitle(title: string): DeliverableRule {
  const key = title.trim().toLowerCase()
  if (!key) return DEFAULT_DELIVERABLE_RULE
  const hit = DELIVERABLE_RULES.find(([name]) => key === name) ??
    DELIVERABLE_RULES.find(([name]) => key.includes(name))
  return hit ? hit[1] : DEFAULT_DELIVERABLE_RULE
}

/**
 * How soon internal work is due once its data lands, by its name.
 *
 * Backing up cards is a day; a film is a month. Same idea as the rule above,
 * on the production side of the deliverable rather than the client side.
 */
export function internalLeadDaysForTitle(title: string): number {
  const t = title.trim().toLowerCase()
  if (/raw\s*(photo|foot|video|pic)/.test(t)) return 2
  if (/(data\s*sort|sorting|data\s*copy|copy\s*data|backup)/.test(t)) return 1
  if (/(film|long\s*video|full\s*video|cinematic)/.test(t)) return 30
  return 7
}

/**
 * One of the studio's own deliverable types, as far as timing goes: its name,
 * when the client gets it, and the days of work it needs. Any number may be
 * unset, and then the built-in guess answers for it.
 */
export interface StudioDeliverableType {
  title: string
  due_days: number | null
  due_basis: string | null
  work_days: number | null
  is_archived?: boolean
}

/** A type's days count from an event, never from a date typed on one project. */
const TYPE_BASES: ReadonlySet<string> = new Set<DueBasis>([
  'after_wedding_day',
  'after_last_shoot',
  'after_project_created',
])

/**
 * The studio's live type with this name, if it has one. The whole name must
 * match, ignoring case and spaces at the ends -- the same way the database
 * matches it (company_work_days, 0179), so both sides pick the same type.
 */
export function findStudioType<T extends StudioDeliverableType>(
  types: ReadonlyArray<T>,
  title: string,
): T | null {
  const key = title.trim().toLowerCase()
  if (!key) return null
  return types.find((t) => !t.is_archived && t.title.trim().toLowerCase() === key) ?? null
}

export interface DeliverableTimings {
  due_days: number
  due_basis: DueBasis
  work_days: number
  /** The studio's type the numbers came from, or null when none matched. */
  own: StudioDeliverableType | null
}

/**
 * The numbers a deliverable starts with, by its name: what the studio said
 * that thing takes, and the trade's usual numbers for anything it left unset.
 */
export function deliverableTimings(
  title: string,
  types: ReadonlyArray<StudioDeliverableType> = [],
): DeliverableTimings {
  const own = findStudioType(types, title)
  const rule = deliverableRuleForTitle(title)
  return {
    due_days: own?.due_days ?? rule.due_days,
    due_basis: own?.due_basis && TYPE_BASES.has(own.due_basis) ? (own.due_basis as DueBasis) : rule.due_basis,
    work_days: own?.work_days ?? internalLeadDaysForTitle(title),
    own,
  }
}
